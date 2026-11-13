# Slipstream classroom MVP acceptance

Status: **in progress, not hardware accepted**.

The first supported game is the existing 90-second **Beat your best** round, for
one through four cars with human or CPU drivers. Additional modes remain available
but are not prerequisites for MVP acceptance. This choice does not waive any
car-count, client, scanning or safety requirement.

## Evidence and remaining gates

| Requirement | Current evidence | Acceptance still required |
|---|---|---|
| Repeatable server startup | Launcher tests plus actual Node 22 Codespace rebuild and shutdown/resume: automatic startup and host-code persistence passed | Check readiness after startup; do not assume immediate availability when SSH connects |
| Public HTTPS client URL | Public readiness and four-client relay checks passed; GitHub reset forwarding to private on resume, then authorized Public was restored | Run `slipstream:preflight` after every resume; QR join from actual phone/iPad on classroom network |
| Laptop owns Bluetooth | Existing host transport and native startup contract tests; prior cars connected | Identify each actual model/firmware accurately; stable concurrent connections for 1–4 cars |
| Guided connect/calibrate/scan/play | Host-handler tests cover selected scan car, clear-track confirmation, countdown and other cars staying stopped | Successful repeatable scan with observed physical movement and complete telemetry; calibration remains optional, experimental |
| Accurate track | Decoder and topology tests; unsupported special pieces remain quarantined | Compare scanned order, direction and closure with the built track; no unsupported piece accepted as verified |
| Browser, phone and iPad human controls | Browser handler, relay and phone safety tests | Physical throttle/steer/neutral/STOP on each client; tilt permissions/calibration; visual fallback when haptics unavailable |
| 1–4 human/CPU participants | `host.test.mjs` runs the full 90-second MVP round with all-human, all-CPU and mixed drivers at 1, 2, 3, 4 simulated cars | Physical rounds at every count, including all-human, all-CPU and mixed configurations |
| Stops, arming and shared pit | Existing fault matrix covers silent telemetry, relay outage and late delocalization at every car count | Observed stop behavior and latency, neutral-required recovery; host-loss limitation resolved or explicitly accepted for supervised use |
| Useful diagnostics | Live telemetry, startup recording, bounded annotated exports and replay tests | Export from successful scan and failed attempt, replay both; correlate with operator observations |

Local regression for startup change: Node 22.23.5, **512 Node tests**; Python
3.14.7, **38 tests**. CWE probes and dependency lab pass; npm audit reports zero
vulnerabilities. These are software checks, not a complete formal proof or proof
of firmware compatibility. Prior Codespaces Node 24.22.3 run passed 508 tests
before the four launcher tests were added.

## Supervised acceptance sequence

1. Use charged cars and an ordinary closed track with start/finish. Remove Power
   Zone/special tiles 53/54/57 for the initial scored-round acceptance. Keep their
   compatibility as an explicit open item; do not relabel them as supported.
2. Connect one car while stopped. Record model, firmware, battery and initialization
   evidence. Leave optional measured-offset calibration blank unless the operator
   intentionally supplies a measured starting offset on a straight.
3. With the operator beside the clear track, select that car and perform a scan
   using the existing countdown, 300 mm/s ceiling, 5-second initial telemetry
   deadline, 2-second gap watchdog and 45-second/3-lap scan bounds. Export the trace
   even if it fails. Do not extend those limits to manufacture a passing scan.
4. Compare the map with the physical track. Verify lane direction at low speed,
   then observe STOP. A displayed speed of zero is not evidence of physical stop.
5. Join and approve a phone/iPad, assign its seat, and test controls and recovery.
   A revoked or departed player must not regain a seat by reconnecting. Never test
   loss of the host's Bluetooth connection with a moving car until a safe physical
   procedure has been agreed with the operator.
6. Run a 90-second round, then repeat with 2, 3 and 4 cars and human/CPU combinations.
   Capture completion, lap correctness, physical stop, telemetry gaps, write errors
   and any pit reason. Unsupported conditions remain blocked rather than hidden.
