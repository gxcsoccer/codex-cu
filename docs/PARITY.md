# Parity harness

Comparing a reimplementation with a live agent is not byte comparison: the UI
changes between runs (window titles, file lists, selection). The harness compares
**semantic features** of accessibility observations and aligns scenarios step by
step.

## Pipeline

```
scenario.json ──► tools/scenario.mjs ──► ours.json ─┐
                                                     ├─► tools/compare.mjs ──► score + per-step diff
dbtrace session ─► tools/from-codex.mjs ─► codex.json ┘
```

## What is compared

| Feature | Weight | Notes |
|---|---:|---|
| `kind` (full vs diff) | gate | mismatched kinds score 0 |
| role histogram (Jaccard) | 40% | localized roles must line up |
| node count ratio | 30% | min/max |
| window/app header | 20% | exact match |
| selection count | 10% | decays with delta |

## Running against our service

Requires Accessibility and Screen Recording for the service process:

1. System Settings → Privacy & Security → Accessibility → add the `CodexCU`
   binary (or the terminal that launches it);
2. same for Screen Recording;
3. run:

```bash
swift build --package-path service
./service/.build/debug/CodexCU --socket /tmp/codex-cu.sock &

cat > /tmp/finder.json <<'JSON'
{"name":"finder-downloads","app":"com.apple.finder","steps":[
  {"op":"getAppState"},
  {"op":"click","elementIndex":9},
  {"op":"getAppState"}
]}
JSON

node tools/scenario.mjs /tmp/finder.json --socket /tmp/codex-cu.sock --out /tmp/ours.json
```

## Capturing the Codex baseline

Run the same scenario through Codex (`dbtrace codex run ...`), then convert the
rollout-derived session:

```bash
node tools/from-codex.mjs traces/session-<id>.json /tmp/codex.json
node tools/compare.mjs /tmp/ours.json /tmp/codex.json
```

The comparison is meaningful when both runs target the same app and window; the
scenario should end with `getAppState` so the final states are comparable.

## Current status

- Harness and normalizer are covered by `tools/test/` (fixtures captured from the
  real service);
- Live execution is blocked on this machine: CLI processes have neither
  Accessibility nor Screen Recording (`AXIsProcessTrusted() == false`,
  `CGPreflightScreenCaptureAccess() == false`). The commands above are the
  reproduction path once permissions are granted.
