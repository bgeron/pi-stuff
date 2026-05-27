import assert from "node:assert/strict";
import { describe, it } from "node:test";
import setThinkingExtension from "./index.js";

type RegisteredShortcut = {
	description?: string;
	handler: (ctx: any) => void | Promise<void>;
};

type Notification = { message: string; level: string };

function registerTestExtension(currentLevel = "medium") {
	let shortcut: RegisteredShortcut | undefined;
	const selectedLevels: string[] = [];
	const pi = {
		registerShortcut(key: string, registered: RegisteredShortcut) {
			assert.equal(key, "alt+shift+tab");
			shortcut = registered;
		},
		getThinkingLevel: () => currentLevel,
		setThinkingLevel: (level: string) => selectedLevels.push(level),
	};

	setThinkingExtension(pi as never);
	assert(shortcut);
	return { shortcut, selectedLevels };
}

function context(model?: {
	id: string;
	reasoning: boolean;
	thinkingLevelMap?: Record<string, string | null>;
}) {
	const notifications: Notification[] = [];
	return {
		ctx: {
			model,
			ui: {
				notify(message: string, level: string) {
					notifications.push({ message, level });
				},
			},
		},
		notifications,
	};
}

describe("reverse thinking-level shortcut", () => {
	it("registers Alt+Shift+Tab without registering a command", () => {
		const { shortcut } = registerTestExtension();
		assert.equal(shortcut.description, "Cycle thinking level backward");
	});

	it("cycles to the previous thinking level", async () => {
		const { shortcut, selectedLevels } = registerTestExtension("medium");
		const test = context({ id: "reasoning-model", reasoning: true });

		await shortcut.handler(test.ctx);

		assert.deepEqual(selectedLevels, ["low"]);
		assert.deepEqual(test.notifications, [{ message: "Thinking level: low", level: "info" }]);
	});

	it("wraps from off to the highest supported thinking level", async () => {
		const { shortcut, selectedLevels } = registerTestExtension("off");
		const test = context({
			id: "reasoning-model",
			reasoning: true,
			thinkingLevelMap: { xhigh: "xhigh", max: "max" },
		});

		await shortcut.handler(test.ctx);

		assert.deepEqual(selectedLevels, ["max"]);
		assert.deepEqual(test.notifications, [{ message: "Thinking level: max", level: "info" }]);
	});

	it("skips thinking levels unsupported by the active model", async () => {
		const { shortcut, selectedLevels } = registerTestExtension("medium");
		const test = context({
			id: "reasoning-model",
			reasoning: true,
			thinkingLevelMap: { low: null },
		});

		await shortcut.handler(test.ctx);

		assert.deepEqual(selectedLevels, ["minimal"]);
	});

	it("chooses the highest supported level when the current level is unavailable", async () => {
		const { shortcut, selectedLevels } = registerTestExtension("max");
		const test = context({ id: "reasoning-model", reasoning: true });

		await shortcut.handler(test.ctx);

		assert.deepEqual(selectedLevels, ["high"]);
	});

	for (const model of [undefined, { id: "plain-model", reasoning: false }]) {
		it(`does not change the level when ${model ? "the model does not support thinking" : "there is no active model"}`, async () => {
			const { shortcut, selectedLevels } = registerTestExtension();
			const test = context(model);

			await shortcut.handler(test.ctx);

			assert.deepEqual(selectedLevels, []);
			assert.deepEqual(test.notifications, [
				{ message: "Current model does not support thinking", level: "info" },
			]);
		});
	}
});
