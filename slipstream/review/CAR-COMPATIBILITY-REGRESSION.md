# Car compatibility regression — 12 November 2026

## Result and limits

The physical-car scan failure is **not resolved or hardware-validated**. This pass
repairs a reproducible missing firmware-initialization check and identifies a
specific startup policy mismatch. The operator subsequently approved the scan-only
allowance described below, which is now implemented. No car commands,
APK execution, firmware execution, deployment, or access changes were performed.

The operator confirmed turning Groundshock off to leave. Its later disconnect is
not evidence of spontaneous battery failure. Whether it physically moved during
the five-second scan remains unknown.

## Original-app evidence

Artifact: F&F build 403 `libDriveEngine.so`, SHA-256
`0eef63a8135f4cfe7bb16b4effa1f720192cc2c1f340d0c8c8f0c2b9835f3d7f`.
Fresh read-only Ghidra exports: `ExportScanCompatibility.java`, 134 selected entries,
134 completed, zero failed. These include linkage stubs and getters; this is not a
full firmware analysis. Decompiled proprietary output stays outside the repository.
`InspectStartupAssembly.java` supplies assembly checks where inferred C arguments
are unreliable (notably ARM float calling conventions).

| Finding | Evidence | Action |
| --- | --- | --- |
| Ping replies alone do not complete native startup | `VehicleInitSequence::IsComplete` 007b01b8 requires final phase AND vehicle confirmation flag; `ProcessIncomingMessage` 007b5310 case 0x23 sets that flag | Require car-init confirmation before releasing initialization gate; timeout faults/closes |
| Groundshock `03 23 ff ff` is not an error code | `CarMsgCarInitComplete` constructor 006b8638, serializer 006b86c0, ToString 006b86f0: u16 **upgrades** | Exact-length decode and retain; never treat as position or refresh telemetry watchdog |
| 0x50 is not demonstrated to be missing normal startup | Parade OnBegin 006ed1cc sends four true flags, OnRemoved 006ed3cc sends four false flags; names identify TransitionUpdate2, steering diagnostics, each barrier code, cycle timing | Do not add speculative telemetry-enable commands |
| Our zero delocalized-speed limit differs from native default | VehicleConfig constructor 007acd40 stores 0x3ecccccd (0.4) at +0x54, with optional configuration override; GetMaxDelocSpeed 007af5d4 reads it. Vehicle constructor 007a72a0 copies into state. SendSetMaxDelocSpeed 007b8d30 loads state +0x160. Constructor 006ac3d4 multiplies by 1000 (literal at 006ac410) and serializes u16 | Native default is 400 mm/s, subject to configuration. Scan-only 300 mm/s allowance subsequently approved; zero outside bootstrap |

The zero limit is a plausible bootstrap obstruction: an initially unlocalized car
may need to move to read its first code. This is an inference, not proof of the
observed no-position failure. App and firmware are different artifacts; inspecting
the APK does not verify the firmware's implementation of that limit.

## Approved compatibility change (implemented after this review)

The operator approved this change in the follow-up. Allow **only an explicitly started, supervised scan** to set an unlocalized-speed
ceiling of 300 mm/s before issuing scan speed. Keep zero during connection and
ordinary driving. Restore zero on first valid position, cancellation, timeout,
STOP, shared pit, or scan completion. Retain the three-second countdown, five-second
first-position timeout, two-second subsequent gap, 45-second/lap scan budgets and
special-piece quarantine. Do not auto-retry a failed scan.

This changes the existing firmware-side zero-speed policy; the operator's earlier
review instructions prohibit weakening stop behavior and require asking for product
decisions. The operator explicitly approved implementing this changed movement policy.
Host timing is not a firmware dead-man: browser failure or link loss can prevent
restoration of zero. No firmware-enforced five-second timeout has been demonstrated.
No physical verification of the new allowance has occurred.

## Reproductions and regression

Before repair: 4 initialization tests passed, 2 new tests failed (ping-only startup
was accepted; native confirmation was discarded). After repair both pass.

`native-startup-contract.test.mjs` is an independent byte-level peer that imports
neither the simulator nor the outgoing encoder or initialization-plan generator.
Its 42-case bounded matrix enumerates six dropped reply barriers plus no drop,
three confirmation timings, and two STOP-latch states. It checks no motion/steering
writes during initialization and failure on incomplete handshakes. This is bounded
regression testing, **not formal equivalence to original firmware** or proof that a
fake BLE peripheral operates with the original Android app. No such run occurred.

Final regression: Node v22.23.5, Python 3.14.7; 488 Node tests and 38 Python tests
pass. CWE lab and dependency lab pass; npm audit reports zero vulnerabilities.
Existing hardware replays and gameplay/fault matrices remain in the passing suite.

Still open: no usable position frames on the captured app-profile scan; short MXT
transition/speed formats; actual initial-localization behavior; real stopping,
steering, track closure and special-tile behavior. A successful supervised real-car
scan remains the acceptance criterion, not a green simulator suite.

## Scan-bootstrap implementation follow-up

Only `Game.startScan` enables the allowance, on an initialized F&F-profile car.
The existing UI still requires track-clear confirmation and the three-second
countdown. F&F scan commands are capped at 300 mm/s even if the speed setting is
higher. The first decoded position queues zero; unsupported short transitions do
not count. STOP cancels pending allowance/motion and prioritizes STOP then zero.
Deliberate disconnect and settled write failure also attempt zero after STOP.
If a GATT operation hangs or the link is lost, do not overlap writes or pretend
restoration succeeded: fault/close and retain the physical-stop limitation.

The restoration obligation survives first-position receipt so that disconnect
cannot discard a queued reset and leave the car configured for bootstrap motion.
Regression tests include an in-flight allowance interrupted by STOP, a pending
reset interrupted by disconnect, connection failure and loss, off-track, watchdog,
pit, cancellation and explicit zero speed. No APK/firmware execution or hardware
validation is claimed.

Follow-up validation: all 501 Node tests pass, including 13 scan-bootstrap tests.
