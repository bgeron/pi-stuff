import { runToolCall } from "@earendil-works/pi-agent-core";
import { fauxAssistantMessage, fauxToolCall, registerFauxProvider } from "@earendil-works/pi-ai/compat";
import {
	createAgentSession,
	createCodemodeExtension,
	DefaultResourceLoader,
	ModelRuntime,
	SessionManager,
	SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { KAGI_ACTIVITY_ENTRY, type KagiActivity } from "./activity.js";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
	buildSearchRequest,
	createKagiState,
	formatKagiApiError,
	hasMatchingPersistentAuthorization,
	KAGI_AUTHORIZATION_CHOICES,
	KAGI_TIMED_SESSION_ACCESS_MS,
	parseKagiResponseText,
	registerKagiExtension,
} from "./index.js";

type Handler = (event: any, ctx: any) => unknown;

function createHarness(options: { mode?: string; globalSettings?: unknown; projectSettings?: unknown } = {}) {
	const root = mkdtempSync(join(tmpdir(), "pi-kagi-test-"));
	const cwd = join(root, "project");
	const globalSettingsPath = join(root, "settings.json");
	const projectSettingsPath = join(cwd, ".pi", "settings.json");
	mkdirSync(join(cwd, ".pi"), { recursive: true });
	if (options.globalSettings) writeFileSync(globalSettingsPath, `${JSON.stringify(options.globalSettings)}\n`);
	if (options.projectSettings) writeFileSync(projectSettingsPath, `${JSON.stringify(options.projectSettings)}\n`);

	const handlers = new Map<string, Handler[]>();
	const commands = new Map<string, any>();
	const tools = new Map<string, any>();
	const entryRenderers = new Map<string, any>();
	const entries: Array<{ type: "custom"; customType: string; data: KagiActivity }> = [];
	const widgets = new Map<string, any>();
	const session = SessionManager.create(cwd, join(root, "sessions"));
	const notifications: string[] = [];
	const selections: Array<string | undefined> = [];
	const selectionChoices: string[][] = [];
	const inputs: Array<string | undefined> = [];
	let selectCount = 0;
	let abortCount = 0;
	let sessionId = "session-1";
	const pi = {
		on(name: string, handler: Handler) {
			handlers.set(name, [...(handlers.get(name) ?? []), handler]);
		},
		registerCommand(name: string, command: any) {
			commands.set(name, command);
		},
		registerTool(tool: any) {
			tools.set(tool.name, tool);
		},
		registerEntryRenderer(name: string, renderer: any) {
			entryRenderers.set(name, renderer);
		},
		appendEntry(customType: string, data: KagiActivity) {
			session.appendCustomEntry(customType, data);
			entries.push(JSON.parse(JSON.stringify({ type: "custom", customType, data })));
		},
	};
	const ctx = {
		mode: options.mode ?? "tui",
		hasUI: options.mode === "print" || options.mode === "json" ? false : true,
		cwd,
		signal: undefined as AbortSignal | undefined,
		sessionManager: { getSessionId: () => sessionId },
		ui: {
			setWidget(key: string, content: any) {
				if (content === undefined) widgets.delete(key);
				else widgets.set(key, content);
			},
			async select(_title: string, choices: string[]) {
				selectCount += 1;
				selectionChoices.push(choices);
				await Promise.resolve();
				return selections.shift();
			},
			async input() {
				return inputs.shift();
			},
			notify(message: string) {
				notifications.push(message);
			},
		},
		abort() {
			abortCount += 1;
		},
	};
	const state = createKagiState();
	registerKagiExtension(pi as any, { globalSettingsPath, state });

	return {
		commands,
		ctx,
		entries,
		entryRenderers,
		widgets,
		session,
		globalSettingsPath,
		handlers,
		inputs,
		notifications,
		projectSettingsPath,
		selections,
		selectionChoices,
		state,
		tools,
		get abortCount() { return abortCount; },
		get selectCount() { return selectCount; },
		setSessionId(value: string) { sessionId = value; },
		async emit(name: string, event: any) {
			for (const handler of handlers.get(name) ?? []) await handler(event, ctx);
		},
	};
}

function installFetchStub(respond?: (url: string, init?: RequestInit) => Response | Promise<Response>): { calls: string[]; restore(): void } {
	const original = globalThis.fetch;
	const calls: string[] = [];
	globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
		const value = String(url);
		calls.push(value);
		if (respond) return respond(value, init);
		const data = value.endsWith("/extract") ? [] : {};
		return { ok: true, status: 200, text: async () => JSON.stringify({ data }) } as Response;
	}) as typeof fetch;
	return { calls, restore: () => { globalThis.fetch = original; } };
}

