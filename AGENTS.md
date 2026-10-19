# Repository Instructions

Treat this directory as the repository root; do not assume files outside it are part of this project.

Before changing behavior, packaging, commands, tests, or user-facing docs, use `fd` to discover related files and read complete files that may need to stay in sync.

Useful starting points include:

- `AGENTS.md`
- `README.md`
- `mise.toml`
- `package.json`
- workspace config
- package manifests
- TypeScript config, source, and test files

New extensions should be publishable workspace packages in their own subdirectories, following the structure and conventions of the existing `pi-*` packages.

When adding, removing, renaming, or moving packages, check package manifests, README docs, mise tasks, and workspace config together.

Do not update release note files during normal development. Generating or editing release notes is a release-only task and should be done per package.

Use `fd` for file discovery where practical.

## Development

This repository uses Aube workspaces. Mise supplies Aube, Node.js, Pi, and the check tools:

```bash
mise install
mise run check
```

Run checks for one package with, for example, `mise run kagi:check`. Use `mise run clean` to remove generated test/pack files and workspace `node_modules`; the next check reinstalls dependencies automatically.

`aube-workspace.yaml` lists the packages and dependency build policy. `aube-lock.yaml` pins dependencies, and `mise run install` uses a frozen lockfile. After intentionally editing dependency versions, run `mise x -- aube install` and commit the updated lockfile.
