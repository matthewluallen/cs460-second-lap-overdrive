# Computer-driver hardware trials — 13 November 2026

The operator requested repeated laps, left/right changes and faster straights/slower curves using the existing race Computer driver. Build `41c1b54` was loaded in SDK mode with a 300 mm/s ceiling and the saved 11-piece track. Power Zone 57 still blocks scored rounds, so these used Computer Free drive with the normal countdown and safety stops.

## Two incomplete attempts

The first attempt requested 200 mm/s while acquiring position. Its first fresh usable straight triggered speed 300, SET_OFFSET −31.5 and CHANGE_LANE wire target +22.5, ID 1, in the same queue cycle. A cancellation-state report (0x41, ID 0x80, horizontal speed 0, forward speed 228) arrived 97 ms later; STOP followed in the same recorder millisecond. The operator had walked away and could not confirm its motion then. Before the retry they returned and confirmed physically stopped on the clear track.

The retry stayed on the same connection so the next request naturally used ID 2. This again combined speed 200→300 with reference −31.5 and a lane request (wire target −22.5). A cancellation-state report arrived 104 ms later and the recorded STOP write followed 3 ms after that. The operator confirmed **“Stopped on track; sideways movement.”** The operator subsequently clarified: **“the sideways movement was the start of changing lanes but not a completion.”** This establishes partial lateral motion, not completed alternating lanes or three laps.

The cumulative recording is `fixtures/groundshock-sdk-computer-lanes-cancelled.json`, originally downloaded as `slipstream-trace-2026-11-13T17-01-55-854Z.json`. It contains 68 events, zero dropped. The first-attempt export was `slipstream-trace-2026-11-13T16-59-51-092Z.json`; the cumulative fixture includes it. Existing ACK 1/1 precedes both new requests. Thus an ACK of 1 is retained evidence, not acceptance of the new command. ID 2 also cancelled; ID reuse is not sufficient to explain the problem.

Both fresh printed-code readings put the car at +31.5 mm left. The requested nominal user targets were −22.5 then +22.5: displacements −54 and −9 mm respectively. Alternating target values after a rejected request did not imply alternating physical directions. The UI showed one map wrap during the retry; this is not proof of a full validated race lap.

## Original-app comparison

Read-only inspection of the existing F&F native export (`steering-audit.c`, local proprietary artifact) found:

- `ProcessLaneChangeUpdate` at 0071bbd8 treats the high bit with near-zero sideways speed as cancellation before checking ordinary sequence equality.
- `IsMoreOrAsRecentThanLastLaneChangeID` at 007bf600 treats high-bit status IDs specially. Low bits of 0x80 are not sufficient reason to dismiss it as an old command 0.
- `Vehicle::ChangeSpeed` at 007a8900 compares the requested speed with a native 0.3 m/s threshold and cancels below it. The literal was independently read from `libDriveEngine.so` at file offset 0x798aec. This is host-app logic, not proof of firmware's internal threshold.

We retain the cancellation STOP. Whether the reports identify the current request, retained state or an internally cancelled action remains unresolved. In both failed attempts speed and lane were queued together while the reported forward speed was 228; the earlier physically successful manual left request followed about ten seconds at requested 300. This motivates waiting for speed confirmation and a subsequent optical reading before CPU steering. It does not establish causation or original-app parity.

## Software follow-up

The Computer planner must defer automatic steering until its requested speed and acceleration are unchanged, a matching current speed reply is received, and a newer valid optical position supports the same safe straight geometry and reports at least min(requested speed, 300) mm/s. A matching speed reply remains current while that command is unchanged; it is not required to repeat periodically. Waiting must not consume a lane encounter or flip the alternating target. Manual control packet format, curve caps, STOP, pit recovery and watchdogs remain unchanged. The simulator must emit the supported speed-reply layout instead of bypassing this gate.

Repeated autonomous laps and completed left/right steering remain unaccepted until another observed physical result. Scored rounds and attacks on Power Zone 57 remain blocked.

The 0x36 speed reply has no sequence number. Timestamp ordering alone cannot distinguish an arbitrarily delayed duplicate reply; the later optical speed and geometry check provides separate movement evidence. This is still not a firmware acknowledgement protocol proof.

Software verification: full Node suite **620 passed**, including 12 CPU policy tests, three cancellation-trace checks and a simulator speed-reply test. The new sequencing gate has not yet passed hardware acceptance.

