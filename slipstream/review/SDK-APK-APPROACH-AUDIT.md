# SDK / decompiled-app approach audit — 13 November 2026

Reviewed Slipstream commit `52eb492`. This is an offline review: no car commands,
controller reload, APK execution or firmware execution. Findings below distinguish
reproduced defects, observed compatibility failures and hypotheses.

## Evidence

- Official SDK checkout `410352617b8660338746a6bb2b2dd173afb1b91a`, especially
  `include/ankidrive/protocol.h` and `src/protocol.c`.
  Public sources: https://github.com/anki/drive-sdk and
  https://anki.github.io/drive-sdk/docs/programming-guide .
- F&F build 403 `libDriveEngine.so`, SHA-256
  `0eef63a8135f4cfe7bb16b4effa1f720192cc2c1f340d0c8c8f0c2b9835f3d7f`.
  A fresh read-only Ghidra export selected 25 functions including wrappers, without
  decompilation failure markers. Export hash:
  `0e23880f3c4c90c929806754a8272509bb57d19c5eefebfd40c6a5dd900416b2`.
  Functions of particular relevance: `Vehicle::ChangeLane` 007a8b78,
  `VehicleState::IncrementLaneChangeID` 007bd20e,
  `VehicleState::CancelLaneChange` 007bd492,
  `Localization::CheckForDroppedCommand` 007197d8,
  `Localization::ProcessLaneChangeUpdate` 0071bbd8,
  `Localization::ProcessPositionUpdate` 0071bdc0,
  `VehicleInitSequence::ExecutePhase` 007aff3c and `Update` 007b0080.
  Decompiled ARM signatures have imperfect type recovery; do not treat every
  recovered parameter name/type as authoritative. No proprietary export is added
  to the repository.
- Operator capture `fixtures/groundshock-sdk-scan-steering.json`, SHA-256
  `1feb39b25f81fafaed201357b2eccbc85135e335f766a7a56ca6cac2a42f22b1`.
  Groundshock firmware 11866; same car connected first through F&F, then SDK.

## Findings in priority order

### A1 — P1: unverified piece data still calibrates the physical car

Locations: `car.mjs:169–188`, `track.mjs:15–22`.

`Pieces.get` marks 53/54/57 unverified, and scored rounds reject those pieces.
However, `Pieces.locate` still returns their location table, and `Car.#lane` uses
it as truth for automatic 0x2c offset correction and sign learning. Quarantine is
therefore incomplete: it prevents scoring but not steering-coordinate changes.

Reproduced using the captured 277195 ms position from piece 57: input offset
66.58799743652344 causes an automatic `05 2c 00 00 58 c1` write, setting -13.5 mm.
The exact write also exists in the physical trace at 277195 ms. No actual lateral
movement is implied by this calibration write. This does not prove the -13.5 mm
value is wrong; it proves data declared unverified is nevertheless trusted for
physical control.

Remedy: exclude unverified piece geometry from calibration/sign-learning and
control decisions. Retain raw observations and partial mapping with explicit
uncertainty. Test this against all three special IDs, not only the captured 57.

### A2 — P1: cancelled steering retains an unachieved target

Locations: `car.mjs:153`, `car.mjs:232–241`, `game.mjs:215–217`.

The new cancellation diagnostic only records the reply. `targetLateral` remains
what we requested, and input.lane can remain that target. `steerTo` then deduplicates
an identical request even though the car did not reach it. Another left press
advances from the requested target rather than a confirmed position.

Offline reproduction with the actual 406684 ms cancellation frame:

- requested internal lateral target remains +45 mm after cancellation;
- repeating +45 mm produces zero additional writes;
- the next left nudge advances input.lane to +67.5 mm.

The original app has distinct intended/current/target state and a cancellation
path that clears intended lane-change parameters (`CancelLaneChange` 007bd492).
Our requested-versus-achieved state is conflated. This is a concrete state-management
fault, independent of why the firmware cancelled this particular command.

Remedy: track command outcomes separately; invalidate the cancelled intention and
require a fresh explicit action with trustworthy position. Do not automatically
retry a cancelled movement. Scan-bootstrap cancellation while initially unlocalized
must be distinguished from cancellation of an operator steering request.

### A3 — P1 compatibility: F&F is the default despite a failed hardware path

Locations: `index.html:25`, `initialization.mjs:10–21`.

F&F mode received version, ping and initialization replies but produced no physical
movement or track telemetry. The trace confirms the approved 300 mm/s delocalized
allowance was written before speed, so this failure is not explained by simply
forgetting to send that allowance. SDK mode on the same car subsequently drove
and mapped the track.

