import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, relative } from "node:path";
import { describe, it } from "node:test";
import continueExtension, {
	formatContinueMessage,
	formatSnippetDescription,
	formatSnippetMessage,
	isMultiParagraphPrompt,
	loadSnippets,
	normalizeSnippetMap,
	parseSnippetArgs,
	registerSnippetCommands,
} from "./index.js";

describe("Continue message formatting", () => {
	it("appends a full stop and Continue for plain messages", () => {
		assert.equal(formatContinueMessage("finish the tests"), "finish the tests. Continue");
	});

	it("trims leading and trailing whitespace", () => {
		assert.equal(formatContinueMessage("  finish the tests  \n"), "finish the tests. Continue");
	});

	it("does not duplicate terminal punctuation", () => {
		assert.equal(formatContinueMessage("finish the tests."), "finish the tests. Continue");
		assert.equal(formatContinueMessage("what failed?"), "what failed? Continue");
		assert.equal(formatContinueMessage("try again…"), "try again… Continue");
	});

	it("uses just Continue for blank input", () => {
		assert.equal(formatContinueMessage("  \t\n"), "Continue");
	});
});

describe("Snippet message formatting", () => {
	it("formats prefix, punctuated args, and suffix", () => {
		assert.equal(
			formatSnippetMessage("ship it", { prefix: "Please", suffix: "Continue" }),
			"Please ship it. Continue",
		);
	});

	it("does not add punctuation when the snippet has no suffix", () => {
		assert.equal(formatSnippetMessage("ship it", { prefix: "Please" }), "Please ship it");
	});

	it("allows object snippets to suppress implicit punctuation", () => {
		assert.equal(
			formatSnippetMessage("ship it", { prefix: "", suffix: "Continue", punctuate: false }),
			"ship it Continue",
		);
		assert.equal(
			formatSnippetMessage("ship it!", { prefix: "", suffix: "Continue", punctuate: false }),
			"ship it! Continue",
		);
		assert.equal(
			formatSnippetMessage("ship it", { prefix: "", suffix: "Continue", punctuate: true }),
			"ship it. Continue",
		);
	});

	it("formats blank arguments from prefix and suffix only", () => {
		assert.equal(formatSnippetMessage(" \n\t ", { prefix: "Please", suffix: "Continue" }), "Please Continue");
	});

	it("does not insert whitespace before attaching punctuation", () => {
		assert.equal(formatSnippetMessage(", ship it", { prefix: "Please", suffix: "Continue" }), "Please, ship it. Continue");
		assert.equal(formatSnippetMessage("ship it", { prefix: "Please", suffix: ", then continue" }), "Please ship it, then continue");
		assert.equal(formatSnippetMessage("ship it", { prefix: "Please", suffix: "? Continue" }), "Please ship it? Continue");
	});

	it("still inserts whitespace before prompt placeholders in descriptions", () => {
		assert.equal(formatSnippetDescription({ prefix: "Please", suffix: "Continue" }), "Expand a configured snippet | Please <prompt>. Continue");
	});

	it("trims whitespace around prefix, args, and suffix without collapsing internal whitespace", () => {
		assert.equal(
			formatSnippetMessage("  ship\n\t it  ", { prefix: " Please\n", suffix: "\tContinue  " }),
			"Please ship\n\t it. Continue",
		);
	});

	it("preserves larger internal whitespace runs in arguments", () => {
		assert.equal(formatSnippetMessage("ship     it     then\t\tverify", { prefix: "", suffix: "Continue" }), "ship     it     then\t\tverify. Continue");
	});

	it("trims large leading and trailing whitespace around arguments", () => {
		assert.equal(
			formatSnippetMessage("\n\n\t     ship it     \t\n\n", { prefix: "", suffix: "Continue" }),
			"ship it. Continue",
		);
	});

	it("preserves intended word separation when prefix and suffix contain only whitespace padding", () => {
		assert.equal(
			formatSnippetMessage("   ", { prefix: "\n\nPlease\t\t", suffix: "\n\tContinue\n\n" }),
			"Please Continue",
		);
	});

	it("preserves internal whitespace in prefix and suffix", () => {
		assert.equal(
			formatSnippetMessage("ship\t\tit", { prefix: "Say   please", suffix: "then\n\ncontinue" }),
			"Say   please ship\t\tit. then\n\ncontinue",
		);
	});

	it("returns an empty string for an all-empty prefix-only snippet with blank arguments", () => {
		assert.equal(formatSnippetMessage(" \n\t ", { prefix: "\n\t  " }), "");
	});
});

