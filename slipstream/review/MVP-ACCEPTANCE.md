# Slipstream classroom MVP acceptance

Status: **in progress, not hardware accepted**. Updated 12 November 2026.

The first supported game is the existing 90-second **Beat your best** round, for
one through four cars with human or CPU drivers. Additional modes remain available
but are not prerequisites for MVP acceptance. This choice does not waive any
car-count, client, scanning or safety requirement.

## Evidence and remaining gates

| Requirement | Current evidence | Acceptance still required |
|---|---|---|
| Repeatable server startup | `platform/slipstream-launcher.test.mjs`: concurrent start, reuse, restart, secret permissions, foreign-port refusal, live-only routes | Configured Codespace stop/start and rebuild exercise |
| Public HTTPS client URL | 12 Nov: `gh codespace ports` reports public; anonymous `/slipstream/` returns 200, `/api/health` returns 404 | QR join from actual phone/iPad on classroom network; repeat after restart |
| Laptop owns Bluetooth | Existing host transport and native startup contract tests; prior cars connected | Identify each actual model/firmware accurately; stable concurrent connections for 1–4 cars |
| Guided connect/calibrate/scan/play | Host-handler tests cover selected scan car, clear-track confirmation, countdown and other cars staying stopped | Successful repeatable scan with observed physical movement and complete telemetry; calibration remains optional, experimental |
| Accurate track | Decoder and topology tests; unsupported special pieces remain quarantined | Compare scanned order, direction and closure with the built track; no unsupported piece accepted as verified |
| Browser, phone and iPad human controls | Browser handler, relay and phone safety tests | Physical throttle/steer/neutral/STOP on each client; tilt permissions/calibration; visual fallback when haptics unavailable |
| 1–4 human/CPU participants | `host.test.mjs` runs full rounds and stops at deadline for 1, 2, 3, 4 simulated cars with mixed drivers | Physical rounds at every count, including all-human, all-CPU and mixed configurations |
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