The SDK documents flag 0x01 as required for speed/lane commands in SDK mode. Our
SDK packet enables it correctly. Our app path disables SDK mode and reconstructs
selected native initialization phases. The native phase machine also has an
initial callback and playback/DAS stages not reproduced by this port. Their
necessity for movement is NOT established. Ping is not semantic acknowledgment
of each setting; the 0x23 reply is not proof that driving will work.

Remedy: present SDK as the empirically successful Groundshock path and label F&F
initialization experimental. Do not claim a universal fix for MXT. Repeat SDK
initialization after a supervised cold power cycle: this successful SDK test
followed app-mode configuration, so persisted vehicle state remains a confounder.
Do not raise limits, change modes or add undocumented packets to make replies look
successful without a controlled experiment.

### A4 — P2: firmware command acknowledgment is underused

Locations: `protocol.mjs:105–121`, `car.mjs:237`.

The official 0x27 layout includes last received ID, last executed ID and desired
lane-change speed. The 0x29 layout contains analogous acknowledgment fields and
lane activity. We retain only the executed 0x27 byte under a generic name and omit
most of the remaining fields. Every outgoing lane request uses tag 0.

The original app increments a 7-bit lane-change ID (007bd20e), stores parameters,
compares acknowledgment age, and uses a bounded dropped-command recovery path
(007197d8). Its cancellation path is separate. We cannot correlate successive
intentions to firmware acknowledgment at that level. GATT write completion proves
transport completion, not physical execution.

Remedy: decode the existing ACK fields, expose requested/received/executed/outcome
state, and validate ID behavior per firmware. Copying the app's retry mechanism
wholesale would be unsafe: retries must never cross STOP, pit, driver change or
cancellation. Constant zero tags are also used by the official SDK serializer,
so tag zero alone is NOT established as the cause of this cancellation.

### A5 — P2: lane geometry and sign are assumed too broadly

Locations: `car.mjs:169–188`, `car.mjs:239–241`, `game.mjs:215–217`.

Nudges use a fixed 22.5 mm grid. The native app resolves a target lane through its
current drivable section and direction before converting it to a signed offset
(007a8b78). Our derived code locations are not necessarily selectable driving lanes:
for example, straight-piece code offsets are spaced at 9 mm, while curves differ.
That does not make an arbitrary continuous SDK target invalid, but it means our
UI label "one lane" is not established against the app's lane model.

Sign learning can also flip on one contradictory sample pair; the comparison is
not restricted to the same verified piece/direction or a confirmed lane movement.
These are control-confidence gaps, not evidence that reversing the sign is the fix.
Use verified geometry and movement evidence before sign changes or claims of lane
accuracy. Do not interpret offset calibration as physical steering.

## What was not found to be a packet-format fault

The captured lane command at 406631 ms is a valid SDK-shaped 12-byte packet:
`0b 25 5e 01 e8 03 00 00 34 c2 00 00`.
It requests 350 mm/s lateral speed, 1000 mm/s² lateral acceleration, -45 mm offset,
hop 0, tag 0. The SDK and native serializer agree on these field widths and order.
The reply 53 ms later carries current=target=-13.5, horizontal speed 0 and ID 0x80;
the native stationary-horizontal handler treats the high bit as cancellation.
No offset-calibration write occurs between this command and the subsequent STOP.
Consequently, calibration did not visibly overwrite this particular attempt.

350 mm/s lateral speed at 240 mm/s forward speed is a candidate experiment, not a
proven error. The retained Partydrive implementation uses lower lateral defaults,
but a different application's defaults do not establish firmware requirements.
Do not change speed, sign, hop flag and ID together; that would obscure causality.

The green light is deliberately set by our RGB command, not a connection failure.
The host watchdog and STOP writes worked as intended in these observations; the
operator confirmed physical stops. This does not prove host-loss safety: a dead
browser cannot send STOP, and firmware-enforced timeout behavior remains unverified.

## Recommended sequence

1. Repair the unverified-data calibration boundary and cancelled-intent state.
2. Expose command/ACK/outcome evidence; preserve raw bytes and timestamps.
3. Make the tested SDK path clear for Groundshock, without claiming MXT support.
4. Cold-start SDK test on ordinary verified pieces, then one bounded lane test
   changing a single parameter if still necessary. Keep current watchdogs and STOP.
5. Only after steering is observed correctly, proceed to physical rounds and
   phone/iPad acceptance. No scored round on piece 57 until its gate is resolved.

Three offline assertions reproduced the cancellation-state behavior and the
unverified-piece calibration write using production code and the actual capture.
The previous implementation baseline has 548 passing Node tests; green tests did
not cover these newly identified control-policy gaps. This review changes no
runtime behavior and does not claim a repaired steering system.
