# Changelog

## v0.1.0

Initial release of my Kagi Pi extension.

- `kagi_search` and `kagi_extract` tools.
- API key stays in-memory only by default, and is asked once per Pi run, the first time the model tries to use the tools.
- Optionally, use commands to persist the API key to disk or clear from memory/disk.