describe("Multi-paragraph prompt detection", () => {
	it("detects blank, whitespace-only, and punctuation-only separator lines", () => {
		assert.equal(isMultiParagraphPrompt("do A\n\ndo B"), true);
		assert.equal(isMultiParagraphPrompt("do A\n \t \ndo B"), true);
		assert.equal(isMultiParagraphPrompt("do A\n---\ndo B"), true);
		assert.equal(isMultiParagraphPrompt("do A\n...???\ndo B"), true);
	});

	it("does not detect normal visual lines or leading/trailing separator-like lines", () => {
		assert.equal(isMultiParagraphPrompt("do A\ndo B"), false);
		assert.equal(isMultiParagraphPrompt("---\ndo B"), false);
		assert.equal(isMultiParagraphPrompt("do A\n---"), false);
		assert.equal(isMultiParagraphPrompt("do A\nnot blank\ndo B"), false);
		assert.equal(isMultiParagraphPrompt("do A\n123\ndo B"), false);
		assert.equal(isMultiParagraphPrompt("do A\n✨\ndo B"), false);
	});
});

describe("Multi-paragraph snippet message formatting", () => {
	it("uses blank lines between prefix, multi-paragraph args, and suffix", () => {
		assert.equal(
			formatSnippetMessage("do A\n\ndo B", { prefix: "Please", suffix: "Continue" }),
			"Please\n\ndo A\n\ndo B\n\nContinue",
		);
	});

	it("uses blank lines for prefix-only and suffix-only snippets", () => {
		assert.equal(formatSnippetMessage("do A\n\ndo B", { prefix: "Please" }), "Please\n\ndo A\n\ndo B");
		assert.equal(formatSnippetMessage("do A\n\ndo B", { prefix: "", suffix: "Continue" }), "do A\n\ndo B\n\nContinue");
	});

	it("preserves internal prompt whitespace and trims outer prompt whitespace", () => {
		assert.equal(
			formatSnippetMessage(" \n\t do A\n  \t\n\t do B \n", { prefix: "Please", suffix: "Continue" }),
			"Please\n\ndo A\n  \t\n\t do B\n\nContinue",
		);
	});

	it("does not let multi-paragraph prefix or suffix alone trigger blank-line joining", () => {
		assert.equal(
			formatSnippetMessage("ship it", { prefix: "Please\n\nreally", suffix: "then\n\ncontinue" }),
			"Please\n\nreally ship it. then\n\ncontinue",
		);
	});
});

describe("Snippet config parsing", () => {
	it("accepts legacy values, explicit objects, and null snippets", () => {
		assert.deepEqual(normalizeSnippetMap({
			ask: "Please",
			go: ["Go"],
			cont: ["", "Continue"],
			explicitPrefix: { prefix: "Explicitly" },
			explicitSuffix: { suffix: "Continue" },
			explicitBoth: { prefix: "Please", suffix: "Continue" },
			unpunctuated: { suffix: "Continue", punctuate: false },
			punctuated: { suffix: "Continue", punctuate: true },
			removed: null,
		}), {
			ask: { prefix: "Please" },
			go: { prefix: "Go" },
			cont: { prefix: "", suffix: "Continue" },
			explicitPrefix: { prefix: "Explicitly" },
			explicitSuffix: { prefix: "", suffix: "Continue" },
			explicitBoth: { prefix: "Please", suffix: "Continue" },
			unpunctuated: { prefix: "", suffix: "Continue", punctuate: false },
			punctuated: { prefix: "", suffix: "Continue", punctuate: true },
		});
	});

	it("rejects invalid command names", () => {
		assert.throws(() => normalizeSnippetMap({ "": "x" }), /Invalid snippet command name/);
		assert.throws(() => normalizeSnippetMap({ "bad name": "x" }), /Invalid snippet command name/);
		assert.throws(() => normalizeSnippetMap({ "bad/name": "x" }), /Invalid snippet command name/);
	});

	it("rejects invalid snippet values", () => {
		assert.throws(() => normalizeSnippetMap({ bad: {} }), /Invalid snippet for \/bad/);
		assert.throws(() => normalizeSnippetMap({ bad: [] }), /Invalid snippet for \/bad/);
		assert.throws(() => normalizeSnippetMap({ bad: ["a", "b", "c"] }), /Invalid snippet for \/bad/);
		assert.throws(() => normalizeSnippetMap({ bad: ["a", 1] }), /Invalid snippet for \/bad/);
		assert.throws(() => normalizeSnippetMap({ bad: { suffix: 1 } }), /Invalid snippet for \/bad/);
		assert.throws(() => normalizeSnippetMap({ bad: { suffix: "Continue", punctuate: "no" } }), /Invalid snippet for \/bad/);
		assert.throws(() => normalizeSnippetMap({ bad: { punctuate: false } }), /Invalid snippet for \/bad/);
		assert.throws(() => normalizeSnippetMap({ bad: { sufix: "Continue" } }), /Invalid snippet for \/bad/);
	});
});