## Speed-confirmation build: stopped before steering

Build `90538af` connected Groundshock in SDK mode at 3735 mV, with the same mapped circuit and ceiling 300. The operator confirmed **stopped on track; moved forward normally** after the trial. No lane or offset write occurred: the new steering gate was never exercised. The requested acquisition/curve speed was 200. Position piece 39/code 17 arrived at recorder time23191, followed by transition23460. The next transition arrived at25576, a2116 ms gap; the watchdog marker was25489 (2029 ms after the previous transition), and the STOP write completed at25576,87 ms after that marker. The following speed report requested0 but still reported236, so only the operator confirms the physical stop. Fixture: `groundshock-sdk-cpu-slow-curve-timeout.json` (98events,0dropped).

The two-second watchdog remains unchanged. The CPU geometry speed cap is adjusted to permit the demonstrated300 mm/s pace on curves when the selected ceiling is300. At ceiling400, ordinary straights permit400 and other geometry permits300; above450 the two-thirds ratio remains. This is a ceiling, not an override of mission speeds, braking, battle slowdowns or operator limits. At ceiling300 the first acceptance target is constant-speed Computer laps with completed steering; speed variation is a subsequent trial. This one gap does not establish a universal minimum speed or validate every lane/track.

Cruise-cap follow-up verification: **621 Node tests passed** on Node22. Physical retest of the300 mm/s CPU pace remains pending.

## Steady300 trial: partial lane change, cancellation persists

Build `77825b6` was loaded with SDK Groundshock and a fresh3709 mV battery reading. The Computer driver requested300 at26565 and received speed acceptance26611. A much later fresh position at40112 on piece39/code18 reported314 mm/s. SET_OFFSET −13.5 and lane wire target+22.5/ID1 followed at40125. Thus the new speed/optical gate was exercised, with no simultaneous acceleration change. The cancellation-state reply arrived40308 (183 ms later), and STOP completed40309 (1 ms later). No offset correction was written after the lane request. Subsequent transition41042 reported received/executed1/1 and offset≈+8.676; these are processing/lateral-state evidence, not completed lane accuracy. The operator confirms **stopped on track; lane change only began**. Fixture: `groundshock-sdk-cpu-steady-speed-cancelled.json` (56events,0dropped).

Steady speed therefore does not eliminate the cancellation. The direct native handler calls `VehicleState::CancelLaneChange(true)`007bd492 (clear lateral intention/state) and `LaneChangeConfirmedComplete`007bd200 (completion flag/direction), then records horizontal and forward measurements. Neither of those bodies directly sends a forward-speed STOP. Downstream planner effects remain distinct; this is not proof that the entire original app always continues driving. Slipstream currently turns any moving lane cancellation into a shared-pit forward STOP, which occurred1 ms after the event here and may interrupt an already-started maneuver.

The operator has been asked for a product decision before changing that stop policy: a single explicitly supervised comparison at ceiling300 could clear and lock further steering on cancellation while allowing forward driving, retaining manual STOP, off-track, telemetry, link and other pit protections. Until authorized and implemented, the cancellation pit remains unchanged. No completed repeated lanes, three-lap run, varying-speed physical race or attack acceptance is claimed.

## Operator-authorized comparison

The operator answered **“Allow this supervised comparison”** to the specific proposal to keep forward driving (ceiling300) after a lane cancellation, clear and lock further steering, and retain manual STOP/off-track/telemetry-loss/link-fault protections. A separate **Supervised · cancellation comparison** control makes this an explicit one-run exception. Its three-second countdown is cancellable; it requires one stopped Computer-driven car, a complete identified map, initialized connection, a fresh battery sample and no charging/low-battery status. It is unscored and does not bypass the Power Zone scoring restriction. An alarm explicitly distinguishes continued forward driving from stopping. All stopping paths end the exception; it is not saved or restored on reconnect. No new test result is implied by authorization or software tests.

Comparison implementation verification before the trial: **631 Node tests passed** on Node22, including seven comparison/fault/queue tests and two host countdown/UI tests. Normal scan and recorded-scan regressions passed.

## Comparison attempt: physical departure before any lane command

Build `ae3012b` ran the approved comparison on 13 November. The operator confirmed a printed lane, clear track and supervision after startup status reported `onTrack:false`. Battery was freshly recharged to4160 mV, compared with3709 mV in the previous run; this was not a strict single-variable reproduction. After STOP the operator confirmed **“Stopped; it left the track”**, then reported that the map marker showed a different location and that they had placed the car at start/finish. The car was disconnected after physical-stop confirmation. No repeat movement was attempted.

