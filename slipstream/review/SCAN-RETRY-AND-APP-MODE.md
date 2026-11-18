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

## Follow-up: SDK scan entered firmware recovery before spinning

The operator subsequently reconnected Groundshock in ordinary SDK mode on `84f799c`, selected 300 mm/s and started a scan with no starting calibration. They reported **slight forward movement, then spinning**, and later confirmed **powered off and stationary**. The final unmodified 30-event recording is [groundshock-sdk-recovery-spin-2026-11-18.json](../fixtures/groundshock-sdk-recovery-spin-2026-11-18.json), recorded from `2026-11-18T18:50:00.458Z`; SHA-256 `3617ae69dfe2919c2d0567c81f88e8be2e5a26d1a055f202cf18bd6c4ed74686`. There are no dropped events/markers or credentials. Initial model zero and operator-selected identity remain distinct. The operator-confirmed power-off is retained in notes; automated `physicalStopVerified` remains false.

| After the positive speed write | Recorded event |
| --- | --- |
| 0 ms | Host speed 300 at 16422 ms; byte-identical to the accepted SDK scan. |
| 49 ms | Desired-speed reply 300, actual zero. |
| 1010 ms | Firmware status reports on-track; no optical code establishes location. |
| 1070 ms | `01 43`: firmware recovery entered. |
| 1280 ms | `01 44`: firmware recovery succeeded. |
| 1339 ms | `01 2b`: off-road notification, only 59 ms after recovery success. |
| 1340 / 1341 ms | Host STOP writes complete in response to off-road. |

No host transmission occurs between the positive speed and off-road. There are **zero positions, zero transitions**, and no lane, offset, turn, configuration or recovery-policy writes. Battery was 3834 mV, versus 4162 mV in the accepted scan; a voltage difference is not proof of battery causality. This recording does not establish a fresh power-on state. The explicit plastic comparison was not selected.

Fresh static native export (`recovery-audit.c`, SHA-256 `867ba2d18393290b4a4be752461249b01a1fb87d6d59ed7715baf71544773d7d`, retained locally) confirms `0x43` constructors/serializer at `006ba6c4`/`006ba6ec`, `0x44` at `006ba98c`/`006ba9b4`, and off-road at `006b2f90`. `VehicleMessenger::ProcessIncomingMessage` (`007b5310`) enables the native recovery filter on `0x43`; on `0x44`, it clears the filter and calls `ExecuteLastDrivingIntention` (`007a975c`). Slipstream did not copy that automatic resend; the trace has no corresponding write.

This explicitly associates the failed attempt with firmware recovery before our STOP, but cannot distinguish recovery causing the spin from recovery responding to a sensing/traction failure. A recovery-success message is not sustained track acquisition. No new firmware setting or safety policy was introduced after this result.

Four new `sdk-recovery-spin.test.mjs` checks preserve the final export, compare the accepted scan, and replay the actual Game path. Synthetic late recovery-success/off-road notifications are explicitly distinguished from recorded events and cannot revive speed or steering after the latch. **760/760 Node tests pass on both Node 22.23.5 and 25.6.1.** Runtime code is unchanged from `84f799c`.

### Independent next comparison

