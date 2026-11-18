# Instructor single-car driving proof of concept

**One supervised wheels-clear 100 mm/s pulse and physical stop were observed on the instructor’s MXT. Full hardware acceptance remains incomplete; keep this feature off for students until code review and the record below are complete.** This is an additive instructor experiment. The existing stationary Web Bluetooth bench, replay, battery/LED evidence and coursework remain available through their existing paths; the original bench cannot encode speed commands.

The instructor page starts in **SIMULATION**, with synthetic responses and no radio. LIVE uses actual Web Bluetooth GATT writes to the one explicitly selected and physically confirmed car. There is no automatic movement, reconnect/resume, multi-car broadcast, lane control, firmware update, raw-command entry or server motor endpoint.

The original **750 ms pulse** remains the first movement test. An optional **experimental track scan** becomes available only after a successful pulse/STOP sequence and the operator's observation of both on the same car in the same connection session. It can drive longer than a pulse, so its separate procedure and acceptance checks below apply. The single raised-wheels movement/stop observation does not verify track travel, emergency/fault stopping or track reconstruction.

## Run locally

From the repository root, install the lockfile's existing dependencies if needed:

```sh
npm ci --ignore-scripts --no-audit --no-fund
```

Ordinary coursework mode keeps the new page unavailable (HTTP 404):

```sh
npm start
```

For an instructor's private qualification session, stop that process and explicitly opt in:

```sh
CS460_INSTRUCTOR_LIVE_DRIVE=I_ACCEPT_UNTESTED_HARDWARE npm start
```

