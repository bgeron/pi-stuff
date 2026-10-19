import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { Type } from "typebox";
import { registerKagiActivity } from "./activity.js";

const KAGI_API_BASE = "https://kagi.com/api/v1";
const STATE_KEY = Symbol.for("pi-extension:kagi:state");
const DEFAULT_GLOBAL_SETTINGS_PATH = join(homedir(), ".pi", "agent", "settings.json");
const KAGI_UNAVAILABLE = "Kagi is not available right now.";
export const KAGI_TIMED_SESSION_ACCESS_MS = 30 * 60 * 1000;

export const KAGI_AUTHORIZATION_CHOICES = {
	allowOnce: "Allow once",
	allowThirtyMinutes: "Allow for 30 minutes in session",
	allowSession: "Allow for session",
	allowAlways: "Allow always",
	allowAlwaysAndPersist: "Allow always and persist key",
	denyOnce: "Deny once",
	abort: "Abort",
} as const;

type CredentialScope = "memory" | "global" | "project";
type PersistedScope = Exclude<CredentialScope, "memory">;
type SessionAccess = "unasked" | "enabled";
type BatchDecision = "allow" | "deny";
type SessionAccessSource = "temporary" | "timed" | PersistedScope;

type BatchAuthorization = {
	id: string;
	decision?: BatchDecision;
	decisionPromise?: Promise<void>;
};

export type KagiState = {
	apiKey?: string;
	apiKeySource?: CredentialScope;
	apiKeyPromise?: Promise<string>;
	sessionId?: string;
	sessionAccess: SessionAccess;
	sessionAccessSource?: SessionAccessSource;
	sessionAccessExpiresAt?: number;
	batch?: BatchAuthorization;
	batchSequence: number;
};

type KagiSettings = {
	apiKey?: string;
	enabled?: boolean;
};

type SettingsJson = Record<string, unknown> & {
	kagi?: KagiSettings;
};

type Credential = {
	key: string;
	scope: CredentialScope;
};

