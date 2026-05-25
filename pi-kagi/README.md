# `@bramgeron/pi-kagi`

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
