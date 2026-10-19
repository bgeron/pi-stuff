# jj template cheat sheet

For fuller explanations and examples, see [`upstream/docs/templates.md`](upstream/docs/templates.md). Command-specific `--template` help identifies the top-level `self` type. Every zero-argument method on that type is also available as a keyword: in `jj log`, for example, `commit_id` means `self.commit_id()`.

## Operators

Strongest to weakest; equal-precedence infix operators associate left-to-right.

| Syntax | Meaning |
|---|---|
| `x.f()`, `f(x)` | Method or function call. |
| `-x`, `!x` | Integer negation or logical not. |
| `p:x` | String pattern or pattern alias. |
| `x * y`, `x / y`, `x % y` | Integer multiply, divide, remainder. |
| `x + y`, `x - y` | Integer addition or subtraction. |
| `x >= y`, `x > y`, `x <= y`, `x < y` | Integer ordering. |
| `x == y`, `x != y` | Equality for booleans, byte strings, integers, or strings. |
| `x && y` | Short-circuiting logical AND. |
| `x || y` | Short-circuiting logical OR. |
| `x ++ y` | Concatenate template content. |

## Global functions

| Signature | Meaning |
|---|---|
| `fill(width: Integer, content: Template, [break_words: bool]) -> Template` | Wrap to `width`; optionally split overlong words. |
| `indent(prefix: Template, content: Template) -> Template` | Prefix each non-empty line. |
| `pad_start(width: Integer, content: Template, [fill_char: Template])` | Left-pad/right-justify one-line content. |
| `pad_end(width: Integer, content: Template, [fill_char: Template])` | Right-pad/left-justify one-line content. |
| `pad_centered(width: Integer, content: Template, [fill_char: Template])` | Pad both sides; an odd extra character goes on the right. |
| `truncate_start(width: Integer, content: Template, [ellipsis: Template])` | Remove leading characters to fit, optionally prepending an ellipsis. |
| `truncate_end(width: Integer, content: Template, [ellipsis: Template])` | Remove trailing characters to fit, optionally appending an ellipsis. |
| `hash(content: Stringify) -> String` | Return the content digest as hexadecimal. |
| `label(label: Stringify, content: Template) -> Template` | Apply color labels named by a space-separated string. |
| `hyperlink(url: Stringify, text: Template, [fallback: Template]) -> Template` | Render an OSC 8 link when color is active, otherwise the fallback/text. |
| `raw_escape_sequence(content: Template) -> Template` | Preserve escape sequences, strip labels, and treat output as zero-width. |
| `replace(pattern: StringPattern, content: Template, replacement: \|RegexCaptures\| -> Template) -> Template` | Replace matches while preserving formatting outside each replacement. |
| `stringify(content: Stringify) -> String` | Format as an uncolored string. |
| `json(value: Serialize) -> String` | Serialize a value, list, or `{key => value}` object as JSON. |
| `if(condition: Boolean, then: Any, [else: Any]) -> Any` | Lazily evaluate the selected branch. |
| `try(expr: Any, fallback: Any...) -> Any` | Return the first runtime-successful expression; parsing/type errors remain errors. |
| `coalesce(content: Template...) -> Template` | Return the first non-empty formatted content. |
| `concat(content: Template...) -> Template` | Concatenate all content, like repeated `++`. |
| `join(separator: Template, content: Template...) -> Template` | Insert `separator` between every argument. |
| `separate(separator: Template, content: Template...) -> Template` | Insert `separator` between non-empty arguments only. |
| `surround(prefix: Template, suffix: Template, content: Template) -> Template` | Wrap non-empty content. |
| `config(name: Stringify) -> Option<ConfigValue>` | Read a configuration value. |
| `revset(revset: Stringify) -> List<Commit>` | Evaluate a revset; constant strings are evaluated once at parse time. |
| `git_web_url([remote: String]) -> String` | Best-effort HTTPS URL for a Git remote, defaulting to `origin`. |

## Types and methods

“Boolean,” “Serialize,” and “Template” below describe implicit conversion support. “Maybe” means support depends on the contained value.

### `AnnotationLine`

Conversions: Boolean no; Serialize no; Template no.

