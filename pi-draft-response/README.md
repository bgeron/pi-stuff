# `@bramgeron/pi-draft-response`

Command for editing review-response drafts in TOML review files:

- `/draft-response @/path/to/review.toml human-response` — open a tabbed TUI over `[[reviews.comments]]` entries and edit each comment's `human-response` field in place.

You can replace `human-response` with another simple TOML field name. In each tab, the UI shows the comment location and the review comment truncated to three lines. Saving writes non-empty field values, creates missing fields, and removes fields whose edited value is empty.

## Local usage

Load this package from the repository root:

```bash
pi -e ./pi-draft-response
```
