# Bram's Pi Packages

This directory contains extensions and skills that Bram (github:@bgeron, npm:@bramgeron) uses for the [Pi coding agent](https://pi.dev/). Most of this is vibe-coded. I don't expect many changes in these packages, but I also don't guarantee any stability. Pull requests will most likely not be considered and I don't expect to give support on it, but I may hop into the GitHub discussions from time to time. If you find this useful, please fork and adapt it to your own needs.

Inspired by Armin Ronacher https://github.com/mitsuhiko/agent-stuff/ .

## Packages

### `@bramgeron/pi-continue`

A tiny Pi extension for the moments when you want to nudge the agent without typing the same little instruction again and again.

Out of the box it gives you `/c` and `/continue`: short commands that expand your prompt into an editable message ending in `Continue`.

```text
/c finish the tests
```

expands into the editor as:

```text
finish the tests. Continue
```

#### Install

Install from npm after release:

```bash
pi install npm:@bramgeron/pi-continue
```

Run Pi with the development version from this repository:

```bash
pi -e ./pi-continue
```

#### Basic commands

- `/c <prompt>` — expand to `<prompt>. Continue` in the editor.
- `/continue <prompt>` — the same command with a longer name.

The extension is polite about punctuation: `/c ship it!` becomes `ship it! Continue`, not `ship it!. Continue`.

If you leave the prompt blank, `/c` expands to `Continue`.

#### Multi-paragraph prompts

When your prompt has multiple paragraphs, the snippet keeps things roomy by putting blank lines around it:

```text
/c review the failing test

Then suggest a small fix
```

expands to:

```text
review the failing test

Then suggest a small fix

Continue
```

Short prompts keep the usual one-line formatting.

#### Edit, then send

Normal snippet commands put the formatted message into Pi's editor without sending it. Tweak it if you like, then submit normally. While the agent is busy, Enter steers and Alt+Enter queues a follow-up.

Already know you want a follow-up without editing? Add a `+` marker between the command and prompt:

```text
/c + write a summary
```

That sends `write a summary. Continue` as a follow-up.

The marker is only recognized in that separating position. `/c +write a summary`, `/c+ write a summary`, and `/c write + summary` are not follow-up shorthand. The same `/snippet + prompt` form works for your own configured snippet commands.

#### Command descriptions

When you open slash-command completion, each snippet describes the message it will expand:

```text
/c   Expand a configured snippet | <prompt>. Continue
```

#### Custom snippets

You can add your own snippet commands in Pi settings. Snippets live under `continue.snippets` in either global settings (`~/.pi/agent/settings.json`) or project settings (`.pi/settings.json`). Project snippets are merged on top of global snippets.

Each snippet value can be:

- a string prefix,
- a one-item array containing a prefix,
- a two-item array containing `[prefix, suffix]`,
- an object containing `prefix`, `suffix`, or both, plus an optional `punctuate` boolean, or
- `null` to remove a snippet from an earlier layer.

For example:

```json
{
  "continue": {
    "snippets": {
      "ct": ["create a todo:", "Don't work on it yet."],
      "ctc": ["create a todo:", "Don't work on it now. Continue"],
      "please": "Please",
      "go": { "suffix": "Continue" },
      "raw": { "suffix": "Continue", "punctuate": false }
    }
  }
}
```

That gives you:

```text
/ct update the docs
```

which expands to:

```text
create a todo: update the docs. Don't work on it yet.
```

and:

```text
/ctc update the docs
```

which expands to:

```text
create a todo: update the docs. Don't work on it now. Continue
```

Because follow-up delivery is shared by all snippets, `/ct + update the docs` sends the same formatted text as a follow-up.

##### Suppressing implicit punctuation

Object snippets can set `punctuate` to `false` to suppress the implicit full stop normally inserted before a suffix:

```text
/raw ship it
```

expands to:

```text
ship it Continue
```

The setting only controls the added full stop. Punctuation already present in the prompt is preserved. Omitting `punctuate`, or setting it to `true`, keeps the default behavior.

##### Removing or replacing defaults

The built-in snippets are:

```json
{
  "c": ["", "Continue"],
  "continue": ["", "Continue"]
}
```

Set one to `null` if you do not want it:

```json
{
  "continue": {
    "snippets": {
      "continue": null
    }
  }
}
```

##### Loading snippets from files

Use `_include` to merge JSON or YAML files into an inline snippet map:

```json
{
  "continue": {
    "snippets": {
      "_include": ["~/.config/pi/snippets.yaml"],
      "plz": { "prefix": "Please" }
    }
  }
}
```

Files are loaded in listed order. Snippets beside `_include` are applied afterward, so they can replace or remove included snippets. Included files contain a snippet map directly and cannot contain their own `_include`.

```yaml
ct:
  prefix: "create a todo:"
  suffix: "Don't work on it yet."
go:
  suffix: Continue
```

If the entire snippet map lives in one file, `continue.snippets` may still be the path itself:

```json
{
  "continue": {
    "snippets": "~/dotfiles/pi/snippets.yaml"
  }
}
```

File type is determined by the mandatory `.json`, `.yaml`, or `.yml` extension. Leading `~` is expanded to the home directory; other relative paths are resolved from the global settings directory (`~/.pi/agent` by default).

### `@bramgeron/pi-draft-response`

Install from npm after release:

```bash
pi install npm:@bramgeron/pi-draft-response
```

Command for editing review-response drafts in TOML review files:

- `/draft-response @/path/to/review.toml human-response` — open a tabbed TUI over `[[reviews.comments]]` entries and edit each comment's `human-response` field in place.

You can replace `human-response` with another simple TOML field name. In each tab, the UI shows the comment location and the review comment truncated to three lines. Saving writes non-empty field values, creates missing fields, and removes fields whose edited value is empty.

Run pi with the development version from the subdirectory:

```bash
pi -e ./pi-draft-response
```

### `@bramgeron/pi-kagi`

Install from npm after release:

```bash
pi install npm:@bramgeron/pi-kagi
```

Tools to query the [Kagi](https://kagi.com/) search engine:

- `kagi_search` — search the web with Kagi.
- `kagi_extract` — extract readable markdown from URLs with Kagi.

Requires Pi 1.3.0 or newer.

#### Codemode activity cards

In Pi's interactive terminal, Kagi calls made through codemode always show human-only activity cards. Each API call gets its own card, even when the script filters or discards the returned output. Direct tool calls keep their normal display without duplicate cards.

While calls are pending, a widget above the editor shows their actual search queries or extraction URLs. Completed cards summarize the operation, result count or extracted character count, status, and elapsed time. Failed attempts also leave error cards; approval is still required before any API access.

Use Pi's expand-tools shortcut, shown on each card, to inspect:

- The full tool input, including all supplied options.
- The complete formatted text returned to codemode, before script-side filtering—not just what the script prints. Activity cards do not add preview limits or truncation to this text.
- Kagi trace IDs when present in the formatted output, and errors or cancellation information.

Cards record the final tool output after other extensions' result transformations, so redacted output stays redacted. Raw API JSON is not included in activity records.

**Persistence and privacy:** full tool inputs and formatted outputs are saved in the Pi session file and remain inspectable after reloads, resuming, and restarts. This includes potentially sensitive queries, URLs, and extracted page content. API credentials and HTTP request headers are not added to these records. The cards themselves never enter model context or consume additional model-input tokens.

Activity cards are terminal-only; RPC, JSON, and print modes retain their existing tool behavior without these extra records.

#### Authorization and API keys

The extension keeps API keys and permission to use Kagi separate. Every Kagi request is checked by the extension before any network access.

On the first Kagi tool call, choose:

- **Allow once** — allow every Kagi call in the current assistant tool batch.
- **Allow for 30 minutes in session** — allow Kagi in the current session for 30 minutes. The remaining approval survives `/reload`, but not a restart or session replacement.
- **Allow for session** — allow Kagi until Pi restarts or the session is replaced with `/resume`, `/new`, or `/fork`. Approval survives `/reload`.
- **Allow always** — persist approval next to the effective persisted key.
- **Allow always and persist key** — shown when the key is only in memory or missing; persist the key and approval globally.
- **Deny once** — deny every Kagi call in the current tool batch. This is the only denial state and is never persisted.
- **Abort** — abort the active agent run, like pressing Escape.

If no key is available, the extension asks for authorization before asking for the key. A newly entered key stays in memory unless you explicitly persist it or choose **Allow always and persist key**.

Persisted keys and approval use the `kagi` object in Pi settings. Project settings override global settings:

```json
{
  "kagi": {
    "apiKey": "...",
    "enabled": true
  }
}
```

A persistent approval is valid only when `apiKey` and `enabled: true` are in the same settings scope. With a project key, **Allow always** writes approval only to `.pi/settings.json`; with a global key, it writes only to `~/.pi/agent/settings.json`.

Unauthorized calls in print, JSON, and RPC modes fail closed and abort the active run. Persistent approval works in those modes, and RPC clients may invoke `/kagi-enable` to grant temporary approval.

#### Commands

- `/kagi-enable` — enable Kagi for this session; prompt for an in-memory key if needed.
- `/kagi-revoke` — remove persistent approval from global and current-project settings, keep all keys, and ask again on the next use.
- `/kagi-load-key` — prompt for an in-memory key and enable Kagi for this session.
- `/kagi-persist-key` — persist the loaded key globally without changing authorization.
- `/kagi-key-status` — show key and authorization status, including their scope.
- `/kagi-clear-key` — clear in-memory and persisted keys, remove persistent approval from global and current-project settings, and ask again on the next use.

Run Pi with the development version from the subdirectory:

```bash
pi -e ./pi-kagi
```

Useful links:

- OpenAPI: https://kagi.com/api/docs/_spec/openapi.yaml
- Generated HTML docs: https://kagi.com/api/docs/openapi

### `@bramgeron/pi-set-thinking`

Cycle Pi's thinking level backward with Alt+Shift+Tab. Pi's native Shift+Tab shortcut continues to cycle forward.

The shortcut wraps around and skips levels unsupported by the active model. For example, pressing Alt+Shift+Tab at `off` selects the model's highest supported thinking level.

Your terminal must report Alt+Shift+Tab to Pi rather than intercepting it as a desktop or terminal shortcut.

Requires Pi 0.79.0 or newer.

#### Install

Install from npm after release:

```bash
pi install npm:@bramgeron/pi-set-thinking
```

Run Pi with the development version from this repository:

```bash
pi -e ./pi-set-thinking
```

## Skills

### `mssql`

[SQL Server documentation guidance](skill-mssql/SKILL.md) backed by the separately installed `librarian` skill's cached `MicrosoftDocs/sql-docs` checkout. Includes a topic map, example searches, include-reference guidance, and version/applicability caveats. Searches focus on SQL Server rather than dedicated Azure SQL, Synapse, or Fabric content.

Try it from this repository:

```bash
pi --skill ./skill-mssql
```

For this local setup, install through the persistent skills directory (`~/.pi/agent/skills` already points there):

```bash
ln -s /workspace/pi-stuff/skill-mssql /workspace/saved/pi/skills/mssql
```

Run `/reload` in an existing Pi session, then use `/skill:mssql` or let Pi select it for SQL Server questions. The upstream docs are not bundled here: librarian populates the cache on first use, requiring network access. Once precached, the Markdown and include files can be read offline; the skill explains how to keep using them if a refresh fails.
