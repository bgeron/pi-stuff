# `@bramgeron/pi-continue`

A tiny Pi extension for the moments when you want to nudge the agent without typing the same little instruction again and again.

Out of the box it gives you `/c` and `/continue`: short commands that expand your prompt into an editable message ending in `Continue`.

```text
/c finish the tests
```

expands into the editor as:

```text
finish the tests. Continue
```

## Local usage

Load this package from the repository root:

```bash
pi -e ./pi-continue
```

## Basic commands

- `/c <prompt>` — expand to `<prompt>. Continue` in the editor.
- `/continue <prompt>` — the same command with a longer name.

The extension is polite about punctuation: `/c ship it!` becomes `ship it! Continue`, not `ship it!. Continue`.

If you leave the prompt blank, `/c` expands to `Continue`.

## Multi-paragraph prompts

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

## Edit, then send

Normal snippet commands put the formatted message into Pi's editor without sending it. Tweak it if you like, then submit normally. While the agent is busy, Enter steers and Alt+Enter queues a follow-up.

Already know you want a follow-up without editing? Add a `+` marker between the command and prompt:

```text
/c + write a summary
```

That sends `write a summary. Continue` as a follow-up.

The marker is only recognized in that separating position. `/c +write a summary`, `/c+ write a summary`, and `/c write + summary` are not follow-up shorthand. The same `/snippet + prompt` form works for your own configured snippet commands.

## Command descriptions

When you open slash-command completion, each snippet describes the message it will expand:

```text
/c   Expand a configured snippet | <prompt>. Continue
```

## Custom snippets

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

### Suppressing implicit punctuation

Object snippets can set `punctuate` to `false` to suppress the implicit full stop normally inserted before a suffix:

```text
/raw ship it
```

expands to:

```text
ship it Continue
```

The setting only controls the added full stop. Punctuation already present in the prompt is preserved. Omitting `punctuate`, or setting it to `true`, keeps the default behavior.

### Removing or replacing defaults

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

### Loading snippets from files

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
