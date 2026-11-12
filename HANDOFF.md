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

"Slipstream" is this project's own name. Compatibility references, vehicle names,
and configuration identifiers still name third-party products. This is an
independent project; naming and attribution do not establish distribution rights.

## Where to look

| Topic | File |
|---|---|
| Security changes, CWEs, how to verify | `SECURITY.md` |
| Controller usage, architecture, first-run-with-cars checklist | `slipstream/README.md` |
| How the Android app works (Ghidra + OSINT), what Slipstream is built on | `slipstream/ANALYSIS.md` |
| Limits of the firmware-emulation evidence and why a behavioural simulator is used | `slipstream/FIRMWARE-TWIN.md` |
| The relay (rooms, host code, approval, per-car seats, WebSocket) | `platform/slipstream-relay.mjs` |
| Behavioural car twin (speaks the real BLE protocol) | `slipstream/sim.mjs` |
| Round design, original missions, accessibility and further playtesting | `slipstream/DESIGN.md`, `slipstream/session.mjs` |
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

Review-fix verification on 12 November 2026: **406 Node tests pass on Node
22.23.5**, **38 Python tests pass on Python 3.14.7**, audit reports zero
vulnerabilities, and the dependency/CWE probes pass. Host/phone browser walkthroughs
covered approval, simulated driving, story completion, and portrait/landscape
layouts. The Node suite includes all supported mode/car-count combinations with
mixed human/computer inputs. The follow-up build adds shared pit recovery with
frozen round/battle timers, precision lane/speed gates, independent scan/carry/deliver
tasks for every story participant, purposeful CPU guidance, and phone task/score
feedback. Simulator tests complete all three missions with one and four cars on
Capsule and Figure eight at 400 mm/s; precision guidance earns points where a
full-throttle baseline earns none. Browser review covers the task HUD and shared
pit/recovery flow. These are software checks, not hardware validation.
Run the controller locally with `npm run slipstream` (prints a host code; opens
`/slipstream/`). Plain `npm start` serves the hardened course bench without Slipstream.

## What is NOT done or NOT trusted (please scrutinise)

- **No Slipstream hardware validation yet.** These changes were tested with the simulator or
  recorded simulator traces. The BLE byte layouts follow the published SDK and the
  app analysis, but left/right lane sign, curve direction, multi-car Bluetooth, and
  phone sensors are all unverified on real devices. See the first-run checklist in
  `slipstream/README.md`.
- **No hardware trace fixture yet.** `slipstream/fixtures/` holds only a
  simulator recording; the suite prints "NO HARDWARE TRACES YET". A real trace is
  the single most useful thing to add.
- **No device-enforced host-loss stop is verified.** If the host browser dies
  mid-race, it cannot send STOP. BLE link-loss behavior remains unmeasured; merely
  adding host pings would not prove a car-side timeout. This is the top safety item.
- **Trademarks / data provenance.** `slipstream/data/*.json` contain derived track
  measurements plus copied vehicle names, weapon identifiers, and selected
  structured gameplay configuration. They are not numeric-only tables. The
  extractor does not bundle app binaries, artwork, or audio. Source permissions
  and distribution terms remain unresolved; no legal clearance is asserted.
  APK/OBB identities, extraction, Java transport paths and selected broader native
  paths have now been independently reproduced; firmware execution remains
  unverified. See `slipstream/review/INDEPENDENT-REVIEW.md` for analysis warnings.
  Reported high entropy is not conclusive evidence of encryption.
- **The course exercises were removed.** The deliberate flaws the class was built on
  no longer reproduce; use `course-vulnerable-baseline` at
  `ab809451fc99564474b2b83baca0f63b78c24034` for those exercises.

## Fast & Furious, 3D studio and container hosting

Read [the Fast & Furious review](slipstream/review/FAST-FURIOUS-REVIEW.md) for the
independent `com.anki.foxtrot` analysis, matching derived tables and transport code,
and the native-analysis warnings. Power Zone effects remain unimplemented.
[Deployment instructions](slipstream/DEPLOYMENT.md) describe Codespaces hosting
with a nearby Bluetooth laptop and phone clients. The optional Three.js studio
uses original procedural graphics with a 2D fallback; desktop panels resize.
Local verification covers 1440×900, 390×844 and 844×390 host layouts, keyboard
resizing, WebGL context-loss fallback, and a non-root Docker build with assets
and authenticated room join/approval. Actual Codespaces forwarding and physical
Bluetooth/sensors remain unverified.

## Broader review and coordination build

Read **[the independent review](slipstream/review/INDEPENDENT-REVIEW.md)** and
**[REA assessment](slipstream/review/REA-REVIEW.md)**. The new pass repairs batch
parser failures, stale/unknown targeting, parked-car targeting, shield ordering,
and long startless mapping. Circuit planning, crew alliances, target IDs and
assist rewards are available. `verification.test.mjs` exhaustively checks 22,620
bounded association states; it is not a formal proof of the complete system.
Smart-car analogies and further coordinated-play designs are in `DESIGN.md`.

## Review follow-up

The follow-up fixes malformed relay-key crashes, adds bounded transport-failure
cleanup, latches off-track stops until explicit recovery, preserves host control
ownership, and halts real cars on visibility loss. STOP ALL always stops; Free
drive is a separate explicit action. Four cars is the maximum and the chosen
speed ceiling also applies to scans and boosts. Arcade, Competition and Story
missions offer short rounds with optional phone haptics and calibrated tilt.
See `slipstream/README.md` for controls and `slipstream/DESIGN.md` for the design
rationale. These software changes do not demonstrate physical stopping behavior.

## Provenance of this work

The initial PR was produced across sessions with Claude (via Claude Code); review
fixes and game-design work were subsequently assisted by Codex. Treat all of it
as needing the same review as any machine-generated change, especially the untested
hardware assumptions above.