The original428-event export is retained byte-for-byte as `fixtures/groundshock-sdk-comparison-offtrack.json` (SHA256 `719ce3f4f2ed814cb2f6883b88f1428560dc7d0432a8003bf85c4b381f45fee8`), downloaded as `slipstream-trace-2026-11-13T17-58-59-395Z.json`. Zero events dropped. Diagnostics were sampled at export after recording stopped, so cumulative diagnostic counters need not equal counts in the frozen event list.

| Recorder time, ms | Observed evidence |
|---|---|
|59291|Only nonzero speed write:300 mm/s.|
|59972|Status reports on track.|
|61622|First optical position: curve18/code9, forward,297 mm/s; firmware offset sentinel654321.|
|61623|Only offset write:−34.7 mm, derived from the curve’s printed code.|
|63328,64010|Power Zone57, reverse codes25 and24.|
|65584|Last optical position: straight39/code13, forward,239 mm/s.|
|66843,68853,70128|Transition reports without a further printed position.|
|70865|Status reports off track.|
|71313|Firmware recovery entry.|
|71553,71554|Delocalized message, then completed STOP write1 ms later. This is not measured physical braking latency.|

There is **no CHANGE_LANE**, no lane-cancellation response, no start/finish33/34 position, and no0x35/0x37 write in the capture. The approved cancellation exception was therefore not exercised; it cannot explain this incident through its cancellation branch. One auto-calibration write occurred. Its presence is not proof of a bad value or a physical cause.

Replaying against the previously accepted11-piece map resolves the first duplicated18 only when57 is observed, then places39 at index3. Three transition-only reports predict indices4→5→6. The original trace contains a matching map-validation summary but not the actual loaded sequence, so exact map identity is an inference. There is no evidence here proving the map was wrong before loss. There is a reproduced display defect after loss: Localizer retained an on-road point while `located:false`, and both renderers drew it. Transitions also refreshed the old optical reference’s age. Negative on-track status and recovery entry did not invalidate it until the later delocalization packet.

## Reference and display repair

Both renderers now hide invalid, ambiguous, stale or disconnected car poses and their anchored effects. Optical freshness is measured from the last position code, not extended by transition reports. Expired candidate history cannot disambiguate a later repeated road ID, and an unexpected road code cannot manufacture a lap before re-localization. Off-track status, recovery entry, invalid codes and disconnection invalidate location immediately. This invalidation does not itself change the ordinary forward STOP policy. The UI exposes the last code, direction, age and whether it is confirmed, estimated, ambiguous, stale or unknown. Simulator placement is explicitly labeled. New exports include the complete loaded map and localization evidence.

At the operator’s request, the next **supervised cancellation comparison** begins with reference acquisition. It resets prior localization and locks lane, turn and offset commands before moving. The first valid optical observation must uniquely identify a mapped start/finish section; a distinct, consistent subsequent optical observation in the same direction is required before Computer steering becomes eligible. An unexpected first piece, inconsistent follow-up, intervening loss/recovery, expired optical evidence or five-second reference-acquisition timeout stops and opens the pit. The ordinary speed-reply/straight-geometry steering checks still apply afterward. This acquisition timeout does not limit the duration of confirmed driving. Normal scan and ordinary driving policy remain separate; no new firmware packet is introduced. Late position messages while safety-stopped or initializing can update observations but no longer trigger automatic calibration or sign learning.

This is a host test precondition, **not full original-app parity or hardware acceptance**. The native app’s `ProcessPositionUpdate`0071bdc0 calls `FindUniqueBiDirectionalMatchOnLatestTrackMapperSegmentWithEncoders`008773e4 before accepting an unlocalized pose. Its loss handler0071e178 clears localization and changes the off-road representation. These support explicit uncertainty; they do not prove our simplified model or explain the physical departure. Proprietary decompiled artifacts remain local.

Before another physical trial, place the sensor before the printed start/finish codes, supervise forward-only acquisition and compare the displayed optical reference with physical placement. A mismatch ends that attempt; do not repeat it unchanged. Repeated safe laps, completed right steering, attacks on special tiles and the physical cause of this departure remain open. The new acquisition procedure has not run on hardware.