function readJson(path: string): any {
	return JSON.parse(readFileSync(path, "utf8"));
}

describe("Kagi error reporting", () => {
	it("includes HTTP status, trace id, and Kagi error details", () => {
		const parsed = parseKagiResponseText<unknown>(
			JSON.stringify({
				meta: { trace: "trace-123", ms: 42 },
				error: [
					{ code: "auth.invalid", message: "Unauthorized", location: "Authorization" },
					{ code: "quota.exhausted", message: "Usage limit exhausted" },
				],
			}),
		);

		assert.equal(
			formatKagiApiError(401, "", parsed),
			"Kagi API request failed with HTTP 401 trace=trace-123: auth.invalid: Unauthorized: Authorization; quota.exhausted: Usage limit exhausted",
		);
	});

	it("supports Extract-style errors array", () => {
		const parsed = parseKagiResponseText<unknown>(
			JSON.stringify({
				meta: { trace: "extract-trace" },
				errors: [{ code: "extract.invalid_url", message: "URL must be HTTPS", location: "pages[0].url" }],
			}),
		);

		assert.equal(
			formatKagiApiError(400, "", parsed),
			"Kagi API request failed with HTTP 400 trace=extract-trace: extract.invalid_url: URL must be HTTPS: pages[0].url",
		);
	});

	it("falls back to raw response text for non-JSON failures", () => {
		assert.equal(
			formatKagiApiError(502, "Bad Gateway", undefined),
			"Kagi API request failed with HTTP 502: Bad Gateway",
		);
	});

	it("reports non-JSON successful responses as undefined so callers can reject them", () => {
		assert.equal(parseKagiResponseText<unknown>("not json"), undefined);
	});
});

describe("Kagi search request building", () => {
	it("lowercases region filters", () => {
		assert.deepEqual(buildSearchRequest({ query: "pi", region: "US" }), {
			query: "pi",
			workflow: "search",
			format: "json",
			filters: { region: "us" },
		});
	});
});

