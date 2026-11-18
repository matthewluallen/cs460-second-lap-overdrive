# Scan refusal and recovery review — 18 November 2026

The operator connected Groundshock, selected its model, clicked Scan, reported no movement, and then could not retry. The controller was using **fast-furious**, not the **sdk** profile of the accepted 13 November scan. The current capture establishes an app-mode acquisition failure and a confusing recovery interface. It does not establish a new steering regression or a repaired physical drive.

## Retained evidence

The unmodified 43-event recording is [groundshock-app-scan-no-motion-2026-11-18.json](../fixtures/groundshock-app-scan-no-motion-2026-11-18.json), recorded from `2026-11-18T18:35:20.423Z`. SHA-256: `61b68800c81e5c0cc0b5dbfb91c2caef1d59a346bf8fbdb80517b2918ee437e3`. It contains no dropped events or markers, host/player credentials, or proprietary binaries. Recorder metadata retains model zero at connection; the operator-selected Groundshock identity appears in the final diagnostics. Do not infer model identity from firmware 11866.

| Trace time | Observation |
| --- | --- |
| 4–632 ms | SDK override disabled; app drone mode, plastic configuration, default road data, initialization reply and ping barriers completed. This proves communication, not drive readiness. |
| 137730 ms | STOP followed by `03 37 2c 01`: temporary 300 mm/s delocalized-speed allowance. |
| 137731 ms | `06 24 2c 01 e8 03 00`: requested speed 300 mm/s. The UI ceiling was 400, but this scan was capped at 300. |
| 137769 ms | Speed reply: desired 300, acceleration 1000, actual zero. |
| 137829 ms | Speed reply: desired zero, acceleration 1000, actual zero. **No host write intervened.** |
| 142766–142768 ms | Five-second acquisition watchdog fired; STOP writes and restoration of zero delocalized allowance followed. |
| Entire capture | Zero raw optical-position or transition packets, no map, no lane/offset/turn command. |

The operator said nothing happened. The telemetry is consistent with that observation but is not an independent physical-stop certificate. The current zero-speed reply cannot identify why firmware abandoned the nonzero desired speed. No further motion was requested during this review.

## Comparison with the working scan

[The accepted scan](SCAN-START-REGRESSION.md) used SDK mode on `08fe678`, received its first optical position after 818 ms, and mapped 11 pieces; the operator confirmed the map and physical stop. This app-mode attempt is not a controlled before/after comparison of that same connection path.

The earlier [SDK/APK audit, finding A3](SDK-APK-APPROACH-AUDIT.md#a3--p1-compatibility-ff-is-the-default-despite-a-failed-hardware-path) already records app-mode no movement despite the allowance, followed by SDK success. That earlier app attempt also sent an unlocalized lane request and received cancellation; today's forward-only attempt did not. The similar symptom is not proof of an identical experiment or common cause. Ordinary app initialization packets and scan-entry logic have not changed since the accepted scan revision. The new optional SDK plastic configuration does not run on this app profile. More recent cold-start SDK trials also failed, so returning to SDK cannot be described as a demonstrated repair.

`app-scan-no-motion.test.mjs` preserves these raw facts and exercises the actual Game scan path with the recorded speed replies. A parked driver at a selected 400 ceiling sends STOP, allowance 300 and speed 300; ordinary ticks add no command until the watchdog. Thus this attempt does not reproduce the hypothesis that a parked-controller tick restored zero or cancelled the allowance.

## Fresh native comparison

Static analysis used the exact F&F build-403 library documented in [the native provenance](FORWARD-BASELINE-NATIVE-NOTES.md); no app or firmware was executed. Fresh Ghidra export SHA-256: `0c3c05cee06d067f77b8493caea2c701313e43a017cf76e5adfd274b2914c588` (`app-scan-speed.c`, retained locally, not committed).

* `CarMsgSpeedUpdate::ToString` at `006b331c` corroborates the desired-speed/acceleration field interpretation.
* `CarMsgSetVehicleSpeed` / `GetBytes` at `006ab85c` / `006ab92c` match the seven-byte packet layout. `SendSetSpeedCommand` at `007b8ebc` derives its last flag from vehicle state; there is no basis to blindly change that flag to one.
* `BeginTrackDetection` at `007b24b0` explicitly sends `SkipAutoDriveInDeloc(false)` before requesting speed when `GetStartDelocalized` is false. `SendSkipAutoDriveInDeloc` at `007b8fe8` passes the boolean into `02 35 bool`.
* Physical full-stop entry/exit at `007a9ce8` / `007a9d28` pair true/false with speed, localization and host-state changes. Slipstream does not implement that complete lifecycle.

The missing explicit recovery-policy transition is a confirmed app-lifecycle difference and a **candidate**, not proof of the firmware gate responsible here. No packet reads that gate's state. Adding only `02 35 00` could change autonomous recovery behavior; this review does not insert it or weaken STOP, watchdog or pit handling.

## Reproduced recovery-interface defect

After the timeout, the shared pit intentionally prevents another scan. The old Scan handler remained clickable and put its explanation only in a collapsed log. Per-car Recover clears the car latch; it does not clear the shared pit. The old shared-pit action resumes controls and can arm Computer cars, so it is unsuitable as the sole route to prepare a scan retry.

The repair makes scan status and errors visible, names model/controller fields, and provides an explicit **Clear pit · keep stopped** route after the existing per-car recovery requirement. Clearing that pit must not start a countdown, arm a driver, resume a round or issue positive speed. A later Scan remains a separate action with its normal clear-track confirmation and countdown. Ordinary race-pit resume is retained.

Connection selection is separate from model selection. App mode is labeled experimental; a completed connection is not advertised as a validated physical scan. Explicit kit selections are remembered across reloads using an allowlist and guarded storage access. A kit choice applies only to new connections, and the connected car's profile is displayed explicitly.

## Verification

On Node 22.23.5 and 25.6.1, **756/756 Node tests pass**. Python 3.14.7 passes **38/38 unittest checks**; CWE regression and dependency-lab checks pass; npm 11.9.0 audit reports **zero vulnerabilities**. Seven new recovery/presentation checks include six reproduced failures before repair and a successful actual SimWorld scan with attempt-only/frozen telemetry counts. Three additional checks preserve the new raw hardware failure and test host scan ordering against its speed replies.

An isolated local browser confirmed explicit SDK selection survives reload, unchecked track-clear produces a visible message, a simulator scan maps nine pieces, and a later slow simulated drive trips the normal telemetry watchdog. The Recover → Clear pit · keep stopped workflow then left requested and reported speed zero, restored the separate scan/free-drive choices, and did not start a countdown. This browser run used only a simulated car. No physical car was driven or rearmed during validation.

## Remaining acceptance

The UI and recorded failure can be reproduced without driving. Physical track acquisition, cold-start SDK reliability, complete left/right maneuvers and multi-car racing remain unaccepted. Do not call this a drive repair, reset every latch automatically, repeat an unchanged failed trial, or promote the plastic comparison. Further app-mode work needs the complete native stop/start/recovery lifecycle and a bounded, explicitly supervised comparison; another charged car can help distinguish device-specific acquisition failure.
