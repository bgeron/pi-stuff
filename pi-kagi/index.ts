import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { Type } from "typebox";

const KAGI_API_BASE = "https://kagi.com/api/v1";
const STATE_KEY = Symbol.for("pi-extension:kagi:state");
const GLOBAL_SETTINGS_PATH = join(homedir(), ".pi", "agent", "settings.json");

type KagiState = {
	apiKey?: string;
	apiKeyPromise?: Promise<string>;
	promptedThisRun: boolean;
};

type KagiSettings = {
	apiKey?: string;
};

type SettingsJson = Record<string, unknown> & {
	kagi?: KagiSettings;
};

type TextContent = { type: "text"; text: string };

type SearchResult = {
	url: string;
	title: string;
	snippet?: string;
	time?: string;
	image?: { url: string; height?: number; width?: number };
	props?: Record<string, unknown>;
};

type KagiErrorDetail = {
	code?: string;
	message?: string | null;
	location?: string | null;
	url?: string;
};

type KagiResponse<T> = {
	meta?: { trace?: string; node?: string; ms?: number };
	data?: T;
	error?: KagiErrorDetail[];
	errors?: KagiErrorDetail[];
};

type SearchParams = {
	query: string;
	workflow?: "search" | "images" | "videos" | "news" | "podcasts";
	limit?: number;
	page?: number;
	timeout?: number;
	region?: string;
	after?: string;
	before?: string;
	safeSearch?: boolean;
	sitesIncluded?: string[];
	sitesExcluded?: string[];
	extractCount?: number;
	extractTimeout?: number;
};

type ExtractParams = {
	urls: string[];
	timeout?: number;
};

type SearchData = Record<string, SearchResult[] | undefined>;
type ExtractData = Array<{ url: string; markdown?: string | null }>;

type ExtractDetails = {
	response?: KagiResponse<ExtractData>;
};

function getState(): KagiState {
	const globalWithState = globalThis as typeof globalThis & { [STATE_KEY]?: KagiState };
	if (!globalWithState[STATE_KEY]) {
		globalWithState[STATE_KEY] = { promptedThisRun: false };
	}
	return globalWithState[STATE_KEY];
}

function readSettingsFile(path: string): SettingsJson {
	if (!existsSync(path)) return {};
	try {
		return JSON.parse(readFileSync(path, "utf8")) as SettingsJson;
	} catch {
		return {};
	}
}

function writeSettingsFile(path: string, settings: SettingsJson): void {
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, `${JSON.stringify(settings, null, 4)}\n`);
}

function getProjectSettingsPath(ctx: ExtensionContext): string {
	return join(ctx.cwd, ".pi", "settings.json");
}

function getKagiSettings(ctx: ExtensionContext): KagiSettings {
	const globalSettings = readSettingsFile(GLOBAL_SETTINGS_PATH).kagi ?? {};
	const projectSettings = readSettingsFile(getProjectSettingsPath(ctx)).kagi ?? {};
	return { ...globalSettings, ...projectSettings };
}

function persistApiKey(apiKey: string): void {
	const settings = readSettingsFile(GLOBAL_SETTINGS_PATH);
	settings.kagi = { ...(settings.kagi ?? {}), apiKey };
	writeSettingsFile(GLOBAL_SETTINGS_PATH, settings);
}

function clearPersistedApiKey(ctx: ExtensionContext): boolean {
	let changed = false;
	for (const path of [GLOBAL_SETTINGS_PATH, getProjectSettingsPath(ctx)]) {
		const settings = readSettingsFile(path);
		if (settings.kagi?.apiKey !== undefined) {
			delete settings.kagi.apiKey;
			writeSettingsFile(path, settings);
			changed = true;
		}
	}
	return changed;
}

