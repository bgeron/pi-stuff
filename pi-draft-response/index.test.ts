import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseDraftResponseArgs, parseReviewComments, updateHumanResponses, updateReviewCommentField } from "./index.js";

const sample = `[[reviews.comments]]
path = "src/a.ts:12"
original_line = 12
body = "first comment"

[[reviews.comments]]
path = "src/b.ts:34"
body = """
line one
line two
line three
line four
"""
human-response = "old thought"
agent-response = "implemented the requested change"
`;

describe("draft-response argument parsing", () => {
	it("accepts file path and field", () => {
		assert.deepEqual(parseDraftResponseArgs("@review.toml human-response"), {
			filePath: "@review.toml",
			fieldName: "human-response",
		});
	});

	it("treats a single @ or TOML argument as the file", () => {
		assert.deepEqual(parseDraftResponseArgs("@review.toml"), { filePath: "@review.toml" });
		assert.deepEqual(parseDraftResponseArgs("review.toml"), { filePath: "review.toml" });
	});

	it("treats a single non-path argument as the field", () => {
		assert.deepEqual(parseDraftResponseArgs("draft_note"), { fieldName: "draft_note" });
	});
});

describe("review TOML parsing", () => {
	it("extracts review comments and existing human responses", () => {
		const comments = parseReviewComments(sample);
		assert.equal(comments.length, 2);
		assert.equal(comments[0].path, "src/a.ts:12");
		assert.equal(comments[0].originalLine, 12);
		assert.equal(comments[0].body, "first comment");
		assert.equal(comments[0].fieldValue, "");
		assert.equal(comments[1].body, "line one\nline two\nline three\nline four\n");
		assert.equal(comments[1].fieldValue, "old thought");
		assert.equal(comments[1].agentResponse, "implemented the requested change");
	});
});

describe("review comment field updates", () => {
	it("creates missing fields and updates existing fields", () => {
		const updated = updateHumanResponses(sample, ["new thought", "replacement"]);
		assert.match(updated, /body = "first comment"\nhuman-response = "new thought"/);
		assert.match(updated, /human-response = "replacement"/);
		assert.doesNotMatch(updated, /old thought/);
	});

	it("can edit fields other than human-response", () => {
		const updated = updateReviewCommentField(sample, "draft_note", ["note one", "note two"]);
		assert.match(updated, /draft_note = "note one"/);
		assert.match(updated, /draft_note = "note two"/);
		assert.match(updated, /human-response = "old thought"/);
	});

	it("removes existing fields when the edited value is empty", () => {
		const updated = updateHumanResponses(sample, ["", ""]);
		assert.doesNotMatch(updated, /human-response/);
	});

	it("escapes TOML string values", () => {
		const updated = updateHumanResponses(sample, ['quote " and newline\nkept', ""]);
		assert.match(updated, /human-response = "quote \\" and newline\\nkept"/);
	});
});
