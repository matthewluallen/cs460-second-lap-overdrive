# Groundshock steering investigation — corrected evidence

13 November 2026. The filename is historical: **no single firmware root cause has been established**. Read [COMPUTER-DRIVER-HARDWARE.md](COMPUTER-DRIVER-HARDWARE.md) for the chronological hardware evidence and [STEERING-AGENT-HANDOFF.md](STEERING-AGENT-HANDOFF.md) for current investigation scope.

## What the recordings establish

- Earlier SDK steering captures sent a bare CHANGE_LANE0x25 and received a cancellation-state0x41 response. They establish that sequence and outcome, not why firmware cancelled.
- The published SDK example sends SET_OFFSET0x2c with zero before a **relative** lane request. Slipstream later added an SDK-only reference/target pair using its printed-code-derived lateral estimate. That is an experimental **absolute-frame** strategy, not an independently measured current offset or an exact copy of the example.
- Build08fe678 produced one operator-confirmed left shift. The recording includes an offset+22.5, target−22.5/ID1, an uncancelled update and later received/executed IDs1/1. Printed codes also changed lateral position. This demonstrates one successful maneuver, not general steering reliability.
- Later Computer requests still cancelled after motion had begun, including a request made after settled speed and fresh optical evidence. Duplicate IDs or simultaneous acceleration therefore do not explain every failure.
- The latest reference-spin recording contains speed and battery writes only: no offset, lane or turn request. Its operator-observed spinning cannot be attributed to a new host steering packet during that capture. Prior firmware state, calibration history and physical tracking remain unresolved.

The paired-reference hypothesis was neither a universal firmware precondition nor a sufficient fix. ACK fields and GATT write completion are not proof of physical lane completion.

## Independently checked source evidence

Source: F&F build403 `libDriveEngine.so`, SHA256
`0eef63a8135f4cfe7bb16b4effa1f720192cc2c1f340d0c8c8f0c2b9835f3d7f`.
SDK revision: `410352617b8660338746a6bb2b2dd173afb1b91a`.
Addresses below use Ghidra's image base0x10000; LLVM objdump ELF addresses are0x10000 lower. Critical calls, constants and branches were checked in Thumb instructions because the decompiler omitted or misrepresented some soft-float arguments. These are host-app observations, not recovered firmware source.

| Evidence | Supported interpretation |
|---|---|
| SDK protocol.h; vehicle-tool change-lane action | Zero establishes a relative lane frame in that example. The set-speed action sends0x24 alone. No universal requirement that0x2c precede ordinary forward driving is established. |
| ConvertOffsetFromRoadCenter_mm2m006ab828 / m2mm006ab7f4 | Ordinary values convert mm↔m; values greater than500000 map to unknown sentinel654321. Testing only exact equality to654321 is narrower than native classification. |
| CarMsgChangeLane006ab970 | Native lane speed/acceleration/target arguments are converted from meters to millimeters for the wire. |
| Vehicle::ChangeLane007a8b78 | Native target selection uses drivable-section lane geometry and direction. It is not the SDK example's relative zero-reference routine. |
| IncrementLaneChangeID007bd20e | Host request IDs increment and wrap with0x7f. |
| IsMoreOrAsRecentThanLastLaneChangeID007bf600 |0xFF is not recent; other high-bit IDs receive special treatment; ordinary IDs use wrap-aware comparison. Low seven bits of0x80 must not be interpreted as an ordinary old request0. |
| ProcessLaneChangeUpdate0071bbd8 | Near-zero horizontal motion plus the high bit triggers lateral cancellation handling. The native threshold is0.00001m/s; with integer mm/s wire speeds, the understood layout's stationary case is zero. |
| CheckForDroppedCommand007197d8 | It tests the **executed-ID argument**, the host's saved/current request ID, elapsed time and retry budget. The received-ID argument is logged; this body does not establish that recvID0xFF means rejection because an offset was undeclared. |
| ProcessPositionUpdate0071bdc0; caller0071b3ae–0071b3cc | Successful localization can supply an output flag used by the same message's correction path. The caller's final pointer argument is visible in assembly but absent from Ghidra's rendered call. |
| Correction gate0071b5a2–0071b60a | Correction also depends on direction, scan state and a0.15-second interval. Finite correction uses0x34 adjustment; unknown host-offset handling at0071b62e–0071b63a sends0x2c with654321. This does not prove an unconditional finite0x2c after the first optical code. |
| Full-stop007a9ce8 / exit007a9d28 | Native pairs SkipAutoDriveInDeloc0x35 true/false. Slipstream's different lifecycle remains an interoperability question; isolated packet injection is not a demonstrated repair. |

## Confirmed host differences and repairs

The reference-acquisition comparison locks offset commands along with lane/turn commands. Both confirming optical packets pass through Car's calibration handler while locked; Game unlocks afterward. No later position arrived in the last spin capture, so its firmware offset stayed unknown. The successful scan sent a finite calibration after its first code. This is a reproduced sequence difference, **not a controlled comparison or proof of causation**. The recordings also differ in starting section and connection history.

A separate extraction defect was reproduced: averaging curve-bit x/y positions before measuring their radius produced an inward chord-centroid bias. The extractor now measures each point's radial lateral offset before averaging. This corrects228 lateral values on ordinary curve IDs17,18,20,23,24,27 by2.3–3.7mm. For example, curve18/code9 changes34.7→31.5mm. Progress, track lengths, noncurve geometry and special-piece restrictions are unchanged. Independent synthetic-circle and lane-record tests fail before and pass after the repair. This numerical defect did not cause the latest straight34-only capture; no calibration was sent in that run.

## Historical implementation record

Commit5b3816d added the SDK-only keyed0x2c→0x25 pair and six queue/order regressions. STOP and cancellation clear both keys. Its563-test result was a software checkpoint, not hardware acceptance. The contemporary claim that an undeclared offset caused firmware rejection was an inference and is withdrawn.

The contemporaneous platform-test failures were a missing declared `three@0.187.0` installation, not evidence of a platform code defect. Later suite counts and physical outcomes are recorded in HANDOFF.md and the hardware report.

## Next acceptance boundary

First recover repeatable forward following using the accepted scan path and a startup-inclusive recording. A forward-only mapped trial must distinguish suppression of lateral intent from suppression of calibration; blanket locking both creates a different sequence. Keep current STOP, arming, pit and watchdog behavior. Investigate offset classification, calibration epochs and connection reuse offline before changing firmware lifecycle behavior.

Only after stable forward laps should left/right completion, repeated Computer steering, races and attacks be accepted. Do not execute the obsolete “repeat one offset-precondition trial” instruction from earlier versions of this report. No hardware movement is authorized by this document alone.
