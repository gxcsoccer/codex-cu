# codex-cu

Clean-room reimplementation of **Codex Computer Use** (the macOS desktop-control
stack behind Codex / ChatGPT): a local service that reads the accessibility tree,
synthesizes input events, captures screenshots, and speaks the same JSON-RPC
protocol as the original.

> Status: protocol, AX observation/actions, screenshots, diffs, audio recording,
> the `cua` surface and a CDP browser backend are implemented and tested.
> Deviations, blocked items and the completion checklist are in `docs/SCOPE.md`.

## Read this first

- [docs/REPORT.md](docs/REPORT.md) — what the original is, how it was reconstructed,
  and the fidelity assessment.
- [docs/CONFORMANCE.md](docs/CONFORMANCE.md) — per-feature implementation and test
  evidence.
- [docs/PROTOCOL.md](docs/PROTOCOL.md) — wire format.

## Why

The original is a closed-source Swift service (`SkyComputerUseService`) driven by
an Electron/Node client over a Unix socket. This project rebuilds it from observed
behavior so the protocol, semantics, and failure modes are documented and testable.

**This is not a copy of OpenAI code.** It is implemented from protocol captures,
public API documentation bundled with the app, and black-box experiments. See
`docs/REVERSE-ENGINEERING.md` for the evidence trail.

## Layout

```
service/    Swift package: Unix socket server, framing, JSON-RPC, AX + input
client/     Node client: framing, request envelopes, high-level API
docs/       protocol spec, evidence, compatibility matrix
fixtures/   recorded frames used as golden tests
```

## Quick start

```bash
# build the service
swift build --package-path service

# run it on a temporary socket
./service/.build/debug/CodexCU --socket /tmp/codex-cu.sock

# talk to it
node -e "import('./client/src/index.mjs').then(async ({Client}) => {
  const c = new Client({ socketPath: '/tmp/codex-cu.sock' });
  console.log(await c.ping());
  console.log(await c.listApps());
})"
```

## Model-facing API

`client/src/cua.mjs` mirrors the captured `cua` surface:

```js
import { Cua } from './client/src/cua.mjs';
const cua = new Cua({ socketPath: '/tmp/codex-cu.sock' });
const app = await cua.getApp('com.apple.finder');
await app.getAXState();
await app.click(42);
await app.scroll([640, 480], 'down', 1);
await app.pressKey('cmd+shift+g');
await app.typeText('hello');
```

### Browser surface

```js
import { Cua } from './client/src/cua.mjs';
import { CdpBrowserProvider } from './client/src/browser.mjs';

const cua = new Cua({
  socketPath: '/tmp/codex-cu.sock',
  browserProvider: new CdpBrowserProvider({ endpoint: 'http://127.0.0.1:9222' }),
});
const tab = await cua.getTab({ url: 'example.com' });
await tab.goto('https://example.com');
console.log(await tab.getAXState());
```

The provider talks CDP to a Chrome started with `--remote-debugging-port`. See
`docs/BROWSER.md` for supported methods and gaps.

## Live verification

With Accessibility/Screen Recording granted and a service running:

```bash
node scripts/live-check.mjs --socket /tmp/codex-cu.sock --audio
```

See `docs/LIVE-VERIFICATION.md` for the checklist and expected output.

## Install

```bash
scripts/install.sh   # LaunchAgent + binary; then grant Accessibility/Screen Recording
```

See `docs/INSTALL.md`.

## Tests

```bash
scripts/verify.sh        # build + every suite (Swift, Node, integration)

npm test                 # protocol + client (mock server, no permissions)
npm run build:service    # swift build
npm run test:integration # client <-> real Swift service over a Unix socket
npm run test:service     # Swift unit tests (scripts/test-service.sh adds the
                         # Swift Testing macro plugin path on CLT-only installs)
```

The client tests run against a mock server and golden frames, so they work on any
machine. The Swift tests cover framing and dispatch with injected providers; tests
that need Accessibility/Screen Recording permissions are marked and skipped when
the permission is absent.

## Compatibility

The wire format, request envelopes, action shapes, and error codes follow the
observed protocol (documented in `docs/PROTOCOL.md`). A per-feature matrix with
implementation and test evidence is in `docs/CONFORMANCE.md`. Response field names for
some requests are inferred; each inference is listed in `docs/COMPATIBILITY.md`
with the test that pins it.

## License

MIT (our code). Protocol facts are documented as observations, not copied source.
