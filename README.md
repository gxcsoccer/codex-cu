# codex-cu

Clean-room reimplementation of **Codex Computer Use** (the macOS desktop-control
stack behind Codex / ChatGPT): a local service that reads the accessibility tree,
synthesizes input events, captures screenshots, and speaks the same JSON-RPC
protocol as the original.

> Status: protocol, app inventory, AX tree text and input actions (click, drag,
> scroll, type, pressKey, setValue, selectText, secondary action) are implemented
> and tested; screenshots and tree diffing are next. See `docs/COMPATIBILITY.md`.

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

## Tests

```bash
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
observed protocol (documented in `docs/PROTOCOL.md`). Response field names for
some requests are inferred; each inference is listed in `docs/COMPATIBILITY.md`
with the test that pins it.

## License

MIT (our code). Protocol facts are documented as observations, not copied source.
