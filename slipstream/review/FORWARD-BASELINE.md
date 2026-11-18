# Supervised forward baseline — 18 November 2026

**Latest result:** Guardian passed the physical three-lap check on unchanged runtime `84f799c`; see [the acceptance evidence below](#guardian-physical-acceptance). This validates this car, circuit and session, not all vehicles or native-app parity.

Implementation history: no hardware was operated while developing this diagnostic. The first subsequent normal SDK scan on `5f3ebbf` failed before any optical code arrived; the operator reported a spin-off entering a curve and then powered Groundshock off, so that attempt never started the baseline. Groundshock later also failed standalone Drone Mode. It remains excluded from unchanged repeated trials; [its cold-scan evidence](GROUNDSHOCK-COLD-CURVE-SCAN.md) is historical and distinct from Guardian's accepted run.

## Purpose and behavior

The previous reference-first comparison locked both maneuvers and offset calibration. The successful scan allowed ordinary printed-code calibration. The dedicated forward baseline separates those concerns: it preserves that existing calibration policy while refusing lane changes, U-turns and SDK lane preambles, including work waiting to enter the transport. It isolates human/phone inputs, the Computer planner and weapons. It adds no firmware command or initialization setting and does not imply that the firmware cannot move laterally on its own.

The named **Supervised · 3 forward laps** button requires one stopped, initialized Computer-driven car, an identified closed map, a battery reading no older than 30 seconds and a cleared shared pit. The host waits through its three-second countdown. The requested pace is at most 300 mm/s and never exceeds the selected ceiling. Increasing the ceiling does not increase the captured baseline pace.

The run discards old map placement, then requires a fresh, uniquely matched ordinary optical code within five seconds. Unlike the old comparison, this acquisition allows ordinary optical calibration. Once acquired, ambiguous, reversed or expired optical evidence stops the baseline; transition traffic alone cannot keep map evidence fresh. The existing telemetry watchdogs remain active.

Three complete observed laps request STOP. The initial partial crossing does not count. A separate 120-second host limit bounds the overall run. Both the acquisition and overall deadlines are checked at the final speed-write boundary, as well as in timers and the game loop. These are host protections, not a guarantee that an already-moving car stops if its Bluetooth link or host disappears.

STOP, a lost link, off-track/recovery status, lane cancellation, low-battery/charger status, and controller/map/car changes end the baseline. It never retries or resumes automatically. The result retains its lap count and stop reason in diagnostics, with `physicalStopVerified: false`; physical success requires the operator's observation. The dedicated **Stop forward check** button, STOP ALL and Escape remain available.

Special pieces may remain on the identified map for this unscored check. Their calibration and game effects remain disabled, and their presence still blocks scored rounds.

## Conditional hardware procedure

The prerequisite is a successful supervised scan with a physically confirmed stop and correct map. Guardian met that prerequisite; Groundshock has not recovered from its recent independent failure. Each further physical trial requires an operator beside the clear track and the existing separate start/countdown.

1. Use the validated Guardian on the clear track, with an observer beside it. Use **Classic SDK connection**; changing profiles introduces another variable. A fresh-session comparison should record the actual power-cycle/connection history rather than assuming firmware state was reset.
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

## Guardian physical acceptance

On 18 November 2026 at approximately 1:30–1:31 p.m. America/Chicago, the operator separately authorized up to three forward-only laps at no more than 300 mm/s after [Guardian's accepted scan](SCAN-RETRY-AND-APP-MODE.md#guardian-sdk-scan-passed-physical-acceptance). Runtime was unchanged `84f799c`, trace build `2026-11-18-scan-recovery`. Guardian remained the sole connected car, Classic SDK, firmware 11866, with the observed seven-section 2.879 m circuit. A stopped battery refresh returned 3712 mV. Selecting Computer left the car stopped; the named forward-check button then used the existing three-second countdown.

The operator subsequently confirmed **“Stopped; all laps stayed on track without spinning.”** This accepts sustained forward following and the scan-stop-to-forward-start sequence for this session. It does not accept lane changes, variable-speed planning, attacks, multiplayer races, app-mode initialization or every car/track combination. Guardian was returned to Parked after the result; no further motion was started.

The unmodified [184-event cumulative capture](../fixtures/guardian-sdk-three-forward-laps-2026-11-18.json) has SHA-256 `733bba74f5a7dbc5a9869736c93e23af14841158fc703b55741328f518286ad0`. It includes connection identification and the earlier scan, has zero dropped events/markers, and contains no credentials. The forward run uses trace car index 2 / driver 4. It was exported before the later physical confirmation, which is recorded here separately; automated `physicalStopVerified` remains false.

| Trace time (ms) | Evidence |
| --- | --- |
| 1766135–1766136 | Baseline start marker, STOP then sole run speed request 300 mm/s (`06 24 2c 01 e8 03 00`). |
| 1767703 | First new optical code, repeated curve ID 17 / code 8; code-derived `SET_OFFSET` −31.5 mm follows. This alone does not disambiguate map location. |
| 1769532 | Fresh unambiguous reference at curve 20 / code 9, 3397 ms after start, inside the unchanged five-second acquisition limit. |
| 1802446 | Third full observed lap completes and STOP is written, 36.310 s after the positive-speed write. |
| 1802506 | Desired speed zero, actual-speed sample 302 mm/s, 60 ms after STOP. The sample later becomes stale and is not a current-motion or physical-stop certificate. |

The run adds **52 positions and 29 transitions**. Its only lateral-related write is ordinary optical calibration; there are no lane-change, turn, recovery-policy or delocalized-speed-allowance writes. No recovery entry/success, off-road, watchdog trip or transport fault occurs. Collision notifications near startup and after STOP do not prove impact; the operator reported continuous on-track travel without spinning. The global maximum-position-gap diagnostic includes the several-minute stopped interval between scan and baseline; it must not be reported as a running watchdog failure.

The physical result required no new command, firmware setting, higher limit, weaker watchdog or changed pit behavior. The next acceptance work is controlled completed left/right lane changes, then speed variation and races. Groundshock remains excluded pending its separate car/track diagnosis.

Validation for this evidence update: **766/766 Node tests pass on Node 22.23.5**; `git diff --check` is clean. Three new `guardian-forward.test.mjs` checks preserve the accepted scan prefix, inspect raw forward ordering, and replay actual Game initialization → scan → stopped interval → battery refresh → Computer selection → baseline with regular 40 ms ticks and the existing deadlines. The first partial wrap counts zero, then three full traversals count one/two/three. The ordinary CPU planner and weapon hooks never run; completion STOP cannot restart from held input. Python/CWE/dependency/audit results above remain historical and were not rerun for this evidence-only update.
