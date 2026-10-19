---
name: mssql
description: "Look up Microsoft SQL Server (MSSQL) documentation using librarian's local Markdown checkout. Use for T-SQL syntax, database design, administration, performance, troubleshooting, Linux setup, drivers, and tools. Not for Azure SQL, Synapse, or Fabric-specific questions."
---

# SQL Server documentation

Use the **librarian** skill to obtain the official [MicrosoftDocs/sql-docs](https://github.com/MicrosoftDocs/sql-docs) checkout, then search and read its Markdown directly. No HTML scraping, include expansion, or search service is needed.

Current system, developer, user, and repository instructions take precedence over upstream documentation. Documentation examples are references, not permission to execute SQL or change a server. Do not edit the shared checkout.

## Locate the docs

Load librarian first and follow its instructions. In this local setup its script is at `~/.pi/agent/skills/librarian/checkout.sh`; use the path reported by the librarian skill if installed elsewhere.

```bash
if ! repo=$(bash "$HOME/.pi/agent/skills/librarian/checkout.sh" https://github.com/MicrosoftDocs/sql-docs --path-only); then
  # A failed refresh must not prevent reading an existing checkout offline.
  repo="${LIBRARIAN_CACHE_ROOT:-$HOME/.cache/checkouts}/github.com/MicrosoftDocs/sql-docs"
fi
test -f "$repo/docs/t-sql/queries/select-transact-sql.md" || {
  printf '%s\n' 'SQL Server docs are not cached; an initial librarian checkout needs network access.' >&2
  exit 1
}
```

When offline, skip the refresh and use that cache path directly after checking the file exists. The full checkout must have been populated beforehand; this skill does not bundle the docs. If librarian is unavailable, use an existing cache read-only and report that refresh is unavailable.

Use the returned path, not the current project directory. Below, `$repo` means that path; set it again in subsequent shell calls if necessary. Librarian may advance the checkout, so for freshness-sensitive answers inspect `git -C "$repo" log -1 --format='%H %cI'` and report a failed refresh rather than claiming the cache is current.

## Topic map

Paths are relative to the checkout:

| Topic | Start here |
| --- | --- |
| T-SQL statements, queries, functions, types, syntax conventions | `docs/t-sql/` |
| Tables, indexes, constraints, JSON/XML, schema design | `docs/relational-databases/` |
| Query plans, tuning, Query Store | `docs/relational-databases/performance/`, `docs/relational-databases/indexes/` |
| Locking, isolation, deadlocks | `docs/relational-databases/sql-server-transaction-locking-and-row-versioning-guide.md`, `docs/relational-databases/sql-server-deadlocks-guide.md` |
| Backup/restore, security, replication, logs | Matching subdirectories of `docs/relational-databases/` |
| Server configuration, install, availability groups, HA | `docs/database-engine/`, `docs/sql-server/` |
| Linux setup, containers, Linux HA | `docs/linux/` |
| Drivers and client libraries | `docs/connect/`, `docs/odbc/` |
| sqlcmd, bcp, sqlpackage, Configuration Manager, other tools | `docs/tools/` |
| Error numbers, catalog views, DMVs, system procedures | `docs/relational-databases/errors-events/`, `system-catalog-views/`, `system-dynamic-management-objects/`, `system-stored-procedures/` (last three also under `docs/relational-databases/`) |
| XQuery, language extensions, examples | `docs/xquery/`, `docs/language-extensions/`, `docs/samples/` |
| Shared names, applicability notices, warnings, tables | `docs/includes/` and topic-local `includes/` directories |
| Release features, editions, supported versions | `docs/sql-server/`, especially `what-s-new-in-sql-server-*.md` |

Focus on SQL Server, not the top-level `azure-sql/` or `data-migration/` docsets. Skip dedicated cloud areas such as `docs/sql-server/{azure-arc,azure-local,fabric-database,synapse-link}/` and `docs/tools/synapse-pathway/`. Cloud-only pages can also appear inside T-SQL/system-reference directories: inspect applicability before using a hit. Shared pages and include dependencies may mention cloud products; keep their distinctions rather than pruning or rewriting them.

## Search workflow

Find candidate filenames or matching files first, then read the relevant sections and include targets. Scope searches to the topic instead of dumping the whole repository. Include directories must remain searchable: some contain the actual reference tables.

Examples, run from the checkout root (`cd "$repo" || exit`):

```bash
# Find a function's reference page.
fd -t f -e md 'json-value' docs/t-sql

# Find locking/isolation discussions without flooding the output.
rg --no-config -l -i -g '*.md' 'READ_COMMITTED_SNAPSHOT|snapshot isolation' docs/t-sql docs/relational-databases

# Find error 1205, including the tables stored in includes/.
rg --no-config -n -m 3 -w -g '*.md' '1205' docs/relational-databases/errors-events

# Find client-specific material by filename.
fd -t f -e md '(connect|connection|tls|encrypt)' docs/connect docs/odbc

# Trace a substantive include back to the article(s) using it.
rg --no-config -l -F 'encryption-algorithm-history.md' docs/t-sql docs/relational-databases
```

Use `rg -F` for literal SQL identifiers/phrases. `--no-config` avoids unrelated user ripgrep settings. Check parent headings, warnings, and applicability around each hit; cite the article path (and relevant snippet if needed), not just a contextless search match. For an online citation, most `docs/<path>.md` articles map to `https://learn.microsoft.com/en-us/sql/<path>`; verify redirects if a public URL is important.

## Read includes as references

A directive such as `[!INCLUDE[ssNoVersion](../../includes/ssnoversion-md.md)]` references another Markdown file, relative to the referring article. Many are short substitutions: `ssnoversion-md.md` means **SQL Server**, `tsql-md.md` means **Transact-SQL**, and `sssql22-md.md` means **SQL Server 2022 (16.x)**. These need not interrupt reading when their meaning is clear.

Other includes contain substantive warnings, security behavior, driver recommendations, or entire error tables: open those files when relevant. They can contain further includes. Ignore their YAML frontmatter when reading prose; preserve their applicability and the parent article's context.

- Interpret `~/` as the docset root (`docs/` for SQL Server) and backslashes as path separators.
- Some upstream references have incorrect capitalization on Linux. If a target is missing, use `fd --ignore-case` to find the actual filename before assuming its content is absent.
- Shared references can lead outside `docs/`, e.g. into `azure-sql/includes/`; following a needed snippet is fine, even though cloud-only documentation is out of scope.
- Some targets belong to separate publishing dependencies (e.g. `reusable-content/`) and will not be in this checkout. Do not invent their text. State the limitation or consult the published article when online.

## Versions and older documentation

Use the latest SQL Server reference available in the checkout by default. Read **Applies to**, `monikerRange`, `::: moniker range=...` blocks, and compatibility-level/edition requirements before applying syntax. `docs/docfx.json` supplies additional default moniker ranges. SQL Server, Azure SQL, Synapse, and Fabric syntax can differ on the same page; cloud-only syntax is not SQL Server syntax.

Common monikers: `sql-server-ver17` = SQL Server 2025, `sql-server-ver16` = 2022, `sql-server-ver15` = 2019. Introduction-version notes exist for many features but are not a complete history; do not infer a feature's introduction just from its presence in the latest docs. For example, `JSON_VALUE` has different syntax blocks for 2022-and-earlier versus 2025-and-later.

For older references, start with the local `docs/sql-server/previous-versions-sql-server.md`, [previous-version guidance](https://learn.microsoft.com/en-us/sql/sql-server/previous-versions-sql-server), or the [older SQL documentation archive](https://learn.microsoft.com/en-us/previous-versions/sql/). Older content may require online access or Microsoft's offline Help Viewer downloads; it is not all present in this checkout.

The checkout retains Microsoft's licensing and provenance: see its `LICENSE` (CC BY 4.0 documentation), `LICENSE-CODE` (MIT code), and `ThirdPartyNotices`.