The operator has another charged car. The [official Anki maintenance guide](https://support.anki.bot/article/341-tire-replacement) documents a built-in Drone Mode: with the car off, press the underside power button five times rapidly, then place it on a clear track; it starts driving independently. This provides a comparison without Slipstream or an installed original app. Observe one lap and turn it off using its power button; with Bluetooth disconnected, browser STOP cannot control this check. Stop the check immediately if it spins or leaves the track. This is an operator-performed comparison, not an automated acceptance or a guaranteed firmware-state reset.

If it follows the track, compare that same car in one supervised SDK scan on the same layout. If it also fails independently, inspect the car/track path before further software-driven attempts. The [official product guide](https://s3.amazonaws.com/helpscout.net/docs/assets/5e3f0b1e2c7d3a7e9ae777f5/attachments/5ea650322c7d3a7e9aeba918/Anki-Overdrive-Product-Information-Guide.pdf) recommends the supplied tire cleaner and a cotton swab for sensor dust, with no chemicals. A comparison outcome must be recorded before drawing a hardware/software conclusion. Neither outcome alone proves every part of the other system correct.

### Operator result: Guardian navigates; Groundshock spins independently

The operator subsequently reported: Groundshock spins in standalone Drone Mode, while Guardian navigated the track. These are physical observations, not a Bluetooth recording or a quantified lap/steering test. They show the Groundshock symptom does not require active Slipstream commands, and distinguish the two cars on the available track. They do not identify the defective component, prove a hardware-only cause, or exclude retained firmware state from earlier sessions.

Guardian (model 12) and Groundshock (model 8) use the same ordinary SDK initialization, optical parser and scan speed logic. Both are non-trucks; their model entries affect naming, dimensions and game equipment. Neither scan path hardcodes firmware 11866. The next comparison keeps the connection profile SDK and ceiling 300, changes the physical car to Guardian, and leaves optional starting calibration blank. Groundshock stays out of repeated attempts. Guardian's standalone result is not yet acceptance of scanning or driving through Slipstream.

## Guardian SDK scan passed physical acceptance

On unchanged runtime `84f799c` (`2026-11-18-scan-recovery`), Guardian completed the approved SDK scan at a 300 mm/s ceiling. The operator subsequently confirmed: **“Stopped; stayed on track; 7-piece map matches.”** This accepts that scan and its map on this circuit. It does not accept repeated laps, lane changes, attacks, multi-car operation, F&F mode or universal protocol parity.

Identification was established without moving either initially connected car. Driver 2 (“PZ. Drive”) and driver 3 (“Z. Drive”) both returned fresh battery replies. Switching the physical Guardian off disconnected only driver 3. Both old cards were then removed; Guardian was switched on normally, selected as “Z. Drive,” reconnected alone as driver 4, and manually labeled Guardian. The model was not inferred from the advertised name or firmware. Initial model-zero metadata remains unchanged in the capture.

The original [88-event recording](../fixtures/guardian-sdk-scan-2026-11-18.json) has SHA-256 `f65bcc19eadeda9c68bfedf3f099220d1019725abf7080f09506dfe151ddd592`, no dropped events/markers and no credentials. It starts with the earlier stationary identification connections. Guardian's scan session is **trace car index 2 / driver 4**, global event indices 42–87. Exported notes predate physical confirmation and still say pending; the confirmation above is a later operator observation, not an alteration to the original recording.

| Event index (zero-based) | Observation |
| --- | --- |
| 42–54 | Normal SDK initialization, firmware 11866, battery 3762 mV; off charger, no low-battery flag. |
| 57 | Sole positive-speed write at 1432500 ms: `06 24 2c 01 e8 03 00` (300 mm/s). |
| 60 | First optical code after 832 ms: finish section 33 / code 6. |
| 61 | Normal code-derived `SET_OFFSET` calibration to −13.5 mm; no manual starting calibration. |
| 60–83 | 15 positions and 8 transitions; maximum optical gap 871 ms, within unchanged default watchdogs. |
| 83–85 | Closing transition at 1442664 ms, STOP writes at 1442667 ms: 3 ms later, 10.167 s after positive speed. This interval is not physical braking time. |
| 86 | Desired speed zero, actual-speed sample 286 mm/s, 55 ms after STOP. It becomes stale; it does not contradict or independently verify the later operator-confirmed stop. |

The mapped sequence is `33F, 17F, 20F, 39R, 17F, 23F, 34F`, total 2879.2 mm, geometrically closed with no inferred, special, jump or intersection sections. Start and finish are separately coded portions of one physical start/finish piece; seven mapped sections can correspond to six physical pieces. Repeated ID 17 is observed, not invented topology. No `CHANGE_LANE`, turn, `0x34`, `0x35`, `0x37` or plastic-configuration command occurs. No recovery/off-road message, write fault or watchdog trip occurs. Collision notifications before motion and after STOP do not establish physical impact; the operator confirmed staying on track.

This is a useful cross-car discriminator: the same runtime and ordinary SDK path that failed to acquire Groundshock's codes acquired Guardian's codes and closed the map. Groundshock's standalone failure also persists without active Slipstream commands. Together they support excluding Groundshock from further unchanged tests, but do not identify a component fault or exclude retained firmware state. The lower voltage on this successful Guardian attempt does not support voltage alone as a sufficient explanation for Groundshock's failures.

Next acceptance is the existing three-forward-lap check with Guardian, at no more than 300 mm/s, with normal optical calibration and no lane changes/turns/attacks. It requires a separate supervised start; this scan alone does not authorize an unattended run. No runtime protocol or safety policy changes accompany this evidence update.

`guardian-scan.test.mjs` adds three checks for the immutable capture, raw command ordering, and the real Game/ReplayCar scan path. The replay uses trace car index 2, initializes from the recorded SDK replies, maps the exact observed topology with default watchdog values, requests STOP and cannot restart from continued input/ticks after completion. It keeps automated physical-stop verification false. **763/763 Node tests pass on Node 22.23.5**; `git diff --check` is clean. No runtime code changed. Previous Python/CWE/dependency/audit results remain historical, not newly rerun claims for this evidence-only update.