describe("Kagi authorization", () => {
	it("requires the persisted authorization to match the key", () => {
		assert.equal(hasMatchingPersistentAuthorization({ apiKey: "key", enabled: true }, "key"), true);
		assert.equal(hasMatchingPersistentAuthorization({ apiKey: "other", enabled: true }, "key"), false);
		assert.equal(hasMatchingPersistentAuthorization({ apiKey: "key", enabled: false }, "key"), false);
		assert.equal(hasMatchingPersistentAuthorization({ enabled: true }, "key"), false);
	});

	it("shares allow-once and deny-once decisions across concurrent calls in a batch", async () => {
		const harness = createHarness({ projectSettings: { kagi: { apiKey: "project-key" } } });
		const fetchStub = installFetchStub();
		try {
			await harness.emit("session_start", { reason: "startup" });
			await harness.emit("turn_start", { turnIndex: 0, timestamp: 1 });
			harness.selections.push(KAGI_AUTHORIZATION_CHOICES.allowOnce);
			await Promise.all([
				harness.tools.get("kagi_search").execute("search", { query: "pi" }, undefined, undefined, harness.ctx),
				harness.tools.get("kagi_extract").execute("extract", { urls: ["https://example.com"] }, undefined, undefined, harness.ctx),
			]);
			assert.equal(harness.selectCount, 1);
			assert.equal(fetchStub.calls.length, 2);

			await harness.emit("turn_end", {});
			await harness.emit("turn_start", { turnIndex: 1, timestamp: 2 });
			harness.selections.push(KAGI_AUTHORIZATION_CHOICES.denyOnce);
			const denied = await Promise.allSettled([
				harness.tools.get("kagi_search").execute("search-2", { query: "pi" }, undefined, undefined, harness.ctx),
				harness.tools.get("kagi_extract").execute("extract-2", { urls: ["https://example.com"] }, undefined, undefined, harness.ctx),
			]);
			assert.equal(harness.selectCount, 2);
			assert.equal(fetchStub.calls.length, 2);
			for (const result of denied) {
				assert.equal(result.status, "rejected");
				if (result.status === "rejected") assert.match(String(result.reason), /Kagi is not available right now/);
			}

			await harness.emit("turn_end", {});
			await harness.emit("turn_start", { turnIndex: 2, timestamp: 3 });
			harness.selections.push(KAGI_AUTHORIZATION_CHOICES.allowOnce);
			await harness.tools.get("kagi_search").execute("search-3", { query: "pi" }, undefined, undefined, harness.ctx);
			assert.equal(harness.selectCount, 3, "deny-once must not survive into the next batch");
			assert.equal(fetchStub.calls.length, 3);
		} finally {
			fetchStub.restore();
		}
	});

	it("allows Kagi for 30 minutes in the current session and asks again after expiry", async () => {
		const harness = createHarness({ projectSettings: { kagi: { apiKey: "project-key" } } });
		const fetchStub = installFetchStub();
		try {
			await harness.emit("session_start", { reason: "startup" });
			await harness.emit("turn_start", { turnIndex: 0, timestamp: 1 });
			const beforeApproval = Date.now();
			harness.selections.push(KAGI_AUTHORIZATION_CHOICES.allowThirtyMinutes);
			await harness.tools.get("kagi_search").execute("search", { query: "pi" }, undefined, undefined, harness.ctx);

			assert.equal(harness.selectionChoices[0]?.includes("Allow for 30 minutes in session"), true);
			assert.equal(harness.state.sessionAccess, "enabled");
			assert.equal(harness.state.sessionAccessSource, "timed");
			assert.ok((harness.state.sessionAccessExpiresAt ?? 0) >= beforeApproval + KAGI_TIMED_SESSION_ACCESS_MS);
			await harness.commands.get("kagi-key-status").handler("", harness.ctx);
			assert.match(harness.notifications.at(-1) ?? "", /30-minute session limit/);
			const expiresAt = harness.state.sessionAccessExpiresAt;

			await harness.emit("session_start", { reason: "reload" });
			assert.equal(harness.state.sessionAccessExpiresAt, expiresAt, "reload should preserve the remaining timed approval");
			await harness.emit("turn_start", { turnIndex: 1, timestamp: 2 });
			await harness.tools.get("kagi_search").execute("search-2", { query: "pi" }, undefined, undefined, harness.ctx);
			assert.equal(harness.selectCount, 1);

			harness.state.sessionAccessExpiresAt = Date.now() - 1;
			await harness.emit("turn_end", {});
			await harness.emit("turn_start", { turnIndex: 2, timestamp: 3 });
			await harness.commands.get("kagi-key-status").handler("", harness.ctx);
			assert.match(harness.notifications.at(-1) ?? "", /Authorization: awaiting approval/);
			harness.selections.push(KAGI_AUTHORIZATION_CHOICES.allowOnce);
			await harness.tools.get("kagi_search").execute("search-3", { query: "pi" }, undefined, undefined, harness.ctx);
			assert.equal(harness.selectCount, 2);
			assert.equal(fetchStub.calls.length, 3);
		} finally {
			fetchStub.restore();
		}
	});

	it("keeps allow-for-session approval and a newly entered key in memory", async () => {
		const harness = createHarness();
		const fetchStub = installFetchStub();
		try {
			await harness.emit("session_start", { reason: "startup" });
			await harness.emit("turn_start", { turnIndex: 0, timestamp: 1 });
			harness.selections.push(KAGI_AUTHORIZATION_CHOICES.allowSession);
			harness.inputs.push("memory-key");
			await harness.tools.get("kagi_search").execute("search", { query: "pi" }, undefined, undefined, harness.ctx);
			await harness.emit("turn_end", {});
			await harness.emit("turn_start", { turnIndex: 1, timestamp: 2 });
			await harness.tools.get("kagi_search").execute("search-2", { query: "pi" }, undefined, undefined, harness.ctx);
			assert.equal(harness.selectCount, 1);
			assert.equal(harness.state.apiKeySource, "memory");
			assert.equal(existsSyncForTest(harness.globalSettingsPath), false);
		} finally {
			fetchStub.restore();
		}
	});

	it("persists an in-memory key with allow-always and permits a later non-interactive session", async () => {
		const harness = createHarness();
		const fetchStub = installFetchStub();
		try {
			await harness.emit("session_start", { reason: "startup" });
			await harness.emit("turn_start", { turnIndex: 0, timestamp: 1 });
			harness.selections.push(KAGI_AUTHORIZATION_CHOICES.allowAlwaysAndPersist);
			harness.inputs.push("persisted-key");
			await harness.tools.get("kagi_search").execute("search", { query: "pi" }, undefined, undefined, harness.ctx);
			assert.deepEqual(readJson(harness.globalSettingsPath).kagi, { apiKey: "persisted-key", enabled: true });

			const next = createHarness({ mode: "json", globalSettings: readJson(harness.globalSettingsPath) });
			await next.emit("session_start", { reason: "startup" });
			await next.emit("turn_start", { turnIndex: 0, timestamp: 1 });
			await next.tools.get("kagi_search").execute("search-next", { query: "pi" }, undefined, undefined, next.ctx);
			assert.equal(next.abortCount, 0);
		} finally {
			fetchStub.restore();
		}
	});

	it("stores allow-always beside a project key rather than in global settings", async () => {
		const harness = createHarness({
			globalSettings: { kagi: { apiKey: "global-key", enabled: true } },
			projectSettings: { kagi: { apiKey: "project-key" } },
		});
		const fetchStub = installFetchStub();
		try {
			await harness.emit("session_start", { reason: "startup" });
			assert.equal(harness.state.sessionAccess, "unasked", "global approval must not authorize an overriding project key");
			await harness.emit("turn_start", { turnIndex: 0, timestamp: 1 });
			harness.selections.push(KAGI_AUTHORIZATION_CHOICES.allowAlways);
			await harness.tools.get("kagi_search").execute("search", { query: "pi" }, undefined, undefined, harness.ctx);
			assert.equal(readJson(harness.projectSettingsPath).kagi.enabled, true);
			assert.equal(readJson(harness.globalSettingsPath).kagi.enabled, true);
			assert.equal(harness.state.sessionAccessSource, "project");
		} finally {
			fetchStub.restore();
		}
	});

	it("preserves temporary approval on reload and resets it on every session replacement", async () => {
		const harness = createHarness({ globalSettings: { kagi: { apiKey: "key" } } });
		await harness.emit("session_start", { reason: "startup" });
		await harness.commands.get("kagi-enable").handler("", harness.ctx);
		assert.equal(harness.state.sessionAccess, "enabled");
		await harness.emit("session_start", { reason: "reload" });
		assert.equal(harness.state.sessionAccess, "enabled");

		for (const [index, reason] of ["resume", "new", "fork", "startup"].entries()) {
			harness.setSessionId(`session-${index + 2}`);
			await harness.emit("session_start", { reason });
			assert.equal(harness.state.sessionAccess, "unasked");
			assert.equal(harness.state.sessionAccessSource, undefined);
			await harness.commands.get("kagi-enable").handler("", harness.ctx);
		}
	});

	it("keeps model-facing tool descriptions vague about authorization and keys", () => {
		const harness = createHarness();
		assert.equal(harness.tools.get("kagi_search").description, "Search the web with Kagi.");
		assert.equal(harness.tools.get("kagi_extract").description, "Extract markdown content from URLs with Kagi.");
		for (const toolName of ["kagi_search", "kagi_extract"]) {
			assert.doesNotMatch(harness.tools.get(toolName).description, /approv|authoriz|key/i);
		}
	});

	it("revokes approval in both settings scopes without clearing keys or creating denial", async () => {
		const harness = createHarness({
			globalSettings: { kagi: { apiKey: "global-key", enabled: true } },
			projectSettings: { kagi: { apiKey: "project-key", enabled: true } },
		});
		assert.equal(harness.commands.has("kagi-disable"), false);
		assert.equal(harness.commands.has("kagi-revoke"), true);
		await harness.emit("session_start", { reason: "startup" });
		await harness.commands.get("kagi-revoke").handler("", harness.ctx);
		assert.deepEqual(readJson(harness.globalSettingsPath).kagi, { apiKey: "global-key" });
		assert.deepEqual(readJson(harness.projectSettingsPath).kagi, { apiKey: "project-key" });
		assert.equal(harness.state.sessionAccess, "unasked");
		await harness.commands.get("kagi-key-status").handler("", harness.ctx);
		assert.match(harness.notifications.at(-1) ?? "", /Authorization: awaiting approval/);

		await harness.commands.get("kagi-clear-key").handler("", harness.ctx);
		assert.deepEqual(readJson(harness.globalSettingsPath).kagi, {});
		assert.deepEqual(readJson(harness.projectSettingsPath).kagi, {});
		assert.equal(harness.state.apiKey, undefined);
		assert.equal(harness.state.sessionAccess, "unasked");
		await harness.commands.get("kagi-key-status").handler("", harness.ctx);
		assert.match(harness.notifications.at(-1) ?? "", /Key: unavailable.*Authorization: awaiting approval/);
	});

	it("loads and persists keys without granting persistent authorization", async () => {
		const harness = createHarness();
		harness.inputs.push("loaded-key");
		await harness.commands.get("kagi-load-key").handler("", harness.ctx);
		assert.equal(harness.state.sessionAccess, "enabled");
		assert.equal(harness.state.apiKeySource, "memory");
		await harness.commands.get("kagi-persist-key").handler("", harness.ctx);
		assert.deepEqual(readJson(harness.globalSettingsPath).kagi, { apiKey: "loaded-key" });
		await harness.commands.get("kagi-key-status").handler("", harness.ctx);
		assert.match(harness.notifications.at(-1) ?? "", /Key: global settings.*Authorization: enabled temporarily/);
	});

	it("aborts unauthorized non-interactive calls and supports temporary RPC enablement", async () => {
		const fetchStub = installFetchStub();
		try {
			const json = createHarness({ mode: "json", globalSettings: { kagi: { apiKey: "key" } } });
			await json.emit("session_start", { reason: "startup" });
			await json.emit("turn_start", { turnIndex: 0, timestamp: 1 });
			await assert.rejects(
				json.tools.get("kagi_search").execute("search", { query: "pi" }, undefined, undefined, json.ctx),
				/Kagi is not available right now/,
			);
			assert.equal(json.abortCount, 1);
			assert.equal(fetchStub.calls.length, 0);

			const rpc = createHarness({ mode: "rpc", globalSettings: { kagi: { apiKey: "key" } } });
			await rpc.emit("session_start", { reason: "startup" });
			await rpc.commands.get("kagi-enable").handler("", rpc.ctx);
			await rpc.emit("turn_start", { turnIndex: 0, timestamp: 1 });
			await rpc.tools.get("kagi_search").execute("search", { query: "pi" }, undefined, undefined, rpc.ctx);
			assert.equal(rpc.selectCount, 0);
			assert.equal(rpc.abortCount, 0);
		} finally {
			fetchStub.restore();
		}
	});

	it("aborts the active run when Abort is selected", async () => {
		const harness = createHarness({ globalSettings: { kagi: { apiKey: "key" } } });
		await harness.emit("session_start", { reason: "startup" });
		await harness.emit("turn_start", { turnIndex: 0, timestamp: 1 });
		harness.selections.push(KAGI_AUTHORIZATION_CHOICES.abort);
		await assert.rejects(
			harness.tools.get("kagi_search").execute("search", { query: "pi" }, undefined, undefined, harness.ctx),
			/aborted by the user/,
		);
		assert.equal(harness.abortCount, 1);
	});
});

