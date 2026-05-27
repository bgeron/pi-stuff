# `@bramgeron/pi-kagi`

Install from npm after release:

```bash
pi install npm:@bramgeron/pi-kagi
```

Tools to query the [Kagi](https://kagi.com/) search engine:

- `kagi_search` — search the web with Kagi.
- `kagi_extract` — extract readable markdown from URLs with Kagi.

## Authorization and API keys

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

## Commands

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
