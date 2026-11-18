# Supervised forward baseline — 18 November 2026

This is a new **software-tested diagnostic**, not a physical acceptance result. No hardware was operated while implementing it. The subsequent normal SDK scan on `5f3ebbf` failed before any optical code arrived; the operator reported a spin-off entering a curve and then powered Groundshock off. Consequently the three-lap baseline was **not started**. Read [the cold-scan evidence and acquisition-first next step](GROUNDSHOCK-COLD-CURVE-SCAN.md) before another physical attempt.

## Purpose and behavior

The previous reference-first comparison locked both maneuvers and offset calibration. The successful scan allowed ordinary printed-code calibration. The dedicated forward baseline separates those concerns: it preserves that existing calibration policy while refusing lane changes, U-turns and SDK lane preambles, including work waiting to enter the transport. It isolates human/phone inputs, the Computer planner and weapons. It adds no firmware command or initialization setting and does not imply that the firmware cannot move laterally on its own.

The named **Supervised · 3 forward laps** button requires one stopped, initialized Computer-driven car, an identified closed map, a battery reading no older than 30 seconds and a cleared shared pit. The host waits through its three-second countdown. The requested pace is at most 300 mm/s and never exceeds the selected ceiling. Increasing the ceiling does not increase the captured baseline pace.

The run discards old map placement, then requires a fresh, uniquely matched ordinary optical code within five seconds. Unlike the old comparison, this acquisition allows ordinary optical calibration. Once acquired, ambiguous, reversed or expired optical evidence stops the baseline; transition traffic alone cannot keep map evidence fresh. The existing telemetry watchdogs remain active.

Three complete observed laps request STOP. The initial partial crossing does not count. A separate 120-second host limit bounds the overall run. Both the acquisition and overall deadlines are checked at the final speed-write boundary, as well as in timers and the game loop. These are host protections, not a guarantee that an already-moving car stops if its Bluetooth link or host disappears.

STOP, a lost link, off-track/recovery status, lane cancellation, low-battery/charger status, and controller/map/car changes end the baseline. It never retries or resumes automatically. The result retains its lap count and stop reason in diagnostics, with `physicalStopVerified: false`; physical success requires the operator's observation. The dedicated **Stop forward check** button, STOP ALL and Escape remain available.

Special pieces may remain on the identified map for this unscored check. Their calibration and game effects remain disabled, and their presence still blocks scored rounds.

## Conditional hardware procedure — blocked by failed cold acquisition

Do not repeat this full procedure unchanged after the failed 18 November scan. First resolve the acquisition issue described in the cold-scan report. These are the acceptance steps to resume only after that prerequisite is established.

1. Use a charged, power-cycled Groundshock on the clear track, with an observer beside it. Use the previously accepted **Classic SDK connection** for this comparison; changing profiles introduces another variable.
2. Start from a fresh connection. Connect automatically records initialization. Keep this recording active through the scan, baseline and STOP. A recording restarted at the baseline button is explicitly labeled as starting after connection and cannot rule out initialization or retained-state issues.
3. Set the speed ceiling to 300 mm/s. Run the normal scan with experimental starting calibration blank. Confirm the map matches, the car stayed on track and it physically stopped. Do not continue from a failed scan.
4. Select Computer, refresh the stopped battery reading if needed, place the car on a printed lane before start/finish, then start **Supervised · 3 forward laps**. Stay beside the track. Stop immediately if it spins or leaves the track; do not repeat the same failed attempt automatically.
5. Save the trace and record whether three laps were physically completed, whether the car stayed on track and whether STOP worked. The trace contains the map, initialization when retained, raw packet traffic, test markers, baseline outcome and operator notes.
6. Only after stable forward acceptance, perform an explicit STOP/restart comparison, then separate completed left and right lane changes. Speed variation, races and attacks remain later acceptance steps.

## Evidence and limits

Read [the native follow-up](FORWARD-BASELINE-NATIVE-NOTES.md) for the recovered exact-hash APK and fresh assembly checks. The app's finite offset adjustment and physical-car full-stop lifecycle differ from our implementation. This baseline deliberately tests the repaired scan-style path; it does not establish native-app parity or explain the previous spin.

Regression coverage includes real host countdown/STOP handlers, preservation of an active connection recording, queue invalidation, actual transport entry after delayed writes, optical-reference loss, both circuit directions, partial/missing optical laps, deadline callbacks, lifecycle changes and input isolation. Simulator results are labeled as software evidence and do not model physical traction or establish firmware behavior.

Final software run: **721/721 Node tests pass** on Node 22.23.5 and 25.6.1; **38 Python tests pass** on Python 3.14.7; CWE/dependency checks pass; npm 11.9.0 audit reports zero vulnerabilities. The baseline before these changes was 697 passing Node tests. The new real-SimWorld matrix completes three laps on Starter oval, Capsule and the observed 11-piece Power Zone circuit at both −22.5 and +22.5 mm, using the default five-second acquisition and two-second telemetry watchdogs.

The actual local browser workflow also completed a fresh simulated scan, selected Computer, preserved the active recording, ran the countdown and three full laps, and displayed requested speed zero with the retained result. [Browser result screenshot](evidence/forward-baseline-simulator.jpg). No physical car was involved in that browser check.
