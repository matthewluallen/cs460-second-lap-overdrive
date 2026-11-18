# Forward baseline: native calibration and recovery follow-up

18 November 2026. This continues the [drive/APK audit](DRIVE-APK-PARITY-AUDIT.md). It is static interoperability analysis, not firmware execution, hardware acceptance or proof that the spinning has been repaired.

## Artifacts and reproducibility

The prior temporary APK/native exports were no longer present. A read-only search of the project and likely local artifact directories found no retained copy. The F&F XAPK was restored through the [previously documented APKPure listing](https://apkpure.net/anki-overdrive-fast-furious-edition/com.anki.foxtrot/download); its APK and ARM library match the original reviewed bytes exactly:

- APK SHA-256: `78c63be8ee611adf1894c4d32c1b70418d921fefa667ab3d0d8e645164b1b60b`.
- Library SHA-256: `0eef63a8135f4cfe7bb16b4effa1f720192cc2c1f340d0c8c8f0c2b9835f3d7f`.

The mirror is not an authenticated vendor delivery. Equality verifies continuity with the earlier analysis, not vendor identity or hardware compatibility. APK, library, raw assembly and decompilation remain outside Git under `/tmp/slipstream-native-nov18`. No APK, app library or firmware was executed.

Fresh Apple LLVM 17.0.0 ARM/Thumb disassembly, ELF dynamic symbols and relocation entries were used to check the findings below. The existing `tools/audit-native-offset.py` also reproduced the retained F&F scalar evidence with Capstone 5.0.7. Addresses below use the earlier Ghidra image base; subtract `0x10000` for ELF/LLVM addresses.

A fresh Ghidra **12.1.3** import/analysis and targeted export completed successfully: **89 selected entries**, including import thunks, with **zero failed export markers**. The analysis logged **3,102 WARN lines and three ArmAnalyzer context-register conflict errors**; the exported text contains **25 warning comments**. These counts describe tool completion, not verified coverage. The local export SHA-256 is `8002d3b23f92ea5b22afc74af0f0c10cd311e555cbcb14fe5cd87523a5223a58`. Its selection covered localization position processing, vehicle initialization/full-stop transitions, physical/virtual creation, and offset serializers/senders.

The fresh decompiler still misrecovers important floating arguments: it presents a logging call's return as the argument to an offset sender. The actual ARM caller loads the computed adjustment into `r1` at `0071b99a`, or loads the sentinel before `0071b63a`. Therefore the findings below rely on the checked instructions and literal data, not a literal translation of generated C.

## The full-stop guard is the physical/virtual car type

The earlier audit left `Vehicle + 0x8ac` unnamed. Fresh instruction-level tracing resolves its relevant values:

| Evidence | Observation |
|---|---|
| `Vehicle::InitializeVehicle` at `007a7c44`, store at `007a7c50` | Stores the `CAR_TYPE` argument directly at `Vehicle + 0x8ac`. |
| `VehicleManager::AddPhysicalVehicle` at `007b0dd8`, call at `007b0e4e` | Passes `CAR_TYPE = 0`. |
| `VehicleManager::AddVirtualVehicle` at `007b10b8`, call at `007b1222` | Passes `CAR_TYPE = 1`. |
| Calls through ELF PLT `00549fd0` | Resolve through GOT `00ebd3bc` to the named `InitializeVehicle` symbol; the calls are not inferred from nearby function names. |
| `EnterFullStopState` at `007a9ce8` and `ExitFullStopState` at `007a9d28` | Their recovery-message/state-reset branch runs when this field is zero: the physical-car path. |

Thus, the original app's physical full-stop path does use `0x35`; it is not merely a virtual-car behavior. Enter requests zero speed with acceleration 20 m/s², sends `SkipAutoDriveInDeloc(true)`, resets localization and records full-stop state. Exit sends false and resets local state. This narrows an evidence gap, but does **not** establish how firmware 11866 behaves under our public SDK override mode or justify adding an isolated `0x35 false` write. Native recovery can resume stored driving intent; a compatible implementation needs the complete stop/rearm lifecycle.

## Native correction is an adjustment with gates

Fresh assembly confirms the correction branch in `Localization::ProcessLocationUpdateMessage` (`0071a270`):

- The `ProcessPositionUpdate` call at `0071b3cc` passes an output boolean by address. The caller later tests that same output; the output argument was obscured in previous decompiler rendering.
- Correction also requires the relevant acquisition/scan-state gate and unchanged direction across the update. It is not an unconditional response to every optical packet.
- The elapsed-time comparison at `0071b5ea`–`0071b5fa` skips correction at or below **0.15 seconds**. The double literal was read directly from the ELF.
- The host pose's unknown-offset branch compares against **500000** and sends the sentinel **654321** through the absolute-offset sender at `0071b63a`.
- For a finite host offset, the direction flag selects its sign before subtracting the reported car offset. Instructions at `0071b6c6`, `0071b97a` and `0071b97e` establish that arithmetic; the resulting adjustment goes to `SendSetOffsetFromRoadCenterAdjustmentCommand` at `0071b9a2`.
- The adjustment constructor `006acd40` scales finite meters to wire millimeters, sets message ID **0x34**, and uses a five-byte length field. Its literals independently confirm scale **1000**, unknown threshold **500000**, and sentinel **654321**.

Slipstream still uses a finite absolute `0x2c` code-derived reference, a 9 mm discrepancy threshold and 700 ms throttle. This is a real algorithm/state difference. Packet layout agreement does not make the two algorithms equivalent. The exact native direction convention, acquisition-output conditions, interaction with an active firmware lane target, and SDK-mode applicability must be accounted for before replacing that estimator. The native application binary alone does not prove firmware-side effects of adjusting a reference during a maneuver.

## Why the new baseline separates maneuvers from calibration

The accepted scan allowed optical calibration after its first reading. The later reference-first spin trial suppressed both calibration and maneuvers under a shared lock, and its trace began after connection. Those are observed differences, not a proven cause of spinning.

The forward-only baseline therefore preserves the reviewed scan-style optical calibration while suppressing lane-change requests, turns, their SDK preambles and game attacks. It does not introduce `0x34`, `0x35`, a guessed offset or a different firmware mode. Existing stale-reference rejection, STOP priority and watchdogs still apply. This isolates forward following from requested maneuvers; it does not guarantee that firmware will never move laterally.

Record from a fresh connection through scan, the baseline and STOP, and retain the operator's physical observations. A successful three-lap run would establish that limited behavior on the tested car, firmware and track. It would not establish original-app parity, completed lane changes, Power Zone effects or multi-car acceptance. Repeated departures or spinning should end the baseline and trigger diagnosis rather than automatic retries.