| Signature | Meaning |
|---|---|
| `.commit() -> Commit` | Commit responsible for the line. |
| `.content() -> ByteString` | Line bytes, including its newline. |
| `.line_number() -> Integer` | One-based current line number. |
| `.original_line_number() -> Integer` | One-based line number in the original commit. |
| `.first_line_in_hunk() -> Boolean` | Whether the preceding line belongs to a different commit. |

### `Any`

Conversions: Boolean no; Serialize maybe; Template maybe. Every value converts to `Any`; it has no methods.

### `AnyList`

Conversions: Boolean no; Serialize maybe; Template maybe.

| Signature | Meaning |
|---|---|
| `.join(separator: Template) -> Template` | Format elements separated by `separator`. |

### `Boolean`

Conversions: Boolean yes; Serialize yes; Template yes. Construct with `false` or `true`; no methods.

### `ByteString`

Conversions: Boolean yes; Serialize yes; Template yes. Bytes are ASCII-compatible but not necessarily valid UTF-8.

| Signature | Meaning |
|---|---|
| `.len() -> Integer` | Length in bytes. |
| `.contains(needle: ByteStringify) -> Boolean` | Whether `needle` occurs as a substring. |
| `.match(needle: StringPattern) -> ByteString` | First matched bytes, or empty. |
| `.starts_with(needle: ByteStringify) -> Boolean` | Whether `needle` is a prefix. |
| `.ends_with(needle: ByteStringify) -> Boolean` | Whether `needle` is a suffix. |
| `.remove_prefix(needle: ByteStringify) -> ByteString` | Remove `needle` when it is a prefix. |
| `.remove_suffix(needle: ByteStringify) -> ByteString` | Remove `needle` when it is a suffix. |
| `.trim() -> ByteString` | Remove leading and trailing ASCII whitespace. |
| `.trim_start() -> ByteString` | Remove leading ASCII whitespace. |
| `.trim_end() -> ByteString` | Remove trailing ASCII whitespace. |
| `.substr(start: Integer, [end: Integer]) -> ByteString` | Slice by byte indexes; negatives count from the end. |
| `.first_line() -> ByteString` | First line without its newline. |
| `.lines() -> List<ByteString>` | Lines without newline bytes. |
| `.split(separator: StringPattern, [limit: Integer]) -> List<ByteString>` | Split by pattern, optionally limiting result count. |
| `.replace(pattern: StringPattern, replacement: ByteStringify, [limit: Integer]) -> ByteString` | Replace matches; `$0`, `$1`, etc. expand capture groups. |
| `.upper() -> ByteString` | ASCII uppercase. |
| `.lower() -> ByteString` | ASCII lowercase. |

### `ByteStringify`

A conversion target, not a concrete printable type. `String` converts losslessly; template-convertible values also convert with labels stripped. No methods.

### `ChangeId`

Conversions: Boolean no; Serialize yes; Template yes.

| Signature | Meaning |
|---|---|
| `.normal_hex() -> String` | Conventional `0-9a-f` rather than canonical reverse-alphabet form. |
| `.short([len: Integer]) -> String` | Fixed/default-length prefix. |
| `.shortest([min_len: Integer]) -> ShortestIdPrefix` | Shortest unique prefix, at least `min_len`. |

### `Commit`

Conversions: Boolean no; Serialize yes; Template no.

