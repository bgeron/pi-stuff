import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { extname, resolve } from "node:path";
import { getAgentDir, SettingsManager, type ExtensionAPI, type ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { parse as parseYaml } from "yaml";

const TERMINAL_PUNCTUATION = /[.!?;:…。！？]$/u;
const LEADING_ATTACHING_PUNCTUATION = /^[,.;:!?…。，、！？；：]/u;
const COMMAND_NAME = /^[^\s/]+$/u;

export interface Snippet {
	prefix: string;
	suffix?: string;
	punctuate?: boolean;
}

export type SnippetMap = Record<string, Snippet>;
export type SnippetDelivery = "steer" | "followUp";

export interface ParsedSnippetArgs {
	args: string;
	deliverAs: SnippetDelivery;
}

type SnippetCommandContext = ExtensionCommandContext & {
	mode: "tui" | "rpc" | "json" | "print";
};

type SettingsWithContinue = {
	continue?: {
		snippets?: unknown;
	};
};

const DEFAULT_SNIPPETS: SnippetMap = {
	c: { prefix: "", suffix: "Continue" },
	continue: { prefix: "", suffix: "Continue" },
};

function trimPart(text: string): string {
	return text.trim();
}

export function isMultiParagraphPrompt(text: string): boolean {
	const lines = text.split(/\r?\n/u);
	return lines.slice(1, -1).some((line) => /^[\s\p{P}]*$/u.test(line));
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getConfiguredSnippets(settings: unknown): unknown {
	return (settings as SettingsWithContinue).continue?.snippets;
}

function configuredSnippetLayers(settingsManager: Pick<SettingsManager, "getGlobalSettings" | "getProjectSettings">): unknown[] {
	return [
		getConfiguredSnippets(settingsManager.getGlobalSettings()),
		getConfiguredSnippets(settingsManager.getProjectSettings()),
	].filter((snippets) => snippets !== undefined);
}

function parseSnippet(commandName: string, value: unknown): Snippet {
	if (typeof value === "string") {
		return { prefix: value };
	}

	if (Array.isArray(value) && (value.length === 1 || value.length === 2) && value.every((item) => typeof item === "string")) {
		const [prefix, suffix] = value;
		return suffix === undefined ? { prefix } : { prefix, suffix };
	}

	if (isPlainObject(value)) {
		const keys = Object.keys(value);
		if (keys.length > 0 && keys.every((key) => key === "prefix" || key === "suffix" || key === "punctuate")) {
			const { prefix, suffix, punctuate } = value;
			if ((prefix === undefined || typeof prefix === "string") &&
				(suffix === undefined || typeof suffix === "string") &&
				(punctuate === undefined || typeof punctuate === "boolean") &&
				(prefix !== undefined || suffix !== undefined)) {
				return {
					prefix: prefix ?? "",
					...(suffix === undefined ? {} : { suffix }),
					...(punctuate === undefined ? {} : { punctuate }),
				};
			}
		}
	}

	throw new Error(
		`Invalid snippet for /${commandName}: expected a string, [prefix], [prefix, suffix], {prefix?, suffix?, punctuate?}, or null`,
	);
}

function applySnippetMap(base: SnippetMap, raw: unknown): SnippetMap {
	if (!isPlainObject(raw)) {
		throw new Error("Invalid continue.snippets: expected an object mapping command names to snippets");
	}

	const snippets: SnippetMap = { ...base };
	for (const [commandName, value] of Object.entries(raw)) {
		if (!COMMAND_NAME.test(commandName)) {
			throw new Error(`Invalid snippet command name ${JSON.stringify(commandName)}: names must be non-empty and contain no whitespace or slash`);
		}
		if (value === null) {
			delete snippets[commandName];
		} else {
			snippets[commandName] = parseSnippet(commandName, value);
		}
	}
	return snippets;
}

export function normalizeSnippetMap(raw: unknown): SnippetMap {
	return applySnippetMap({}, raw);
}

function resolveSnippetPath(path: string): string {
	const expanded = path === "~"
		? homedir()
		: path.startsWith("~/") || path.startsWith("~\\")
			? resolve(homedir(), path.slice(2))
			: path;
	return resolve(getAgentDir(), expanded);
}

function readSnippetFile(path: string): unknown {
	const fullPath = resolveSnippetPath(path);
	const contents = readFileSync(fullPath, "utf8");
	switch (extname(fullPath).toLowerCase()) {
		case ".json":
			return JSON.parse(contents) as unknown;
		case ".yaml":
		case ".yml":
			return parseYaml(contents) as unknown;
		default:
			throw new Error(`Unsupported snippet file extension for ${JSON.stringify(path)}: expected .json, .yaml, or .yml`);
	}
}

function applySnippetFile(base: SnippetMap, path: string): SnippetMap {
	const raw = readSnippetFile(path);
	if (isPlainObject(raw) && "_include" in raw) {
		throw new Error(`Invalid snippet file ${JSON.stringify(path)}: nested _include is not supported`);
	}
	return applySnippetMap(base, raw);
}

function applyConfiguredSnippetMap(base: SnippetMap, raw: unknown): SnippetMap {
	if (!isPlainObject(raw)) {
		throw new Error("Invalid continue.snippets: expected an object mapping command names to snippets");
	}

	let snippets = base;
	const include = raw._include;
	if (include !== undefined) {
		if (!Array.isArray(include) || !include.every((path) => typeof path === "string")) {
			throw new Error("Invalid continue.snippets._include: expected an array of file paths");
		}
		for (const path of include) {
			snippets = applySnippetFile(snippets, path);
		}
	}

	const ownSnippets = Object.fromEntries(Object.entries(raw).filter(([name]) => name !== "_include"));
	return applySnippetMap(snippets, ownSnippets);
}

export function loadSnippets(settingsManager = SettingsManager.create(process.cwd())): SnippetMap {
	let snippets = { ...DEFAULT_SNIPPETS };

	for (const configured of configuredSnippetLayers(settingsManager)) {
		snippets = typeof configured === "string"
			? applySnippetFile(snippets, configured)
			: applyConfiguredSnippetMap(snippets, configured);
	}

	return snippets;
}

function joinSnippetParts(parts: string[], separator: string): string {
	return parts.reduce((message, part) => {
		if (!message) {
			return part;
		}
		return `${message}${LEADING_ATTACHING_PUNCTUATION.test(part) ? "" : separator}${part}`;
	}, "");
}

export function formatSnippetMessage(args: string, snippet: Snippet): string {
	const prefix = trimPart(snippet.prefix);
	const trimmedArgs = trimPart(args);
	const suffix = snippet.suffix === undefined ? undefined : trimPart(snippet.suffix);
	const parts: string[] = [];

	if (prefix) {
		parts.push(prefix);
	}

	const multilinePrompt = isMultiParagraphPrompt(trimmedArgs);

	if (trimmedArgs) {
		const needsPunctuation = snippet.punctuate !== false &&
			snippet.suffix !== undefined &&
			!multilinePrompt &&
			!TERMINAL_PUNCTUATION.test(trimmedArgs) &&
			(suffix === undefined || !LEADING_ATTACHING_PUNCTUATION.test(suffix));
		parts.push(`${trimmedArgs}${needsPunctuation ? "." : ""}`);
	}

	if (suffix) {
		parts.push(suffix);
	}

	return joinSnippetParts(parts, multilinePrompt ? "\n\n" : " ");
}

export function formatContinueMessage(message: string): string {
	return formatSnippetMessage(message, DEFAULT_SNIPPETS.continue);
}

export function parseSnippetArgs(args: string): ParsedSnippetArgs {
	const followUpMatch = /^\s*\+\s+/u.exec(args);
	if (followUpMatch) {
		return { args: args.slice(followUpMatch[0].length), deliverAs: "followUp" };
	}
	return { args, deliverAs: "steer" };
}

export function formatSnippetDescription(snippet: Snippet): string {
	return `Expand a configured snippet | ${formatSnippetMessage("<prompt>", snippet)}`;
}

export function registerSnippetCommands(pi: ExtensionAPI, snippets: SnippetMap): void {
	for (const [name, snippet] of Object.entries(snippets)) {
		pi.registerCommand(name, {
			description: formatSnippetDescription(snippet),
			handler: async (args: string, ctx) => {
				const parsed = parseSnippetArgs(args);
				const message = formatSnippetMessage(parsed.args, snippet);

				if (parsed.deliverAs === "followUp") {
					pi.sendUserMessage(message, { deliverAs: "followUp" });
					return;
				}

				const mode = (ctx as SnippetCommandContext).mode;
				if (mode === "print" || mode === "json") {
					pi.sendUserMessage(message, { deliverAs: "steer" });
					return;
				}

				ctx.ui.setEditorText(message);
			},
		});
	}
}

export default function (pi: ExtensionAPI) {
	registerSnippetCommands(pi, loadSnippets());
}
