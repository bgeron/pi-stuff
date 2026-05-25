import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const TERMINAL_PUNCTUATION = /[.!?;:…。！？]$/u;

export function formatContinueMessage(message: string): string {
	const trimmed = message.trim();
	if (!trimmed) return "Continue";
	return `${trimmed}${TERMINAL_PUNCTUATION.test(trimmed) ? "" : "."} Continue`;
}

export default function (pi: ExtensionAPI) {
	const handler = async (args: string) => {
		pi.sendUserMessage(formatContinueMessage(args), { deliverAs: "steer" });
	};

	pi.registerCommand("c", {
		description: "Send a steering message ending with Continue",
		handler,
	});

	pi.registerCommand("continue", {
		description: "Alias for /c: send a steering message ending with Continue",
		handler,
	});
}