7. Save build identity, client/browser versions, car firmware, track layout, exported
   session and operator observations for every acceptance run. Record failures too.

No real-car command is authorized by this document alone. The operator must be
present and ready for each physical test. Formal models and simulator tests cover
stated assumptions; they cannot certify unknown firmware behavior, worn batteries,
radio interference or actual lane direction.

## Network-client and recovery follow-up

All **522 Node tests** pass after adding two phone neutral-handshake regressions
and eight real-client/real-relay integration cases (1–4 players, WebSocket and HTTP
fallback). The two phone regressions failed before the fix with steering `1`
instead of `0`. A locked phone now transmits neutral motion even when sensor/arrow
input changes; host arming rules remain unchanged. Integration tests exercise the
production `net.mjs`, approval, input routing, individual state and revocation on
loopback. They do not establish public-proxy WebSocket behavior or phone sensors.

## Public relay evidence

`npm run slipstream:check` passed both WebSocket and forced HTTP fallback through
`https://curly-giggle-449vvxwxrj43jr67-3000.app.github.dev` on 12 November 2026.
Each transport used four temporary approved players, neutral input, individual
state delivery, and rejected revoked credentials; both rooms were deleted. The
client process ran inside Codespaces but addressed the public HTTPS proxy, not
loopback. No Bluetooth connection or real-car command was made. An external phone
on the classroom network remains unverified. PR #4 is open and mergeable but has
an initially empty check summary. Subsequent workflow history confirms successful
run [43368273825](https://github.com/matthewluallen/cs460-second-lap-overdrive/actions/runs/43368273825)
for `56c0ae8`. Local, Codespaces and CI results remain separately scoped evidence.

## Full MVP driver-combination regression

All **530 Node tests** pass on Node 22.23.5. Eight additional round cases cover
all-human and all-CPU configurations at every car count; the existing mixed cases
remain. Every participant must score a lap, the 3-second countdown must stay
stopped, and STOP must reach every simulated transport at round completion. MVP
rounds now advance every simulation update through the entire 90-second round,
instead of jumping from the first 30 seconds to the deadline. The ordinary simulator
track and its configured speeds are software test conditions, not hardware tuning.
Physical multi-car behavior and actual phone sensor inputs remain open gates.

## First operator-confirmed SDK track discovery — 13 November 2026

Groundshock, operator-identified, firmware 11866, on the operator's ordinary
closed circuit. Fast & Furious initialization completed but a 300 mm/s scan
produced no positions/transitions, timed out after five seconds, and the operator
reported no physical movement. The first car's green LED is explicitly commanded
by Slipstream; it is not evidence of the active firmware driving mode.

Reconnected the same car with **Classic SDK connection**, battery 4.09 V. With
calibration blank and the requested speed ceiling still 300 mm/s, scanning began
at 07:39:37 America/Chicago and completed at 07:40:10. The UI reported **11 pieces,
4.88 m, 45 position messages and 22 transitions**. Automatic STOP was logged at
completion; the operator explicitly confirmed: “it is stopped and it mapped
correctly.” STOP was also reasserted at 07:40:15. This is one successful physical
scan and observed stop, not repeatability or multi-car acceptance.

One displayed speed sample was 372 mm/s despite a 300 mm/s request (others observed:
291, 293, 320 and 296). Do not equate the command ceiling with a physically measured
speed bound. No external speed measurement exists. The last speed report remained
296 mm/s with an increasing age after stopping, while the operator confirmed stop;
stale speed display must not be interpreted as ongoing motion.

The active browser recording contains both profile attempts, with 144 captured
messages at export request and operator notes. Save trace was invoked; the exported
file has not yet been retrieved and independently replayed by the agent. No raw
trace fixture is claimed for this run. Steering, repeatable discovery, phone/iPad
controls, scored physical rounds and 2–4 car operation remain open. The F&F app
profile remains unresolved; SDK success applies only to this observed car/firmware
and track, and does not establish MXT or special-tile compatibility.
