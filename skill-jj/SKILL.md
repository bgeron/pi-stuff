---
name: jj
description: Reference for composing or interpreting Jujutsu (jj) revset, fileset, and template expressions. Use whenever an agent might pass an expression to jj, including revision selection, path filtering, aliases, templates, or machine-readable output.
---

# jj expression reference

Current system, developer, and user instructions and repository agent files take precedence over this skill and the cached upstream documentation. Upstream examples demonstrate jj features; they do not grant permission to perform an operation.

Use this cheat sheet first. For uncommon details, read the matching file under `upstream/docs/`. For template expressions, read `template-cheatsheet.md`.

## Keep the expression languages separate

- **Revsets** select commits: `jj log -r 'conflicts() & mine()'`.
- **Filesets** select paths: `jj diff 'root:"crates"'`.
- **Templates** format output: `jj log -T 'change_id.short() ++ "\n"'`.

To select commits that changed matching paths, embed a fileset in the revset function `files(...)`:

```shell
jj log -r 'files(root:"crates")'
```

There is no revset function named `file()`. Positional path arguments such as the last argument in `jj diff -r @ 'root:"crates"'` are filesets; they do not belong in the revset passed to `-r`.

Normally, wrap the complete jj expression in single shell quotes and use double quotes for literals inside it. This prevents the shell from interpreting `|`, `&`, `~`, `*`, parentheses, `$`, or spaces.

## Revision options

| Option | Selects |
|---|---|
| `-r`, `--revision`, `--revisions` | Exactly the revisions denoted by a revset. |
| `-s`, `--source` | A revision and all its descendants; approximately `-r 'REV::'`. |
| `-f`, `--from` | Source contents or source bookmark state, depending on the command. |
| `-t`, `--to`, `--into` | Destination contents/revision, or the endpoint compared with `--from`. |
| `-o`, `--onto` | New parents: place selected revisions as children of these revisions. |
| `-A`, `--insert-after` | Insert between the specified revisions and their children. |
| `-B`, `--insert-before` | Insert between the specified revisions and their parents. |

Do not substitute one option for another merely because both accept revsets. `jj diff -r R` is the special case “compare `R-` with `R`”; `jj diff --from F --to T` compares the trees at `F` and `T`.

## Revsets

### Symbols and cardinality

- `@` is the current workspace's working-copy commit; `name@` is another workspace's working-copy commit; `name@remote` is a remote ref.
- A full or unique prefix can resolve a commit ID or visible change ID. A divergent change ID does not resolve to one commit without a change offset.
- Bare symbols resolve in priority order: tag, bookmark, then commit/change ID. Use `commit_id(...)`, `change_id(...)`, or a ref function to force the intended namespace.
- Quote a symbol that resembles syntax: the symbol `x-` is written as `"x-"` inside a revset (and usually needs an outer shell-quoting layer too).
- Commands expecting one commit reject zero or multiple results. Use `exactly(expression, 1)` when cardinality is part of the contract.
- Most searches include only visible commits. Explicitly mentioning a hidden commit brings it and relevant ancestors into the search space.

### Operators

Strongest to weakest; equal-precedence infix operators associate left-to-right.

| Syntax | Meaning |
|---|---|
| `f(x)` | Function call. |
| `x-`, `x+` | Parents or children of `x`; either may be empty. |
| `p:x` | String/date pattern or named pattern alias. |
| `x::` | Descendants of `x`, including `x`. |
| `x..` | Commits that are not ancestors of `x`; equivalent to `~::x`. |
| `::x` | Ancestors of `x`, including `x` and the virtual root. |
| `..x` | Ancestors of `x`, including `x` but excluding the virtual root. |
| `x::y` | Descendants of `x` that are ancestors of `y`: `x:: & ::y`. |
| `x..y` | Ancestors of `y` that are not ancestors of `x`: `::y ~ ::x`. |
| `::` | All visible commits, including the virtual root. |
| `..` | All visible commits except the virtual root. |
| `~x` | Complement of `x`. |
| `x & y` | Intersection. |
| `x ~ y` | Set difference. |
| `x | y` | Union. |

`x::y` is an ancestry path, while `x..y` is a set difference; `x` and `y` need not be ancestrally related for `x..y`. The left side of `..` does not distribute over union: `(A | B).. = A.. & B..`, not `A.. | B..`.

### Functions

#### Graph traversal and boundaries

