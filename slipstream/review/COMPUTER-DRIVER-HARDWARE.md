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