Open [the instructor page](http://127.0.0.1:8000/instructor-drive/) in a separate desktop Chrome or Edge window on the computer near the car. The server binds only to `127.0.0.1`; `PORT` can change the default 8000. The enabled page still starts in **SIMULATION**; switching to LIVE is a separate deliberate action. To disable the feature, stop the process and restart with the variable unset.

The environment flag is deployment opt-in, **not authentication or a security boundary against someone who controls the local code**. Do not publish this route, enable it on a shared/student host, add a public tunnel, or serve the repository root with a generic static server. The teaching platform deliberately retains educational vulnerabilities. Use the supplied local server, which mounts only designated assets and gates the instructor route.

LIVE needs a working BLE adapter, Bluetooth enabled, browser/OS permission, `navigator.bluetooth`, the browser Web Locks API and a secure context. A same-origin exclusive lock prevents another instructor tab from selecting a second car; it cannot control unrelated apps or other origins. Loopback satisfies the relevant local-origin requirement. Standard Firefox/Safari and many embedded browser previews cannot run this flow; do not infer a car fault from an unavailable browser API. [Primary browser references and compatibility limits](SOURCES.md#browser-requirements-and-failure-limits).

## Before touching hardware

For the underside power button, several identical Fast & Furious cars, or ambiguous chooser entries, follow [the physical identification guide](IDENTIFICATION.md). The instructor driving flow requires isolation before selection; the existing stationary bench remains available for coordinated candidate trials.

1. Assign **one unique physical label** to the car, record its model and inspect its wheels, tires, battery and charger condition. Charge it using its intended hardware, then remove it from the charger for motor tests. A voltage reply alone does not establish capacity or battery health.
2. Power off every other nearby course car. Close other apps/tabs that could connect to this car. Keep the exact selected car in sight; a model name is shared by many cars, and the browser ID is not a printed serial number or MAC address.
3. For the first command tests, secure the car in a stable fixture with wheels completely clear and nothing that can catch in them. Keep hair, fingers, cables and loose items clear. After fixture tests pass, use a flat contained Anki track clear of people, pets, obstacles and table edges. Do not use an arbitrary floor as a track.
4. Keep an operator beside the car, able to physically stop/power it off if the radio or page fails. Keep the browser visible and computer awake. The on-screen emergency STOP cannot operate a disconnected radio.
5. Rehearse in SIMULATION first, including confirmation, arming, a pulse and emergency STOP. Synthetic evidence must remain labeled SIMULATION and must not be submitted as hardware acceptance evidence.

## One-car LIVE sequence

1. In **Connect one car**, deliberately select **LIVE**, enter the car's unique physical label, acknowledge the setup precautions and open the chooser. Select only the isolated assigned car. The expected Anki service is used for discovery. If that filtered chooser fails, the explicit all-devices fallback under **Debug, evidence & instructions** is available only after physical isolation; it does not establish compatibility. Cancel if selection is ambiguous. The label and selected browser identity stay bound to this session.
2. In **Confirm the exact car**, choose one physical check. **Check using power button** opens a **two-minute (120-second)** window: press and release the labeled car's underside button once to turn it off, and let the page observe the actual Bluetooth disconnection. Turn that same car on with one press, then explicitly choose **Reconnect same car**. That button opens a fresh chooser to rediscover the car after its power cycle. Select the same device; the saved browser ID is checked before connection, and a mismatch is rejected. There is no automatic reconnect. The page checks the required browser ID before GATT and discovers fresh services/characteristics. This observation window sends no motor command. Alternatively, **Try light signal · optional** requests engine lights **off → green → off** through the inherited bench trial, followed by identification SDK cleanup. Observe that exact pattern on the labeled car. A connection light, completed writes or a changed chooser count do not substitute for either check. [Detailed identification procedure](IDENTIFICATION.md).
3. Check the operator observation box only after personally completing the chosen physical check, then select **Confirm this car**. The page retains the exact label/device association without requiring redundant ID typing. This is recorded human confirmation, not authenticated hardware identity. If the light trial produces no visible change, leave its observation box unchecked and use the power-button check; if neither check succeeds, disconnect and investigate. A fresh connection after ordinary disconnect or emergency STOP requires fresh identification.
4. Arm explicitly. The controller requests version, battery and ping before enabling the motion SDK profile and requesting zero speed. Only firmware **9511 or 11866** is provisionally allowed. Other versions are blocked; do not alter firmware to bypass the gate. Inclusion in this list means “candidate for controlled qualification,” not “hardware tested.”
5. The raw battery reading must be **3500–4500 mV**. This is a provisional bench sanity gate, not a chemistry specification, state-of-charge estimate, charger recommendation or battery-health guarantee. If outside it, inspect/charge with appropriate hardware and diagnose the reading before retrying.
6. Arming expires after **5 seconds**. Each explicit movement action consumes that arm for **one pulse**, with a fresh ping before dispatch. Default speed is **100 mm/s**, maximum **200 mm/s**, with requested acceleration/deceleration **1000 mm/s²**. The browser schedules STOP for **750 ms** after the pulse budget begins, before dispatching the speed write. This is a timer target, not a guaranteed maximum: scheduling, a busy/frozen page or delayed BLE writes can make STOP late or prevent it. The observed Chrome SIMULATION trial requested STOP after 752 ms. Actual motor duration, speed, distance and stopping still require physical observation.
7. Use the prominent emergency STOP whenever needed. Do not re-arm until an operator observes that the car has actually stopped. Normal STOP disarms; each additional pulse requires a new explicit arm. Emergency STOP also disconnects, so another attempt requires selection and one of the physical identification checks again. Disconnect when done, download the session trace, and shut down the opted-in server.

## Experimental one-car track scan

This is active driving on a contained track, not Bluetooth device discovery. It remains instructor-only and hardware-unverified. The first wheels-clear pulse, low speed ceiling, physical identity and battery/firmware gates remain required. Community scanners use higher speeds; this experiment does **not** raise its ceiling to match them. Missing optical readings at the permitted speed are a valid incomplete result.

1. Complete the normal wheels-clear pulse above and personally observe the wheels move and physically stop. The scan gate accepts only the ordinary **750 ms pulse-limit STOP with a completed zero-speed write**, followed by the operator's observation. A cancelled pulse, emergency STOP, fault, successful nonzero write alone or simulation result does not qualify a LIVE scan.
2. Under **Discover the track · experimental**, tick **I saw this car's wheels move during the last pulse and stop afterward**, then choose **Record movement & STOP observation**. Qualification is bound to the same immutable car, label, mode, firmware and connection session; it does not survive reconnect or transfer to another car.
3. Place that same car on a **flat, closed, contained Anki track**, keeping its connection and the operator beside it. Keep other cars off. Confirm **The same car is now on the closed, contained track**. Use the existing Speed field: scan speed cannot exceed either the successfully qualified pulse speed or **200 mm/s**. Do not raise speed to chase missing codes.
4. Select **Arm · 5 seconds**, which repeats the telemetry checks, then explicitly choose **Start track scan · up to 45 seconds** within that arm window. The controller sends one nonzero speed request and schedules STOP after at most a **45-second requested scan budget**. Browser/radio delays can make the physical stop later or unavailable; this is not a guaranteed maximum travel time.
5. Watch the car continuously. The software requests STOP sooner if no valid **position (`0x27`)** telemetry arrives within **5 seconds**, if position readings then disappear for **2 seconds**, if a heartbeat reply fails, or if evidence becomes malformed, unsupported or ambiguous. Transition messages alone cannot keep the scan moving. It also stops on delocalization, an observed supported loop, cancellation or the scan deadline. Heartbeats are scheduled about every 500 ms with a 1-second reply timeout. Emergency STOP remains available; intervene physically if delivery is uncertain.
6. Choose **Download track evidence** and keep it with the session trace. LIVE observations contain received raw frames and timing; piece classes and geometry are separately derived. A diagram is produced only for a supported simple flat sequence returning to its start anchor with consistent direction and geometry closing in position and heading. One such loop is **not a surveyed track or a second independent validation lap**. Check it against the physical track; gaps, unknown/special pieces, jumps, grade or ambiguous curves must remain incomplete rather than be filled with invented data.
7. Every scan termination revokes its qualification. A further scan requires another successful bounded pulse, physical movement/STOP observation, explicit track confirmation and arm. Nothing starts a second lap or retries at a higher speed automatically.

The default SIMULATION transport supplies no optical track frames, so its scan stops incomplete. Unit fixtures exercise known sequences explicitly as simulated evidence; the UI does not fabricate a LIVE track. The low-speed scan may fail to read enough track codes even when motor commands work. [Source comparison and decoder limits](SOURCES.md#track-discovery-is-active-driving-and-inference).

## What STOP does and cannot promise

STOP requests the same speed opcode with requested speed zero. Software disarms on STOP/fault and attempts that packet while a suitable connection is available. Timeouts, write/parse errors and disconnection must leave the interface unable to start another pulse automatically. Keep the trace's distinction between **STOP requested**, **write completed**, and **physically stopped**.

A reply is observed in a pending request window; these packets have no transaction nonce, so the browser cannot prove which request caused it. STOP sends zero speed and does not restore the pre-session light or SDK state.

A browser timer is not a car-side command lease. Sleep, process termination, tab suspension, adapter failure or BLE loss can prevent the timer and/or STOP packet from taking effect. There is no verified firmware watchdog in this proof of concept. The car might keep moving or enter its own recovery behavior. If STOP delivery is unavailable or uncertain, intervene physically; do not wait for the page to prove a stop it cannot observe. Fault tests belong in the wheels-clear fixture before any track driving.

The exact wire packets, firmware rationale, public reports, source revisions and license decisions are in [SOURCES.md](SOURCES.md).

## Software verification

Run the repository regression suite and the dedicated drive tests from the repository root:

```sh
npm test
node --test instructor-drive/*.test.mjs
```

See [VALIDATION.md](VALIDATION.md) for the actual results, browser findings and remaining hardware gap; review the PR for the exact tested commit. Automated transport fixtures validate software behavior, packet bytes and fault paths; they do not connect to a physical car. Browser tests with injected fake Bluetooth must also be labeled simulated. Do not turn a passing test suite into a hardware-ready claim.

## Hardware acceptance record — all items initially pending

Complete this record for **one specifically identified car** before student access. Preserve raw LIVE TX/RX logs and operator observations separately; keep real device identifiers in private inventory. Requalification is needed after a car, firmware, host, browser or transport change. The initial November 11 LED session produced no observed custom light change and sent no motor command. A later **22:53 UTC** trial completed the physical OFF/ON identification and exact-device reconnect, received fresh firmware **9511**, battery **3594 mV** and ping replies, then sent one requested **100 mm/s** pulse. The operator separately saw the raised wheels move briefly and stop. [Redacted pulse trace](validation/live-pulse-excerpt.txt) and [full validation record](VALIDATION.md#first-observed-real-motor-pulse). Full acceptance, including track and fault behavior, remains incomplete.

| Record field | Value to enter |
| --- | --- |
| Operator and date/time | Instructor observation, 11 November 2026, 22:53 UTC; operator identity retained privately |
| Reviewed commit / PR | Pending |
| Physical label and car model | International MXT; unique inventory label retained privately |
| Exact browser device ID / selected name | Retained privately; exact-device reconnect recorded |
| Raw firmware reply / decoded version | `05 19 27 25 00 00` / 9511 |
| Host OS, browser version, BLE adapter | macOS 26.6.2, Chrome 157; adapter detail pending |
| Initial/final raw battery mV | 3594 mV at arming; final reading pending |
| Fixture and contained-track description | Raised wheels observed; fixture details and track acceptance pending |
| Log/evidence file and observed stop distance/time | [LIVE pulse trace](validation/live-pulse-excerpt.txt); STOP requested after 752 ms and write completed after 756 ms, both host timings; mechanical latency/distance unmeasured |
| Optional scan evidence, physical track comparison and incomplete cases | Pending |
| Reviewer / instructor sign-off | Pending |

- [ ] Default server returns 404 for the instructor page; no query, browser storage value or ordinary support API enables it. Enabled page visibly starts in SIMULATION.
- [ ] Real chooser targets only the isolated labeled car. The session label/device association is immutable. A wrong ID on power-check reconnect, absent physical-check evidence or missing operator/safety confirmation cannot arm.
- [ ] Record either the visibly observed off → green → off pattern on that exact car **or** deliberate physical power-off → observed GATT disconnect → explicit same-ID reconnect → operator attestation. Blue connection lights, completed writes and scan counts alone do not qualify. No other car reacts.
- [ ] Raw ping, version and battery replies are captured. Allowed version is recorded, not inferred from a model name. Unknown/malformed replies and out-of-gate battery values cannot authorize motion.
- [ ] Arming itself causes no movement. An unused arm expires after 5 seconds, without later movement.
- [x] One explicit requested 100 mm/s pulse on this MXT produced observed raised-wheel movement followed by a physical stop, at 22:53 UTC on November 11.
- [ ] Measure mechanical stopping latency and wheel speed/distance in the fixture; the 752/756 ms host timestamps are not mechanical measurements. Repeatability remains to be established.
- [ ] Emergency STOP interrupts a pulse. Repeated STOP is safe. Further movement requires re-arming; switching mode, disconnecting or reconnecting never auto-starts.
- [ ] In the fixture, test Escape/cancellation, loss of focus/visibility, notification timeout, write failure/stall and BLE disconnection. Record actual car behavior and any failed STOP delivery. Keep immediate physical intervention available.
- [ ] Confirm no queued late nonzero command runs after STOP/cancellation. Confirm a stale chooser/connection cannot replace the current selected car.
- [ ] Only after the fixture checks pass, repeat a low pulse on the contained track, record actual travel/stop distance and confirm the car stays contained. Do not assume optical localization is reliable at this crawl speed.
- [ ] Before any experimental scan, the same-session completed pulse and observed movement/STOP are recorded. Missing attestation, wrong/reconnected car, unsupported firmware, excessive speed or absent contained-track confirmation blocks scanning.
- [ ] Scan never exceeds the qualified requested speed or 200 mm/s. Verify early STOP requests for absent initial track data, stale track data, heartbeat failure, invalid/ambiguous frames and delocalization in controlled conditions; record actual physical stopping separately.
- [ ] Verify the 45-second STOP scheduling target, explicit cancellation and emergency STOP. A stopped/failed scan cannot restart, change speed or repeat a lap automatically; qualification must be earned again.
- [ ] Preserve raw LIVE track frames separately from inferred piece classes/geometry. Compare a complete simple loop with the physical track and a separately initiated repeat. Unknown/special pieces, missing codes, grade, direction ambiguity and low-speed reading failure remain incomplete; no guessed map is presented as measured.
- [ ] Verify existing replay, battery and LED evidence, coursework routes and intentional vulnerability exercises still behave as required.
- [ ] Instructor reviews residual browser/link-loss risk, signs this exact setup, and separately approves any student release. Leave LIVE unpublished until then.

A failed item is an investigation result, not permission to raise the speed, remove a gate, flash firmware or switch to a guessed packet format.

Slipstream likewise marks Fast & Furious IDs 53, 54 and 57 special/unverified and
blocks scored rounds on maps containing them. Neither controller certifies their
geometry or Power Zone behavior.