type ExtensionOptions = {
	globalSettingsPath?: string;
	state?: KagiState;
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

export function createKagiState(): KagiState {
	return { sessionAccess: "unasked", batchSequence: 0 };
}

function getState(): KagiState {
	const globalWithState = globalThis as typeof globalThis & { [STATE_KEY]?: Partial<KagiState> };
	const state = globalWithState[STATE_KEY] ?? createKagiState();
	state.sessionAccess ??= "unasked";
	state.batchSequence ??= 0;
	if (state.apiKey && !state.apiKeySource) state.apiKeySource = "memory";
	globalWithState[STATE_KEY] = state;
	return state as KagiState;
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

function getScopeSettings(ctx: ExtensionContext, globalSettingsPath: string, scope: PersistedScope): KagiSettings {
	const path = scope === "global" ? globalSettingsPath : getProjectSettingsPath(ctx);
	return readSettingsFile(path).kagi ?? {};
}

function getEffectivePersistedCredential(ctx: ExtensionContext, globalSettingsPath: string): Credential | undefined {
	const project = getScopeSettings(ctx, globalSettingsPath, "project");
	if (project.apiKey) return { key: project.apiKey, scope: "project" };
	const global = getScopeSettings(ctx, globalSettingsPath, "global");
	if (global.apiKey) return { key: global.apiKey, scope: "global" };
	return undefined;
}

function getAvailableCredential(state: KagiState, ctx: ExtensionContext, globalSettingsPath: string): Credential | undefined {
	if (state.apiKey) return { key: state.apiKey, scope: state.apiKeySource ?? "memory" };
	return getEffectivePersistedCredential(ctx, globalSettingsPath);
}

export function hasMatchingPersistentAuthorization(settings: KagiSettings, key: string): boolean {
	return Boolean(settings.apiKey && settings.apiKey === key && settings.enabled === true);
}

function getPersistentAuthorizationScope(
	state: KagiState,
	ctx: ExtensionContext,
	globalSettingsPath: string,
): PersistedScope | undefined {
	const credential = getAvailableCredential(state, ctx, globalSettingsPath);
	if (!credential || credential.scope === "memory") return undefined;
	const settings = getScopeSettings(ctx, globalSettingsPath, credential.scope);
	return hasMatchingPersistentAuthorization(settings, credential.key) ? credential.scope : undefined;
}

function updateKagiSettings(path: string, update: (kagi: KagiSettings) => void): void {
	const settings = readSettingsFile(path);
	const kagi = { ...(settings.kagi ?? {}) };
	update(kagi);
	settings.kagi = kagi;
	writeSettingsFile(path, settings);
}

function persistApiKey(state: KagiState, globalSettingsPath: string, apiKey: string): void {
	updateKagiSettings(globalSettingsPath, (kagi) => {
		kagi.apiKey = apiKey;
	});
	state.apiKey = apiKey;
	state.apiKeySource = "global";
}

function persistAuthorization(
	state: KagiState,
	ctx: ExtensionContext,
	globalSettingsPath: string,
	credential: Credential,
): PersistedScope {
	if (credential.scope === "memory") {
		updateKagiSettings(globalSettingsPath, (kagi) => {
			kagi.apiKey = credential.key;
			kagi.enabled = true;
		});
		state.apiKey = credential.key;
		state.apiKeySource = "global";
		return "global";
	}

	const path = credential.scope === "global" ? globalSettingsPath : getProjectSettingsPath(ctx);
	updateKagiSettings(path, (kagi) => {
		if (!kagi.apiKey || kagi.apiKey !== credential.key) {
			throw new Error(`Cannot persist Kagi authorization without a matching ${credential.scope} API key.`);
		}
		kagi.enabled = true;
	});
	return credential.scope;
}

function clearPersistedSettings(
	ctx: ExtensionContext,
	globalSettingsPath: string,
	options: { apiKey: boolean; authorization: boolean },
): { apiKey: boolean; authorization: boolean } {
	const cleared = { apiKey: false, authorization: false };
	for (const path of [globalSettingsPath, getProjectSettingsPath(ctx)]) {
		const settings = readSettingsFile(path);
		if (!settings.kagi) continue;
		let changed = false;
		if (options.apiKey && settings.kagi.apiKey !== undefined) {
			delete settings.kagi.apiKey;
			cleared.apiKey = true;
			changed = true;
		}
		if (options.authorization && settings.kagi.enabled !== undefined) {
			delete settings.kagi.enabled;
			cleared.authorization = true;
			changed = true;
		}
		if (changed) writeSettingsFile(path, settings);
	}
	return cleared;
}

function isInteractiveMode(ctx: ExtensionContext): boolean {
	const mode = (ctx as ExtensionContext & { mode?: string }).mode;
	return mode ? mode === "tui" : ctx.hasUI;
}

async function promptForApiKey(state: KagiState, ctx: ExtensionContext): Promise<string> {
	if (state.apiKeyPromise) return state.apiKeyPromise;
	if (!ctx.hasUI) {
		throw new Error("Kagi API key is not available in memory, and this pi mode cannot prompt for one.");
	}

	state.apiKeyPromise = (async () => {
		const value = await ctx.ui.input(
			"Kagi API key",
			"Enter your Kagi API key. It will be kept in memory only until you explicitly persist it.",
		);
		const key = value?.trim();
		if (!key) throw new Error("No Kagi API key entered.");
		state.apiKey = key;
		state.apiKeySource = "memory";
		ctx.ui.notify("Kagi API key loaded in memory. Use /kagi-persist-key to save it to Pi settings.", "info");
		return key;
	})();

	try {
		return await state.apiKeyPromise;
	} finally {
		state.apiKeyPromise = undefined;
	}
}

async function getApiKey(state: KagiState, ctx: ExtensionContext, globalSettingsPath: string): Promise<string> {
	if (state.apiKey) return state.apiKey;
	if (state.apiKeyPromise) return state.apiKeyPromise;
	const persisted = getEffectivePersistedCredential(ctx, globalSettingsPath);
	if (persisted) {
		state.apiKey = persisted.key;
		state.apiKeySource = persisted.scope;
		return persisted.key;
	}
	return promptForApiKey(state, ctx);
}

function beginBatch(state: KagiState, id?: string): BatchAuthorization {
	state.batch = { id: id ?? `batch-${++state.batchSequence}` };
	return state.batch;
}

function getBatch(state: KagiState): BatchAuthorization {
	return state.batch ?? beginBatch(state);
}

export function expireTimedKagiSessionAccess(state: KagiState, now = Date.now()): boolean {
	if (state.sessionAccessSource !== "timed" || state.sessionAccessExpiresAt === undefined) return false;
	if (now < state.sessionAccessExpiresAt) return false;
	state.sessionAccess = "unasked";
	state.sessionAccessSource = undefined;
	state.sessionAccessExpiresAt = undefined;
	return true;
}

export function resetKagiSessionAccess(
	state: KagiState,
	sessionId: string,
	persistentScope?: PersistedScope,
): void {
	state.sessionId = sessionId;
	state.sessionAccess = persistentScope ? "enabled" : "unasked";
	state.sessionAccessSource = persistentScope;
	state.sessionAccessExpiresAt = undefined;
	state.batch = undefined;
}

async function promptForAuthorization(
	state: KagiState,
	batch: BatchAuthorization,
	ctx: ExtensionContext,
	globalSettingsPath: string,
): Promise<void> {
	const credential = getAvailableCredential(state, ctx, globalSettingsPath);
	const alwaysChoice = credential?.scope === "global" || credential?.scope === "project"
		? KAGI_AUTHORIZATION_CHOICES.allowAlways
		: KAGI_AUTHORIZATION_CHOICES.allowAlwaysAndPersist;
	const choice = await ctx.ui.select("Allow Kagi access?", [
		KAGI_AUTHORIZATION_CHOICES.allowOnce,
		KAGI_AUTHORIZATION_CHOICES.allowThirtyMinutes,
		KAGI_AUTHORIZATION_CHOICES.allowSession,
		alwaysChoice,
		KAGI_AUTHORIZATION_CHOICES.denyOnce,
		KAGI_AUTHORIZATION_CHOICES.abort,
	]);

	if (choice === KAGI_AUTHORIZATION_CHOICES.allowOnce) {
		batch.decision = "allow";
		return;
	}
	if (choice === KAGI_AUTHORIZATION_CHOICES.allowThirtyMinutes) {
		state.sessionAccess = "enabled";
		state.sessionAccessSource = "timed";
		state.sessionAccessExpiresAt = Date.now() + KAGI_TIMED_SESSION_ACCESS_MS;
		return;
	}
	if (choice === KAGI_AUTHORIZATION_CHOICES.allowSession) {
		state.sessionAccess = "enabled";
		state.sessionAccessSource = "temporary";
		state.sessionAccessExpiresAt = undefined;
		return;
	}
	if (choice === alwaysChoice) {
		const key = credential ?? { key: await promptForApiKey(state, ctx), scope: "memory" as const };
		const scope = persistAuthorization(state, ctx, globalSettingsPath, key);
		state.sessionAccess = "enabled";
		state.sessionAccessSource = scope;
		state.sessionAccessExpiresAt = undefined;
		ctx.ui.notify(`Kagi is always allowed with the ${scope} API key.`, "info");
		return;
	}
	if (choice === KAGI_AUTHORIZATION_CHOICES.denyOnce) {
		batch.decision = "deny";
		throw new Error(KAGI_UNAVAILABLE);
	}

	ctx.abort();
	throw new Error("Kagi access was aborted by the user.");
}

async function ensureKagiAuthorized(
	state: KagiState,
	ctx: ExtensionContext,
	globalSettingsPath: string,
): Promise<void> {
	expireTimedKagiSessionAccess(state);
	if (state.sessionAccess === "enabled") return;
	const batch = getBatch(state);
	if (batch.decision === "allow") return;
	if (batch.decision === "deny") throw new Error(KAGI_UNAVAILABLE);

	if (!isInteractiveMode(ctx)) {
		ctx.abort();
		throw new Error(KAGI_UNAVAILABLE);
	}
	if (!batch.decisionPromise) {
		batch.decisionPromise = promptForAuthorization(state, batch, ctx, globalSettingsPath);
	}
	try {
		await batch.decisionPromise;
	} finally {
		batch.decisionPromise = undefined;
	}
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

async function postKagi<T>(
	state: KagiState,
	ctx: ExtensionContext,
	globalSettingsPath: string,
	path: string,
	body: unknown,
): Promise<KagiResponse<T>> {
	await ensureKagiAuthorized(state, ctx, globalSettingsPath);
	const apiKey = await getApiKey(state, ctx, globalSettingsPath);
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

function formatKagiStatus(state: KagiState, ctx: ExtensionContext, globalSettingsPath: string): string {
	expireTimedKagiSessionAccess(state);
	const credential = getAvailableCredential(state, ctx, globalSettingsPath);
	const keyStatus = credential
		? credential.scope === "memory"
			? "Key: loaded in memory only."
			: `Key: ${credential.scope} settings${state.apiKey ? " (loaded)" : ""}.`
		: "Key: unavailable.";

	const batchStatus = state.batch?.decision === "allow"
		? "Authorization: allowed for the current tool batch."
		: state.batch?.decision === "deny"
			? "Authorization: denied for the current tool batch."
			: undefined;
	const authorizationStatus = batchStatus ?? (state.sessionAccess === "enabled"
		? state.sessionAccessSource === "global" || state.sessionAccessSource === "project"
			? `Authorization: enabled for this session from ${state.sessionAccessSource} settings.`
			: state.sessionAccessSource === "timed"
				? "Authorization: enabled temporarily with a 30-minute session limit."
				: "Authorization: enabled temporarily for this session."
		: "Authorization: awaiting approval.");
	return `${keyStatus} ${authorizationStatus}`;
}

export function registerKagiExtension(pi: ExtensionAPI, options: ExtensionOptions = {}): void {
	const globalSettingsPath = options.globalSettingsPath ?? DEFAULT_GLOBAL_SETTINGS_PATH;
	const state = options.state ?? getState();
	const activity = registerKagiActivity(pi, (event, input, output) => {
		const response = event.result.details?.response;
		if (!response) return undefined;
		// Only summarize details that still match the final text. A tool_result
		// handler may have redacted content without removing the original details.
		if (event.toolName === "kagi_search") {
			const searchResponse = response as KagiResponse<SearchData>;
			if (output !== formatSearchResults(searchResponse, input as SearchParams)) return undefined;
			const count = Object.values(searchResponse.data ?? {})
				.reduce((sum, results) => sum + (Array.isArray(results) ? results.length : 0), 0);
			return `${count} result${count === 1 ? "" : "s"}`;
		}
		const extractResponse = response as KagiResponse<ExtractData>;
		if (output !== formatExtractResults(extractResponse)) return undefined;
		const chars = (extractResponse.data ?? []).reduce((sum, page) => sum + (page.markdown?.trim().length ?? 0), 0);
		return `${chars} chars extracted`;
	});

	pi.on("session_start", (event, ctx) => {
		const sessionId = ctx.sessionManager.getSessionId();
		expireTimedKagiSessionAccess(state);
		if (event.reason === "reload" && state.sessionId === sessionId) {
			state.batch = undefined;
			return;
		}
		const persistentScope = getPersistentAuthorizationScope(state, ctx, globalSettingsPath);
		resetKagiSessionAccess(state, sessionId, persistentScope);
	});

	pi.on("turn_start", (event) => {
		beginBatch(state, `${state.sessionId ?? "session"}:${event.turnIndex}:${event.timestamp}`);
	});

	pi.on("turn_end", () => {
		state.batch = undefined;
	});

	pi.registerCommand("kagi-enable", {
		description: "Enable Kagi for this session, prompting for an in-memory API key if needed",
		handler: async (_args, ctx) => {
			await getApiKey(state, ctx, globalSettingsPath);
			state.sessionAccess = "enabled";
			state.sessionAccessSource = "temporary";
			state.sessionAccessExpiresAt = undefined;
			state.batch = undefined;
			ctx.ui.notify("Kagi enabled for this session.", "info");
		},
	});

	pi.registerCommand("kagi-revoke", {
		description: "Revoke Kagi approval and return to asking on the next use without clearing API keys",
		handler: async (_args, ctx) => {
			clearPersistedSettings(ctx, globalSettingsPath, { apiKey: false, authorization: true });
			state.sessionAccess = "unasked";
			state.sessionAccessSource = undefined;
			state.sessionAccessExpiresAt = undefined;
			state.batch = undefined;
			ctx.ui.notify("Kagi approval revoked. API keys were kept; the next use will ask again.", "info");
		},
	});

	pi.registerCommand("kagi-clear-key", {
		description: "Forget Kagi API keys, remove persistent authorization, and ask again on the next use",
		handler: async (_args, ctx) => {
			state.apiKey = undefined;
			state.apiKeySource = undefined;
			state.apiKeyPromise = undefined;
			state.sessionAccess = "unasked";
			state.sessionAccessSource = undefined;
			state.sessionAccessExpiresAt = undefined;
			state.batch = undefined;
			clearPersistedSettings(ctx, globalSettingsPath, { apiKey: true, authorization: true });
			ctx.ui.notify("Forgot in-memory and persisted Kagi API keys and removed persistent authorization. The next use will ask again.", "info");
		},
	});

	pi.registerCommand("kagi-load-key", {
		description: "Prompt for an in-memory Kagi API key and enable Kagi for this session",
		handler: async (_args, ctx) => {
			await promptForApiKey(state, ctx);
			state.sessionAccess = "enabled";
			state.sessionAccessSource = "temporary";
			state.sessionAccessExpiresAt = undefined;
			state.batch = undefined;
			ctx.ui.notify("Kagi enabled for this session.", "info");
		},
	});

	pi.registerCommand("kagi-persist-key", {
		description: "Persist the loaded Kagi API key to Pi global settings without changing authorization",
		handler: async (_args, ctx) => {
			if (!state.apiKey) {
				ctx.ui.notify("No Kagi API key is loaded in memory. Use /kagi-load-key or a Kagi tool first to enter one.", "warning");
				return;
			}
			persistApiKey(state, globalSettingsPath, state.apiKey);
			ctx.ui.notify("Persisted Kagi API key to global Pi settings. Authorization was not changed.", "info");
		},
	});

	pi.registerCommand("kagi-key-status", {
		description: "Show Kagi API key and authorization status",
		handler: async (_args, ctx) => {
			ctx.ui.notify(formatKagiStatus(state, ctx, globalSettingsPath), "info");
		},
	});

	pi.registerTool({
		name: "kagi_search",
		label: "Kagi Search",
		description: "Search the web with Kagi.",
		promptSnippet: "Search the web with Kagi and return cited results.",
		promptGuidelines: [
			"Use kagi_search when current web search results would help answer the user's question.",
			"Do not use kagi_search extractCount unless full page extraction is needed, because it incurs additional Kagi API cost.",
		],
		parameters: searchParameters,
		renderCall(args: SearchParams, theme) {
			return new Text(formatSearchCall(args, theme), 0, 0);
		},
		async execute(toolCallId, params: SearchParams, signal, _onUpdate, ctx) {
			activity.executing(toolCallId, params, signal ?? ctx.signal, ctx);
			const response = await postKagi<SearchData>(state, ctx, globalSettingsPath, "/search", buildSearchRequest(params));
			return {
				content: [{ type: "text", text: formatSearchResults(response, params) } satisfies TextContent],
				details: { response },
			};
		},
	});

	pi.registerTool({
		name: "kagi_extract",
		label: "Kagi Extract",
		description: "Extract markdown content from URLs with Kagi.",
		promptSnippet: "Extract readable markdown from URLs with Kagi.",
		promptGuidelines: ["Use kagi_extract when the user asks to read web pages and URL extraction is preferable to browser automation."],
		parameters: extractParameters,
		renderCall(args: ExtractParams, theme) {
			const urls = Array.isArray(args.urls) ? args.urls : [];
			const lines = [theme.fg("toolTitle", theme.bold("kagi_extract ")) + theme.fg("muted", `${urls.length} URL${urls.length === 1 ? "" : "s"}`)];
			for (const url of urls) lines.push(`  ${theme.fg("accent", url)}`);
			if (args.timeout !== undefined) lines.push(theme.fg("dim", `  timeout: ${args.timeout}s`));
			return new Text(lines.join("\n"), 0, 0);
		},
		renderResult(result, { expanded }, theme) {
			const details = result.details as ExtractDetails | undefined;
			return new Text(formatExtractResultForDisplay(details?.response, expanded, theme), 0, 0);
		},
		async execute(toolCallId, params: ExtractParams, signal, onUpdate, ctx) {
			activity.executing(toolCallId, params, signal ?? ctx.signal, ctx);
			onUpdate?.({
				content: [{ type: "text", text: `Extracting ${params.urls.length} URL${params.urls.length === 1 ? "" : "s"}:\n${params.urls.join("\n")}` }],
				details: { urls: params.urls },
			});
			const response = await postKagi<ExtractData>(state, ctx, globalSettingsPath, "/extract", {
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

export default function (pi: ExtensionAPI): void {
	registerKagiExtension(pi);
}