async function promptForApiKey(ctx: ExtensionContext): Promise<string> {
	const state = getState();
	if (state.apiKeyPromise) return state.apiKeyPromise;

	if (!ctx.hasUI) {
		throw new Error("Kagi API key is not available in memory, and this pi mode cannot prompt for one.");
	}

	state.promptedThisRun = true;
	state.apiKeyPromise = (async () => {
		const value = await ctx.ui.input(
			"Kagi API key",
			"Enter your Kagi API key. It will be kept in memory only for this Pi process and will not be written to disk.",
		);
		const key = value?.trim();
		if (!key) {
			throw new Error("No Kagi API key entered.");
		}
		state.apiKey = key;
		ctx.ui.notify("Kagi API key loaded in memory. Use /kagi-persist-key if you want to save it to Pi settings for future runs.", "info");
		return key;
	})();

	try {
		return await state.apiKeyPromise;
	} finally {
		state.apiKeyPromise = undefined;
	}
}

async function getApiKey(ctx: ExtensionContext): Promise<string> {
	const state = getState();
	if (state.apiKey) return state.apiKey;
	if (state.apiKeyPromise) return state.apiKeyPromise;

	const settings = getKagiSettings(ctx);
	if (settings.apiKey) {
		state.apiKey = settings.apiKey;
		return settings.apiKey;
	}

	if (state.promptedThisRun) {
		throw new Error(
			"No Kagi API key is available in memory. The extension prompts automatically at most once per pi run. Use /kagi-load-key to enter a key explicitly, or /kagi-clear-key and try again.",
		);
	}

	return promptForApiKey(ctx);
}

export function parseKagiResponseText<T>(text: string): KagiResponse<T> | undefined {
	try {
		return text ? (JSON.parse(text) as KagiResponse<T>) : undefined;
	} catch {
		return undefined;
	}
}

export function formatKagiApiError(status: number, text: string, parsed?: KagiResponse<unknown>): string {
	const errors = parsed?.error ?? parsed?.errors ?? [];
	const detail = errors
		.map((error) => [error.code, error.message, error.location].filter(Boolean).join(": "))
		.filter(Boolean)
		.join("; ");
	const trace = parsed?.meta?.trace ? ` trace=${parsed.meta.trace}` : "";
	const fallback = text ? `: ${text.slice(0, 1000)}` : "";
	return `Kagi API request failed with HTTP ${status}${trace}${detail ? `: ${detail}` : fallback}`;
}

async function postKagi<T>(ctx: ExtensionContext, path: string, body: unknown): Promise<KagiResponse<T>> {
	const apiKey = await getApiKey(ctx);
	const response = await fetch(`${KAGI_API_BASE}${path}`, {
		method: "POST",
		headers: {
			Authorization: `Bearer ${apiKey}`,
			Accept: "application/json",
			"Content-Type": "application/json",
		},
		body: JSON.stringify(body),
		signal: ctx.signal,
	});

	const text = await response.text();
	const parsed = parseKagiResponseText<T>(text);

	if (!response.ok) {
		throw new Error(formatKagiApiError(response.status, text, parsed));
	}

	if (!parsed) {
		throw new Error(`Kagi API returned non-JSON response: ${text.slice(0, 500)}`);
	}

	return parsed;
}

function trimSnippet(snippet: string | undefined, maxLength = 1200): string | undefined {
	if (!snippet) return undefined;
	const normalized = snippet.replace(/\s+/g, " ").trim();
	return normalized.length > maxLength ? `${normalized.slice(0, maxLength - 1)}…` : normalized;
}

function formatSearchResults(response: KagiResponse<SearchData>, params: SearchParams): string {
	const lines: string[] = [`# Kagi ${params.workflow ?? "search"}: ${params.query}`];
	if (response.meta?.trace || response.meta?.ms !== undefined) {
		lines.push("", `Trace: ${response.meta.trace ?? "unknown"}${response.meta.ms !== undefined ? ` (${response.meta.ms} ms)` : ""}`);
	}

	const data = response.data ?? {};
	// Kagi groups heterogeneous search results into dynamic buckets under `data`.
	// For example, a single response can include `search`, `image`, `news`,
	// `code`, `related_search`, or other buckets. Iterate non-empty buckets
	// generically so newly added Kagi result categories still render usefully.
	const buckets = Object.entries(data).filter(([, results]) => Array.isArray(results) && results.length > 0) as Array<[
		string,
		SearchResult[],
	]>;

	if (buckets.length === 0) {
		lines.push("", "No results.");
		return lines.join("\n");
	}

	for (const [bucket, results] of buckets) {
		lines.push("", `## ${bucket}`);
		for (const [index, result] of results.entries()) {
			lines.push("", `${index + 1}. [${result.title}](${result.url})`);
			if (result.time) lines.push(`   - Time: ${result.time}`);
			const snippet = trimSnippet(result.snippet);
			if (snippet) lines.push(`   - Snippet: ${snippet}`);
			if (result.image?.url) lines.push(`   - Image: ${result.image.url}`);
		}
	}

	return lines.join("\n");
}

