# Latest: review hardening — unidentified cars no longer default to Groundshock

Independent review of the Student workspace and phone QR work reproduced one latent identity defect and left all accepted hardware evidence and safety behavior unchanged. `Game.addCar` defaulted its `model` parameter to `8` (Groundshock, which is also the excluded car), so any caller that omitted model information silently produced a Groundshock-named car. The student connect path was already safe — it passes `model: 0` for an unadvertised car, names it “Unidentified car”, and logs “no Groundshock identity assumed” — so no student-facing screen showed a wrong identity; the defect lived at the library boundary and contradicted the stated invariant “missing model information must not silently become Groundshock.”

The focused repair changes the `addCar` default to `model = 0` (unidentified, “Unknown”), matching the production connect flow. Explicitly selected models, including Groundshock, are still honored. New `car-model-identity.test.mjs` regressions reproduce the defect (a model-less car is not Groundshock and reads as Unknown) and confirm explicit selection still works; the one watchdog test that relied on the old default now names its car explicitly. No firmware packet, speed ceiling, watchdog, arming, color, scanning or steering behavior changed.

Everything else reviewed against the acceptance priorities held: card/map/3D-ring/LED/phone colors stay consistent, independent servers assign the same first color (green), duplicate and effectively-black custom colors are rejected after wire quantization, host codes stay case-sensitive, QR links exclude host credentials, approval remains required, the phone resets driving intent on release/stop/handoff/hidden/stale/disconnect and closes the old binding on an invitation change, map markers hide without a fresh optical reference, and a stale lane intent cannot steer a stopped physical car (lane commands require speed > 0 and the game loop returns early while halted).

Validation: **842/842 Node tests on 22.23.5 (840 prior + 2 new identity regressions), 38 Python tests, CWE regression checks (exit 0), dependency lab (regression check passed) and npm audit (zero vulnerabilities)**. `git diff --check` is clean. Physical driving through the phone interface is still **not** accepted and is not claimed here; Guardian's previous acceptance remains below.

# Previous: simple Student workspace and phone QR control

The default `/slipstream/` page now leads with connect/model/unique LED color, track scan, live map and explicit human driving. **Advanced** retains the full racing and diagnostic workspace. Fresh Student sessions use Classic SDK at300 mm/s; a previously saved kit selection is honored and is visible under Connection settings. Known Bluetooth names are shown separately from the chosen car model. The same identification color appears on the car's requested LED, card, map/3D ring and phone. Color changes are stopped-only and distinct after protocol quantization.

**Phone / QR** requests a per-car invitation. Host codes are case-sensitive; the UI preserves their case, matching the managed launcher’s generated codes. The student enters the class host code, opens the code on a phone/iPad, joins by name, and is explicitly approved with **Let in**. The laptop's **Start driving** arms human controls; the phone holds to drive, releases to stop, and has prominent left/right and STOP controls. The Bluetooth laptop must remain awake with its host tab visible. The default page does not expose deployment topology or multi-server details. The existing room authorization, neutral-input arming, watchdogs and stop policies remain; no car protocol packets or scanning/calibration algorithms changed.

