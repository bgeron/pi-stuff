# Bram's Pi Packages

This directory contains extensions and skills that Bram (github:@bgeron, npm:@bramgeron) uses for the [Pi coding agent](https://pi.dev/). Most of this is vibe-coded. I don't expect many changes in these packages, but I also don't guarantee any stability. Pull requests will most likely not be considered and I don't expect to give support on it, but I may hop into the GitHub discussions from time to time. If you find this useful, please fork and adapt it to your own needs.

Inspired by Armin Ronacher https://github.com/mitsuhiko/agent-stuff/ .

## Packages

### `@bramgeron/pi-kagi`

Install from npm after release:

```bash
pi install npm:@bramgeron/pi-kagi
```

Tools to query the [Kagi](https://kagi.com/) search engine:

- `kagi_search` — search the web with Kagi.
- `kagi_extract` — extract readable markdown from URLs with Kagi.

By default, the extension keeps the API key **only in memory** and asks once per Pi instance. You can run `/kagi-load-key` to enter it up front, or `/kagi-persist-key` to persist a loaded key globally.

Commands:

- `/kagi-load-key` — prompt for a Kagi API key and load it in memory for this Pi process.
- `/kagi-key-status` — show whether a Kagi API key is loaded in memory or persisted in Pi settings.
- `/kagi-persist-key` — persist the currently loaded in-memory key to Pi's global settings.
- `/kagi-clear-key` — forget the in-memory key and remove any persisted key from Pi settings.

Run pi with the development version from the subdirectory:

```bash
pi -e ./pi-kagi
```

Useful links:

- OpenAPI: https://kagi.com/api/docs/_spec/openapi.yaml
- Generated HTML docs: https://kagi.com/api/docs/openapi

### `@bramgeron/pi-continue`

Install from npm after release:

```bash
pi install npm:@bramgeron/pi-continue
```

Command to steer the agent to continue with optional guidance:

- `/c <message>` — send `<message>. Continue` as a steering message.
- `/continue <message>` — alias for `/c`.

Run pi with the development version from the subdirectory:

```bash
pi -e ./pi-continue
```
