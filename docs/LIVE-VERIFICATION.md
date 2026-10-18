# Live verification checklist

The CI suite runs without Accessibility, Screen Recording or a real browser. To
verify the parts that need them, run this on a normal desktop session.

## 0. Preconditions

```bash
scripts/install.sh            # or: swift build --package-path service
```

Grant permissions to **the binary** (`~/.local/bin/codex-cu`, or the built
`service/.build/debug/CodexCU`):

1. System Settings → Privacy & Security → Accessibility
2. System Settings → Privacy & Security → Screen Recording

Then start the service (LaunchAgent or manually):

```bash
~/.local/bin/codex-cu --socket /tmp/codex-cu.sock      # manual
# or
launchctl kickstart -k gui/$UID/com.codex-cu.service
```

## 1. Run the checks

```bash
node scripts/live-check.mjs \
  --socket /tmp/codex-cu.sock \
  --app com.apple.finder \
  --audio
```

Add `--browser http://127.0.0.1:9222` if a Chrome is running with
`--remote-debugging-port=9222`.

## 2. Expected output

| Check | PASS means | SKIP means |
|---|---|---|
| `ping` | version handshake | — (failure is real) |
| `listApps` | at least one regular app | headless session |
| `getAppState` | text contains `Window:` | app not running (`-10007`) or no Accessibility (`-10009`) |
| `screenshot` | `file://` PNG starts with `89 50` | no skyshot returned |
| `audio` | WAV is `RIFF/WAVE`, 24000 Hz, 2 ch | Screen Recording missing (`-10009`) |
| `screenshot` | needs `getAppState` first; with Accessibility granted the `file://` PNG is checked | — |
| `browser` | AX tree contains the data-URL heading | no `--browser` endpoint |

`FAIL` is a real defect; `SKIP` means the environment did not provide the
precondition. Exit code is non-zero only when a check fails.

## 3. Manual spot checks

```bash
# read the AX text
node -e "import('./client/src/cua.mjs').then(async ({Cua}) => {
  const c = new Cua({socketPath:'/tmp/codex-cu.sock'});
  const app = await c.getApp('com.apple.finder');
  console.log(await app.getAXState());
  c.close();
})"

# record 3 seconds of system audio and inspect the WAV
node -e "import('./client/src/cua.mjs').then(async ({Cua}) => {
  const c = new Cua({socketPath:'/tmp/codex-cu.sock'});
  await c.startAudioRecording({maxDurationMilliseconds:3000});
  await new Promise(r=>setTimeout(r,3200));
  const a = await c.stopAudioRecording();
  console.log(a.filepath, a.bytes.length);
  c.close();
})"
```

## 4. What is verified automatically

`scripts/verify.sh` runs all offline suites and then the live check if a socket
exists (`CODEX_CU_SOCKET` overrides the path). It never treats a skip as a pass.
