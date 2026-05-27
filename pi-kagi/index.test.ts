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
	};
	const ctx = {
		mode: options.mode ?? "tui",
		hasUI: options.mode === "print" || options.mode === "json" ? false : true,
		cwd,
		sessionManager: { getSessionId: () => sessionId },
		ui: {
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

function installFetchStub(): { calls: string[]; restore(): void } {
	const original = globalThis.fetch;
	const calls: string[] = [];
	globalThis.fetch = (async (url: string | URL | Request) => {
		const value = String(url);
		calls.push(value);
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