function formatExtractResults(response: KagiResponse<ExtractData>): string {
	const lines: string[] = ["# Kagi extract"];
	if (response.meta?.trace || response.meta?.ms !== undefined) {
		lines.push("", `Trace: ${response.meta.trace ?? "unknown"}${response.meta.ms !== undefined ? ` (${response.meta.ms} ms)` : ""}`);
	}

	for (const page of response.data ?? []) {
		lines.push("", `## ${page.url}`, "", page.markdown?.trim() || "No markdown extracted.");
	}

	const errors = response.errors ?? response.error ?? [];
	if (errors.length > 0) {
		lines.push("", "## Errors");
		for (const error of errors) {
			lines.push(`- ${[error.code, error.message, error.location].filter(Boolean).join(": ")}`);
		}
	}

	return lines.join("\n");
}

export function formatSearchCall(params: SearchParams, theme: any): string {
	const lines = [theme.fg("toolTitle", theme.bold("kagi_search ")) + theme.fg("accent", params.query)];
	const entries: Array<[string, unknown]> = [
		["workflow", params.workflow ?? "search"],
		["limit", params.limit],
		["page", params.page],
		["timeout", params.timeout !== undefined ? `${params.timeout}s` : undefined],
		["region", params.region?.toLowerCase()],
		["after", params.after],
		["before", params.before],
		["safeSearch", params.safeSearch],
		["sitesIncluded", params.sitesIncluded],
		["sitesExcluded", params.sitesExcluded],
		["extractCount", params.extractCount],
		["extractTimeout", params.extractTimeout !== undefined ? `${params.extractTimeout}s` : undefined],
	];

	for (const [key, value] of entries) {
		if (value === undefined) continue;
		const rendered = Array.isArray(value) ? value.join(", ") : String(value);
		lines.push(theme.fg("dim", `  ${key}: `) + theme.fg("muted", rendered));
	}
	return lines.join("\n");
}

function formatExtractResultForDisplay(response: KagiResponse<ExtractData> | undefined, expanded: boolean, theme: any): string {
	if (!response) return theme.fg("dim", "No extraction details available.");
	const lines: string[] = [];
	const pages = response.data ?? [];
	for (const page of pages) {
		const markdown = page.markdown?.trim();
		const summary = markdown ? `${markdown.length} chars extracted` : "no markdown extracted";
		lines.push(theme.fg("success", "✓ ") + theme.fg("accent", page.url) + theme.fg("dim", ` — ${summary}`));
		if (markdown) {
			const preview = expanded ? markdown : trimSnippet(markdown, 500);
			lines.push(theme.fg("muted", preview));
		}
	}

	const errors = response.errors ?? response.error ?? [];
	for (const error of errors) {
		lines.push(theme.fg("error", `✗ ${[error.code, error.message, error.location].filter(Boolean).join(": ")}`));
	}

	return lines.length > 0 ? lines.join("\n") : theme.fg("dim", "No extraction results.");
}