function existsSyncForTest(path: string): boolean {
	try {
		readFileSync(path);
		return true;
	} catch {
		return false;
	}
}

const plainTheme = {
	fg: (_color: string, text: string) => text,
	bg: (_color: string, text: string) => text,
	bold: (text: string) => text,
};

function renderCard(harness: ReturnType<typeof createHarness>, data: KagiActivity, expanded = false, width = 120): string {
	return harness.entryRenderers.get(KAGI_ACTIVITY_ENTRY)({ data }, { expanded }, plainTheme).render(width).join("\n");
}

function renderPending(harness: ReturnType<typeof createHarness>): string {
	return [...harness.widgets.values()]
		.map((factory) => factory(undefined, plainTheme).render(120).join("\n"))
		.join("\n");
}

function jsonResponse(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

// Exercise Pi's real validation/execution/result-hook pipeline, adapting the
// extension's fifth context argument just as Pi's extension wrapper does.
async function runCall(
	harness: ReturnType<typeof createHarness>,
	name: string,
	input: Parameters<typeof runToolCall>[0]["arguments"],
	options: {
		id?: string;
		parent?: string | null;
		signal?: AbortSignal;
		patchInput?: (input: Record<string, unknown>) => void;
		resultText?: string;
		block?: boolean;
	} = {},
) {
	const id = options.id ?? "code/1";
	const parentToolCallId = options.parent === null ? undefined : options.parent ?? "code";
	await harness.emit("tool_execution_start", { toolCallId: id, toolName: name, args: input, parentToolCallId });
	const tools = [...harness.tools.values()].map((tool) => ({
		...tool,
		execute(toolCallId: string, args: any, signal: AbortSignal | undefined, onUpdate: any) {
			return tool.execute(toolCallId, args, signal, onUpdate, { ...harness.ctx, signal });
		},
	}));
	const outcome = await runToolCall({ type: "toolCall", id, name, arguments: input }, {
		tools,
		assistantMessage: { role: "assistant", content: [] } as any,
		context: { messages: [], tools },
		signal: options.signal,
		async beforeToolCall({ args }) {
			options.patchInput?.(args as Record<string, unknown>);
			if (options.block) return { block: true, reason: "Blocked by another extension" };
		},
		async afterToolCall() {
			if (options.resultText !== undefined) return { content: [{ type: "text", text: options.resultText }] };
		},
	});
	await harness.emit("tool_execution_end", {
		toolCallId: id,
		toolName: name,
		parentToolCallId,
		result: outcome.result,
		isError: outcome.isError,
		durationMs: outcome.durationMs,
	});
	return outcome;
}

async function authorizedHarness(mode = "tui") {
	const harness = createHarness({ mode, globalSettings: { kagi: { apiKey: "secret-api-key", enabled: true } } });
	await harness.emit("session_start", { reason: "startup" });
	return harness;
}

describe("Kagi human-only activity", () => {
	it("always records complete search inputs and final formatted output, even if the caller discards it", async () => {
		const harness = await authorizedHarness();
		const fetchStub = installFetchStub(() => jsonResponse({
			meta: { trace: "search-trace", ms: 23 },
			data: { search: [{ title: "Pi docs", url: "https://pi.dev", snippet: "Search result" }], news: [{ title: "News", url: "https://example.com" }] },
		}));
		const input = {
			query: "pi codemode", workflow: "news", limit: 8, page: 2, timeout: 3,
			region: "US", after: "2026-01-01", before: "2026-10-01", safeSearch: false,
			sitesIncluded: ["pi.dev"], sitesExcluded: ["example.org"], extractCount: 2, extractTimeout: 1,
		};
		try {
			const outcome = await runCall(harness, "kagi_search", input);
			assert.equal(outcome.isError, false);
			assert.equal(harness.entries.length, 1);
			const { data, customType } = harness.entries[0]!;
			assert.equal(customType, KAGI_ACTIVITY_ENTRY);
			assert.deepEqual(data.input, input);
			assert.equal(data.output, outcome.result.content[0]?.type === "text" ? outcome.result.content[0].text : "");
			assert.equal(data.summary, "2 results");
			assert.equal(data.status, "ok");
			assert.equal(data.durationMs, outcome.durationMs);
			assert.equal(data.parentToolCallId, "code");
			assert.match(renderCard(harness, data), /Kagi search · pi codemode.*2 results.*ms/);
			assert.doesNotMatch(renderCard(harness, data), /Search result/);
			const expanded = renderCard(harness, data, true);
			assert.match(expanded, /"region": "US"/);
			assert.match(expanded, /"extractCount": 2/);
			assert.match(expanded, /Search result/);
			assert.match(expanded, /search-trace/);
			assert.doesNotMatch(JSON.stringify(harness.entries), /secret-api-key|Bearer|Authorization|"response"/);
			assert.equal(harness.widgets.size, 0);
		} finally {
			fetchStub.restore();
		}
	});

	it("keeps concurrent calls separate and shows each query/URL while pending", async () => {
		const harness = await authorizedHarness();
		const releases = new Map<string, (response: Response) => void>();
		const fetchStub = installFetchStub((url) => new Promise((resolve) => { releases.set(url, resolve); }));
		try {
			const search = runCall(harness, "kagi_search", { query: "日本語 codemode" }, { id: "code/1" });
			const extract = runCall(harness, "kagi_extract", { urls: ["https://example.com/a", "https://example.com/b"], timeout: 4 }, { id: "code/2" });
			// Reach fetch in both calls without depending on wall-clock timing.
			while (releases.size < 2) await new Promise<void>((resolve) => setImmediate(resolve));
			const pending = renderPending(harness);
			assert.match(pending, /日本語 codemode/);
			assert.match(pending, /https:\/\/example.com\/a/);
			assert.match(pending, /https:\/\/example.com\/b/);
			assert.equal(harness.entries.length, 0);
			releases.get("https://kagi.com/api/v1/extract")!(jsonResponse({ data: [{ url: "https://example.com/a", markdown: "hello" }] }));
			await extract;
			assert.equal(harness.entries[0]?.data.toolCallId, "code/2");
			assert.equal(harness.entries[0]?.data.summary, "5 chars extracted");
			assert.match(renderPending(harness), /日本語 codemode/);
			assert.doesNotMatch(renderPending(harness), /example.com/);
			releases.get("https://kagi.com/api/v1/search")!(jsonResponse({ data: {} }));
			await search;
			assert.equal(harness.entries.length, 2);
			assert.equal(harness.entries[1]?.data.summary, "0 results");
			assert.equal(harness.widgets.size, 0);
		} finally {
			for (const release of releases.values()) release(jsonResponse({ data: {} }));
			fetchStub.restore();
		}
	});

	it("persists large extraction outputs intact and renders them fully after reload/restart, outside model context", async () => {
		const harness = await authorizedHarness();
		harness.session.appendMessage({ role: "user", content: "Extract a page", timestamp: Date.now() });
		const markdown = `START\n${"long extracted paragraph\n".repeat(6000)}END`;
		const fetchStub = installFetchStub(() => jsonResponse({ meta: { trace: "large-trace" }, data: [{ url: "https://example.com", markdown }] }));
		try {
			const outcome = await runCall(harness, "kagi_extract", { urls: ["https://example.com"], timeout: 10 });
			const data = harness.entries[0]!.data;
			assert.equal(data.output, outcome.result.content[0]?.type === "text" ? outcome.result.content[0].text : "");
			assert.ok(data.output.length > 100_000);
			const file = harness.session.getSessionFile()!;
			assert.match(readFileSync(file, "utf8"), /large-trace/);
			for (const reason of ["reload", "resume", "startup"]) {
				const restored = SessionManager.open(file);
				const fresh = await authorizedHarness();
				await fresh.emit("session_start", { reason });
				const entry = restored.getEntries().find((entry) => entry.type === "custom" && entry.customType === KAGI_ACTIVITY_ENTRY);
				assert.ok(entry?.type === "custom");
				assert.deepEqual(entry.data, data);
				const rendered = renderCard(fresh, entry.data as KagiActivity, true, 200);
				assert.match(rendered, /START/);
				assert.match(rendered, /END/);
				assert.equal(rendered.match(/long extracted paragraph/g)?.length, 6000);
				assert.equal(restored.buildSessionContext().messages.length, 1);
				assert.doesNotMatch(JSON.stringify(restored.buildSessionContext().messages), /START|large-trace|kagi-activity/);
			}
		} finally {
			fetchStub.restore();
		}
	});

	it("captures patched execution inputs and respects final result redaction, even when original details remain", async () => {
		const harness = await authorizedHarness();
		const fetchStub = installFetchStub(() => jsonResponse({
			meta: { trace: "private-trace" },
			data: { search: [{ title: "private-title", url: "https://private.example" }] },
		}));
		try {
			await runCall(harness, "kagi_search", { query: "original" }, {
				patchInput(input) { input.query = "patched"; input.safeSearch = false; },
				resultText: "[redacted by another extension]",
			});
			const data = harness.entries[0]!.data;
			assert.deepEqual(data.input, { query: "patched", safeSearch: false });
			assert.equal(data.output, "[redacted by another extension]");
			assert.equal(data.summary, undefined);
			assert.doesNotMatch(JSON.stringify(harness.entries), /private-trace|private-title|private.example/);
		} finally {
			fetchStub.restore();
		}
	});

	it("records API errors and clears pending feedback", async () => {
		const harness = await authorizedHarness();
		const fetchStub = installFetchStub(() => jsonResponse({ meta: { trace: "error-trace" }, error: [{ code: "quota", message: "Exhausted" }] }, 429));
		try {
			const outcome = await runCall(harness, "kagi_search", { query: "pi" });
			assert.equal(outcome.isError, true);
			const data = harness.entries[0]!.data;
			assert.equal(data.status, "error");
			assert.match(data.output, /HTTP 429.*error-trace.*Exhausted/);
			assert.match(renderCard(harness, data, true), /HTTP 429/);
			assert.equal(harness.widgets.size, 0);
		} finally {
			fetchStub.restore();
		}
	});

	it("records aborted requests as cancelled without losing the error text", async () => {
		const harness = await authorizedHarness();
		const controller = new AbortController();
		let reachedFetch = false;
		const fetchStub = installFetchStub((_url, init) => new Promise((_resolve, reject) => {
			reachedFetch = true;
			assert.equal(init?.signal, controller.signal);
			init.signal.addEventListener("abort", () => reject(new DOMException("Request cancelled", "AbortError")), { once: true });
		}));
		try {
			const call = runCall(harness, "kagi_extract", { urls: ["https://example.com"] }, { signal: controller.signal });
			while (!reachedFetch) await new Promise<void>((resolve) => setImmediate(resolve));
			assert.match(renderPending(harness), /https:\/\/example.com/);
			controller.abort();
			await call;
			assert.equal(harness.entries[0]?.data.status, "cancelled");
			assert.equal(harness.entries[0]?.data.output, "Request cancelled");
			assert.equal(harness.widgets.size, 0);
		} finally {
			controller.abort();
			fetchStub.restore();
		}
	});

	it("leaves direct calls and non-TUI modes without duplicate activity entries or widgets", async () => {
		const fetchStub = installFetchStub();
		try {
			for (const mode of ["tui", "rpc", "json", "print"]) {
				const harness = await authorizedHarness(mode);
				const outcome = await runCall(harness, "kagi_search", { query: "pi" }, { parent: mode === "tui" ? null : "code" });
				assert.equal(outcome.isError, false);
				assert.equal(harness.entries.length, 0);
				assert.equal(harness.widgets.size, 0);
			}
		} finally {
			fetchStub.restore();
		}
	});

	it("keeps authorization denials and blocked/invalid calls diagnosable without network access", async () => {
		const fetchStub = installFetchStub();
		try {
			const harness = await authorizedHarness();
			await runCall(harness, "kagi_search", { query: "blocked" }, { block: true });
			assert.match(harness.entries[0]!.data.output, /Blocked by another extension/);
			await runCall(harness, "kagi_extract", { urls: [] }, { id: "code/2" });
			assert.equal(harness.entries[1]!.data.status, "error");
			const unapproved = createHarness({ globalSettings: { kagi: { apiKey: "key" } } });
			unapproved.selections.push(KAGI_AUTHORIZATION_CHOICES.denyOnce);
			await runCall(unapproved, "kagi_search", { query: "denied" });
			assert.match(unapproved.entries[0]!.data.output, /Kagi is not available/);
			assert.equal(unapproved.selectCount, 1);
			assert.equal(fetchStub.calls.length, 0);
			assert.equal(unapproved.widgets.size, 0);
		} finally {
			fetchStub.restore();
		}
	});

	it("clears pending calls on session replacement/shutdown and ignores late results", async () => {
		for (const boundary of ["session_start", "session_shutdown"]) {
			const harness = await authorizedHarness();
			const event = { toolCallId: "code/1", toolName: "kagi_search", args: { query: "old session" }, parentToolCallId: "code" };
			await harness.emit("tool_execution_start", event);
			assert.match(renderPending(harness), /old session/);
			await harness.emit(boundary, { reason: "new" });
			assert.equal(harness.widgets.size, 0);
			await harness.emit("tool_execution_end", { ...event, result: { content: [{ type: "text", text: "late" }] }, isError: false });
			assert.equal(harness.entries.length, 0);
		}
	});
});

describe("Kagi codemode integration", () => {
	it("records real nested calls even when the script discards their outputs", async () => {
		const harness = createHarness({ globalSettings: { kagi: { apiKey: "kagi-secret", enabled: true } } });
		const faux = registerFauxProvider();
		const model = faux.getModel();
		const settingsManager = SettingsManager.inMemory({ compaction: { enabled: false }, retry: { enabled: false } });
		const modelRuntime = await ModelRuntime.create({
			authPath: join(harness.ctx.cwd, "auth.json"),
			modelsPath: null,
			modelsStorePath: join(harness.ctx.cwd, "models-cache.json"),
			refreshOnCreate: false,
		});
		modelRuntime.registerProvider(model.provider, { api: model.api, apiKey: "faux-key", baseUrl: model.baseUrl, models: [model] });
		const resourceLoader = new DefaultResourceLoader({
			cwd: harness.ctx.cwd,
			agentDir: harness.ctx.cwd,
			settingsManager,
			noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true,
			extensionFactories: [createCodemodeExtension(), (pi) => registerKagiExtension(pi, {
				globalSettingsPath: harness.globalSettingsPath, state: createKagiState(),
			})],
		});
		await resourceLoader.reload();
		const manager = SessionManager.inMemory(harness.ctx.cwd);
		const { session } = await createAgentSession({
			cwd: harness.ctx.cwd, agentDir: harness.ctx.cwd, model, modelRuntime, settingsManager,
			resourceLoader, sessionManager: manager, tools: ["codemode", "kagi_search", "kagi_extract"],
		});
		const errors: unknown[] = [];
		const fetchStub = installFetchStub((url) => url.endsWith("/search")
			? jsonResponse({ data: { search: [{ title: "Hidden result", url: "https://example.com" }] } })
			: jsonResponse({ data: [{ url: "https://example.com", markdown: "Hidden extraction" }] }));
		try {
			await session.bindExtensions({ mode: "tui", uiContext: harness.ctx.ui as any, onError: (error) => errors.push(error) });
			faux.setResponses([
				fauxAssistantMessage([fauxToolCall("codemode", { code: `
					await Promise.all([
						tools.kagi_search({ query: "codemode integration" }),
						tools.kagi_extract({ urls: ["https://example.com"] })
					]);
					text("Only script summary");
				` })], { stopReason: "toolUse" }),
				fauxAssistantMessage("Done"),
			]);
			await session.prompt("Run the script");
			assert.deepEqual(errors, []);
			assert.equal(fetchStub.calls.length, 2);
			const entries = manager.getEntries().filter((entry) => entry.type === "custom" && entry.customType === KAGI_ACTIVITY_ENTRY);
			assert.equal(entries.length, 2);
			assert.match(JSON.stringify(entries), /Hidden result/);
			assert.match(JSON.stringify(entries), /Hidden extraction/);
			assert.doesNotMatch(JSON.stringify(manager.buildSessionContext().messages), /Hidden result|Hidden extraction|kagi-secret/);
			const result = session.messages.find((message) => message.role === "toolResult" && message.toolName === "codemode");
			assert.ok(result);
			assert.match(JSON.stringify(result), /Script completed/);
			assert.match(JSON.stringify(result), /Only script summary/);
			assert.equal(harness.widgets.size, 0);
		} finally {
			fetchStub.restore();
			session.dispose();
			faux.unregister();
		}
	});
});
