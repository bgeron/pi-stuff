# `@bramgeron/pi-draft-response`

Install from npm after release:

```bash
pi install npm:@bramgeron/pi-draft-response
```

Command for editing review-response drafts in TOML review files:

- `/draft-response @/path/to/review.toml human-response` — open a tabbed TUI over `[[reviews.comments]]` entries and edit each comment's `human-response` field in place.

You can replace `human-response` with another simple TOML field name. In each tab, the UI shows the comment location and the review comment truncated to three lines. Saving writes non-empty field values, creates missing fields, and removes fields whose edited value is empty.

Run pi with the development version from the subdirectory:

```bash
pi -e ./pi-draft-response
```