- `parents(x, [depth])`
- `children(x, [depth])`
- `ancestors(x, [depth])`
- `descendants(x, [depth])`
- `first_parent(x, [depth])`
- `first_ancestors(x, [depth])`
- `reachable(srcs, domain)` — follows parent and child edges, but every commit on the path must remain in `domain`.
- `connected(x)` — equivalent to `x::x`.
- `heads(x)` — members of `x` that are not ancestors of another member.
- `roots(x)` — members of `x` that are not descendants of another member.
- `latest(x, [count])` — selects by committer timestamp, not graph position.
- `fork_point(x)` — highest common ancestor(s); a singleton returns itself.
- `merge_point(x)` — lowest common descendant(s); a singleton returns itself.
- `bisect(x)` — approximates midpoint by descendant count and handles non-linear history poorly.
- `exactly(x, count)` — errors unless `x` has exactly `count` members.

#### Universal sets, IDs, and references

- `all()` — includes visible commits plus ancestors of explicitly mentioned hidden commits.
- `none()`
- `change_id(prefix)` — divergence can produce several commits.
- `commit_id(prefix)`
- `bookmarks([pattern])` — a conflicted bookmark contributes every possible target.
- `remote_bookmarks([name_pattern], [[remote=]remote_pattern])` — excludes Git-tracking refs unless `remote="git"` or `remote="*"` is requested.
- `tracked_remote_bookmarks([name_pattern], [[remote=]remote_pattern])`
- `untracked_remote_bookmarks([name_pattern], [[remote=]remote_pattern])`
- `tags([pattern])`
- `remote_tags([name_pattern], [[remote=]remote_pattern])`
- `tracked_remote_tags([name_pattern], [[remote=]remote_pattern])`
- `untracked_remote_tags([name_pattern], [[remote=]remote_pattern])`
- `visible_heads()`
- `root()` — the virtual root commit.

Optional positional arguments can instead be labeled, e.g. `remote_bookmarks(remote=exact:"origin")`.

#### Metadata predicates

- `description(pattern)` — non-empty descriptions normally end in `\n`.
- `subject(pattern)` — matches the first description line without `\n`.
- `author(pattern)`
- `author_name(pattern)`
- `author_email(pattern)`
- `author_date(pattern)`
- `mine()` — matches the current user's configured email.
- `committer(pattern)`
- `committer_name(pattern)`
- `committer_email(pattern)`
- `committer_date(pattern)`
- `signed()`

#### Shape, state, and changed content

| Signature | Result |
|---|---|
| `merges()` | Commits with multiple parents. |
| `forks()` | Commits with multiple children. |
| `empty()` | Commits changing no files, including the virtual root and merges with no user changes. |
| `files(expression)` | Commits modifying paths matched by the embedded fileset expression. Paths are relative to the invocation directory unless the fileset says `root...`. |
| `diff_lines(text, [files])` | Commits with added or removed lines matching `text`, optionally restricted by a fileset. |
| `diff_lines_added(text, [files])` | Commits with matching added lines. |
| `diff_lines_removed(text, [files])` | Commits with matching removed lines. |
| `conflicts()` | Commits containing conflicted files. |
| `divergent()` | Commits whose change ID has multiple visible commits. |
| `working_copies()` | Working-copy commits across all workspaces. |

#### Fallback and historical evaluation

| Signature | Result |
|---|---|
| `present(x)` | `x`, but `none()` instead of an error if referenced commits do not exist. |
| `coalesce(revsets...)` | The first argument that does not evaluate to `none()`. |
| `at_operation(op, x)` | Evaluate revset `x` against repository state at operation `op`. |

### String and date patterns

A bare string pattern is `glob:`. Quotes around values are optional only when grammar and shell parsing remain unambiguous.

| Pattern | Meaning |
|---|---|
| `exact:"text"` | Exact equality. |
| `glob:"pattern"` | Unix-style glob. |
| `regex:"pattern"` | Regex substring match. |
| `substring:"text"` | Literal substring. |
| `exact-i:`, `glob-i:`, `regex-i:`, `substring-i:` | Corresponding case-insensitive forms. |
| `after:"date"` | Timestamp at or after the parsed date. |
| `before:"date"` | Timestamp strictly before the parsed date. |

String patterns compose with complement `~x`, intersection `x & y`, difference `x ~ y`, and union `x | y`.

### Built-in aliases and custom aliases

