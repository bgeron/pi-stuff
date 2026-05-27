import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { getSupportedThinkingLevels } from "@earendil-works/pi-ai";

const REVERSE_CYCLE_SHORTCUT = "alt+shift+tab";

export default function setThinkingExtension(pi: ExtensionAPI): void {
	pi.registerShortcut(REVERSE_CYCLE_SHORTCUT, {
		description: "Cycle thinking level backward",
		handler: (ctx) => {
			if (!ctx.model?.reasoning) {
				ctx.ui.notify("Current model does not support thinking", "info");
				return;
			}

			const levels = getSupportedThinkingLevels(ctx.model);
			const currentIndex = levels.indexOf(pi.getThinkingLevel());
			const previousIndex = currentIndex < 0 ? levels.length - 1 : (currentIndex - 1 + levels.length) % levels.length;
			const previousLevel = levels[previousIndex];

			pi.setThinkingLevel(previousLevel);
			ctx.ui.notify(`Thinking level: ${previousLevel}`, "info");
		},
	});
}
