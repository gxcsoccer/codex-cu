# Captured accessibility text

These files are **verbatim observations from the real Codex Computer Use service**
(`cua.getApp("Finder")` and a subsequent `getAXState()`), captured with `dbtrace`
on macOS 27 in a `zh` locale.

- `finder-full-tree.txt` — first observation after `getApp`, with the
  `Window: ..., App: ....` header and localized role descriptions.
- `finder-diff.txt` — the follow-up diff, including `Removed element IDs`,
  `+`/`~` lines with a tab, the `Selected:` block and its note.

Only the home directory path is redacted (`/Users/<user>`). Everything else is
unchanged and is used by `FormatParityTests` to pin the renderer.
