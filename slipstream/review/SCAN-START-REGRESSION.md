# Physical scan startup regression — 13 November 2026

## Reproduction and evidence

The operator requested a new scan, then confirmed **stopped; moved forward without shifting**. No map was built and no optical position/transition arrived. Original cumulative 69-event capture is `../fixtures/groundshock-sdk-scan-start-cancelled.json`; earlier attempts in it are not additional scans. Its operatorNotes describe the first pulse only; this report records the later observations separately.

Successful scan fixture `groundshock-sdk-scan-steering.json`, SDK connection index1:
- 273018 ms: bare lane request, legacy ID0, then speed300.
- 273055 ms: lane cancellation (high-bit ID0x80, zero horizontal speed).
- 273865 ms: first transition; 274645 ms: first position (1627 ms after motion).
- The old host continued despite cancellation and later mapped the circuit; user confirmed it was correct.

New scan, SDK firmware11866, fresh battery3974 mV:
- 987050 ms: STOP, offset0, lane target−22.5/sideways350/ID1, speed300.
- 987118 ms: cancellation0x80, then STOP writes (68 ms after motion write completion).
- 987176 ms: desired speed300 response, then 987392 ms: desired0/actual0.
- Collision notifications followed STOP. No position or transition.

A separately authorized repeated diagnostic in this cumulative capture also triggered collision: speed150 at941336 ms, collision941693 ms, STOP941694 ms. Operator confirmed it stopped and stayed on track without impact. This is the second collision-latched short pulse, not a scan result.

## Diagnosis

The successful scan ALSO received startup cancellation. The new moving-cancellation shared-pit rule stops before the optical acquisition that the older run permitted. Therefore adding the SDK offset preamble is not a sufficient repair: the new trace includes it and still cancels. Command IDs, initialization history, battery and placement differ; this evidence does not isolate firmware causes or establish that reversing the offset change restores steering.

The unlocalized scan's automatic lane request is avoidable. Native `VehicleManager::BeginTrackDetection`007b24b0 directly sends recovery policy and requests speed, with no direct lane call in that function. Downstream arbitration and event listeners are not fully reconstructed; do not claim whole-app equivalence from this one function.

## Repair and boundaries

Physical scan startup no longer calls steerTo. It follows the operator-placed lane and retains its speed ceiling, first-position/gap watchdogs, scan/lap budgets, shared pit, and cancellation stop. Explicit optional operator calibration still precedes speed; default scanning sends neither lane nor offset until actual telemetry warrants calibration. This avoids the speculative lateral command; it does not suppress any incoming cancellation. A delayed cancellation still stops the scan.

Simulator-only lane placement is retained explicitly because its intersection model requires a readable code strip. It is not evidence of hardware placement or app equivalence. Real cars must be placed on a printed lane; no automatic lateral repositioning is promised.

Three new/updated expectations failed before the repair (default SDK scan, default F&F scan, optional calibration without lane). Regressions assert absence of unlocalized steering, bounded speed, preservation of cancellation stop, and calibration ordering. Full physical scan acceptance remains pending. No new 0x35 policy or default speed changes were made.

Validation: 591 Node tests and 38 Python tests pass; CWE regression checks and dependency lab pass; npm audit reports zero vulnerabilities. Runtime change is limited to scan startup steering; physical acceptance pending.

## Hardware retest accepted on this layout — 10:26 America/Chicago

Build 08fe678 was installed in Codespaces and reloaded. Operator selected Groundshock, confirmed clear printed-lane placement and supervised readiness. SDK firmware 11866 initialized; initial battery 4162 mV, no charging/low-battery flag. No power-cycle claim is made. Original startup-inclusive trace: `../fixtures/groundshock-sdk-repaired-scan.json` (63 events, zero dropped). The car metadata was captured before the Groundshock label was selected; diagnostics/operator observation record that identification.

| Relative recorder time | Observed event |
| --- | --- |
| 22328 ms | Speed 300 write completed; no startup lane or offset request |
| 23146 ms | First actual position, piece 33: 818 ms after speed write |
| 23146 ms, after that receive event | Code-derived offset −22.5 write completed |
| 39114 ms | Circuit closure evidence arrived |
| 39116 ms | Map accepted and STOP writes completed, 16788 ms after speed write |
| 39167 ms | Firmware speed reply: desired 0, actual field 300 (not physical stop proof) |

Result: **11 pieces, approximately 4.88 m; 24 positions, 12 transitions; zero inferred pieces; one start/finish; geometric closure; special piece 57 at index 2**. Piece IDs 18 and 17 each occur twice. Operator explicitly confirmed **physically stopped; stayed on track; displayed map matches the layout**. This is physical acceptance of one scan on this circuit, not repeatability across arbitrary layouts or full original-app parity.

Four collision notifications remain in this capture (including stationary initialization, during travel and after STOP). No lane-change command/cancellation, off-road or recovery message occurred. Scan collision handling was unchanged: raw 0x4d remains diagnostic evidence during scans; the separate bounded-drive collision latch remains enabled. Do not attribute the successful scan to disabling a safety handler.

Power Zone 57 remains unverified for attacks/scored rounds. The map checks retain that warning. Mapping installs a fresh localizer, so the stopped car still needs a new position to establish race location. Steering, multi-car races, attacks and autonomous host-loss stopping are not accepted by this test.

The new offline replay checks use the real decoder and mapper and preserve the observed piece order, absence of inferred geometry, and packet order. They guard against software regressions; physical stop/map agreement comes from the operator confirmation above.

Post-retest verification: 594 Node tests pass, including three new repaired-scan replay regressions. No runtime code changed in this evidence commit; preceding Python38/CWE/dependency/audit results remain the build08fe678 baseline.
