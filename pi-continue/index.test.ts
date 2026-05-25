import assert from "node:assert/strict";
import { describe, it } from "node:test";
import continueExtension, { formatContinueMessage } from "./index.js";

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

describe("Continue command registration", () => {
	it("registers /c and /continue commands that send steering messages", async () => {
		const commands = new Map<string, { handler: (args: string, ctx: unknown) => Promise<void> }>();
		const sentMessages: Array<{ content: string; options: unknown }> = [];
		const pi = {
			registerCommand(name: string, command: { handler: (args: string, ctx: unknown) => Promise<void> }) {
				commands.set(name, command);
			},
			sendUserMessage(content: string, options: unknown) {
				sentMessages.push({ content, options });
			},
		};

		continueExtension(pi as never);

		assert.deepEqual([...commands.keys()], ["c", "continue"]);
		await commands.get("c")?.handler(" ship it ", {});
		await commands.get("continue")?.handler("ship it!", {});

		assert.deepEqual(sentMessages, [
			{ content: "ship it. Continue", options: { deliverAs: "steer" } },
			{ content: "ship it! Continue", options: { deliverAs: "steer" } },
		]);
	});
});