Final software verification: Node22.23.5, npm11.9.0, Python3.14.7; **653/653 Node tests**, **38 Python tests**, CWE regression checks and dependency lab pass; npm audit reports **0 vulnerabilities**. This includes13 comparison tests,8 optical-reference regressions,4 renderer regressions,3 new hardware-trace checks and the full existing mode/car-count matrix. Browser simulator review confirmed the 3D scene hides stale cars while displaying the reason. No additional physical trial was run and no proprietary decompiled files were published.

## Recharged reconnect: recovery reports before any motion

After that software repair, the operator returned charged Groundshock, selected it and confirmed readiness for the reference-first comparison. On `79f9350` its SDK startup repeatedly emitted recovery/off-track messages with no nonzero speed command. No driving test was started in that connection. The680-event recording is retained verbatim as `fixtures/groundshock-sdk-stationary-recovery-loop.json`, from `slipstream-trace-2026-11-13T18-23-28-267Z.json`; SHA256 `8aa09cc878694a132bf1948b04b028bb92278e6486c75038b2e78f53eb3ae4ca`.

It contains222 recovery-entry and222 delocalized reports,224 exact STOP writes, and no position, transition, lane, offset or nonzero speed command. Status was off-track at3307 ms, SDK mode was written3321, the first recovery arrived3574 before version11866 arrived3692, and the first delocalized event3632 was followed by STOP3633. Each delocalized event's next recorded transmission is STOP, within0–43 ms (write completion, not physical braking time). Battery samples are4158 and4145 mV. Later export diagnostics show larger counts than the frozen event list. The car was disconnected and the operator explicitly confirmed a full power cycle, stopped before start/finish.

The native full-stop lifecycle sends SkipAutoDriveInDeloc(true) in `EnterFullStopState`007a9ce8; `ExitFullStopState`007a9d28 and SDK `StartDriving`00799ca4 send false. Serializers006ac6ec/006ac76c establish `02 35 01` / `02 35 00`; our SDK initialization sends neither. This is an established lifecycle difference, not evidence of11866 defaults or proof of this fault's cause. Recovery-success logic may execute the last driving intention, so isolated recovery commands must not be copied without a complete reviewed stop/rearm policy. No0x35 change was made.

## Power-cycle comparison: unexpected first piece, stopped on track

The operator selected the power-cycled Groundshock and the same approved comparison ran on `79f9350`, SDK11866, ceiling300, with a refreshed battery reading around4.20 V. Startup contained no recovery/delocalized loop. Initial `onTrack:false` alone was present; it is not optical placement evidence. This capture includes the full loaded map:33F,18F,57R,39F,20F,17F,17R,23F,36F,18F,34F. Thus18 occurs twice, at indices1 and9.

Recording `fixtures/groundshock-sdk-start-reference-mismatch.json`, from `slipstream-trace-2026-11-13T18-27-04-919Z.json`, contains32 events, zero dropped. The sole motion write was300 at107009 ms; on-track status followed107393, transition107994, and the first position108635 reported18/code8, forward,301 mm/s, unknown-offset sentinel654321 and lane ACKs255/255. The reference gate sent STOP108636:1 ms after the position and1627 ms after the motion write. The following speed reply desired0/actual306 is not physical-stop proof. The operator separately confirmed **“Stopped; stayed on track.”**

No lane or offset command was sent, and no0x43/0x2b recovery/delocalization occurred in this second capture. The contrast supports investigating retained recovery state, but does not prove a firmware cause. The start/finish precondition correctly failed; Computer steering and cancellation-continuation were never exercised. No start/finish code was observed, and the map marker remained hidden rather than choosing one of the two curve18 instances.

The next step is to reconcile actual placement, the sensor's approach to printed codes, and readable lane with the first reported curve. Placing a car at the visible line does not guarantee it crosses a complete start/finish code row. This is a setup hypothesis, not a finding that the operator placed it incorrectly or that the tables are correct. Do not repeat the unchanged comparison or bypass the new reference gate. Completed reference acquisition, repeated laps and completed autonomous steering remain unaccepted.

Evidence-only follow-up verification: **657/657 Node tests pass**, including the four new startup/reference-trace checks. No runtime code or dependencies changed after `79f9350`; the earlier38 Python checks, CWE/dependency checks and clean audit remain the last run for those unchanged components. The second fixture is also byte-identical to its download (SHA256 `ec4337b21927751386e51a7347bbce88dc813551e7b3a2901e14d4d09400110f`).
