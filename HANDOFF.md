# Review handoff

For a reviewer (human or AI) picking this up cold. It says what changed, where to
look, how to verify, and what is deliberately unfinished or untrusted.

## What this repo is now

Two bodies of work sit on top of the original CS460 teaching scenario:

1. **Security hardening** of the original course code. The scenario shipped with
   deliberate vulnerabilities as exercises; those are now repaired. Full list with
   CWE numbers, the flawed-baseline commit, and verification steps: **[SECURITY.md](SECURITY.md)**.
2. **Slipstream** (`slipstream/`): a new browser controller for real Anki DRIVE /
   OVERDRIVE cars — multi-car Web Bluetooth, automatic track mapping, the original
   game's weapons and car models, computer opponents, and phone/laptop controllers
   that join by per-car QR code through a relay. Guide: **[slipstream/README.md](slipstream/README.md)**.

The name "Slipstream" is this project's own; it deliberately avoids the hardware
maker's and game's trademarks. The one file that names them is the analysis
(below), because it must say what was examined.

## Where to look

| Topic | File |
|---|---|
| Security changes, CWEs, how to verify | `SECURITY.md` |
| Controller usage, architecture, first-run-with-cars checklist | `slipstream/README.md` |
| How the Android app works (Ghidra + OSINT), what Slipstream is built on | `slipstream/ANALYSIS.md` |
| Why a firmware-in-QEMU "digital twin" is not practical (firmware is encrypted) | `slipstream/FIRMWARE-TWIN.md` |
| The relay (rooms, host code, approval, per-car seats, WebSocket) | `platform/slipstream-relay.mjs` |
| Behavioural car twin (speaks the real BLE protocol) | `slipstream/sim.mjs` |
| Real-car trace capture + replay for tests | `slipstream/trace.mjs`, `slipstream/fixtures/` |

## How to verify

```sh
npm ci --ignore-scripts
npm audit                        # expect: found 0 vulnerabilities
npm test                         # Node suites (bench, platform, instructor, slipstream)
python3 -m unittest discover -s tests -v
python3 -m lapreturn.cwe_lab     # expect three "flaw_reproduced": false, exit 0
npm run dependency-lab           # expect "regressionCheckPassed": true
```

Last run here: **324 Node tests and 38 Python tests pass; `npm audit` clean.**
Run the controller locally with `npm run slipstream` (prints a host code; opens
`/slipstream/`). Plain `npm start` is the unchanged course bench.

## What is NOT done or NOT trusted (please scrutinise)

- **No physical hardware has ever been exercised.** Every test uses the simulator or
  recorded simulator traces. The BLE byte layouts follow the published SDK and the
  app analysis, but left/right lane sign, curve direction, multi-car Bluetooth, and
  phone sensors are all unverified on real devices. See the first-run checklist in
  `slipstream/README.md`.
- **No hardware trace fixture yet.** `slipstream/fixtures/` holds only a
  simulator recording; the suite prints "NO HARDWARE TRACES YET". A real trace is
  the single most useful thing to add.
- **No host keep-alive.** If the host browser dies mid-race nothing tells the cars to
  stop; what a car does on BLE link loss is unmeasured. This is the top safety item.
- **Trademarks / data provenance.** `slipstream/data/*.json` are numeric tables
  derived from the app's own config by `slipstream/tools/extract_config.py`; no app
  code, art or audio is included. A reviewer should confirm this is acceptable for
  this repo's distribution before it is made more public. `slipstream/ANALYSIS.md`
  and `slipstream/FIRMWARE-TWIN.md` describe the reverse-engineering done and the
  lines deliberately not crossed (e.g. no firmware-encryption circumvention).
- **The course exercises were removed.** The deliberate flaws the class was built on
  no longer reproduce; the flawed baseline is the tagged commit named in SECURITY.md.

## Provenance of this work

Produced across a series of sessions with Claude (via Claude Code). Treat all of it
as needing the same review as any machine-generated change, especially the untested
hardware assumptions above.