| Signature | Meaning |
|---|---|
| `.description() -> String` | Full description, normally with trailing newline when non-blank. |
| `.trailers() -> List<Trailer>` | Parsed `<key>: <value>` trailers in source order. |
| `.change_id() -> ChangeId` | Change ID. |
| `.commit_id() -> CommitId` | Commit ID. |
| `.parents() -> List<Commit>` | Parent commits. |
| `.author() -> Signature` | Author identity and timestamp. |
| `.committer() -> Signature` | Committer identity and timestamp. |
| `.signature() -> Option<CryptographicSignature>` | Cryptographic signature when present. |
| `.mine() -> Boolean` | Whether author email matches the current user. |
| `.working_copies() -> List<WorkspaceRef>` | Workspaces whose working-copy commit is this commit. |
| `.current_working_copy() -> Boolean` | Whether this is the current workspace's working-copy commit. |
| `.bookmarks() -> List<CommitRef>` | Local and relevant remote bookmarks at this commit. |
| `.local_bookmarks() -> List<CommitRef>` | Local bookmarks at this commit. |
| `.remote_bookmarks() -> List<CommitRef>` | Remote bookmarks at this commit. |
| `.tags() -> List<CommitRef>` | Local and relevant remote tags at this commit. |
| `.local_tags() -> List<CommitRef>` | Local tags at this commit. |
| `.remote_tags() -> List<CommitRef>` | Remote tags at this commit. |
| `.divergent() -> Boolean` | Whether the change ID has multiple visible commits. |
| `.hidden() -> Boolean` | Whether the commit is hidden/abandoned. |
| `.change_offset() -> Option<Integer>` | Change offset when available. |
| `.immutable() -> Boolean` | Whether the commit is in the immutable set. |
| `.contained_in(revset: Stringify) -> Boolean` | Whether the commit belongs to the supplied revset. |
| `.conflict() -> Boolean` | Whether the commit contains conflicts. |
| `.empty() -> Boolean` | Whether it modifies no files. |
| `.diff([files: StringLiteral]) -> TreeDiff` | Parent-to-commit diff, optionally restricted by a literal fileset. |
| `.files([files: StringLiteral]) -> List<TreeEntry>` | Existing files matching an optional literal fileset; use `.diff().files()` for changed files. |
| `.conflicted_files() -> List<TreeEntry>` | Conflicted tree entries. |
| `.root() -> Boolean` | Whether this is the virtual root commit. |

### `CommitEvolutionEntry`

Conversions: Boolean no; Serialize yes; Template no.

| Signature | Meaning |
|---|---|
| `.commit() -> Commit` | New commit version. |
| `.operation() -> Operation` | Operation that created or rewrote it. |
| `.predecessors() -> List<Commit>` | Prior commit versions. |
| `.inter_diff([files: StringLiteral]) -> TreeDiff` | Difference from predecessor versions, optionally path-restricted. |

### `CommitId`

Conversions: Boolean no; Serialize yes; Template yes.

| Signature | Meaning |
|---|---|
| `.short([len: Integer]) -> String` | Fixed/default-length prefix. |
| `.shortest([min_len: Integer]) -> ShortestIdPrefix` | Shortest unique prefix, at least `min_len`. |

### `CommitRef`

Conversions: Boolean no; Serialize yes; Template yes.

| Signature | Meaning |
|---|---|
| `.name() -> RefSymbol` | Bookmark or tag name. |
| `.remote() -> Option<RefSymbol>` | Remote name for a remote ref. |
| `.present() -> Boolean` | Whether the ref points to a commit. |
| `.conflict() -> Boolean` | Whether the ref is conflicted. |
| `.normal_target() -> Option<Commit>` | Target when present and unconflicted. |
| `.removed_targets() -> List<Commit>` | Old targets in a conflict. |
| `.added_targets() -> List<Commit>` | New targets, normally one. |
| `.tracked() -> Boolean` | Whether a local ref tracks this remote ref. |
| `.tracking_present() -> Boolean` | Whether tracking exists and its local ref is present. |
| `.tracking_ahead_count() -> SizeHint` | Commits ahead of the tracking local ref. |
| `.tracking_behind_count() -> SizeHint` | Commits behind the tracking local ref. |
| `.synced() -> Boolean` | Whether local and tracked remote target(s) agree. |

### `ConfigValue`

Conversions: Boolean no; Serialize yes; Template yes. Default formatting is TOML.

| Signature | Meaning |
|---|---|
| `.as_boolean() -> Boolean` | Extract a boolean. |
| `.as_integer() -> Integer` | Extract an integer. |
| `.as_string() -> String` | Extract a string without coercing another type. |
| `.as_string_list() -> List<String>` | Extract a string list. |

### `CryptographicSignature`

Conversions: Boolean no; Serialize no; Template no. Its methods perform signature verification and can be slow; checking whether `Commit.signature()` is present is fast.

| Signature | Meaning |
|---|---|
| `.status() -> String` | `good`, `bad`, `unknown`, or `invalid`. |
| `.key() -> String` | Key identifier/fingerprint. |
| `.display() -> String` | Display identity or principal. |

### `DiffStatEntry`

Conversions: Boolean no; Serialize no; Template no.

