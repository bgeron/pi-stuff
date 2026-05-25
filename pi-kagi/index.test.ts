import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildSearchRequest, formatKagiApiError, parseKagiResponseText } from "./index.js";

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