Four collapsed classroom activities cover optical/Bluetooth operation, an HBOM starting point, the declared software dependency inventory/SBOM limits, FCC-label evidence and security questions. They do not invent exact hardware parts or model-to-FCC mappings. [Student instructions](slipstream/README.md#student-view-default) include connection and phone setup.

Validation: **840/840 Node tests on22.23.5,38 Python tests, CWE regression checks, dependency lab and npm audit (zero vulnerabilities)**. Added regressions cover student scanning and explicit start, identity/quantized color choice, pairing/approval/rearming, failed-code retry, case-sensitive generated host codes, stale invitation responses, focus-loss release and changing QR invitations. Browser QA uses an isolated simulator server: scan completion, custom color, per-car QR, phone join/approval, held drive/release and STOP. Portrait/landscape/tablet layout checks are software-only. No new physical car motion or phone-hardware acceptance is claimed by this update; Guardian's previous acceptance remains below.

# Previous: Guardian completed a Computer round with automatic steering

On unchanged runtime `96fc393`, **Arcade → Crew mission → Computer**, one Guardian and the requested 300 mm/s ceiling completed the three-lap goal and sent automatic STOP after 31.735 seconds of commanded motion. The operator confirms **physically stopped; stayed on track; saw lane changes**. The recording supports at least three complete optical route traversals independently of the UI score. Two automatic moves were requested: measured −4.5→+22.5 mm (27 mm left), then +22.5→−22.5 mm (45 mm right), with noncancelled replies, matching command acknowledgments and subsequent printed codes on the resulting lanes. No recovery/off-road notification or cancellation occurs. This run holds **300 mm/s throughout**; it does not yet implement slower curves.

Read [the Computer acceptance and scoring audit](slipstream/review/RELATIVE-LANE-CONTROLS.md#guardian-computer-round-physically-confirmed). Crew's distance-based score reaches three circuits from its acquired reference; the stricter start/finish Localizer counter reads two because it arms on its first start-line crossing. Replay and the raw repeated route support the three-complete-circuit claim; neither counter should be silently substituted for the other. The final score crossing is interpolated between optical codes, so displayed best/last times are estimates, not timing-gate measurements.

Guardian is physically confirmed stopped. The next unaccepted behavior is explicit curve-speed variation under the same 300 mm/s ceiling and unchanged two-second telemetry watchdog. Existing Crew mode intentionally keeps 300 mm/s even on curves; Precision's 75 mm/s slow band at this ceiling can exceed the watchdog on this ordinary straight and is not a substitute. Attacks, multiple cars, phone/gamepad steering and special-track scoring remain outside this physical acceptance. This follow-up changes evidence/tests/documentation only; no browser reload is needed.

Validation: **817/817 Node tests pass on Node 22.23.5**, including the retained scan/forward/isolated-steering evidence and four new Computer protocol/route/session checks. `git diff --check` is clean. The earlier 38 Python tests, CWE/dependency checks and zero-vulnerability audit were not rerun for this evidence-only update.

# Previous: Guardian's left and right shifts physically confirmed

On `96fc393` (`2026-11-18-diagnostic-observation`), Guardian completed both separately observed small steering tests using Classic SDK, the saved ordinary seven-section map and a requested 300 mm/s ceiling. The operator explicitly confirms **stopped; clearly shifted left and stayed on track**, then **stopped; clearly shifted right and stayed on track**. Left commanded −4.5→+18 mm in the travel-relative frame; right commanded +22.5→0 mm. Each received a noncancelled `0x41` and matching received/executed command IDs, followed by automatic STOP about 750 ms after the lane write. Physical observations, not ACKs alone, establish the visible direction and staying on track. Exact physical displacement was not measured.

Read [the accepted steering evidence and lane-count explanation](slipstream/review/RELATIVE-LANE-CONTROLS.md#guardian-left-and-right-shifts-physically-confirmed). The original app's ordinary track model uses **16 usable fine lanes at 9 mm spacing**, with two additional border definitions on each side. Slipstream's 22.5 mm nudge is a separate control choice, not one native fine lane or proof of four main lanes. Four cars is a separate participant limit. Do not silently change these spacings while comparing the now-accepted steering path.

Guardian is physically confirmed stopped on track. Scanning, three forward-only laps and these isolated left/right shifts are accepted for this car/circuit/session. Variable-speed Computer laps, attacks, multi-car interactions and phone/gamepad steering remain outside this hardware acceptance. Groundshock remains excluded after its independent Drone Mode failure. The current runtime is still `96fc393`; this follow-up preserves evidence without changing control code.

Three new accepted-steering evidence/replay tests pass, including an actual SDK Game replay with an advancing clock across both separate diagnostics and no unexpected restart. The focused accepted scan/forward/steering and observation-clock set passes **17/17 on Node 22.23.5**. The preceding full runtime suite passed 810/810 before these three evidence-only tests were added; it was not rerun for this artifact-only update. `git diff --check` is clean.

# Previous: valid Guardian straight readings exposed a diagnostic clock bug

Two further authorized trials on unchanged `835f77b` are retained. The entrance-placement attempt received an unsolicited cancellation-state report after 1279 ms, despite **no host lane command anywhere in the connection capture**; normal cancellation STOP followed 1 ms later. Its movement was missed, but the operator subsequently confirmed stopped on track. The requested watched repeat then moved normally and stayed on track, with physical STOP confirmed. It read ordinary straight 39/code 20 and 19 in reverse with **440.16 mm and 280 mm remaining**, yet sent no lane request. This second no-attempt result cannot be explained by insufficient straight distance. See [the paired trials and timing repair](slipstream/review/RELATIVE-LANE-CONTROLS.md#entrance-attempt-and-watched-repeat).

The diagnostic compared `Car`'s observation timestamp to a later independent `performance.now()` sample. A real Car/Game regression using the captured eligible packet sends no lane request when the clock advances 0.1 ms between calls, while a fixed-clock test masks the defect. The repair passes the exact receipt timestamp to the Game listener and matches the estimate to that observation; current time separately enforces freshness and deadlines. The final transport still checks the current drive/reference identity. No firmware command, lane spacing, distance gate, timeout, speed ceiling or cancellation/STOP policy changes. Historical recordings do not include those internal clock samples, so this is a reproduced software explanation, not proof of the precise timing of every omitted historical request.

Guardian is physically confirmed stopped on track after the watched repeat. No completed Guardian left/right maneuver has yet been observed. Its accepted scan and three forward laps remain valid. The new software must be loaded before testing this repair; the existing browser still runs `835f77b` at this documentation checkpoint. A fresh connection/placement check is required after reload, under the already-recorded left/right test authorization.

Validation: **810/810 Node tests pass on Node 22.23.5**. Eight new observation-clock tests cover the advancing-clock reproduction and invalid evidence, one immutable watched-trial test preserves the eligible geometry, and three cancellation/STOP replay tests retain the separate unsolicited-report case. Independent reviews found no blocking issue. `git diff --check` is clean. The trace build is `2026-11-18-diagnostic-observation`. This is software validation; no physical test of the repaired clock path has yet run.

# Previous: charged Guardian reached the straight code too late for steering

On `835f77b`, the operator reported Guardian charged and placed on the straight opposite start/finish, selected **Z. Drive without P**, and confirmed presence beside it. The new four-second left diagnostic read ordinary straight **39/code 33 in reverse**, then curves 17/23. Its first optical reading was 1163 ms after positive speed, at 78.6% of the straight: **119.84 mm remained, below the unchanged 250 mm steering gate**. The proposed left target (+54 mm from +31.5 mm) was within bounds; the battery was 4117 mV and the moving status did not report low battery or charging. **No lane request was sent.** One normal optical offset calibration was sent; STOP followed at the four-second deadline. This is a no-attempt result, not a firmware rejection.

The operator subsequently confirms **physically stopped; stayed on the track without spinning**. This confirms the physical outcome of the short forward drive, not a lane change. The next useful comparison changes placement only: start near the entrance seam of that same ordinary straight, facing the same travel direction, with room to the left. Repositioning is requested but not yet confirmed; do not weaken the distance gate or repeat the unchanged placement. The earlier accepted Guardian scan and three full forward laps remain the baseline; completed left/right steering is still pending. See [the charged-trial analysis](slipstream/review/RELATIVE-LANE-CONTROLS.md#charged-guardian-trial-late-straight-reading).

The control-tick/independent-timer outcome-message race is repaired without changing motion. **798/798 Node tests pass on Node 22.23.5**: five new deadline regressions reproduced before repair, and four new captured/synthetic replay tests preserve the late-code result and show an earlier same-lane code can qualify. Trace build for the repaired software is `2026-11-18-diagnostic-outcomes`; the connected browser remains on `835f77b` until deliberately reloaded. No new physical result is implied by these software checks.

# Previous: short Guardian trial sent no steering; diagnostic health stop repaired

On `a028e4e`, Guardian's authorized short left test read finish 33 and curves 17/20, not the ordinary straight required by the steering gate. **No lane, offset or turn request was sent.** The operator confirms physically stopped and only halfway around; this was the four-second diagnostic, not a full-lap run. A low-battery status arrived 359 ms after positive speed, but the old diagnostic waited until its deadline to stop. The immutable capture and separate repaired replay are documented in [the trial report](slipstream/review/RELATIVE-LANE-CONTROLS.md#first-short-guardian-trial-no-lane-request).

Straight and steering diagnostics now invoke the existing shared-pit STOP immediately when their active car reports low battery or charging. No voltage threshold, firmware command, speed ceiling or timeout changed. A steering deadline with no eligible code now explicitly reports that no lane request was sent. **789/789 Node tests pass on Node 22.23.5**; the eight new health/replay tests reproduced six failures before repair. The 38 Python tests, CWE/dependency checks and zero-vulnerability audit also passed during this repair session. Trace build: `2026-11-18-diagnostic-health`.

Guardian is physically confirmed stopped and disconnected from the controller. Charging was requested; power-off or charge completion has not yet been confirmed. After charging, place it near the entrance of the long straight **opposite the checkered start/finish piece**, with room in the requested direction. No right test or variable-speed race has run. Earlier accepted scanning and three forward laps remain valid; completed left/right steering is still the next physical milestone.

# Previous: relative lane controls repaired; Guardian steering pending

Before the authorized left/right tests, review reproduced a manual target-selection defect: after forward-only driving, the first browser/keyboard nudge could use the stale zero steering target rather than Guardian's measured +22.5 mm lane. The fix anchors the first physical discrete nudge to fresh current-drive optical evidence; later explicit nudges may accumulate only within that drive. Missing/stale evidence refuses the press instead of queuing delayed motion. STOP and explicit recovery/off-track notifications invalidate discrete intent. The separate battle-effect relative helper is unchanged and remains unaccepted on hardware.

Both **Clear track · one left-lane test** and **Clear track · one right-lane test** now use the same existing gates, countdown, 300 mm/s ceiling, single request and automatic STOP. Direction is recorded and shown in the HUD. No firmware encoding, watchdog, arming or cancellation policy changed. Guardian must begin near the entrance of the long ordinary straight on a printed lane with room in the test direction; start/finish is not an ordinary-straight diagnostic code. Browser reconnection after reload is still required. No new physical steering result is claimed. Read [the reproduction and acceptance scope](slipstream/review/RELATIVE-LANE-CONTROLS.md).

Validation: **781/781 Node tests on Node 22.23.5**, **38/38 Python tests**, CWE/dependency checks pass; npm audit reports zero vulnerabilities. The focused host suite also passes **111/111 on Node 25.6.1**. Trace build is `2026-11-18-relative-steering`. Guardian's accepted scan and three forward laps below remain the physical baseline.

# Previous: Guardian completed three forward laps — 18 November 2026

After the accepted scan below, Guardian completed the separately authorized **Supervised · 3 forward laps** check in Classic SDK mode at a requested **300 mm/s**. The operator confirms **stopped; all laps stayed on track without spinning**. The unchanged runtime `84f799c` reacquired an unambiguous map reference, counted three full laps, then sent automatic STOP after 36.310 seconds of commanded forward driving. The run added 52 positions and 29 transitions, one ordinary optical calibration, and no lane/turn requests, recovery or off-road messages. Guardian is now Parked and stopped.

Read [the retained forward-run evidence](slipstream/review/FORWARD-BASELINE.md#guardian-physical-acceptance). Scanning, stop-to-start forward driving and sustained forward following are accepted for this Guardian/circuit/session. Completed left/right lane changes, variable-speed Computer racing, attacks and multi-car operation remain unverified. Groundshock stays excluded after its independent Drone Mode failure. No runtime or safety setting changed for this result.

Validation: **766/766 Node tests pass on Node 22.23.5**, including three new cumulative-trace and actual Game forward-run checks. The replay excludes the initial partial lap, counts three complete optical traversals under default watchdogs, stops and does not restart from held input. This update changes evidence/tests/documentation only.

# Previous: Guardian SDK scan passed physical acceptance — 18 November 2026

Guardian completed a supervised ordinary **Classic SDK** scan on unchanged runtime `84f799c`, at the **300 mm/s** ceiling with blank starting calibration. The operator confirms **stopped, stayed on track, and the displayed 7-section map matches**. The capture records 15 optical positions and 8 transitions, a closed 2.879 m circuit with no inferred/special sections, no recovery/off-road messages, and STOP immediately after closure. One normal optical offset calibration followed the first code; no lane or turn request was sent. This is an accepted scan for Guardian on this circuit, not acceptance of repeated forward laps, steering, races or every car.

The physical power-off check identified Guardian as connection 3, “Z. Drive”; the other connection was removed. Guardian then reconnected alone as driver 4. Do not use the advertised name or firmware 11866 alone to identify a model. The unmodified recording retains initial unknown-model metadata and earlier stationary connections. See [Guardian's scan evidence and scope](slipstream/review/SCAN-RETRY-AND-APP-MODE.md#guardian-sdk-scan-passed-physical-acceptance).

Groundshock remains excluded after its independent Drone Mode failure. The next milestone is the existing supervised three-forward-lap check with Guardian, without lane changes or attacks; no additional hardware result is implied here.

Validation: **763/763 Node tests pass on Node 22.23.5**, including three new Guardian provenance/command/replay checks. The actual Game replay closes the observed map under the unchanged watchdog defaults and remains stopped after completion. This commit adds evidence, tests and documentation only; runtime stays `84f799c`.

# Previous: independent comparison distinguishes Guardian from Groundshock

The operator reports **Groundshock also spins in standalone Drone Mode**, while **Guardian navigates the track** in that mode. This reproduces Groundshock's symptom without active Slipstream control and establishes a useful replacement-car baseline. It does not identify a motor, tire, sensor or battery fault, exclude retained firmware configuration, or validate Slipstream's initialization and control. Groundshock is excluded from further repeated trials. Guardian is the next candidate for one supervised SDK scan at a maximum 300 mm/s, with recording from connection and blank starting calibration. Its connection/physical readiness and software scan result remain pending.

# Previous: SDK scan entered firmware recovery, then off-road; Groundshock off

After the UI repair, the operator started an ordinary SDK scan on `84f799c` at 300 mm/s and reported slight forward movement followed by spinning. They then confirmed **powered off and stationary**, with another charged car available. The 30-event recording contains zero positions/transitions, firmware recovery entry at +1070 ms, recovery success at +1280 ms, off-road at +1339 ms, then host STOP at +1340 ms. No host write occurs between positive speed and off-road. Firmware recovery is now explicitly observed; its cause and relation to the physical spin remain unknown. No new driving command or policy has been added. Read [the follow-up evidence and independent comparison](slipstream/review/SCAN-RETRY-AND-APP-MODE.md#follow-up-sdk-scan-entered-firmware-recovery-before-spinning).

The next requested operator check uses the other charged car's manufacturer-documented standalone Drone Mode, with Slipstream disconnected, before another supervised software scan. No outcome is yet claimed. SDK startup/forward bytes match the earlier accepted scan; that does not prove all retained state or hardware conditions match. Do not repeat an unchanged failed Groundshock scan or mistake recovery-success telemetry for a usable map.

Four additional trace/replay checks pass; the full Node suite is **760/760 on Node 22.23.5 and 25.6.1**. This evidence update does not change runtime code.

# Previous: app-mode scan did not move; retry interface repaired

The operator reconnected Groundshock with **Fast & Furious**, selected its model and started a scan on `a79c006`. They reported no movement. The retained 43-event trace shows allowance 300 then speed 300; firmware reported desired speed zero after 98 ms **without an intervening host write**. No optical position or transition arrived. The unchanged five-second watchdog stopped the scan and latched the shared pit. This resembles an app-profile failure already documented before the accepted SDK scan; it is not evidence that the recent steering code caused this failure. The prior app attempt also had a lane request, so no identical-experiment claim is made.

Read [the scan/retry review](slipstream/review/SCAN-RETRY-AND-APP-MODE.md). The repair exposes scan errors, distinguishes the model selector from the connected-car selector, identifies the actual connection profile, and provides **Clear pit · keep stopped** after explicit per-car recovery. It never arms a driver or resumes motion. Kit choices are remembered for the next connection; changing the selector does not reconfigure an existing car. No vehicle command, firmware recovery policy or watchdog threshold is changed. Fresh native inspection confirms a missing app scan-entry recovery-policy transition, but its causality remains unproved; do not insert an isolated `0x35` command or claim this UI repair fixes physical driving. No new physical test was run during this repair.

Validation: **756/756 Node tests pass on Node 22.23.5 and 25.6.1**, **38 Python tests pass**, CWE/dependency checks pass, and audit reports zero vulnerabilities. The isolated simulator browser mapped nine pieces and exercised telemetry-stop recovery without restarting. Runtime trace identifier: `2026-11-18-scan-recovery`.

# Previous: plastic-track comparison also failed; Groundshock powered off

On `a79c006`, configuration/ping/version communication completed while stopped. The subsequent 300 mm/s scan received **zero positions and zero transitions** before the normal five-second acquisition STOP. The operator reported an immediate spin, then confirmed **powered off and stationary**. No map or forward laps completed. The 38-event original trace and exact regression are retained in [the latest report](slipstream/review/GROUNDSHOCK-COLD-CURVE-SCAN.md). The explicit plastic setting did not restore acquisition in this attempt; firmware application remains unknown. Do not promote it to the normal SDK default or repeat the unchanged Groundshock trial. Another charged car or an original-app comparison is the next useful discriminator. The operator is now being given the normal manual-control steps; no additional motion has been requested.

# Previous: explicit plastic-track comparison after repeated acquisition failure

On `c39567c`, the fresh authorized scan had orderly initialization but still received **zero optical positions and one unknown-offset transition** before the normal watchdog STOP. The operator confirmed stopped after spinning midway into the next curve; Groundshock was then disconnected. No forward laps ran. The original 30-event recording and exact replay expectations are retained. Read [the latest evidence and comparison](slipstream/review/GROUNDSHOCK-COLD-CURVE-SCAN.md).

**Classic SDK · plastic-track comparison** is an explicit, non-default connection option. It adds the independently verified plastic-parser/no-jump-supercodes `03 45 00 00` packet and a ping barrier after SDK selection. Default SDK stays unchanged; setup remains stopped, and pong completion is not a configuration readback. This is the next single configuration comparison, not a confirmed spin repair. No recovery-mode, offset, steering or watchdog change is included.

Validation: **745/745 Node tests pass on Node 22.23.5 and 25.6.1**. Eleven new checks cover the second failed capture, opt-in packet/reply/fault behavior, and real host connection handlers including a selector change during pairing. The comparison remains physically untested at this build checkpoint.

# Previous hardware result: cold scan spun off entering a curve — 18 November 2026

Groundshock on `5f3ebbf` failed the normal Classic SDK scan at requested 300 mm/s. The operator confirmed **powered off; entered a curve** after observing the departure. The full connection-to-STOP capture contains **no optical position (`0x27`)**, only unknown-offset transitions, and **no lane/offset/turn command**. No map or three-lap forward baseline was completed. Read [the evidence and next diagnostic](slipstream/review/GROUNDSHOCK-COLD-CURVE-SCAN.md). Do not repeat the unchanged circuit attempt.

The forward bytes match the previously accepted scan, which received its first optical code after 818 ms. Offline replay preserves the failed scan and late STOP-only handling. A separate reproduced host issue allowed ordinary parked-driver ticks to inject zero-speed commands during initialization; those ticks now wait for setup completion while explicit STOP and safety checks remain available. Both successful and failed captures had the extra writes, so this is **not a proven cause or repair of spinning**. The next hardware question is why a cold start did not acquire printed codes before curve entry. Groundshock remains powered off.

The SDK/native review corroborates an explicit plastic-versus-vinyl parser setting: the app profile sends it, while SDK initialization omits it. The original app's native plastic argument and independently compiled SDK vectors agree. Firmware defaults/persistence are unknown; this is a proposed controlled configuration comparison, not an added packet or established diagnosis. `inspect_trace.mjs` now reports bounded acquisition intervals and wheel/late-track observations without claiming physical motion. Final follow-up: **734/734 Node tests pass on Node 22.23.5 and 25.6.1**, including 13 new tests. The car has not been driven again.

# Historical forward-only acceptance preparation — 18 November 2026

The new **Supervised · 3 forward laps** check preserves normal printed-code calibration while blocking lane changes, U-turns, SDK lane preambles, game attacks and competing control inputs. It requires one stopped Computer car, a mapped circuit, a fresh battery reading and the existing countdown. It reacquires an unambiguous optical map reference within five seconds, stops on lost/expired/reversed evidence, and requests STOP after three full observed laps or a 120-second host limit. Deadline and maneuver checks also apply immediately before transport entry. Existing watchdogs, default cancellation STOP and shared-pit behavior remain. Results explicitly require physical confirmation.

Read [FORWARD-BASELINE.md](slipstream/review/FORWARD-BASELINE.md) for the conditional hardware procedure. Preserve the recording from fresh connection through scan, baseline and STOP. **No car was connected or driven while implementing this build.** The later physical scan failed as documented above; three-lap driving has not been hardware accepted.

The exact-hash F&F APK/library were recovered after the earlier temporary artifacts disappeared. [Fresh native analysis](slipstream/review/FORWARD-BASELINE-NATIVE-NOTES.md) identifies the former unnamed full-stop guard as physical-car type zero, and confirms that native finite calibration uses a direction-adjusted delta. These findings narrow the remaining state-machine gaps; no guessed `0x34` or `0x35` writes were added.

Validation: **721/721 Node tests pass on both Node 22.23.5 and 25.6.1**, **38 Python tests pass** on Python 3.14.7, CWE/dependency checks pass and npm audit reports zero vulnerabilities. The actual local browser workflow scanned the simulated Capsule, reported three full forward laps and requested STOP. Six additional simulator runs cover both readable lane sides on Starter oval, Capsule and the observed Power Zone map with the unchanged default watchdogs. This is software evidence only.

# Detailed APK/SDK drive audit and repairs — software only

Read [DRIVE-APK-PARITY-AUDIT.md](slipstream/review/DRIVE-APK-PARITY-AUDIT.md) for the current comparison of connection, speed, calibration, geometry, lane eligibility, IDs, STOP and recovery. It combines Ghidra/JADX exports with independent LLVM Thumb disassembly and a new Capstone/ELF verifier. The offset conversion was also checked in the standard Overdrive APK 1502 binary. No native app/firmware was executed and no car was connected in this pass.

Confirmed repairs: STOP now invalidates dequeued-but-not-entered motion and cannot be overwritten by a quick restart; stale or merely queued calibration cannot fabricate steering-sign evidence; unsent automatic calibration is discarded when its optical observation is superseded or invalidated, without throttling the replacement correction; unknown offset classification matches the native greater-than-500000 range; 228 ordinary curve lateral coordinates lose a 2.3–3.7 mm extraction bias; physical SDK/F&F lane requests require a fresh printed reference from the current drive and recheck it before radio entry. Scan calibration, the existing watchdogs, limits and default cancellation pit remain. The earlier universal “missing 0x2c caused rejection” diagnosis is explicitly withdrawn.

The full regression exposed Story guidance that could miss its deadline while waiting for safe steering geometry. CPU pace now uses 95% of the existing task maximum, with unchanged scoring bands, deadlines, goals and operator caps. All 24 simulator combinations (three missions, two layouts, one through four cars) complete. These retain explicitly simulator-only timing; Figure-eight Story remains unaccepted on physical hardware. Replay now drains queued writes between recorded steps, and combat tests use deterministic seeds while checking truthful visibility through ambiguity/watchdog pits.

The audit does **not** establish native-app parity or the cause of the last spin. Important differences remain: our finite 0x2c calibration versus native conditional 0x34/unknown handling, public-SDK versus app-engine initialization, native 0x35 full-stop lifecycle and different STOP deceleration. No speculative packet, higher speed ceiling or weaker watchdog is introduced to bridge those gaps. The next physical milestone remains stable forward following using the accepted scan baseline before lane changes or races. Latest physical observation below is unchanged.

Final validation: **697/697 Node tests**, **38 Python tests**, CWE/dependency checks pass; audit reports 0 vulnerabilities. Source evidence and all repairs are on the PR branch; do not merge main. No new physical acceptance or live-browser reload is implied.

# Latest physical result: start reference confirmed, but forward driving spun

On `79f9350`, the repositioned Groundshock read start section **34/code12 → 34/code13** and passed the reference gate. It then lost position/transition telemetry; the unchanged two-second watchdog requested STOP. The operator confirms **stopped; stayed on track, but spun around a couple of times before reaching the end of the start/stop section**. This is a failed stable-forward-driving trial, not a successful Computer run. The car was disconnected after the observation. No further motion was attempted.

The 29-event raw recording is preserved as `slipstream/fixtures/groundshock-sdk-reference-spin.json`. It contains only battery requests and speed/STOP writes: **no lane, offset, turn, mode change or direct-motor command**. It began after connection, so retained firmware state is not ruled out. The requested 300 mm/s packet exactly matches the successful scan's packet. Unlike that scan, the acquisition lock suppressed calibration on both reference packets; no later optical packet arrived to trigger calibration after unlock. That is an observed sequence difference, not a proven cause. Native correction also has conditional adjustment/sentinel paths, so replaying a guessed finite offset would not establish parity. See [the evidence, native audit and next steps](slipstream/review/COMPUTER-DRIVER-HARDWARE.md#start-reference-confirmed-spinning-before-telemetry-stop).

This pass also repairs two reproduced host bookkeeping errors: the first partial crossing of the map boundary must not count as a completed lap, and a new explicit comparison must not inherit its Bot's prior lane encounter/target history. Neither repair explains the spinning or changes firmware packets, stop policy, watchdog thresholds or calibration behavior. Full validation results are recorded in the hardware report. **Do not repeat the unchanged physical trial or claim original-app parity.**

Validation: **664/664 Node tests**, **38 Python tests**, CWE/dependency checks pass and `npm audit` reports0 vulnerabilities. CPU section visits now use their own generation, so conservative lap evidence does not suppress a later valid straight encounter. Seven new regressions cover the trace, partial laps, comparison reset and this integration.

# Previous physical result: reference mismatch stopped safely on track

On `79f9350`, charged Groundshock initially emitted continuous recovery/off-track messages while requested speed stayed zero. This stopped after the operator fully power-cycled it. The subsequent authorized comparison requested300 mm/s; the first optical reading was **curve18/code8**, not start/finish. The new gate sent STOP1 ms after that reading and sent **no lane or offset command**. Operator confirms **stopped; stayed on track**. The test did not establish the required reference or enable Computer steering. See the latest sections of [the hardware report](slipstream/review/COMPUTER-DRIVER-HARDWARE.md). Do not rerun unchanged: resolve why start/finish was not read, including actual sensor placement and readable lane, before another attempt. No firmware recovery policy was changed. Both raw recordings and four replay tests are retained; the full Node suite now passes **657/657**. This evidence update changes no runtime code.

The operator subsequently confirmed that this run physically stopped on **the first curve after start/finish**. That observation is consistent with curve18 at index1 in the exported map. Telemetry alone still cannot distinguish its two occurrences at indices1 and9, and no start/finish code was captured. The raw fixture remains unchanged; this adds an operator observation, not a successful reference acquisition or a new trial result.

# Previous physical result: off track before steering; reference gate required

The approved comparison ran on `ae3012b` and ended on delocalization before any lane request. The operator confirms **stopped; it left the track**, reports the map marker at a different spot, and says they placed it at start/finish. No start/finish optical code appears in this capture:18→57→57→39, then only transitions. One printed-code auto-offset write occurred; no physical cause is established. The car was disconnected after confirmed physical stop. Read [the current hardware report](slipstream/review/COMPUTER-DRIVER-HARDWARE.md#comparison-attempt-physical-departure-before-any-lane-command).

Reproduced software defects: both renderers showed an untrusted on-road position after localization loss, and transitions renewed optical freshness. Fixed by hiding invalid poses, invalidating on negative status/recovery/loss, tracking optical age independently and showing reference evidence. Expired candidate history and contradictory codes no longer invent a unique location or lap. New trace exports include the full map. The next explicit comparison must acquire a unique start/finish code plus a consistent follow-up before lateral commands or calibration unlock; mismatch or a five-second acquisition timeout stops. Late data cannot restore the marker through an off-track latch or recalibrate while safety-stopped. This is **software verified, not hardware accepted**. No more movement occurred in this repair pass. Earlier pending/authorized statements below are historical; the single prior authorization has been exercised.

Final validation: Node22.23.5/npm11.9.0 **653/653 tests pass**; Python3.14.7 **38 tests pass**; CWE/dependency regression checks pass; `npm audit` reports0 vulnerabilities. Local 2D/3D simulator UI confirms untrusted markers are hidden and optical reference status is visible. No proprietary app artifacts were committed.

# Historical: authorized one-run lane-cancellation comparison

The operator explicitly approved one supervised comparison at no more than300 mm/s: a lane-cancellation notification clears and locks further steering while forward driving continues. Manual STOP, off-track, telemetry loss, link faults and other pit protections remain. This is an opt-in diagnostic comparison, not the default driving policy or proof of native-app equivalence. Its named per-car button uses a three-second countdown, requires one stopped Computer-driven car on a mapped circuit and fresh battery status, and displays a prominent forward-driving warning after cancellation. Any stop or control/map lifecycle change ends the exception. Completed steering and repeated laps still require physical observation.

# Latest trial: stable300 still produces interrupted steering

Build `77825b6` exercised the new speed-confirmation gate: fresh optical speed314, long-established requested300, then one lane request. Cancellation-state notification followed183 ms later; host STOP completed1 ms after it. Operator confirms **stopped on track; lane change only began**. The later optical ACK reports the new request executed, but does not prove completion. See [COMPUTER-DRIVER-HARDWARE.md](slipstream/review/COMPUTER-DRIVER-HARDWARE.md). Original direct cancellation handler clears lateral intent without directly sending forward STOP; whole-app downstream behavior remains unproved. A product decision is pending for an explicitly supervised comparison that would keep forward motion but lock steering on cancellation. Existing cancellation pit remains default and unchanged pending authorization.

# Latest trial: ordinary forward movement, telemetry-gap stop before steering

The `90538af` trial requested200 mm/s and received a2116 ms transition gap, tripping the unchanged two-second watchdog before any lane/offset request. Operator confirms **stopped on track; moved forward normally**. The speed-confirmation steering fix is therefore still untested physically. See [the updated CPU report](slipstream/review/COMPUTER-DRIVER-HARDWARE.md). Next CPU policy permits the demonstrated300 mm/s pace with selected ceiling300; varying speed and completed repeated lane changes remain open.

# Latest CPU hardware result: cancellation stops; movement observed

Build `41c1b54` ran two Computer Free-drive attempts. Both first automatic steering requests coincided with a 200→300 mm/s speed increase and received cancellation-state reports within 97/104 ms; STOP/pit activated. The retry used new ID 2, so retained ID 1 alone cannot explain the issue. The operator confirms the retry **stopped on track and began a lane change without completing it**. This is partial movement, not three-lap or completed left/right acceptance. Read [COMPUTER-DRIVER-HARDWARE.md](slipstream/review/COMPUTER-DRIVER-HARDWARE.md) for exact traces, original-app comparison and the speed-confirmation sequencing follow-up. Do not dismiss 0x80 by its low-bit ID or weaken the cancellation stop.

# Latest physical result: left steering accepted; Computer driving next

Groundshock firmware 11866 in SDK mode on loaded build `08fe678` completed ordinary Free drive at requested 300 mm/s and one left request. The operator confirmed **stopped; clearly shifted left**. The recording shows an uncancelled lane ID 1, received/executed ID 1, and printed-code lateral change from −22.5 to +31.5 mm. This is one physical left-maneuver acceptance, not precise target accuracy or whole-system validation. See [the evidence and CPU follow-up](slipstream/review/GROUNDSHOCK-LEFT-STEERING-ACCEPTED.md) and the retained fixture/replay tests. The optional bounded trial below was not used. Older unresolved steering statements below are historical.

The existing Computer race driver now uses fresh ordinary-straight geometry for speed and lane decisions. In unscored Free drive it alternates lane targets once per straight encounter; at ceiling 300 it requests 300 on usable straights and 200 elsewhere. Active races retain their intents under the same cap. Power Zone 57 still blocks scored rounds. Repeated autonomous driving and right steering require the next physical result; no native-app parity is claimed.

# Bounded steering trial — physical acceptance pending

A new explicit “one left-lane test” uses a three-second countdown, at most 300 mm/s and a four-second host deadline. It requires a mapped circuit without inferred sections and a fresh battery sample. One fresh ordinary-straight position with positive reported speed, at least 250 mm remaining straight geometry, sufficient left room and 750 ms remaining authorizes exactly one relative left request. STOP follows within a 750 ms host window. The nominal geometry margin is not a proven physical stopping distance.

This trial uses existing ordinary-driving collision reporting (raw 0x4d is retained); the separate half-second diagnostic's collision latch is unchanged. Lane cancellation, off-road, telemetry gaps and link faults still stop. Human/phone/CPU inputs are isolated; pending offset/lane writes expire, STOP clears calibration and lane queues, and both timers are cancelled on stop/reassignment. Existing SDK reference-before-lane remains experimental, not original-app parity. No physical lane completion is claimed. Full Node suite: 601 passed, including seven new fault/timing tests. Browser simulator confirmed the control renders. A supervised physical trial is next.

# Repaired scan passed one supervised hardware trial

On 13 November at 10:26 America/Chicago, Groundshock firmware 11866 in SDK mode on build 08fe678 scanned the circuit successfully: 11 pieces / 4.88 m, 24 positions, 12 transitions, no inferred pieces. The operator confirmed stopped, stayed on track, and map matches. Startup had no lane/offset command; first position arrived 818 ms after the speed write; offset calibration followed optical evidence. Trace and detailed limits are in [SCAN-START-REGRESSION.md](slipstream/review/SCAN-START-REGRESSION.md). Power Zone 57 remains unverified/scored-round-blocked; steering, races and whole-app parity remain unaccepted. This supersedes the earlier “hardware retest pending” status for this single layout only.

# Physical scan startup repair — hardware retest pending

Read [SCAN-START-REGRESSION.md](slipstream/review/SCAN-START-REGRESSION.md). Both the formerly successful SDK scan and today's aborted scan received an initial lane cancellation. The newer moving-cancellation stop now halts before optical acquisition. Physical scans no longer issue the speculative startup lane command; cancellation stops and watchdogs remain intact. Simulator-only lane placement is explicitly separate. Today's offset-before-lane trace still cancels, disproving its sufficiency as a steering repair. Latest physical observation: forward movement, no sideways shift, stopped; no map. New cumulative trace retained. Hardware acceptance of this repair is still required.

# App parity requirement and collision dispatch review

The user requires original-app protocol/state-machine fidelity. Current SDK/F&F subsets are not equivalent to the original app; read [the compatibility ledger](slipstream/review/COLLISION-PROTOCOL-PARITY.md) before more hardware changes. Native VehicleMessenger case0x4d has no direct stop; our diagnostic collision pit is a custom safety policy, and raw-packet battle damage is also not established app parity. A fresh read-only Ghidra export covered 63 collision-named functions. Firmware collision counts/age/flags are now visible in live checks; no motion policy changed. 589 Node tests passed; isolated simulator UI verified. Live page not reloaded during this review.

# Supervised batch stopped on firmware collision signal

At 10:04 America/Chicago on 13 November, the first of up to three authorized 150 mm/s pulses received 0x4d after 339 ms. STOP and shared pit activated; remaining pulses were cancelled. Operator confirms stopped and stayed on track with no visible impact. The cumulative trace and replay regression are retained; see [bounded test evidence](slipstream/review/GROUNDSHOCK-BOUNDED-STRAIGHT.md). Collision-signal accuracy and optical localization remain unresolved; do not bypass the pit. No driving-policy change.

# First bounded straight hardware result — 13 November 2026

Groundshock on SDK firmware 11866 completed one supervised 150 mm/s / 500 ms diagnostic on build ceb863c. The operator confirmed movement, staying on track, and physical stop. The timer requested STOP after 501 ms; the recorded STOP write completed 551 ms after the motion write completed. No optical codes or steering occurred. Collision packets around/after STOP remain unresolved; this is not localization, steering, race or full-system acceptance. See [the evidence report](slipstream/review/GROUNDSHOCK-BOUNDED-STRAIGHT.md) and its original 26-event fixture. No runtime change in this update.

# Architecture follow-through: directional targeting and map evidence

Rear-facing cone targeters now honor negative range in the source car's direction of travel. Regressions first reproduced failures using both real Shredder loadouts, then verified ahead/behind, reverse travel, boundary, lateral width and loop wrap. Trailer anchors/global-pose angle semantics remain unresolved; this is not full native combat parity.

Track validation is now a read-only evidence report in the live checks and trace export: geometric closure, start count, repeated IDs, inferred/special pieces and unverified intersection/jump traversal. It never certifies physical validity or changes existing scoring/safety gates. No-start layouts remain supported under existing policy.

The full suite passes587 Node tests. Browser simulator preview confirmed map-check rendering; no real-car motion or firmware-policy changes. Hardware localization recovery remains the priority; command/STOP pulse is not guaranteed to cross an optical code.

# Original app architecture review

Read [ORIGINAL-APP-STATE-MACHINES.md](slipstream/review/ORIGINAL-APP-STATE-MACHINES.md) for the expanded vehicle lifecycle, mapping/localization, host-owned multi-car interactions, feature evidence ledger and staged implementation gaps. A fresh read-only Ghidra export inspected35 selected lifecycle/control functions (including thunks); manifest and reproducible script are committed, proprietary export stays local. This review does not claim complete app or firmware reconstruction. No new firmware commands or hardware trials were performed.

Key new evidence: native pause/full-stop and drive/acquisition explicitly toggle SkipAutoDriveInDeloc0x35; current software does not. Hardware semantics remain unvalidated, so no speculative policy change. Native configuration also makes our short low-speed pulse a command/STOP probe, not guaranteed optical acquisition. Rear-facing cone targeting is a separately reproduced software bug scheduled after control/localization recovery.

# Independent advisory and follow-up repairs

Read [REVERSE-ENGINEERING-ADVISORY.md](slipstream/review/REVERSE-ENGINEERING-ADVISORY.md) for three independent AI reverse-engineering reviews and reproduced repairs. The unknown0x43 incident packet is firmware delocalization-recovery entry. This is newly identified evidence, not a proven physical cause. Scan-reference overwrite, diagnostic auto-calibration, expired-motion race, negative-status aging and startup-notification capture are repaired with regressions. No physical commands in this review pass.

# Recovery implementation: bounded diagnostic and fresh health readings

Added an explicitly supervised three-second countdown / 500 ms diagnostic host window, capped at requested 150 mm/s, with no steering or normal driver commands. Deadline, STOP, collision, reassignment and delayed-write queue cleanup have regression coverage. It is best-effort browser timing, not a firmware failsafe or proof of physical stop. Fresh battery sample (within 30 seconds) is required; recent charger/low-battery reports block the pulse. Unknown/stale status remains explicitly unknown/stale, not a health certificate.

Battery and status ages are now visible and exported; collision and speed-report evidence is retained. A stationary battery-refresh button requests a new sample without starting the car. Steering comments and the root-cause report now qualify the unproven reference hypothesis.

Validation: 572 Node tests and 38 Python tests passed; CWE regression and dependency lab passed; npm audit reports zero vulnerabilities. Local browser simulator confirmed countdown, pulse and automatic STOP. Browser testing caught and corrected timer receiver binding before hardware deployment. No real-car commands, live reload or Codespaces deployment occurred in this implementation pass.

Remaining phase-1 work includes precise build/session identifiers, richer stop/write timing summaries and a successful/failed initialization comparison tool. Normal free-drive acquisition policy is unchanged; do not repeat previous hardware trials without following SYSTEM-RECOVERY-PLAN.md. Further hardware readiness is required, and physical localization/steering remain unresolved.

# Current recovery plan

Read [SYSTEM-RECOVERY-PLAN.md](slipstream/review/SYSTEM-RECOVERY-PLAN.md) first. It supersedes older next-trial instructions below: two pre-steering spin-offs received no optical telemetry, and physical trials are paused pending bounded diagnostics and initialization review. Recent steering changes were not exercised by those trials; causality is not established. Historical test counts below are dated records.

# Review handoff

For a reviewer (human or AI) picking this up cold. It says what changed, where to
look, how to verify, and what is deliberately unfinished or untrusted.

## Current agent handoff

Read [STEERING-AGENT-HANDOFF.md](slipstream/review/STEERING-AGENT-HANDOFF.md)
for exact latest state, the failed cold-start trial, committed evidence, reproduction
tools and remaining raw-trace gap. Groundshock is physically stopped; no next trial
is authorized by these notes. All 557 Node tests pass.

## Repeated physical steering failure; correlation instrumentation ready

Build `1e19867` was loaded in Codespaces. Groundshock SDK initialization succeeded
(firmware 11866, battery 3.82 V). Two short tests at requested 240 mm/s received
positions but cancelled the left-lane request. Operator confirmed stopping; on the
repeat, no leftward shift. Shared pit activation worked; stop latency is unmeasured.

The next build numbers steering requests using the app's seven-bit sequence and
shows SDK received/executed IDs and desired sideways speed. All 556 Node tests pass.
This is instrumentation and a controlled sequence change, not a proven steering
fix. It must not be represented as race/attack acceptance. No further movement is
authorized by the offline work. See the SDK/app audit follow-up for remaining
coordinate-strategy hypotheses and newest-trace provenance limits.

## Control repairs ready for supervised acceptance

The two reproduced SDK/app faults are repaired: unverified geometry cannot
calibrate steering, and cancelled targets are cleared. Cancellation while moving
now opens the shared pit, preventing automatic retries by continuous controllers.
The Power Zone label and signal counts distinguish mapping from activation;
actual zone attacks remain disabled pending hardware evidence.

Fresh checks: 552 Node tests, 38 Python tests, CWE lab and dependency lab pass;
zero npm audit advisories. This includes the existing 1–4-car mode/fault matrix.
The new regressions first failed on the captured piece-57 offset correction and
unachieved steering target. See `hardware-steering.test.mjs` and
`live-diagnostics.test.mjs`. Node 22.23.5; Python 3.14.7.

Changes are on the review branch, not loaded into the active Codespaces browser.
Next hardware gate: load the repaired build while stopped, verify ordinary-piece
left/right steering and STOP, then record marked-lane versus adjacent-lane passes
in both directions. Only then enable a tested Power Zone attack implementation.
Do not describe this as completed physical racing or formal firmware verification.

## Power Zone lane behavior reviewed

Read [POWER-ZONE-AUDIT.md](slipstream/review/POWER-ZONE-AUDIT.md). Fresh Ghidra
and F&F configuration review identifies a direction-aware attack lane that
disables eligible nearby opponents, with cooldown and repeat-hit protection.
The successful Groundshock capture maps piece 57 but contains no zone-supercode
events. Physical lane activation and attack behavior remain unverified; no
runtime changes or car commands were made, and special-piece scoring stays gated.

## SDK/app approach faults identified

Read [SDK-APK-APPROACH-AUDIT.md](slipstream/review/SDK-APK-APPROACH-AUDIT.md).
Fresh targeted Ghidra review plus captured-byte probes originally reproduced two
faults (repaired in the follow-up above): unverified piece 57 still drives offset calibration, and cancelled steering
retains an unachieved target. The packet layout is SDK-consistent; the reason for
firmware cancellation is not yet proved. No live commands or runtime edits were
made in this review. The follow-up repairs need supervised hardware acceptance before racing.

## Hardware trace now replayed

The attached Groundshock capture is preserved and replays to an 11-piece map.
It contains special piece 57 (still blocked for scoring), and the left-lane request
received a cancellation report after 53 ms. New diagnostics expose cancellation;
548 Node tests pass. The cause of cancellation and physical steering remain open.
See the attached-trace section in MVP-ACCEPTANCE.md. No live controller reload or
additional physical movement was performed for this diagnostic change.

## First physical SDK scan

On 13 November, Groundshock firmware 11866 successfully scanned an 11-piece circuit
using Classic SDK connection; the operator confirmed the map was correct and the
car physically stopped. F&F initialization on the same car produced no movement or
positions. See the final section of [MVP acceptance](slipstream/review/MVP-ACCEPTANCE.md)
for the comparison, observed speed discrepancy and remaining physical gates.
Historical statements below that scanning is unproven predate this single test.

## Classroom access preflight

`npm run slipstream:preflight` checks anonymous live readiness, controller delivery
and teaching-route isolation without a host code, rooms or Bluetooth. Set
`SLIPSTREAM_CHECK_ORIGIN` to the public HTTPS origin. It explains private-port
redirects and never changes forwarding permissions. `slipstream:check` runs this
before creating its temporary rooms and refuses subsequent API redirects.
All **545 Node tests pass**, including eight preflight regressions. The anonymous
check passed from the operator laptop against the public Codespaces URL. Actual
phone/iPad classroom access and physical-car acceptance remain open.

## Feature-confirmation audit and browser scoring repair

Read [FEATURE-CONFIRMATION-AUDIT.md](slipstream/review/FEATURE-CONFIRMATION-AUDIT.md).
A real-browser simulation exposed zero lap scores despite movement: timestamps
sampled before synchronous telemetry made fresh positions appear future-dated.
An advancing-clock regression reproduced it; sampling after delivery fixes it
without weakening freshness checks. All 537 Node tests pass. Browser verification
then showed both CPU racers scoring laps (7 and 6 at the captured observation).
Ordinary races now show best/last lap times rather than knockout columns.
The initial Codespaces restart failed because the old Alpine container lost Node
and home state. Rebuilding the configured Node 22 container, adding SSH support,
and keeping private state under `/workspaces/.slipstream-managed` repaired this.
Rebuild and subsequent shutdown/resume preserved the host code and automatically
started the live server. Readiness can lag SSH availability; wait for `/slipstream/ready`.
Four public-proxy clients passed both socket and HTTP checks after rebuild.
GitHub reset port 3000 to private on resume; restored authorized public visibility.
Check forwarding visibility before sharing QR codes. Hardware scanning remains unproven.

## Network lifecycle regression

Five failing tests reproduced callbacks from stopped/replaced connections and a
socket send exception that bypassed callers' promise error handling. The network
client now rejects sends after stop, ignores stale socket/HTTP callbacks and turns
send failures into promise rejections. All 535 Node tests pass, including real
relay integration. This is software evidence only; hardware acceptance is pending.

## Full MVP round regression

All 530 Node tests pass. The 90-second MVP round is exercised through every
simulation update with all-human, all-CPU and mixed drivers for 1–4 cars. Every
driver must score a lap and every simulated transport must receive STOP at the
finish. This extends software evidence; physical acceptance remains incomplete.

## Public relay deployment check

`npm run slipstream:check` now verifies an isolated room through the deployment's
actual origin. Four clients passed WebSocket and forced HTTP fallback through the
public Codespaces proxy, including approval, neutral input, state and revocation.
Temporary rooms were removed. See deployment instructions; no car or phone-hardware
validation is implied. GitHub workflow run 43368273825 passed for `56c0ae8`;
the PR summary was temporarily empty while that run appeared in history.

## Phone neutral handshake and real network client coverage

A stopped phone could retain nonzero steering while the host required a neutral
input to re-arm. Two failing regressions reproduced that recovery deadlock. The
phone now sends zero motion/action values whenever driving is locked, including
sensor changes while waiting. The host's neutral rule is unchanged. Eight new
real network client tests cover 1–4 players over WebSocket and HTTP fallback,
including approval, input, private state and removal. All 522 Node tests pass.
These tests do not validate phone hardware, classroom networking or physical cars.

## MVP startup and acceptance

`npm run slipstream:up` adds managed live-only startup, private persisted host code,
readiness identity, and refusal to replace an occupied server. The configured
Codespace runs it on startup. See [deployment](slipstream/DEPLOYMENT.md) and
[MVP acceptance](slipstream/review/MVP-ACCEPTANCE.md). Local regression: 512 Node
and 38 Python tests pass, audit clean. Public HTTPS now responds, but no successful
real-car scan or 1–4 car physical acceptance is claimed.

## Live diagnostics and optional calibration

See [LIVE-DIAGNOSTICS.md](slipstream/review/LIVE-DIAGNOSTICS.md) for the new live
readout, replay-compatible diagnostic export, measured starting-lane calibration
and the next one-variable-at-a-time physical test. No hardware success is claimed.

## Latest research

[Community/APK protocol cross-check](slipstream/review/COMMUNITY-PROTOCOL-REVIEW.md)
identifies unknown lateral offset in Groundshock telemetry and original-app
set-offset-before-lane-change sequencing. It does not prove the scan failure is
fixed. Firmware-specific packet formats and unsupported short frames remain open.

## Latest real-car compatibility status

Read [CAR-COMPATIBILITY-REGRESSION.md](slipstream/review/CAR-COMPATIBILITY-REGRESSION.md).
The scan is still unresolved. Native 0x23 startup confirmation is now required;
The operator approved a scan-only 300 mm/s unlocalized-speed allowance. It is
restored to zero on first position or stop; physical scan success remains unverified.
All 501 Node tests pass, including 13 scan-bootstrap regressions.
Groundshock's later disconnect was the operator turning it off to leave.

## What this repo is now

Two bodies of work sit on top of the original CS460 teaching scenario:

1. **Security hardening** of the original course code. The scenario shipped with
   deliberate vulnerabilities as exercises; those are now repaired. Full list with
   CWE numbers, the flawed-baseline commit, and verification steps: **[SECURITY.md](SECURITY.md)**.
2. **Slipstream** (`slipstream/`): a new browser controller for real Anki DRIVE /
   OVERDRIVE cars — multi-car Web Bluetooth, automatic track mapping, the original
   game's weapons and car models, computer opponents, and phone/laptop controllers
   that join by per-car QR code through a relay. Guide: **[slipstream/README.md](slipstream/README.md)**.

"Slipstream" is this project's own name. Compatibility references, vehicle names,
and configuration identifiers still name third-party products. This is an
independent project; naming and attribution do not establish distribution rights.

## Where to look

| Topic | File |
|---|---|
| Security changes, CWEs, how to verify | `SECURITY.md` |
| Controller usage, architecture, first-run-with-cars checklist | `slipstream/README.md` |
| How the Android app works (Ghidra + OSINT), what Slipstream is built on | `slipstream/ANALYSIS.md` |
| Limits of the firmware-emulation evidence and why a behavioural simulator is used | `slipstream/FIRMWARE-TWIN.md` |
| The relay (rooms, host code, approval, per-car seats, WebSocket) | `platform/slipstream-relay.mjs` |
| Behavioural car twin (speaks the real BLE protocol) | `slipstream/sim.mjs` |
| Round design, original missions, accessibility and further playtesting | `slipstream/DESIGN.md`, `slipstream/session.mjs` |
| Real-car trace capture + replay for tests | `slipstream/trace.mjs`, `slipstream/fixtures/` |

## How to verify

```sh
npm ci --ignore-scripts
npm audit                        # expect: found 0 vulnerabilities
npm test                         # Node suites (bench, platform, instructor, slipstream)
python3 -m unittest discover -s tests -v
python3 -m lapreturn.cwe_lab     # expect three "flaw_reproduced": false, exit 0
npm run dependency-lab           # expect "regressionCheckPassed": true
```

Review-fix verification on 12 November 2026: **419 Node tests pass on Node
22.23.5**, **38 Python tests pass on Python 3.14.7**, audit reports zero
vulnerabilities, and the dependency/CWE probes pass. Host/phone browser walkthroughs
covered approval, simulated driving, story completion, and portrait/landscape
layouts. The Node suite includes all supported mode/car-count combinations with
mixed human/computer inputs. The follow-up build adds shared pit recovery with
frozen round/battle timers, precision lane/speed gates, independent scan/carry/deliver
tasks for every story participant, purposeful CPU guidance, and phone task/score
feedback. Simulator tests complete all three missions with one and four cars on
Capsule and Figure eight at 400 mm/s; precision guidance earns points where a
full-throttle baseline earns none. Browser review covers the task HUD and shared
pit/recovery flow. These are software checks, not hardware validation.
Run the controller locally with `npm run slipstream` (prints a host code; opens
`/slipstream/`). Plain `npm start` serves the hardened course bench without Slipstream.

## What is NOT done or NOT trusted (please scrutinise)

- **No Slipstream hardware validation yet.** These changes were tested with the simulator or
  recorded simulator traces. The BLE byte layouts follow the published SDK and the
  app analysis, but left/right lane sign, curve direction, multi-car Bluetooth, and
  phone sensors are all unverified on real devices. See the first-run checklist in
  `slipstream/README.md`.
- **No hardware trace fixture yet.** `slipstream/fixtures/` holds only a
  simulator recording; the suite prints "NO HARDWARE TRACES YET". A real trace is
  the single most useful thing to add.
- **No device-enforced host-loss stop is verified.** If the host browser dies
  mid-race, it cannot send STOP. BLE link-loss behavior remains unmeasured; merely
  adding host pings would not prove a car-side timeout. This is the top safety item.
- **Trademarks / data provenance.** `slipstream/data/*.json` contain derived track
  measurements plus copied vehicle names, weapon identifiers, and selected
  structured gameplay configuration. They are not numeric-only tables. The
  extractor does not bundle app binaries, artwork, or audio. Source permissions
  and distribution terms remain unresolved; no legal clearance is asserted.
  APK/OBB identities, extraction, Java transport paths and selected broader native
  paths have now been independently reproduced; firmware execution remains
  unverified. See `slipstream/review/INDEPENDENT-REVIEW.md` for analysis warnings.
  Reported high entropy is not conclusive evidence of encryption.
- **The course exercises were removed.** The deliberate flaws the class was built on
  no longer reproduce; use `course-vulnerable-baseline` at
  `ab809451fc99564474b2b83baca0f63b78c24034` for those exercises.

## Fast & Furious, 3D studio and container hosting

Read [the Fast & Furious review](slipstream/review/FAST-FURIOUS-REVIEW.md) for the
independent `com.anki.foxtrot` analysis, matching derived tables and transport code,
and the native-analysis warnings. Power Zone effects remain unimplemented. Diagnostic-only supercode decoding and
`slipstream/tools/inspect_trace.mjs` now prepare for real captures. Recordings retain
firmware, distinguish mixed sessions, and reject callbacks from previous sessions.
[Deployment instructions](slipstream/DEPLOYMENT.md) describe Codespaces hosting
with a nearby Bluetooth laptop and phone clients. The optional Three.js studio
uses original procedural graphics with a 2D fallback; desktop panels resize. The 3D feedback pass adds energy bars,
shields, grouped numbered mission gates and attack/recovery cues. Browser checks
exercise 13 effect types, cached gate labels and reduced-motion status visibility.
Local verification covers 1440×900, 390×844 and 844×390 host layouts, keyboard
resizing, WebGL context-loss fallback, and a non-root Docker build with assets
and authenticated room join/approval. Actual Codespaces forwarding and physical
Bluetooth/sensors remain unverified.

## Broader review and coordination build

Read **[the independent review](slipstream/review/INDEPENDENT-REVIEW.md)** and
**[REA assessment](slipstream/review/REA-REVIEW.md)**. The new pass repairs batch
parser failures, stale/unknown targeting, parked-car targeting, shield ordering,
and long startless mapping. Circuit planning, crew alliances, target IDs and
assist rewards are available. `verification.test.mjs` exhaustively checks 22,620
bounded association states; it is not a formal proof of the complete system.
Smart-car analogies and further coordinated-play designs are in `DESIGN.md`.

## Review follow-up

The follow-up fixes malformed relay-key crashes, adds bounded transport-failure
cleanup, latches off-track stops until explicit recovery, preserves host control
ownership, and halts real cars on visibility loss. STOP ALL always stops; Free
drive is a separate explicit action. Four cars is the maximum and the chosen
speed ceiling also applies to scans and boosts. Arcade, Competition and Story
missions offer short rounds with optional phone haptics and calibrated tilt.
See `slipstream/README.md` for controls and `slipstream/DESIGN.md` for the design
rationale. These software changes do not demonstrate physical stopping behavior.

## Provenance of this work

The initial PR was produced across sessions with Claude (via Claude Code); review
fixes and game-design work were subsequently assisted by Codex. Treat all of it
as needing the same review as any machine-generated change, especially the untested
hardware assumptions above.

## Phone input follow-up

Phone throttle now tracks an active pointer gesture. Disconnects, stops and car
reassignments invalidate old gestures and held inputs; a new car starts with
neutral steering. Unassigned/revoked phones disable stale weapon controls.
Regression tests exercise the actual phone handlers with synthetic browser events;
physical touchscreen and sensor behavior still need device validation.

Phone release now remains locked and retries until acknowledged. Gamepad slots
retain disconnected gaps, disconnected controls clear held weapons, and stop/
reconnect/reassignment requires neutral controls before rearming. Host/phone
regressions cover these transitions without claiming physical-device validation.

## External review remediation (12 November 2026)

Read [PR4 review response](slipstream/review/PR4-REVIEW-RESPONSE.md) for reproduced
findings, separate fixing commits, baseline/final checks and remaining risks.
Final verification: **478 Node tests, 38 Python tests**, zero npm audit findings;
CWE and dependency regression probes pass. Includes 42 injected-fault matrix cases.
H1/H2/H3/M1/M2/M3/M4/M12 are repaired in software; H4 special tiles 53/54/57 are
quarantined from scored rounds, with physical behavior still unverified.
The 2-second telemetry default remains. Story/Precision intersection rounds are
blocked pending validation; longer Story algorithm-test timing is simulator-only.
No hardware validation or complete-system formal proof is claimed. M13 and
car-enforced host-loss stopping remain open. See the response before deployment.

Public hardware trials now use `PORT=3000 npm run slipstream:live`, which excludes
the teaching APIs and bench pages (M13 deployment isolation). The user explicitly
authorized public Codespaces forwarding for QR controllers. Latest local Node run:
479 tests passed. See `slipstream/DEPLOYMENT.md`; hardware limits remain unchanged.

## First hardware scan — 12 November 2026

The operator identified the connected car as International MXT and reported almost
three laps in the 45-second scan, on a circuit containing start/finish and F&F
Power Zone. The browser misidentified it as Groundshock via its fallback. A partial
recording started about 20 seconds into the scan. It contains short 8-byte 0x29
frames and battery reports, but no 0x27 position frames. The scan timed out; the
UI reported zero speed after STOP. Physical stop is not established by UI alone.
`slipstream/fixtures/mxt-short-transitions.json` preserves hardware bytes and labels
the incorrect model metadata; simulated-car events are excluded. Replay reproduced
a safety bug: short 0x29 frames refreshed the track watchdog despite lacking the
supported classic transition layout. The decoder now requires the full layout.
480 Node tests pass. This repairs the watchdog gap, not MXT localization or Power
Zone compatibility. Do not increase scan time or infer piece IDs from these bytes.

The subsequent [MXT-focused Ghidra/JADX pass](slipstream/review/MXT-DECOMPILE-FOLLOWUP.md)
re-exported initialization, transition and receive functions from the F&F library.
It confirms the supported classic layout and an application startup sequence unlike
our SDK path, but does not establish the missing-position root cause. No additional
live commands were sent. Startup-inclusive recording is the next evidence gap.

## F&F initialization implementation

The Fast & Furious modular-kit connection now uses an app-derived phased startup,
with exact default road-network bytes recovered from native data and ping/version
barriers. Startup recording attaches before the first command. Unknown models no
longer default to Groundshock. See [initialization evidence and deliberate safety
differences](slipstream/review/FF-INITIALIZATION.md). 484 Node tests pass; real-car
startup and scanning still require validation with the new build.
