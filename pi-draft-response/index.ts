import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { CombinedAutocompleteProvider, Editor, type EditorTheme, Input, Key, matchesKey, truncateToWidth } from "@earendil-works/pi-tui";

type Range = { start: number; end: number };

export type ReviewComment = {
	index: number;
	section: Range;
	path?: string;
	originalLine?: number;
	body: string;
	agentResponse: string;
	fieldValue: string;
	fieldRange?: Range;
};

function stripAtPrefix(path: string): string {
	return path.startsWith("@") ? path.slice(1) : path;
}

export function parseDraftResponseArgs(args: string): { fieldName?: string; filePath?: string } {
	const parts = args.trim().split(/\s+/).filter(Boolean);
	if (parts.length === 0) return {};
	if (parts.length === 1) {
		const [only] = parts;
		if (only.startsWith("@") || only.endsWith(".toml")) return { filePath: only };
		return { fieldName: only };
	}
	return { filePath: parts[0], fieldName: parts[1] };
}

function parseBasicString(raw: string): string | undefined {
	try {
		return JSON.parse(raw) as string;
	} catch {
		return undefined;
	}
}

function parseTomlString(raw: string): string | undefined {
	const trimmed = raw.trim();
	if (trimmed.startsWith('"""') && trimmed.endsWith('"""')) {
		let inner = trimmed.slice(3, -3);
		if (inner.startsWith("\n")) inner = inner.slice(1);
		return inner;
	}
	if (trimmed.startsWith("'''") && trimmed.endsWith("'''")) {
		let inner = trimmed.slice(3, -3);
		if (inner.startsWith("\n")) inner = inner.slice(1);
		return inner;
	}
	if (trimmed.startsWith('"')) return parseBasicString(trimmed);
	if (trimmed.startsWith("'")) return trimmed.slice(1, -1);
	return undefined;
}

function findMultilineEnd(lines: string[], start: number, delimiter: string): number {
	const first = lines[start];
	const firstValueIndex = first.indexOf(delimiter);
	const firstCloseIndex = first.indexOf(delimiter, firstValueIndex + delimiter.length);
	if (firstCloseIndex !== -1) return start + 1;

	for (let i = start + 1; i < lines.length; i++) {
		if (lines[i].includes(delimiter)) return i + 1;
	}
	return lines.length;
}

function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function readField(lines: string[], section: Range, key: string): { value: string; range: Range } | undefined {
	const fieldPattern = new RegExp(`^${escapeRegExp(key)}\\s*=`);
	for (let i = section.start + 1; i < section.end; i++) {
		if (!fieldPattern.test(lines[i])) continue;
		const equals = lines[i].indexOf("=");
		const valueStart = lines[i].slice(equals + 1).trimStart();
		let end = i + 1;
		if (valueStart.startsWith('"""')) end = findMultilineEnd(lines, i, '"""');
		else if (valueStart.startsWith("'''")) end = findMultilineEnd(lines, i, "'''");
		const raw = [lines[i].slice(equals + 1), ...lines.slice(i + 1, end)].join("\n");
		return { value: parseTomlString(raw) ?? "", range: { start: i, end } };
	}
	return undefined;
}

function readNumberField(lines: string[], section: Range, key: string): number | undefined {
	const fieldPattern = new RegExp(`^${escapeRegExp(key)}\\s*=\\s*(-?\\d+(?:\\.\\d+)?)\\s*$`);
	for (let i = section.start + 1; i < section.end; i++) {
		const match = lines[i].match(fieldPattern);
		if (!match) continue;
		const parsed = Number(match[1]);
		return Number.isFinite(parsed) ? parsed : undefined;
	}
	return undefined;
}

export function parseReviewComments(toml: string, fieldName = "human-response"): ReviewComment[] {
	const lines = toml.split("\n");
	const starts: number[] = [];
	for (let i = 0; i < lines.length; i++) {
		if (lines[i].trim() === "[[reviews.comments]]") starts.push(i);
	}

	return starts.map((start, index) => {
		const section = { start, end: starts[index + 1] ?? lines.length };
		const path = readField(lines, section, "path")?.value;
		const body = readField(lines, section, "body")?.value ?? "";
		const agentResponse = readField(lines, section, "agent-response")?.value ?? "";
		const field = readField(lines, section, fieldName);
		return {
			index,
			section,
			path,
			originalLine: readNumberField(lines, section, "original_line"),
			body,
			agentResponse,
			fieldValue: field?.value ?? "",
			fieldRange: field?.range,
		};
	});
}

