# Collision handling and app compatibility — 13 November 2026

The user requires original-app protocol and state-machine fidelity. Current Slipstream is **not app-equivalent**. Do not use that claim until packet sequences and state transitions have independent evidence. No live commands or safety-policy changes occurred in this review.

## Collision evidence

Read-only Ghidra export `ExportCollisionHandling.java` produced 63 non-thunk BaseStation functions with collision in their names, zero reported decompiler failures. This is targeted symbol coverage, not whole-app or firmware coverage. Proprietary output remains local; see the manifest for hashes.

- Constructors 006b6ee0/006b6f14 and ToString 006b6fb0 confirm 0x4d and two boolean fields: side-on, front/back. Our decoding of `03 4d 01 00` agrees.
- Existing export of `VehicleMessenger::ProcessIncomingMessage`007b5310 groups case0x4d with case0x1b in a break-only branch. That branch falls through to the function epilogue, with no direct stop command. This is a finding about this dispatcher, not proof that no other consumer observes the message.
- `CollisionController::Update`007c30b0 examines vehicle pairs and calls FindCurrentCollisions when vehicle-state conditions hold. `UpdateAfterPositionUpdate`007c3c78 updates collision records from vehicle state. These are distinct from treating every raw collision notification as a physical crash.
- Our diagnostic stops immediately on any collision notification. Our active battle separately applies one point of crash damage to such notifications. Neither policy is demonstrated equivalent to the native dispatcher/planner.
- Hardware batch packet arrived 339 ms after motion; operator saw no impact and confirmed staying on track/stopping. This is a discrepancy, not proof of a false sensor signal. Do not silently discard raw evidence or remove a stop rule.

## Required compatibility ledger

| Area | Original-app evidence | Current difference / next proof |
| --- | --- | --- |
| Operating profile | F&F mode, network and initialization phases | Recent trials used classic SDK. SDK success cannot establish F&F parity. Select and validate one target profile per session. |
| Initialization | Native phase sender/acknowledgment flow | Extra STOPs, explicit SDK-disable, ping barriers and partial app setup; verify exact order, conditions and replies, not merely packet constants. |
| Jump behavior | Vehicle-settings flag is app-configured | Ours forces jump boost off. Recover actual kit/mode setting before claiming parity. |
| Unlocalized motion | App default reviewed as 400 mm/s | Ours initializes zero and permits scan-only 300. This is an explicit motion-policy deviation, not equivalent initialization. |
| Pause/full stop/acquisition | Native lifecycle sends 0x35 true/false | Ours omits these transitions. Recover preconditions and ordering before implementing a complete lifecycle. |
| Collision notification | Dispatcher case0x4d has no direct stop | Diagnostic pit and battle damage are custom behavior. Separate firmware observations, inferred collisions and operator safety policy. |
| Recovery success | Native clears filter and may execute last intention | Ours never auto-resumes. Record as an intentional operator-safety override, not protocol parity. |
| Steering | Native action arbitration and state-dependent send/cancel | SDK offset-before-lane experiment is not established native-app sequence. Validate frame, freshness, command IDs and completion evidence. |
| Mapping | Segmented history, encoders, topology checks | Current simplified mapper is not native algorithm parity. Packet parity alone does not establish map correctness. |

## Implementation contract

Build conformance around states and ordered outbound packets, including absence of packets, not just encoder unit tests. Each golden sequence must cite the native address/configuration or independent capture; tests copied from our implementation alone are insufficient. Mark unresolved branches explicitly. Separate app-protocol actions from operator emergency STOP/watchdog overrides and report whenever an override interrupts a sequence. Do not represent an interrupted safety-controlled run as an exact original-app run.

Next implementation priority is the complete F&F initialize → ready/unlocalized → acquisition → localized → pause/full-stop → explicit resume state table, with 0x35, 0x37, 0x22 and 0x45 sequencing and reply prerequisites. Resolve configurable values from the actual kit mode; no speculative nonzero defaults deployed to hardware. Preserve separate SDK conformance instead of mixing its lane preconditions into the F&F path. Original-app execution/capture is currently unavailable, and firmware11866 internals are not recovered; byte-exact end-to-end equivalence remains unproven.

## Changes in this pass

Live checks now show firmware collision count, age and reported direction flags, explicitly distinguishing a notification from a confirmed impact. Regression checks preserve independent collision freshness without optical localization or physical-stop claims. No stop, latch, acceleration, speed cap or firmware packet behavior changed. Full Node suite: 589 passed. Isolated simulator browser confirmed the new diagnostic line; live hardware page was not reloaded.
