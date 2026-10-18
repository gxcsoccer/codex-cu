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