| Signature | Meaning |
|---|---|
| `.bytes_delta() -> Integer` | Signed byte-size change. |
| `.lines_added() -> Integer` | Added line count. |
| `.lines_removed() -> Integer` | Removed line count. |
| `.path() -> RepoPath` | Target/right path for copies and renames. |
| `.display_diff_path() -> String` | Display path including copy/rename context. |
| `.status() -> String` | `modified`, `added`, `removed`, `copied`, or `renamed`. |
| `.status_char() -> String` | `M`, `A`, `D`, `C`, or `R`. |

### `DiffStats`

Conversions: Boolean no; Serialize no; Template yes. Default formatting is a change histogram.

| Signature | Meaning |
|---|---|
| `.files() -> List<DiffStatEntry>` | Per-file statistics. |
| `.total_added() -> Integer` | Total insertions. |
| `.total_removed() -> Integer` | Total deletions. |

### `Email`

Conversions: Boolean yes; Serialize yes; Template yes. The value is not guaranteed to contain exactly one `@`.

| Signature | Meaning |
|---|---|
| `.local() -> String` | Text before the first `@`. |
| `.domain() -> String` | Text after the first `@`, or empty. |

### `FsPath`

Conversions: Boolean no; Serialize yes; Template yes. Filesystem paths may contain non-UTF-8 bytes, which can make JSON serialization fail.

| Signature | Meaning |
|---|---|
| `.absolute() -> FsPath` | Absolute path. |
| `.relative() -> FsPath` | Path relative to the invocation directory. |

### `Integer`

Conversions: Boolean no; Serialize yes; Template yes. No methods.

### `List`

Conversions: Boolean yes; Serialize maybe; Template maybe.

| Signature | Meaning |
|---|---|
| `.len() -> Integer` | Element count. |
| `.join(separator: Template) -> Template` | Format elements with a separator. |
| `.filter(\|item\| expression) -> List` | Keep elements satisfying the predicate. |
| `.map(\|item\| expression) -> AnyList` | Transform each element. |
| `.any(\|item\| expression) -> Boolean` | Whether any element satisfies the predicate. |
| `.all(\|item\| expression) -> Boolean` | Whether all elements satisfy the predicate. |
| `.first() -> Option<T>` | First element. |
| `.last() -> Option<T>` | Last element. |
| `.get(index: Integer) -> Option<T>` | Zero-based indexed element. |
| `.reverse() -> List` | Reversed list. |
| `.skip(count: Integer) -> List` | Drop the first `count` elements. |
| `.take(count: Integer) -> List` | Keep the first `count` elements. |

### `List<Trailer>`

Supports all `List` methods plus:

| Signature | Meaning |
|---|---|
| `.contains_key(key: Stringify) -> Boolean` | Whether any trailer has `key`. |

### `Operation`

Conversions: Boolean no; Serialize yes; Template no.

| Signature | Meaning |
|---|---|
| `.current_operation() -> Boolean` | Whether this is the current operation. |
| `.description() -> String` | Operation description. |
| `.id() -> OperationId` | Operation ID. |
| `.attributes() -> String` | Operation attributes formatted as text. |
| `.time() -> TimestampRange` | Operation time range. |
| `.user() -> String` | Recorded user. |
| `.snapshot() -> Boolean` | Whether this is a snapshot operation. |
| `.workspace_name() -> String` | Origin workspace name, or empty. |
| `.root() -> Boolean` | Whether this is the root operation. |
| `.parents() -> List<Operation>` | Parent operations. |

### `OperationId`

Conversions: Boolean no; Serialize yes; Template yes.

| Signature | Meaning |
|---|---|
| `.short([len: Integer]) -> String` | Fixed/default-length prefix. |

### `Option`

Conversions: Boolean yes; Serialize maybe; Template maybe. A set option exposes the contained type's methods. Calling one on an unset value reports an inline error. Unset compares below set values. Boolean-convertible types instead use their empty value and do not support `Option`.

### `RefSymbol`

Conversions: Boolean no; Serialize yes; Template yes. Behaves like `String`, but formats with revset-safe quoting and escaping. It is not truthy-convertible.

### `RegexCaptures`

Conversions: Boolean no; Serialize no; Template no. Passed to the replacement lambda of global `replace()`.