describe("Snippet settings loading", () => {
	function useAgentDir(dir: string): () => void {
		const oldAgentDir = process.env.PI_CODING_AGENT_DIR;
		process.env.PI_CODING_AGENT_DIR = dir;
		return () => {
			if (oldAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
			else process.env.PI_CODING_AGENT_DIR = oldAgentDir;
		};
	}

	it("uses built-in snippets when continue.snippets is absent", () => {
		const settingsManager = {
			getGlobalSettings: () => ({}),
			getProjectSettings: () => ({}),
		};

		assert.deepEqual(loadSnippets(settingsManager as never), {
			c: { prefix: "", suffix: "Continue" },
			continue: { prefix: "", suffix: "Continue" },
		});
	});

	it("keeps built-in snippets when continue.snippets is an empty object", () => {
		const settingsManager = {
			getGlobalSettings: () => ({ continue: { snippets: {} } }),
			getProjectSettings: () => ({}),
		};

		assert.deepEqual(loadSnippets(settingsManager as never), {
			c: { prefix: "", suffix: "Continue" },
			continue: { prefix: "", suffix: "Continue" },
		});
	});

	it("allows null to remove built-in snippets", () => {
		const settingsManager = {
			getGlobalSettings: () => ({ continue: { snippets: { c: null, continue: null, go: "Go" } } }),
			getProjectSettings: () => ({}),
		};

		assert.deepEqual(loadSnippets(settingsManager as never), {
			go: { prefix: "Go" },
		});
	});

	it("merges global and project inline snippet maps", () => {
		const settingsManager = {
			getGlobalSettings: () => ({ continue: { snippets: { ask: "Please", go: "Go" } } }),
			getProjectSettings: () => ({ continue: { snippets: { go: { prefix: "Go now", suffix: "Continue", punctuate: false } } } }),
		};

		assert.deepEqual(loadSnippets(settingsManager as never), {
			c: { prefix: "", suffix: "Continue" },
			continue: { prefix: "", suffix: "Continue" },
			ask: { prefix: "Please" },
			go: { prefix: "Go now", suffix: "Continue", punctuate: false },
		});
	});

	it("loads relative snippet paths from the global settings directory", () => {
		const dir = mkdtempSync(join(tmpdir(), "pi-continue-test-"));
		const restoreAgentDir = useAgentDir(dir);
		try {
			writeFileSync(join(dir, "snippets.json"), JSON.stringify({ go: ["Go", "Continue"] }));
			const settingsManager = {
				getGlobalSettings: () => ({ continue: { snippets: "snippets.json" } }),
				getProjectSettings: () => ({}),
			};

			assert.deepEqual(loadSnippets(settingsManager as never), {
				c: { prefix: "", suffix: "Continue" },
				continue: { prefix: "", suffix: "Continue" },
				go: { prefix: "Go", suffix: "Continue" },
			});
		} finally {
			restoreAgentDir();
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("loads ordered JSON and YAML includes before sibling snippets", () => {
		const dir = mkdtempSync(join(tmpdir(), "pi-continue-test-"));
		const restoreAgentDir = useAgentDir(dir);
		try {
			writeFileSync(join(dir, "base.yaml"), "c: null\ngo: [Go, Continue]\nshared: Base\n");
			writeFileSync(join(dir, "personal.json"), JSON.stringify({ shared: "Personal", extra: "Extra" }));
			const settingsManager = {
				getGlobalSettings: () => ({
					continue: {
						snippets: {
							_include: ["base.yaml", "personal.json"],
							shared: { suffix: "Local" },
						},
					},
				}),
				getProjectSettings: () => ({}),
			};

			assert.deepEqual(loadSnippets(settingsManager as never), {
				continue: { prefix: "", suffix: "Continue" },
				go: { prefix: "Go", suffix: "Continue" },
				shared: { prefix: "", suffix: "Local" },
				extra: { prefix: "Extra" },
			});
		} finally {
			restoreAgentDir();
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("expands a leading tilde when loading a YAML snippet file", () => {
		const dir = mkdtempSync(join(homedir(), ".pi-continue-test-"));
		try {
			const file = join(dir, "snippets.yml");
			writeFileSync(file, "go:\n  suffix: Continue\n");
			const settingsManager = {
				getGlobalSettings: () => ({ continue: { snippets: `~/${relative(homedir(), file)}` } }),
				getProjectSettings: () => ({}),
			};

			assert.deepEqual(loadSnippets(settingsManager as never).go, { prefix: "", suffix: "Continue" });
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("requires valid include arrays, recognized extensions, and non-recursive files", () => {
		const dir = mkdtempSync(join(tmpdir(), "pi-continue-test-"));
		const restoreAgentDir = useAgentDir(dir);
		try {
			writeFileSync(join(dir, "snippets.txt"), "{}");
			writeFileSync(join(dir, "nested.json"), JSON.stringify({ _include: [] }));
			const settings = (snippets: unknown) => ({
				getGlobalSettings: () => ({ continue: { snippets } }),
				getProjectSettings: () => ({}),
			});

			assert.throws(() => loadSnippets(settings({ _include: "snippets.json" }) as never), /expected an array of file paths/);
			assert.throws(() => loadSnippets(settings({ _include: ["snippets.txt"] }) as never), /Unsupported snippet file extension/);
			assert.throws(() => loadSnippets(settings({ _include: ["nested.json"] }) as never), /nested _include is not supported/);
		} finally {
			restoreAgentDir();
			rmSync(dir, { recursive: true, force: true });
		}
	});
});

describe("Snippet follow-up marker parsing", () => {
	it("uses steering delivery by default", () => {
		assert.deepEqual(parseSnippetArgs("ship it"), { args: "ship it", deliverAs: "steer" });
	});

	it("treats a leading plus marker followed by whitespace as follow-up delivery", () => {
		assert.deepEqual(parseSnippetArgs("+ ship it"), { args: "ship it", deliverAs: "followUp" });
		assert.deepEqual(parseSnippetArgs(" + ship it"), { args: "ship it", deliverAs: "followUp" });
		assert.deepEqual(parseSnippetArgs(" \t + \t ship it"), { args: "ship it", deliverAs: "followUp" });
	});

	it("does not treat plus without surrounding separation as a follow-up marker", () => {
		assert.deepEqual(parseSnippetArgs("+ship it"), { args: "+ship it", deliverAs: "steer" });
		assert.deepEqual(parseSnippetArgs("ship + it"), { args: "ship + it", deliverAs: "steer" });
		assert.deepEqual(parseSnippetArgs("ship it +"), { args: "ship it +", deliverAs: "steer" });
	});
});

describe("Snippet command descriptions", () => {
	it("describes the message shape with a prompt placeholder", () => {
		assert.equal(
			formatSnippetDescription({ prefix: "Please", suffix: "Continue" }),
			"Expand a configured snippet | Please <prompt>. Continue",
		);
		assert.equal(
			formatSnippetDescription({ prefix: "", suffix: "Continue" }),
			"Expand a configured snippet | <prompt>. Continue",
		);
		assert.equal(
			formatSnippetDescription({ prefix: "create a todo:", suffix: "Don't work on it yet." }),
			"Expand a configured snippet | create a todo: <prompt>. Don't work on it yet.",
		);
		assert.equal(
			formatSnippetDescription({ prefix: "Please" }),
			"Expand a configured snippet | Please <prompt>",
		);
		assert.equal(
			formatSnippetDescription({ prefix: "Please", suffix: ", then continue" }),
			"Expand a configured snippet | Please <prompt>, then continue",
		);
		assert.equal(
			formatSnippetDescription({ prefix: "Please", suffix: "Continue", punctuate: false }),
			"Expand a configured snippet | Please <prompt> Continue",
		);
	});
});

describe("Continue command registration", () => {
	type RegisteredCommand = { description: string; handler: (args: string, ctx: unknown) => Promise<void> };

	function registerTestCommands() {
		const commands = new Map<string, RegisteredCommand>();
		const sentMessages: Array<{ content: string; options: unknown }> = [];
		const pi = {
			registerCommand(name: string, command: RegisteredCommand) {
				commands.set(name, command);
			},
			sendUserMessage(content: string, options: unknown) {
				sentMessages.push({ content, options });
			},
		};
		registerSnippetCommands(pi as never, {
			c: { prefix: "", suffix: "Continue" },
			ct: { prefix: "create a todo:", suffix: "Don't work on it yet." },
		});
		return { commands, sentMessages };
	}

	function interactiveContext(idle: boolean, expanded: string[], notifications: string[]) {
		return {
			isIdle: () => idle,
			mode: "tui",
			ui: {
				setEditorText: (message: string) => expanded.push(message),
				notify: (message: string) => notifications.push(message),
			},
		};
	}

	it("registers every snippet with an expansion description", () => {
		const { commands } = registerTestCommands();

		assert.deepEqual([...commands.keys()], ["c", "ct"]);
		assert.equal(commands.get("c")?.description, "Expand a configured snippet | <prompt>. Continue");
		assert.equal(commands.get("ct")?.description, "Expand a configured snippet | create a todo: <prompt>. Don't work on it yet.");
	});

	it("silently expands normal snippets into the editor whether idle or busy", async () => {
		const { commands, sentMessages } = registerTestCommands();
		const expanded: string[] = [];
		const notifications: string[] = [];

		await commands.get("c")?.handler(" ship it ", interactiveContext(true, expanded, notifications));
		await commands.get("ct")?.handler("fix autocomplete", interactiveContext(false, expanded, notifications));

		assert.deepEqual(expanded, [
			"ship it. Continue",
			"create a todo: fix autocomplete. Don't work on it yet.",
		]);
		assert.deepEqual(sentMessages, []);
		assert.deepEqual(notifications, []);
	});

	it("expands an empty /c prompt to Continue", async () => {
		const { commands, sentMessages } = registerTestCommands();
		const expanded: string[] = [];

		await commands.get("c")?.handler("", interactiveContext(false, expanded, []));

		assert.deepEqual(expanded, ["Continue"]);
		assert.deepEqual(sentMessages, []);
	});

	it("uses editor-text UI behavior in RPC mode", async () => {
		const { commands, sentMessages } = registerTestCommands();
		const expanded: string[] = [];

		await commands.get("c")?.handler("ship it", {
			mode: "rpc",
			ui: { setEditorText: (message: string) => expanded.push(message) },
		});

		assert.deepEqual(expanded, ["ship it. Continue"]);
		assert.deepEqual(sentMessages, []);
	});

	it("keeps explicit plus invocations as a direct follow-up fast path", async () => {
		const { commands, sentMessages } = registerTestCommands();
		const expanded: string[] = [];

		await commands.get("c")?.handler(" + follow after tools ", interactiveContext(false, expanded, []));

		assert.deepEqual(expanded, []);
		assert.deepEqual(sentMessages, [
			{ content: "follow after tools. Continue", options: { deliverAs: "followUp" } },
		]);
	});

	it("sends normal snippets as steering messages in print and JSON modes", async () => {
		const { commands, sentMessages } = registerTestCommands();

		await commands.get("c")?.handler("print it", { mode: "print", ui: {} });
		await commands.get("ct")?.handler("record it", { mode: "json", ui: {} });

		assert.deepEqual(sentMessages, [
			{ content: "print it. Continue", options: { deliverAs: "steer" } },
			{ content: "create a todo: record it. Don't work on it yet.", options: { deliverAs: "steer" } },
		]);
	});

	it("loads snippets for the default extension entry point", () => {
		const commands = new Map<string, { description: string }>();
		const pi = {
			registerCommand(name: string, command: { description: string }) {
				commands.set(name, command);
			},
			sendUserMessage() {},
		};

		continueExtension(pi as never);

		assert(commands.has("c"));
		assert(commands.has("continue"));
		assert.equal(commands.get("c")?.description, "Expand a configured snippet | <prompt>. Continue");
		assert.equal(commands.get("continue")?.description, "Expand a configured snippet | <prompt>. Continue");
	});
});
