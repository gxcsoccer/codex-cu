# Installation

## As a LaunchAgent (per user)

```bash
scripts/install.sh
```

This builds the release binary, installs it to `~/.local/bin/codex-cu`, writes
`~/Library/LaunchAgents/com.codex-cu.service.plist`, and bootstraps the agent.
The socket is `~/Library/Application Support/codex-cu/computeruse.sock`.

Then grant permissions (required by the same TCC gates as the original):

1. System Settings → Privacy & Security → **Accessibility** → add
   `~/.local/bin/codex-cu`;
2. System Settings → Privacy & Security → **Screen Recording** → add the same
   binary;
3. `launchctl kickstart -k gui/$UID/com.codex-cu.service`.

## Approvals

By default every app is allowed (documented deviation). To deny specific apps:

```bash
codex-cu --socket /tmp/cu.sock --approvals ~/approvals.json
```

```json
{"persistentApprovals": {"com.example.blocked": "alwaysDeny"}}
```

`alwaysAllow` and `alwaysDeny` are the observed decision values; `allowAllChats`
overrides individual entries. The older `{"apps": {"<bundle>": {"allowed":
false}}}` document is still accepted.

Missing files, malformed JSON, and apps without an entry fail open.

## Instructions and launch timeout

```bash
codex-cu --socket /tmp/cu.sock \
  --instructions ~/instructions.json \
  --launch-timeout 8
```

`instructions.json` maps bundle ids to the text returned as
`appSpecificInstructions`:

```json
{"apps": {"com.apple.finder": "Prefer the sidebar and list view."}}
```

`--launch-timeout` controls how long `startApp` waits for the first window
(default 5 s).

## Manual

```bash
swift build --package-path service
./service/.build/debug/CodexCU --socket /tmp/codex-cu.sock
```

## Uninstall

```bash
scripts/install.sh --uninstall
```

## Notes

- A LaunchAgent cannot show TCC prompts; if the binary is not listed, macOS
  silently denies Accessibility and Screen Recording. Grant manually.
- The service only listens on a Unix socket in the user's home; there is no TCP
  listener.
- `--print-plist` is side-effect free and used by CI to validate the plist.