| Signature | Meaning |
|---|---|
| `.len() -> Integer` | Capture count including group 0. |
| `.get(index: Integer) -> ByteString` | Capture by index; errors when out of bounds. |
| `.name(name: Stringify) -> ByteString` | Named capture; errors when absent. |

### `RepoPath`

Conversions: Boolean no; Serialize yes; Template yes. Slash-separated and repository-root-relative.

| Signature | Meaning |
|---|---|
| `.absolute() -> FsPath` | Absolute filesystem path. |
| `.display() -> String` | Platform-native path relative to the invocation directory. |
| `.parent() -> Option<RepoPath>` | Parent path. |

### `Serialize`

A conversion target for values accepted by `json()`, not a concrete type. Serialized fields and shapes are usually stable but do not have a backward-compatibility guarantee. No methods.

### `ShortestIdPrefix`

Conversions: Boolean no; Serialize yes; Template yes.

| Signature | Meaning |
|---|---|
| `.prefix() -> String` | Unique portion. |
| `.rest() -> String` | Remaining displayed portion. |
| `.upper() -> ShortestIdPrefix` | Uppercase both portions. |
| `.lower() -> ShortestIdPrefix` | Lowercase both portions. |

### `Signature`

Conversions: Boolean no; Serialize yes; Template yes.

| Signature | Meaning |
|---|---|
| `.name() -> String` | Display name. |
| `.email() -> Email` | Email field. |
| `.timestamp() -> Timestamp` | Signature timestamp. |

### `SizeHint`

Conversions: Boolean no; Serialize yes; Template no.

| Signature | Meaning |
|---|---|
| `.lower() -> Integer` | Lower bound. |
| `.upper() -> Option<Integer>` | Upper bound when known. |
| `.exact() -> Option<Integer>` | Exact value when equal known bounds. |
| `.zero() -> Boolean` | Whether the known upper bound is zero. |

### `String`

Conversions: Boolean yes; Serialize yes; Template yes. UTF-8 encoded.

| Signature | Meaning |
|---|---|
| `.len() -> Integer` | UTF-8 byte length. |
| `.contains(needle: Stringify) -> Boolean` | Whether `needle` occurs. |
| `.match(needle: StringPattern) -> String` | First match, or empty. |
| `.starts_with(needle: Stringify) -> Boolean` | Whether `needle` is a prefix. |
| `.ends_with(needle: Stringify) -> Boolean` | Whether `needle` is a suffix. |
| `.remove_prefix(needle: Stringify) -> String` | Remove `needle` when it is a prefix. |
| `.remove_suffix(needle: Stringify) -> String` | Remove `needle` when it is a suffix. |
| `.trim() -> String` | Remove leading and trailing whitespace. |
| `.trim_start() -> String` | Remove leading whitespace. |
| `.trim_end() -> String` | Remove trailing whitespace. |
| `.substr(start: Integer, [end: Integer]) -> String` | Slice by UTF-8 byte indexes; negatives count from the end. |
| `.first_line() -> String` | First line without its newline. |
| `.lines() -> List<String>` | Lines without newline characters. |
| `.split(separator: StringPattern, [limit: Integer]) -> List<String>` | Split by pattern, optionally limiting result count. |
| `.replace(pattern: StringPattern, replacement: Stringify, [limit: Integer]) -> String` | Replace matches; `$0`, `$1`, etc. expand captures. |
| `.upper() -> String` | Uppercase. |
| `.lower() -> String` | Lowercase. |
| `.escape_json() -> String` | JSON-escape one string; prefer `json()` for structured output. |

### `Stringify`

A conversion target, not a concrete type. Template-convertible values convert with labels stripped; invalid UTF-8 is rejected. No methods.

### `StringLiteral`

A parse-time string literal required by APIs that must validate a constant value. Single quotes have no escapes. Double quotes support `\"`, `\\`, `\t`, `\r`, `\n`, `\0`, `\e`, and `\xHH`. No methods.

### `StringPattern`

Conversions: Boolean no; Serialize no; Template no. Uses revset string-pattern kinds, but quotes are mandatory; a literal string means case-sensitive substring matching. Pattern values cannot currently be passed around and must appear directly at their call site. No methods.

### `Template`