function tomlBasicString(value: string): string {
	return JSON.stringify(value);
}

function renderField(fieldName: string, value: string): string {
	return `${fieldName} = ${tomlBasicString(value)}`;
}

export function updateReviewCommentField(toml: string, fieldName: string, values: string[]): string {
	const lines = toml.split("\n");
	const comments = parseReviewComments(toml, fieldName);
	const edits: Array<{ start: number; end: number; replacement: string[] }> = [];

	for (const comment of comments) {
		const next = values[comment.index] ?? "";
		if (next === "") {
			if (comment.fieldRange) {
				edits.push({ ...comment.fieldRange, replacement: [] });
			}
			continue;
		}

		if (comment.fieldRange) {
			edits.push({ ...comment.fieldRange, replacement: [renderField(fieldName, next)] });
		} else {
			let insertAt = comment.section.end;
			while (insertAt > comment.section.start + 1 && lines[insertAt - 1] === "") insertAt--;
			edits.push({ start: insertAt, end: insertAt, replacement: [renderField(fieldName, next)] });
		}
	}

	for (const edit of edits.sort((a, b) => b.start - a.start)) {
		lines.splice(edit.start, edit.end - edit.start, ...edit.replacement);
	}
	return lines.join("\n");
}

export function updateHumanResponses(toml: string, thoughts: string[]): string {
	return updateReviewCommentField(toml, "human-response", thoughts);
}

function commentLocation(comment: ReviewComment): string {
	if (!comment.path) return `comment ${comment.index + 1}`;
	if (comment.path.includes(":")) return comment.path;
	return comment.originalLine === undefined ? comment.path : `${comment.path}:${comment.originalLine}`;
}

function previewLines(text: string, maxLines = 3): string[] {
	const lines = text.trim().split(/\r?\n/).filter((line) => line.length > 0);
	const shown = lines.slice(0, maxLines);
	if (lines.length > maxLines) shown[maxLines - 1] = `${shown[maxLines - 1]} …`;
	return shown.length > 0 ? shown : ["(no review comment body)"];
}

type MiniInputContext = { ui: { custom: <T>(factory: (tui: any, theme: any, keybindings: any, done: (value: T) => void) => any) => Promise<T> } };

async function promptMiniInput(
	ctx: MiniInputContext,
	title: string,
	initialValue: string,
	placeholder?: string,
): Promise<string | undefined> {
	return ctx.ui.custom<string | undefined>((tui, theme, _kb, done) => {
		const input = new Input();
		input.setValue(initialValue);
		input.onSubmit = (value) => done(value);
		input.onEscape = () => done(undefined);
		let focused = true;

		return {
			get focused() {
				return focused;
			},
			set focused(value: boolean) {
				focused = value;
				input.focused = value;
			},
			render(width: number) {
				const renderedInput = input.render(Math.max(1, width));
				const inputLines = input.getValue() === "" && placeholder ? [theme.fg("dim", placeholder)] : renderedInput;
				const lines = [
					theme.fg("accent", "─".repeat(width)),
					theme.fg("accent", theme.bold(title)),
					...inputLines,
					theme.fg("dim", "Enter submit • Esc cancel"),
					theme.fg("accent", "─".repeat(width)),
				];
				return lines.map((line) => truncateToWidth(line, width));
			},
			invalidate() {
				input.invalidate();
			},
			handleInput(data: string) {
				input.handleInput(data);
				tui.requestRender();
			},
		};
	});
}

