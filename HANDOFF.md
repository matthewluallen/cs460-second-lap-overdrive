# Review handoff

For a reviewer (human or AI) picking this up cold. It says what changed, where to
look, how to verify, and what is deliberately unfinished or untrusted.

## Latest real-car compatibility status

Read [CAR-COMPATIBILITY-REGRESSION.md](slipstream/review/CAR-COMPATIBILITY-REGRESSION.md).
The scan is still unresolved. Native 0x23 startup confirmation is now required;
The operator approved a scan-only 300 mm/s unlocalized-speed allowance. It is
restored to zero on first position or stop; physical scan success remains unverified.
All 501 Node tests pass, including 13 scan-bootstrap regressions.
Groundshock's later disconnect was the operator turning it off to leave.

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

Review-fix verification on 12 November 2026: **419 Node tests pass on Node
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
and the native-analysis warnings. Power Zone effects remain unimplemented. Diagnostic-only supercode decoding and
`slipstream/tools/inspect_trace.mjs` now prepare for real captures. Recordings retain
firmware, distinguish mixed sessions, and reject callbacks from previous sessions.
[Deployment instructions](slipstream/DEPLOYMENT.md) describe Codespaces hosting
with a nearby Bluetooth laptop and phone clients. The optional Three.js studio
uses original procedural graphics with a 2D fallback; desktop panels resize. The 3D feedback pass adds energy bars,
shields, grouped numbered mission gates and attack/recovery cues. Browser checks
exercise 13 effect types, cached gate labels and reduced-motion status visibility.
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

## Phone input follow-up

Phone throttle now tracks an active pointer gesture. Disconnects, stops and car
reassignments invalidate old gestures and held inputs; a new car starts with
neutral steering. Unassigned/revoked phones disable stale weapon controls.
Regression tests exercise the actual phone handlers with synthetic browser events;
physical touchscreen and sensor behavior still need device validation.

Phone release now remains locked and retries until acknowledged. Gamepad slots
retain disconnected gaps, disconnected controls clear held weapons, and stop/
reconnect/reassignment requires neutral controls before rearming. Host/phone
regressions cover these transitions without claiming physical-device validation.

## External review remediation (12 November 2026)

Read [PR4 review response](slipstream/review/PR4-REVIEW-RESPONSE.md) for reproduced
findings, separate fixing commits, baseline/final checks and remaining risks.
Final verification: **478 Node tests, 38 Python tests**, zero npm audit findings;
CWE and dependency regression probes pass. Includes 42 injected-fault matrix cases.
H1/H2/H3/M1/M2/M3/M4/M12 are repaired in software; H4 special tiles 53/54/57 are
quarantined from scored rounds, with physical behavior still unverified.
The 2-second telemetry default remains. Story/Precision intersection rounds are
blocked pending validation; longer Story algorithm-test timing is simulator-only.
No hardware validation or complete-system formal proof is claimed. M13 and
car-enforced host-loss stopping remain open. See the response before deployment.

Public hardware trials now use `PORT=3000 npm run slipstream:live`, which excludes
the teaching APIs and bench pages (M13 deployment isolation). The user explicitly
authorized public Codespaces forwarding for QR controllers. Latest local Node run:
479 tests passed. See `slipstream/DEPLOYMENT.md`; hardware limits remain unchanged.

## First hardware scan — 12 November 2026

The operator identified the connected car as International MXT and reported almost
three laps in the 45-second scan, on a circuit containing start/finish and F&F
Power Zone. The browser misidentified it as Groundshock via its fallback. A partial
recording started about 20 seconds into the scan. It contains short 8-byte 0x29
frames and battery reports, but no 0x27 position frames. The scan timed out; the
UI reported zero speed after STOP. Physical stop is not established by UI alone.
`slipstream/fixtures/mxt-short-transitions.json` preserves hardware bytes and labels
the incorrect model metadata; simulated-car events are excluded. Replay reproduced
a safety bug: short 0x29 frames refreshed the track watchdog despite lacking the
supported classic transition layout. The decoder now requires the full layout.
480 Node tests pass. This repairs the watchdog gap, not MXT localization or Power
Zone compatibility. Do not increase scan time or infer piece IDs from these bytes.

The subsequent [MXT-focused Ghidra/JADX pass](slipstream/review/MXT-DECOMPILE-FOLLOWUP.md)
re-exported initialization, transition and receive functions from the F&F library.
It confirms the supported classic layout and an application startup sequence unlike
our SDK path, but does not establish the missing-position root cause. No additional
live commands were sent. Startup-inclusive recording is the next evidence gap.

## F&F initialization implementation

The Fast & Furious modular-kit connection now uses an app-derived phased startup,
with exact default road-network bytes recovered from native data and ping/version
barriers. Startup recording attaches before the first command. Unknown models no
longer default to Groundshock. See [initialization evidence and deliberate safety
differences](slipstream/review/FF-INITIALIZATION.md). 484 Node tests pass; real-car
startup and scanning still require validation with the new build.
