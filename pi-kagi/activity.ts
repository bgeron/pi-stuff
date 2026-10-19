import {
	keyText,
	type ExtensionAPI,
	type ExtensionContext,
	type Theme,
	type ToolExecutionEndEvent,
} from "@earendil-works/pi-coding-agent";
import { Box, Text } from "@earendil-works/pi-tui";

export const KAGI_ACTIVITY_ENTRY = "kagi-activity";
const WIDGET_KEY = "kagi-pending";
type KagiToolName = "kagi_search" | "kagi_extract";

export type KagiActivity = {
	toolCallId: string;
	parentToolCallId: string;
	toolName: KagiToolName;
	input: Record<string, unknown>;
	output: string;
	status: "ok" | "error" | "cancelled";
	durationMs: number;
	summary?: string;
};

type PendingCall = {
	toolCallId: string;
	parentToolCallId: string;
	toolName: KagiToolName;
	input: Record<string, unknown>;
	startedAt: number;
	signal?: AbortSignal;
};

function callLabel(call: Pick<KagiActivity, "toolName" | "input">): string {
	if (call.toolName === "kagi_search") return `Kagi search · ${String(call.input.query ?? "")}`;
	const urls = Array.isArray(call.input.urls) ? call.input.urls : [];
	return `Kagi extract · ${urls.length} URL${urls.length === 1 ? "" : "s"}`;
}

function renderActivity(data: KagiActivity, expanded: boolean, theme: Theme) {
	const box = new Box(1, 1, (text) => theme.bg("customMessageBg", text));
	const icon = data.status === "ok" ? "✓" : data.status === "cancelled" ? "■" : "✗";
	const color = data.status === "ok" ? "success" : data.status === "cancelled" ? "warning" : "error";
	const summary = [callLabel(data), data.status, data.summary, `${data.durationMs} ms`].filter(Boolean).join(" · ");
	const hint = expanded ? "" : ` (${keyText("app.tools.expand")} to expand)`;
	box.addChild(new Text(theme.fg(color, `${icon} `) + theme.fg("accent", summary) + theme.fg("dim", hint), 0, 0));
	if (expanded) {
		box.addChild(new Text(theme.fg("dim", `Call: ${data.toolCallId}\nParent: ${data.parentToolCallId}`), 0, 0));
		box.addChild(new Text(theme.fg("muted", `Input\n${JSON.stringify(data.input, null, 2)}`), 0, 0));
		// Deliberately neither preview nor truncate: this is the exact final tool text,
		// not the codemode script's possibly filtered output or the raw API response.
		box.addChild(new Text(theme.fg("muted", `Output\n${data.output}`), 0, 0));
	}
	return box;
}

/** Observe final execution events, after every tool_result transformer has run. */
export function registerKagiActivity(
	pi: ExtensionAPI,
	summarize: (event: ToolExecutionEndEvent, input: Record<string, unknown>, output: string) => string | undefined,
) {
	const pending = new Map<string, PendingCall>();

	const updateWidget = (ctx: ExtensionContext) => {
		if (ctx.mode !== "tui") return;
		if (pending.size === 0) {
			ctx.ui.setWidget(WIDGET_KEY, undefined);
			return;
		}
		ctx.ui.setWidget(WIDGET_KEY, (_tui, theme) => {
			const lines: string[] = [];
			for (const call of pending.values()) {
				lines.push(theme.fg("accent", `⏳ ${callLabel(call)}`));
				if (call.toolName === "kagi_extract" && Array.isArray(call.input.urls)) {
					for (const url of call.input.urls) lines.push(theme.fg("muted", `  ${String(url)}`));
				}
			}
			return new Text(lines.join("\n"), 0, 0);
		});
	};

	pi.registerEntryRenderer<KagiActivity>(KAGI_ACTIVITY_ENTRY, (entry, { expanded }, theme) => {
		if (!entry.data) return new Text(theme.fg("warning", "Missing Kagi activity data."), 0, 0);
		return renderActivity(entry.data, expanded, theme);
	});

	pi.on("tool_execution_start", (event, ctx) => {
		if (ctx.mode !== "tui" || !event.parentToolCallId) return;
		if (event.toolName !== "kagi_search" && event.toolName !== "kagi_extract") return;
		pending.set(event.toolCallId, {
			toolCallId: event.toolCallId,
			parentToolCallId: event.parentToolCallId,
			toolName: event.toolName,
			input: structuredClone(event.args),
			startedAt: performance.now(),
			signal: ctx.signal,
		});
		updateWidget(ctx);
	});

	pi.on("tool_execution_end", (event, ctx) => {
		const call = pending.get(event.toolCallId);
		if (!call) return;
		pending.delete(event.toolCallId);
		updateWidget(ctx);
		const output = ((event.result.content ?? []) as Array<{ type: string; text?: string }>)
			.filter((block) => block.type === "text")
			.map((block) => block.text ?? "")
			.join("\n");
		pi.appendEntry<KagiActivity>(KAGI_ACTIVITY_ENTRY, {
			toolCallId: call.toolCallId,
			parentToolCallId: call.parentToolCallId,
			toolName: call.toolName,
			input: call.input,
			output,
			status: event.isError ? (call.signal?.aborted ? "cancelled" : "error") : "ok",
			durationMs: Math.round(event.durationMs ?? (performance.now() - call.startedAt)),
			summary: event.isError ? undefined : summarize(event, call.input, output),
		});
	});

	const clear = (_event: unknown, ctx: ExtensionContext) => {
		pending.clear();
		updateWidget(ctx);
	};
	pi.on("session_start", clear);
	pi.on("session_shutdown", clear);

	return {
		/** Capture arguments after tool_call patches and the execution's own signal. */
		executing(toolCallId: string, input: Record<string, unknown>, signal: AbortSignal | undefined, ctx: ExtensionContext) {
			const call = pending.get(toolCallId);
			if (!call) return;
			call.input = structuredClone(input);
			call.signal = signal;
			updateWidget(ctx);
		},
	};
}