Conversions: Boolean no; Serialize no; Template yes. Most printable types convert to it. No methods.

### `Timestamp`

Conversions: Boolean no; Serialize yes; Template yes.

| Signature | Meaning |
|---|---|
| `.ago() -> String` | Relative time. |
| `.format(format: Stringify) -> String` | Format with jj's strftime-like syntax. |
| `.utc() -> Timestamp` | Convert to UTC. |
| `.local() -> Timestamp` | Convert to local time. |
| `.after(date: StringLiteral) -> Boolean` | At or after the parsed date. |
| `.before(date: StringLiteral) -> Boolean` | Strictly before the parsed date. |
| `.since(start: Timestamp) -> TimestampRange` | Range from `start` to this timestamp. |

### `TimestampRange`

Conversions: Boolean no; Serialize yes; Template yes.

| Signature | Meaning |
|---|---|
| `.start() -> Timestamp` | Start timestamp. |
| `.end() -> Timestamp` | End timestamp. |
| `.duration() -> String` | Human-readable duration. |

### `Trailer`

Conversions: Boolean no; Serialize no; Template yes.

| Signature | Meaning |
|---|---|
| `.key() -> String` | Trailer key. |
| `.value() -> String` | Trailer value. |

### `TreeDiff`

Conversions: Boolean no; Serialize no; Template no.

| Signature | Meaning |
|---|---|
| `.files() -> List<TreeDiffEntry>` | Changed entries. |
| `.color_words([context: Integer]) -> Template` | Word-level colored diff. |
| `.git([context: Integer]) -> Template` | Git-format diff. |
| `.stat([width: Integer], [max_bar_width: Integer]) -> DiffStats` | Diff statistics with optional layout widths. |
| `.summary() -> Template` | Status-and-path summary. |

### `TreeDiffEntry`

Conversions: Boolean no; Serialize no; Template no.

| Signature | Meaning |
|---|---|
| `.path() -> RepoPath` | Target/right path for copies and renames. |
| `.display_diff_path() -> String` | Display path including copy/rename context. |
| `.status() -> String` | `modified`, `added`, `removed`, `copied`, or `renamed`. |
| `.status_char() -> String` | `M`, `A`, `D`, `C`, or `R`. |
| `.source() -> TreeEntry` | Source/left entry. |
| `.target() -> TreeEntry` | Target/right entry. |

### `TreeEntry`

Conversions: Boolean no; Serialize no; Template no.

| Signature | Meaning |
|---|---|
| `.path() -> RepoPath` | Repository-relative path. |
| `.normal_value() -> Option<TreeValue>` | Resolved value, or unset if absent/conflicted. |
| `.conflict() -> Boolean` | Whether the entry is conflicted. |
| `.conflict_side_count() -> Integer` | One if normal, otherwise the number of conflict sides. |
| `.file_type() -> String` | `file`, `symlink`, `tree`, `git-submodule`, or `conflict`. |
| `.executable() -> Boolean` | Whether a file entry is executable. |

### `TreeValue`

Conversions: Boolean no; Serialize no; Template yes. Default formatting is the full object ID; for a Git submodule, that is its recorded commit ID. No methods.

### `WorkspaceRef`

Conversions: Boolean no; Serialize yes; Template yes.

| Signature | Meaning |
|---|---|
| `.name() -> RefSymbol` | Workspace name. |
| `.target() -> Commit` | Workspace's working-copy commit. |
| `.root() -> Option<FsPath>` | Recorded workspace root, if available. |

## Machine-readable output

Use `json()` rather than hand-escaping fields. Add one newline per record for JSONL, suppress the graph, and disable color:

```shell
jj log --no-graph --color=never -r '::@' \
  -T 'json({
    "change_id" => change_id,
    "commit_id" => commit_id,
    "description" => description.first_line(),
    "bookmarks" => bookmarks,
  }) ++ "\n"'
```

For a JSON array rather than JSONL, serialize a mapped list from a context that provides one, or let the caller collect JSONL. Do not concatenate unescaped values into JSON. `String.escape_json()` is available for a single string when an object cannot be expressed directly.

Template serialization is intended for machine-readable output, but upstream notes that serialized fields and value shapes are not guaranteed backward-compatible across jj versions.