async function promptFileInput(ctx: MiniInputContext, cwd: string): Promise<string | undefined> {
	return ctx.ui.custom<string | undefined>((tui, theme, _kb, done) => {
		const editorTheme: EditorTheme = {
			borderColor: (s: string) => theme.fg("accent", s),
			selectList: {
				selectedPrefix: (text: string) => theme.fg("accent", text),
				selectedText: (text: string) => theme.fg("accent", text),
				description: (text: string) => theme.fg("muted", text),
				scrollInfo: (text: string) => theme.fg("dim", text),
				noMatch: (text: string) => theme.fg("warning", text),
			},
		};
		const editor = new Editor(tui, editorTheme, { autocompleteMaxVisible: 8 });
		editor.setAutocompleteProvider(new CombinedAutocompleteProvider([], cwd, "fd"));
		editor.onSubmit = (value) => done(value);
		let focused = true;

		return {
			get focused() {
				return focused;
			},
			set focused(value: boolean) {
				focused = value;
				editor.focused = value;
			},
			render(width: number) {
				const lines = [
					theme.fg("accent", "─".repeat(width)),
					theme.fg("accent", theme.bold("Review TOML file")),
					...(editor.getText() === "" ? [theme.fg("dim", "Type a path, or press Tab for file completion. Use @ for fuzzy file search.")] : []),
					...editor.render(Math.max(1, width)),
					theme.fg("dim", "Tab complete/select • Enter submit • Esc cancel"),
					theme.fg("accent", "─".repeat(width)),
				];
				return lines.map((line) => truncateToWidth(line, width));
			},
			invalidate() {
				editor.invalidate();
			},
			handleInput(data: string) {
				if (matchesKey(data, Key.escape)) {
					done(undefined);
					return;
				}
				editor.handleInput(data);
				tui.requestRender();
			},
		};
	});
}

class DraftResponseComponent {
	private current = 0;
	private confirmCancel = false;
	private navigationWarning?: string;
	private cachedLines?: string[];
	private editor: Editor;

	constructor(
		private readonly comments: ReviewComment[],
		private readonly fieldName: string,
		private readonly thoughts: string[],
		private readonly theme: any,
		private readonly requestRender: () => void,
		private readonly done: (value: string[] | null) => void,
		tui: any,
	) {
		const editorTheme: EditorTheme = {
			borderColor: (s: string) => theme.fg("accent", s),
			selectList: {
				selectedPrefix: (text: string) => theme.fg("accent", text),
				selectedText: (text: string) => theme.fg("accent", text),
				description: (text: string) => theme.fg("muted", text),
				scrollInfo: (text: string) => theme.fg("dim", text),
				noMatch: (text: string) => theme.fg("warning", text),
			},
		};
		this.editor = new Editor(tui, editorTheme);
		this.editor.disableSubmit = true;
		this.editor.setText(this.thoughts[this.current] ?? "");
		this.editor.onChange = () => {
			this.navigationWarning = undefined;
			this.invalidateAndRender();
		};
	}

	private invalidateAndRender() {
		this.cachedLines = undefined;
		this.requestRender();
	}

	invalidate() {
		this.cachedLines = undefined;
		this.editor.invalidate();
	}

	private saveCurrent() {
		this.thoughts[this.current] = this.editor.getText();
	}

	private switchTab(delta: number) {
		this.saveCurrent();
		const next = this.current + delta;
		if (next < 0 || next >= this.comments.length) {
			this.navigationWarning = delta > 0 ? "Already on the last comment. Press Ctrl+S/Ctrl+D to save." : "Already on the first comment.";
			return this.invalidateAndRender();
		}
		this.current = next;
		this.confirmCancel = false;
		this.navigationWarning = undefined;
		this.editor.setText(this.thoughts[this.current] ?? "");
		this.invalidateAndRender();
	}

	handleInput(data: string) {
		if (this.confirmCancel) {
			if (matchesKey(data, Key.enter) || data === "y" || data === "Y" || matchesKey(data, "y") || matchesKey(data, Key.shift("y"))) {
				return this.done(null);
			}
			if (matchesKey(data, Key.escape) || data === "n" || data === "N" || matchesKey(data, "n") || matchesKey(data, Key.shift("n"))) {
				this.confirmCancel = false;
				return this.invalidateAndRender();
			}
			return;
		}

		if (matchesKey(data, Key.escape)) {
			this.confirmCancel = true;
			return this.invalidateAndRender();
		}
		if (matchesKey(data, Key.ctrl("s")) || matchesKey(data, Key.ctrl("d"))) {
			this.saveCurrent();
			return this.done([...this.thoughts]);
		}
		if (matchesKey(data, Key.enter) && !matchesKey(data, Key.shift("enter"))) return this.switchTab(1);
		if (matchesKey(data, Key.tab)) return this.switchTab(1);
		if (matchesKey(data, Key.shift("tab"))) return this.switchTab(-1);

		this.editor.handleInput(data);
		this.invalidateAndRender();
	}