export function buildSearchRequest(params: SearchParams): Record<string, unknown> {
	const body: Record<string, unknown> = {
		query: params.query,
		workflow: params.workflow ?? "search",
		format: "json",
	};

	for (const key of ["limit", "page", "timeout"] as const) {
		if (params[key] !== undefined) body[key] = params[key];
	}
	if (params.safeSearch !== undefined) body.safe_search = params.safeSearch;

	const filters: Record<string, unknown> = {};
	if (params.region) filters.region = params.region.toLowerCase();
	if (params.after) filters.after = params.after;
	if (params.before) filters.before = params.before;
	if (Object.keys(filters).length > 0) body.filters = filters;

	const lens: Record<string, unknown> = {};
	if (params.sitesIncluded?.length) lens.sites_included = params.sitesIncluded;
	if (params.sitesExcluded?.length) lens.sites_excluded = params.sitesExcluded;
	if (Object.keys(lens).length > 0) body.lens = lens;

	if (params.extractCount !== undefined) {
		body.extract = {
			count: params.extractCount,
			...(params.extractTimeout !== undefined ? { timeout: params.extractTimeout } : {}),
		};
	}

	return body;
}

const searchParameters = Type.Object(
	{
		query: Type.String({ description: "Search query to send to Kagi." }),
		workflow: Type.Optional(
			Type.Union([
				Type.Literal("search"),
				Type.Literal("images"),
				Type.Literal("videos"),
				Type.Literal("news"),
				Type.Literal("podcasts"),
			], { description: "Type of Kagi results to return. Defaults to search." }),
		),
		limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 1024, description: "Maximum number of results to return." })),
		page: Type.Optional(Type.Integer({ minimum: 1, maximum: 10, description: "Page number for paginated results." })),
		timeout: Type.Optional(Type.Number({ minimum: 0.5, maximum: 4, description: "Search timeout in seconds." })),
		region: Type.Optional(Type.String({ description: "Optional ISO 3166-1 alpha-2 country code for localized results." })),
		after: Type.Optional(Type.String({ description: "Only results published or updated after this YYYY-MM-DD date." })),
		before: Type.Optional(Type.String({ description: "Only results published or updated before this YYYY-MM-DD date." })),
		safeSearch: Type.Optional(Type.Boolean({ description: "Whether safe search is enabled. Kagi defaults to true." })),
		sitesIncluded: Type.Optional(Type.Array(Type.String(), { description: "Domains to restrict the search to." })),
		sitesExcluded: Type.Optional(Type.Array(Type.String(), { description: "Domains to exclude from the search." })),
		extractCount: Type.Optional(
			Type.Integer({
				minimum: 1,
				maximum: 10,
				description: "Extract full page markdown into snippets for the top N results. This incurs additional Kagi Extract API cost.",
			}),
		),
		extractTimeout: Type.Optional(Type.Number({ minimum: 0.5, maximum: 4, description: "Per-page extraction timeout in seconds." })),
	},
	{ additionalProperties: false },
);

const extractParameters = Type.Object(
	{
		urls: Type.Array(Type.String(), {
			minItems: 1,
			maxItems: 10,
			description: "HTTP(S) URLs to extract as markdown. Kagi allows 1-10 URLs per request.",
		}),
		timeout: Type.Optional(Type.Number({ minimum: 0.5, maximum: 10, description: "Extraction timeout in seconds." })),
	},
	{ additionalProperties: false },
);

