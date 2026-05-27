---
name: address-review
description: "Workflow for collaborating on PR review comments stored in a TOML file."
---

# Address Review Comments

Use this skill when the user is collaborating with the agent to address PR review comments recorded in a TOML file.

## Review TOML conventions

- The review file is TOML and contains an array of tables such as `[[...]]`; do not assume a specific table path.
- Each table is one review comment and usually includes the review comment text plus the diff hunk it was made on.
- Only consider entries that have a `human-response` field. Skip entries without `human-response` for this session.
- Treat `human-response` as the user's instruction for that comment. It may ask for a code/doc change, a modified version of the reviewer suggestion, or investigation.
- When work on an entry is useful, add or update an `agent-response` field directly below `human-response`, preserving the surrounding TOML as much as practical.
- Prefer `agent-response` for durable results. TOML comments may be used for supplementary investigation notes if that is clearer, but still preserve valid TOML.

## Preflight

1. If the review TOML path is not provided, ask for it before proceeding.
2. Run `jj status` before making changes.
3. If the working-copy commit already contains unrelated changes, do not accidentally include them in review-comment commits. Ask the user how to isolate them, or use path-limited/interactive `jj commit` only when you can do so safely.
4. Read the relevant review TOML and identify all entries that contain `human-response`; ignore the rest.
5. Process one review comment at a time. Do not batch multiple comments into one commit unless the user explicitly asks.

## Per-comment workflow

For each considered entry:

1. Read the review comment, diff hunk, location metadata, and `human-response`.
2. Inspect the referenced code and enough surrounding context to understand the issue.
3. If the instruction is clear and feasible, implement the change or perform the requested investigation.
4. Run focused checks/tests when practical.
5. Update the same TOML entry with `agent-response` immediately below `human-response`, summarizing:
   - what was changed or investigated;
   - checks/tests run, if any;
   - any caveats or follow-up needed.
6. Commit before moving to the next review comment:

   ```bash
   jj status
   jj commit -m "address review: <brief comment/location summary>"
   ```

`jj commit` records the current working-copy change and creates a new empty working-copy change on top. Use `-m` so the command does not need an editor.

## Investigation-only comments

If `human-response` asks for investigation rather than a code change:

1. Investigate and optionally run experiments or checks.
2. Record the result in `agent-response` or, if useful, TOML comments near the entry.
3. Run `jj status` and `jj commit -m "investigate review: <brief summary>"` before proceeding, even if the durable change is only the TOML note.

## When the suggestion is not practical

Sometimes an attempted implementation reveals that the review suggestion is not a good fit.

1. Preserve the failed or draft attempt in history:

   ```bash
   jj status
   jj commit -m "draft review attempt: <brief summary>"
   ```

2. Return the working copy to the previous commit with:

   ```bash
   jj prev
   ```

   `jj prev` creates a new empty working-copy change based on an ancestor behind the parent of the current working-copy change. In this workflow, after committing the draft attempt, it moves the working copy back before that draft while leaving the draft commit available in history.

3. Update the review TOML entry with an `agent-response` directly below `human-response`, explaining:
   - what was attempted;
   - why it was not kept;
   - where the draft attempt was committed, if identifiable from `jj log`;
   - any alternative recommendation.
4. Commit that response before moving on:

   ```bash
   jj status
   jj commit -m "respond review: <brief summary>"
   ```

## Clarifying questions to ask when needed

Ask the user instead of guessing if any of these are unclear:

- Which TOML review file should be used?
- Whether an entry with ambiguous `human-response` should be implemented, investigated, or skipped.
- How to handle pre-existing unrelated working-copy changes.
- Whether to use a different response field name or TOML formatting convention.
- Whether a risky or broad reviewer suggestion should be attempted now or only analyzed.
