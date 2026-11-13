# Review handoff

For a reviewer (human or AI) picking this up cold. It says what changed, where to
look, how to verify, and what is deliberately unfinished or untrusted.

## Control repairs ready for supervised acceptance

The two reproduced SDK/app faults are repaired: unverified geometry cannot
calibrate steering, and cancelled targets are cleared. Cancellation while moving
now opens the shared pit, preventing automatic retries by continuous controllers.
The Power Zone label and signal counts distinguish mapping from activation;
actual zone attacks remain disabled pending hardware evidence.

Fresh checks: 552 Node tests, 38 Python tests, CWE lab and dependency lab pass;
zero npm audit advisories. This includes the existing 1–4-car mode/fault matrix.
The new regressions first failed on the captured piece-57 offset correction and
unachieved steering target. See `hardware-steering.test.mjs` and
`live-diagnostics.test.mjs`. Node 22.23.5; Python 3.14.7.

Changes are on the review branch, not loaded into the active Codespaces browser.
Next hardware gate: load the repaired build while stopped, verify ordinary-piece
left/right steering and STOP, then record marked-lane versus adjacent-lane passes
in both directions. Only then enable a tested Power Zone attack implementation.
Do not describe this as completed physical racing or formal firmware verification.

## Power Zone lane behavior reviewed

Read [POWER-ZONE-AUDIT.md](slipstream/review/POWER-ZONE-AUDIT.md). Fresh Ghidra
and F&F configuration review identifies a direction-aware attack lane that
disables eligible nearby opponents, with cooldown and repeat-hit protection.
The successful Groundshock capture maps piece 57 but contains no zone-supercode
events. Physical lane activation and attack behavior remain unverified; no
runtime changes or car commands were made, and special-piece scoring stays gated.

## SDK/app approach faults identified

Read [SDK-APK-APPROACH-AUDIT.md](slipstream/review/SDK-APK-APPROACH-AUDIT.md).
Fresh targeted Ghidra review plus captured-byte probes originally reproduced two
faults (repaired in the follow-up above): unverified piece 57 still drives offset calibration, and cancelled steering
retains an unachieved target. The packet layout is SDK-consistent; the reason for
firmware cancellation is not yet proved. No live commands or runtime edits were
made in this review. The follow-up repairs need supervised hardware acceptance before racing.

## Hardware trace now replayed

The attached Groundshock capture is preserved and replays to an 11-piece map.
It contains special piece 57 (still blocked for scoring), and the left-lane request
received a cancellation report after 53 ms. New diagnostics expose cancellation;
548 Node tests pass. The cause of cancellation and physical steering remain open.
See the attached-trace section in MVP-ACCEPTANCE.md. No live controller reload or
additional physical movement was performed for this diagnostic change.

## First physical SDK scan

On 13 November, Groundshock firmware 11866 successfully scanned an 11-piece circuit
using Classic SDK connection; the operator confirmed the map was correct and the
car physically stopped. F&F initialization on the same car produced no movement or
positions. See the final section of [MVP acceptance](slipstream/review/MVP-ACCEPTANCE.md)
for the comparison, observed speed discrepancy and remaining physical gates.
Historical statements below that scanning is unproven predate this single test.

## Classroom access preflight

`npm run slipstream:preflight` checks anonymous live readiness, controller delivery
and teaching-route isolation without a host code, rooms or Bluetooth. Set
`SLIPSTREAM_CHECK_ORIGIN` to the public HTTPS origin. It explains private-port
redirects and never changes forwarding permissions. `slipstream:check` runs this
before creating its temporary rooms and refuses subsequent API redirects.
All **545 Node tests pass**, including eight preflight regressions. The anonymous
check passed from the operator laptop against the public Codespaces URL. Actual
phone/iPad classroom access and physical-car acceptance remain open.

## Feature-confirmation audit and browser scoring repair

Read [FEATURE-CONFIRMATION-AUDIT.md](slipstream/review/FEATURE-CONFIRMATION-AUDIT.md).
A real-browser simulation exposed zero lap scores despite movement: timestamps
sampled before synchronous telemetry made fresh positions appear future-dated.
An advancing-clock regression reproduced it; sampling after delivery fixes it
without weakening freshness checks. All 537 Node tests pass. Browser verification
then showed both CPU racers scoring laps (7 and 6 at the captured observation).
Ordinary races now show best/last lap times rather than knockout columns.
The initial Codespaces restart failed because the old Alpine container lost Node
and home state. Rebuilding the configured Node 22 container, adding SSH support,
and keeping private state under `/workspaces/.slipstream-managed` repaired this.
Rebuild and subsequent shutdown/resume preserved the host code and automatically
started the live server. Readiness can lag SSH availability; wait for `/slipstream/ready`.
Four public-proxy clients passed both socket and HTTP checks after rebuild.
GitHub reset port 3000 to private on resume; restored authorized public visibility.
Check forwarding visibility before sharing QR codes. Hardware scanning remains unproven.

## Network lifecycle regression

Five failing tests reproduced callbacks from stopped/replaced connections and a
socket send exception that bypassed callers' promise error handling. The network
client now rejects sends after stop, ignores stale socket/HTTP callbacks and turns
send failures into promise rejections. All 535 Node tests pass, including real
relay integration. This is software evidence only; hardware acceptance is pending.

## Full MVP round regression

All 530 Node tests pass. The 90-second MVP round is exercised through every
simulation update with all-human, all-CPU and mixed drivers for 1–4 cars. Every
driver must score a lap and every simulated transport must receive STOP at the
finish. This extends software evidence; physical acceptance remains incomplete.

## Public relay deployment check

`npm run slipstream:check` now verifies an isolated room through the deployment's
actual origin. Four clients passed WebSocket and forced HTTP fallback through the
public Codespaces proxy, including approval, neutral input, state and revocation.
Temporary rooms were removed. See deployment instructions; no car or phone-hardware
validation is implied. GitHub workflow run 43368273825 passed for `56c0ae8`;
the PR summary was temporarily empty while that run appeared in history.

## Phone neutral handshake and real network client coverage

A stopped phone could retain nonzero steering while the host required a neutral
input to re-arm. Two failing regressions reproduced that recovery deadlock. The
phone now sends zero motion/action values whenever driving is locked, including
sensor changes while waiting. The host's neutral rule is unchanged. Eight new
real network client tests cover 1–4 players over WebSocket and HTTP fallback,
including approval, input, private state and removal. All 522 Node tests pass.
These tests do not validate phone hardware, classroom networking or physical cars.

## MVP startup and acceptance

`npm run slipstream:up` adds managed live-only startup, private persisted host code,
readiness identity, and refusal to replace an occupied server. The configured
Codespace runs it on startup. See [deployment](slipstream/DEPLOYMENT.md) and
[MVP acceptance](slipstream/review/MVP-ACCEPTANCE.md). Local regression: 512 Node
and 38 Python tests pass, audit clean. Public HTTPS now responds, but no successful
real-car scan or 1–4 car physical acceptance is claimed.

## Live diagnostics and optional calibration

See [LIVE-DIAGNOSTICS.md](slipstream/review/LIVE-DIAGNOSTICS.md) for the new live
readout, replay-compatible diagnostic export, measured starting-lane calibration
and the next one-variable-at-a-time physical test. No hardware success is claimed.

## Latest research

[Community/APK protocol cross-check](slipstream/review/COMMUNITY-PROTOCOL-REVIEW.md)
identifies unknown lateral offset in Groundshock telemetry and original-app
set-offset-before-lane-change sequencing. It does not prove the scan failure is
fixed. Firmware-specific packet formats and unsupported short frames remain open.

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