export default function (pi: ExtensionAPI) {
	pi.registerCommand("kagi-clear-key", {
		description: "Forget the in-memory Kagi API key and remove any persisted Kagi API key from Pi settings",
		handler: async (_args, ctx) => {
			const state = getState();
			state.apiKey = undefined;
			state.apiKeyPromise = undefined;
			state.promptedThisRun = false;
			const clearedPersistedKey = clearPersistedApiKey(ctx);
			ctx.ui.notify(clearedPersistedKey ? "Forgot in-memory and persisted Kagi API key." : "Forgot in-memory Kagi API key.", "info");
		},
	});

	pi.registerCommand("kagi-load-key", {
		description: "Prompt for a Kagi API key and load it in memory for this Pi process",
		handler: async (_args, ctx) => {
			await promptForApiKey(ctx);
		},
	});

	pi.registerCommand("kagi-persist-key", {
		description: "Persist the in-memory Kagi API key to Pi global settings",
		handler: async (_args, ctx) => {
			const state = getState();
			if (!state.apiKey) {
				ctx.ui.notify("No Kagi API key is loaded in memory. Use /kagi-load-key or a Kagi tool first to enter one.", "warning");
				return;
			}
			persistApiKey(state.apiKey);
			ctx.ui.notify("Persisted Kagi API key to Pi global settings as kagi.apiKey. Use /kagi-clear-key to remove it.", "info");
		},
	});

	pi.registerCommand("kagi-key-status", {
		description: "Show whether a Kagi API key is currently held in memory or persisted in Pi settings",
		handler: async (_args, ctx) => {
			const state = getState();
			const settings = getKagiSettings(ctx);
			const persisted = Boolean(settings.apiKey);
			if (state.apiKey) {
				ctx.ui.notify(persisted ? "Kagi API key is loaded in memory and persisted in Pi settings." : "Kagi API key is loaded in memory.", "info");
			} else {
				ctx.ui.notify(persisted ? "Kagi API key is persisted in Pi settings." : "No Kagi API key is loaded in memory or persisted.", "info");
			}
		},
	});

	pi.registerTool({
		name: "kagi_search",
		label: "Kagi Search",
		description: "Search the web with Kagi. Uses a persisted Kagi API key if configured, otherwise prompts once and keeps the key in memory only.",
		promptSnippet: "Search the web with Kagi and return cited results.",
		promptGuidelines: [
			"Use kagi_search when current web search results would help answer the user's question.",
			"Do not use kagi_search extractCount unless full page extraction is needed, because it incurs additional Kagi API cost.",
		],
		parameters: searchParameters,
		renderCall(args: SearchParams, theme) {
			return new Text(formatSearchCall(args, theme), 0, 0);
		},
		async execute(_toolCallId, params: SearchParams, _signal, _onUpdate, ctx) {
			const response = await postKagi<SearchData>(ctx, "/search", buildSearchRequest(params));
			return {
				content: [{ type: "text", text: formatSearchResults(response, params) } satisfies TextContent],
				details: { response },
			};
		},
	});

	pi.registerTool({
		name: "kagi_extract",
		label: "Kagi Extract",
		description: "Extract markdown content from up to 10 URLs using Kagi. Uses a persisted Kagi API key if configured, otherwise prompts once and keeps the key in memory only.",
		promptSnippet: "Extract readable markdown from URLs with Kagi.",
		promptGuidelines: ["Use kagi_extract when the user asks to read web pages and URL extraction is preferable to browser automation."],
		parameters: extractParameters,
		renderCall(args: ExtractParams, theme) {
			const urls = Array.isArray(args.urls) ? args.urls : [];
			const lines = [theme.fg("toolTitle", theme.bold("kagi_extract ")) + theme.fg("muted", `${urls.length} URL${urls.length === 1 ? "" : "s"}`)];
			for (const url of urls) {
				lines.push(`  ${theme.fg("accent", url)}`);
			}
			if (args.timeout !== undefined) {
				lines.push(theme.fg("dim", `  timeout: ${args.timeout}s`));
			}
			return new Text(lines.join("\n"), 0, 0);
		},
		renderResult(result, { expanded }, theme) {
			const details = result.details as ExtractDetails | undefined;
			return new Text(formatExtractResultForDisplay(details?.response, expanded, theme), 0, 0);
		},
		async execute(_toolCallId, params: ExtractParams, _signal, onUpdate, ctx) {
			onUpdate?.({
				content: [{ type: "text", text: `Extracting ${params.urls.length} URL${params.urls.length === 1 ? "" : "s"}:\n${params.urls.join("\n")}` }],
				details: { urls: params.urls },
			});
			const response = await postKagi<ExtractData>(ctx, "/extract", {
				pages: params.urls.map((url) => ({ url })),
				format: "json",
				...(params.timeout !== undefined ? { timeout: params.timeout } : {}),
			});
			return {
				content: [{ type: "text", text: formatExtractResults(response) } satisfies TextContent],
				details: { response },
			};
		},
	});
}