	render(width: number): string[] {
		if (this.cachedLines) return this.cachedLines;
		this.saveCurrent();
		const comment = this.comments[this.current];
		const lines: string[] = [];
		const add = (line: string) => lines.push(truncateToWidth(line, width));
		add(this.theme.fg("accent", "─".repeat(width)));
		const tabs = this.comments.map((_comment, i) => {
			const label = ` ${i + 1}${this.thoughts[i] ? "•" : ""} `;
			return i === this.current ? this.theme.bg("selectedBg", this.theme.fg("text", label)) : this.theme.fg("muted", label);
		});
		add(tabs.join(""));
		add(`${this.theme.fg("accent", "Location:")} ${commentLocation(comment)}`);
		add(this.theme.fg("accent", "Review comment:"));
		for (const line of previewLines(comment.body)) add(`${this.theme.fg("muted", "│ ")}${line}`);
		if (comment.agentResponse.trim()) {
			lines.push("");
			add(this.theme.fg("accent", "agent-response:"));
			for (const line of previewLines(comment.agentResponse)) add(`${this.theme.fg("muted", "│ ")}${line}`);
		}
		lines.push("");
		add(this.theme.fg("accent", `${this.fieldName}:`));
		for (const line of this.editor.render(Math.max(1, width - 2))) {
			add(` ${line}`);
		}
		lines.push("");
		if (this.confirmCancel) {
			add(this.theme.fg("warning", "Cancel without saving? Press Enter/y to confirm, Esc/n to keep editing."));
		} else if (this.navigationWarning) {
			add(this.theme.fg("warning", this.navigationWarning));
			add(this.theme.fg("dim", "Tab/Enter next • Shift+Tab prev • Shift+Enter newline • Ctrl+S/Ctrl+D save • Esc cancel"));
		} else {
			add(this.theme.fg("dim", "Tab/Enter next • Shift+Tab prev • Shift+Enter newline • Ctrl+S/Ctrl+D save • Esc cancel"));
		}
		add(this.theme.fg("accent", "─".repeat(width)));
		this.cachedLines = lines;
		return lines;
	}
}

export default function draftResponseExtension(pi: ExtensionAPI) {
	pi.registerCommand("draft-response", {
		description: "Edit a field for review comments in a TOML review file",
		handler: async (args, ctx) => {
			if (!ctx.hasUI) {
				ctx.ui.notify("/draft-response requires an interactive UI", "error");
				return;
			}
			let { fieldName, filePath: rawPath } = parseDraftResponseArgs(args);
			if (!rawPath) {
				const value = await promptFileInput(ctx, ctx.cwd);
				rawPath = value?.trim();
				if (!rawPath) {
					ctx.ui.notify("Cancelled; no review file selected.", "info");
					return;
				}
			}
			if (!fieldName) {
				const value = await promptMiniInput(ctx, "TOML field to edit", "human-response");
				if (value === undefined) {
					ctx.ui.notify("Cancelled; no TOML field selected.", "info");
					return;
				}
				fieldName = value.trim() || "human-response";
			}
			if (!/^[A-Za-z0-9_-]+$/.test(fieldName)) {
				ctx.ui.notify(`Unsupported TOML field name: ${fieldName}`, "error");
				return;
			}
			const filePath = resolve(ctx.cwd, stripAtPrefix(rawPath));
			const original = readFileSync(filePath, "utf8");
			const comments = parseReviewComments(original, fieldName);
			if (comments.length === 0) {
				ctx.ui.notify(`No [[reviews.comments]] entries found in ${filePath}`, "warning");
				return;
			}

			const thoughts = comments.map((comment) => comment.fieldValue);
			const result = await ctx.ui.custom<string[] | null>((tui, theme, _kb, done) => {
				return new DraftResponseComponent(comments, fieldName, thoughts, theme, () => tui.requestRender(), done, tui);
			});
			if (!result) {
				ctx.ui.notify("Cancelled; review file was not changed.", "info");
				return;
			}

			const updated = updateReviewCommentField(original, fieldName, result);
			writeFileSync(filePath, updated, "utf8");
			ctx.ui.notify(`Updated ${filePath}`, "info");
		},
	});
}