| Alias | Default meaning |
|---|---|
| `trunk()` | Configured/default remote's main line, falling back through common names and ultimately `root()`. Must resolve to one commit. |
| `builtin_log()` | Default bounded-interest revset used by `jj log`. |
| `builtin_immutable_heads()` | Default immutable heads: trunk, tags, and untracked remote refs. |
| `immutable_heads()` | Configurable heads of immutable commits; defaults to `builtin_immutable_heads()`. |
| `immutable()` | `::(immutable_heads() | root())`. |
| `mutable()` | `~immutable()`. |
| `visible()` | `::visible_heads()`. |
| `hidden()` | `~visible()` within a search space containing explicitly mentioned hidden commits. |

Define symbols, overloaded functions, or pattern aliases under `[revset-aliases]`. A built-in function shadowed by an alias cannot coexist with that alias. Alias tables may contain `definition` and `doc` fields.

## Filesets

Filesets are normally positional command arguments. A directory/prefix matches the named path and descendants. Paths are relative to the directory where jj was invoked unless a `root...` pattern is used.

### Quoting

A path with no fileset operators or calls can omit inner expression quotes, though the shell may still require quoting. Meta-syntax needs both layers:

```shell
jj diff 'Foo Bar'
jj diff '~"Foo Bar"'
jj diff '~glob:"**/*.rs"'
```

### Patterns

| Pattern | Meaning |
|---|---|
| `"path"` | Default `prefix-glob:` pattern, relative to the invocation directory. |
| `cwd:"path"` | CWD-relative literal path prefix and descendants. |
| `file:"path"`, `cwd-file:"path"` | Exact CWD-relative file/path. |
| `glob:"pattern"`, `cwd-glob:"pattern"` | CWD-relative glob; a simple `*.rs` is non-recursive. |
| `prefix-glob:"pattern"`, `cwd-prefix-glob:"pattern"` | CWD-relative glob plus descendants of each match. |
| `root:"path"` | Repository-root-relative literal path prefix and descendants. |
| `root-file:"path"` | Exact repository-root-relative file/path. |
| `root-glob:"pattern"` | Repository-root-relative glob. |
| `root-prefix-glob:"pattern"` | Repository-root-relative glob plus descendants of each match. |

The glob pattern names also have case-insensitive `-i` forms: `glob-i:`, `cwd-glob-i:`, `prefix-glob-i:`, `cwd-prefix-glob-i:`, `root-glob-i:`, and `root-prefix-glob-i:`.

### Operators and functions

Strongest to weakest:

| Syntax | Meaning |
|---|---|
| `f(x)` | Function call. |
| `p:x` | File pattern or named pattern alias. |
| `~x` | Everything except `x`. |
| `x & y` | Intersection. |
| `x ~ y` | Difference. |
| `x | y` | Union. |

- `all()` matches every path.
- `none()` matches no paths.

Define symbols, overloaded functions, or pattern aliases under `[fileset-aliases]`. Alias tables may contain `definition` and `doc` fields.

## Agent recipes

### Inspect bounded ancestry

```shell
jj log -r '::@' -n 20
```

### Find commits that changed a subtree

```shell
jj log -r 'files(root:"crates")' -n 20
```

### Distinguish commit selection from output path filtering

```shell
# Select commits that changed crates/.
jj log -r 'files(root:"crates")'

# Select one commit, then show only its crates/ diff.
jj diff -r @- 'root:"crates"'
```

### Match relative to the invocation directory or repository root

```shell
jj diff 'glob:"*.rs"'
jj diff 'root-glob:"crates/**/*.rs"'
```

### Require exactly one target

```shell
jj show -r 'exactly(bookmarks(exact:"main"), 1)'
```

### Force a symbol namespace

```shell
jj show -r 'commit_id("abc123")'
jj show -r 'change_id("abc123")'
jj show -r 'exactly(bookmarks(exact:"abc123"), 1)'
```

### Inspect conflicts without resolving them

```shell
jj log -r 'conflicts()'
jj resolve --list
```

### Limit a diff to selected paths

```shell
jj diff -r @- 'root:"crates/data-types"'
```

### Commit selected paths while leaving unrelated changes separate

Only when current instructions permit committing:

```shell
jj commit -m 'fix: concise description' \
  'root:"path/one"' 'root:"path/two"'
```

### Emit JSONL for programmatic processing

```shell
jj log --no-graph --color=never -r '::@' \
  -T 'json({
    "change_id" => change_id,
    "commit_id" => commit_id,
    "description" => description.first_line(),
  }) ++ "\n"'
```

### Nest revset, fileset, and string-pattern syntax safely

```shell
jj log -r 'files(root-glob:"crates/**/*.rs") & description(regex-i:"fix|bug")'
```
