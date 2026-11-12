# External review of PR #4 at `2835eb6`

12 November 2026. Reviewer: Claude (Anthropic), run at the repository owner's request in a session separate from the ones that wrote this branch. This is an AI-generated source review of `slipstream-and-security-hardening` against `main` (`ab80945`).

**Limits.** No test suite, browser, container or hardware was run for this review, and no code was changed. Findings marked "Code" were traced in source with file and line. Reproduce each one with a failing test before repairing it. Line numbers refer to commit `2835eb6`.

## Bottom line

Slipstream at `2835eb6` is ready for a simulator demo, conditionally ready for a single-car bench trial, and not ready for classroom use.

**How to read this review.** I read every Slipstream runtime module, the relay and the server at this commit, and the diff against `main` (`ab80945`). I could not run the test suites: this session's policy blocked executing repository code. "Confirmed" below means traced in source with file and line, not reproduced by running it.

The four findings that matter most:

1. **A phone-driven car restarts by itself after a network blip on the host side.** The host's dead-man stops the car, then accepts the phone's still-latched throttle when the link heals (H1).
2. **Nothing stops a car whose telemetry goes silent while it is commanded to move.** Scans have no deadline, and stops are never checked against telemetry. The older instructor-drive module on `main` has these guards; Slipstream does not (H2).
3. **The driver dropdown keeps keyboard focus.** Driving keys then operate the dropdown and can select Computer, which starts the car immediately in free drive (H3).
4. **The Fast & Furious special tiles are mapped as ordinary straights.** That rests on an extractor that defaults unknown piece kinds to "straight". The instructor module in the same repo classifies the same IDs as unsupported (H4).

What held up under independent checking:

- All command encoders and the position, transition, intersection and offset frame layouts match the public SDK header I cloned (`anki/drive-sdk@4103526`).
- The default lane sign (positive = right) matches the SDK tool's own help text. The advertisement model-byte offset matches the SDK parser.
- `npm audit` reports 0 vulnerabilities. All 69 lockfile entries carry registry URLs and integrity hashes.
- A static count of declared tests gives exactly 419 Node and 38 Python tests. I did not execute them.
- I found no HTML injection sink. Car, player and relay text reaches the page only through `textContent`.

## 1. Prioritized findings

Twenty findings are High or Medium, fourteen are Low, and seven are evidence gaps. HANDOFF.md and SECURITY.md are repository-root files. Paths are relative to `slipstream/` unless they start with `platform/`, `instructor-drive/` or `lapreturn/`.

**Severity.** High: can cause unexpected motion or an unverified stop on real cars, or blocks the primary kit. Medium: wrong control ownership, unfair or broken game outcomes, or a control that does not do what is claimed. Low: usability, robustness or cosmetic.

**Evidence.** Code: follows deterministically from the source. Code + browser or Code + hardware: the logic is confirmed, the consequence depends on browser or car behaviour. Gap: evidence is missing.

| ID | Severity | Evidence | Finding | Main location |
| --- | --- | --- | --- | --- |
| H1 | High | Code | Phone-driven car resumes by itself after a host-to-relay interruption | `app.mjs:337-341, 366-375` |
| H2 | High | Code + hardware | No stale-telemetry watchdog, no stop verification, no scan deadline | `car.mjs:83-84, 157`; `game.mjs:91-101, 155-178` |
| H3 | High | Code + browser | Driver dropdown keeps focus; keys can select Computer, which moves the car at once | `app.mjs:98, 294-297`; `game.mjs:47-50, 161-162` |
| H4 | High | Gap, contradiction in repo | F&F special tiles 53, 54, 57 treated as ordinary straights | `tools/extract_config.py:22, 34`; `instructor-drive/track.mjs:11` |
| M1 | Medium | Code | A reconnecting phone is re-seated after Leave car or host revocation | `app.mjs:350-358, 364` |
| M2 | Medium | Code | Gamepad-to-car binding shifts when an earlier car leaves gamepad mode; window blur does not stop gamepad cars | `app.mjs:311, 314-319` |
| M3 | Medium | Code | One car's link loss or connection fault raises no shared stop and no alarm | `app.mjs:132`; `car.mjs:58-66` |
| M4 | Medium | Code | Scan moves the first connected car with no countdown and re-arms every car; pit resume launches CPU cars with no countdown | `app.mjs:139-142`; `game.mjs:79-101` |
| M5 | Medium | Code + hardware | Lane-sign learning can flip on one sample; a wrong sign sends a lane change off the track edge | `car.mjs:99-110` |
| M6 | Medium | Code + browser | Control tick has no fault containment and shares the main thread with 3D rendering | `app.mjs:518-542`; `render3d.mjs:135-153` |
| M7 | Medium | Code | Stopped cars drift forward on the map for 2 s, then become untargetable while recharging | `track.mjs:224-229`; `battle.mjs:63-67, 158` |
| M8 | Medium | Code + hardware | Story and precision progress resets on any non-positive movement sample | `session.mjs:145-147, 153-154, 164-168` |
| M9 | Medium | Code | Any stop over 2 s, any knockout, or anyone's pit stop wipes lap progress | `session.mjs:91, 184` |
| M10 | Medium | Code | Balance: sustainable instant-KO pulse ram, Boost with no effect at full throttle, forced lane changes undone next tick | `battle.mjs:160, 238, 261-268, 322`; `game.mjs:171-174` |
| M11 | Medium | Code | Lap sprint has no skill lever at a fixed ceiling; goals and gates ignore track length and car count | `session.mjs:13-15, 22-23, 51, 117` |
| M12 | Medium | Code | Host-code "rate limit" does not limit guessing | `platform/slipstream-relay.mjs:147-153` |
| M13 | Medium | Code | Slipstream mode still serves the course bench and mock API; docs disagree about a Public port | `platform/server.mjs:93-119, 152`; `app.mjs:438` |
| M14 | Medium | Code | A saved map is trusted without a verification lap | `app.mjs:147-149`; `track.mjs:191-196` |
| M15 | Medium | Code (CSS values) | Live-hardware chip hidden at 1200 px and below; labels under 10 px; phone weapon labels at 1.1-2.3:1 contrast | `style.css:64, 73`; `pad.html:33-36` |
| M16 | Medium | Code + browser | Player list and car-pick buttons are rebuilt several times a second, dropping clicks and focus | `app.mjs:379, 397-416`; `pad.mjs:124` |

### High-severity findings in detail

**H1 · Phone-driven car resumes by itself after a host-to-relay interruption**

- **Where:** `app.mjs:337-341` (dead-man), `app.mjs:366-375` (input accepted with no re-arm), `app.mjs:434` (link status only updates a note), `pad.mjs:128-135` (the phone keeps sending while its own link is up).
- **Trigger:** the host laptop's relay connection drops for more than 0.7 s while the phone stays connected with a non-zero throttle. A Wi-Fi roam or one WebSocket reconnect is enough; the client backoff starts at 0.5 s (`net.mjs:82`).
- **Consequence:** the car stops, then accelerates to the old throttle when the next input arrives. Nobody touched anything. The phone locks itself only when its own link drops (`pad.mjs:50-51`); it cannot see a host-side outage. DESIGN.md states the opposite intent: "Reconnection should require neutral input before motion can resume."
- **Reproduce (harness, not executed):** in the `host()` harness of `host.test.mjs`, seat a phone player and send `onRelay({type:'input',player:1,throttle:1})`. Tick, advance time 1000 ms, tick (speed is 0), send the same input again, tick. Current code gives speed > 0. On hardware through Codespaces: switch the laptop's Wi-Fi off for three seconds while a phone on another network holds 50% throttle.
- **Repair:** give each phone seat a host-side `armed` flag, like `gamepadArmed`. Clear it on dead-man trip, halt, seat change and relay status change. Set it only when an input with throttle 0 arrives. On the phone, treat one second without a state message as not ready.

**H2 · No stale-telemetry watchdog, no stop verification, no scan deadline**

- **Where:** `car.mjs:25` with `protocol.mjs:37-38` (SDK mode with the override-localization flag). `car.mjs:83-84, 157` (telemetry age feeds only a display value). `game.mjs:155-178` (the tick never checks telemetry age). `game.mjs:91-101` (a scan sets a speed once and waits). `car.mjs:117` (an unchanged speed is never re-sent). No ping is ever sent, and `refreshBattery` (`car.mjs:155`) is never called.
- **Trigger:** a moving car stops reporting positions and no delocalized (0x2b) message reaches the host. Or a STOP write succeeds in the browser but the car keeps reporting motion. Or a scan never closes.
- **Consequence:** the last speed command stays in force indefinitely and the card shows the stale speed as live. The public SDK header says this flag must be set for speed and lane commands to work, and names it "override localization". What the firmware then does off the track is not documented there, so it cannot be assumed. A scan circulates at up to 450 mm/s until someone cancels it.
- **Precedent in this repo:** `instructor-drive/README.md:63` stops a scan after 5 s without a first position, 2 s without a later one, and at a 45 s ceiling. Slipstream dropped all three.
- **Reproduce (simulator console, not executed):** start free drive or a scan with one simulated car, then run `slipstream.world.cars[0].listeners.clear()`. The simulated car keeps lapping, the host keeps its command, and nothing stops either.
- **Repair:** add a per-car watchdog in `Game.tick`. If commanded speed is above zero and no position or transition arrives for N ms, latch a safety stop and open the shared pit. After any stop, if positions still arrive after 1 s, re-send STOP and raise an alarm. Give scans a lap and time budget. Start from the instructor-drive values and tune them on hardware.

**H3 · Driver dropdown keeps focus; keys can select Computer, which moves the car at once**

- **Where:** `app.mjs:38` (options in order: Parked, On-screen controls, Keyboard W A S D, Keyboard arrows, Gamepad, Phone or link, Computer). `app.mjs:98` (the change handler never blurs). `app.mjs:294-297` (the game ignores keys while a SELECT has focus). `game.mjs:47-50, 161-162` and `battle.mjs:384-387` (a CPU driver gets 55-75% throttle on the next tick whenever the game is not halted and a map exists).
- **Trigger:** a completed scan leaves the game un-halted (`game.mjs:103-110`). Choose "Keyboard arrows" from a car's dropdown, then press the arrow keys to drive. In Chrome on Windows or Linux, arrow keys change a focused closed select and fire `change` at each step. Three presses of ArrowDown reach Computer. Letters also type ahead: G selects Gamepad, O On-screen, P Parked or Phone.
- **Consequence:** the car changes driver unpredictably and, on Computer, launches with no Start and no countdown. The page warns that real cars move as soon as they have a driver, but this is not a deliberate choice of driver.
- **Reproduce (not executed):** two simulated cars, scan, pick "Keyboard arrows" for car 2 with the mouse, press ArrowDown three times. macOS opens the menu instead of changing the value.
- **Repair:** blur the select after `change`. More fundamentally, never start a CPU car from a selection change. Require Start round or an explicit Arm button with the same 3 s countdown.

**H4 · Fast & Furious special tiles treated as ordinary straights**

- **Where:** `tools/extract_config.py:22, 34` maps any unknown piece kind to `straight` and then discards the kind code. `data/pieces.json` lists 53, 54 and 57 as 560 mm straights with 39 location codes, where the other straights have 48. `README.md:154-157` lists them as supported. `sim.mjs:14` uses 53 and 57 in a built-in layout, so the tests confirm them as straights. `instructor-drive/track.mjs:11` on `main` classifies the same IDs as "Fast & Furious special" and unsupported.
- **Why it matters:** the F&F kit is the primary kit. `review/FAST-FURIOUS-REVIEW.md:88-91` cites a vendor FAQ saying the Power Zone track is unsupported in OVERDRIVE 2.6 and can crash its scan. Byte-identical re-extraction shows the extractor is deterministic. It does not show that it classifies these tiles correctly.
- **Consequence:** unknown. Outcomes range from "works as a straight with a dead zone" to maps that never close or positions that jump on that tile. Supercode messages from the tile are decoded for diagnostics only.
- **Reproduce:** needs hardware. Scan a loop without the special tile, then the same loop with it, and compare the recorded traces.
- **Repair:** keep the raw kind code in `pieces.json`. Mark 53, 54 and 57 as "special, unverified" and block scored rounds on maps containing them until a hardware trace is committed as a fixture. Make Slipstream and instructor-drive agree on one classification.

### Medium-severity findings in detail

**M1 · A reconnecting phone is re-seated after Leave car or host revocation**

- **Where:** `app.mjs:364` calls `seat(p)` on every `online` event. `seat` (`app.mjs:350-358`) falls back to the first free phone car when the player has no wanted car. It never checks `p.manual`, which release and revocation set (`app.mjs:349, 368`).
- **Trigger and consequence:** a player leaves a car, then locks the phone or switches apps. On return the socket reconnects, the relay emits `online` (`platform/slipstream-relay.mjs:91-95`), and the host seats them again. They often get the car they just left, or one meant for someone else. README says later phone inputs "cannot silently reclaim" a revoked car; a reconnect can.
- **Reproduce (harness, not executed):** seat player 1, send `onRelay({type:'input',player:1,release:true})`, then `onRelay({type:'online',player:1})`. `p.driver` is set again.
- **Repair:** in the `online` branch, seat only when `p.manual` is not set, and only into `p.car`.

**M2 · Gamepad binding shifts; window blur does not stop gamepad cars**

- **Where:** `app.mjs:314-319` assigns a pad index by counting gamepad drivers in garage order. `app.mjs:311` zeroes keyboard and on-screen drivers on window blur, not gamepad drivers. `app.mjs:334` uses the raw trigger value with no dead zone. `Gamepad.mapping` is never checked.
- **Trigger and consequence:** cars A and B both use gamepads. In free drive the host changes A to another driver. B now reads pad 0, which is A's old pad. B stops, re-arms as soon as pad 0 is neutral, then obeys the wrong person. The neutral re-arm does not help, because that pad is usually already neutral. `host.test.mjs:250-261` covers a safety stop and a same-car re-selection, not this shift.
- **Reproduce (harness, not executed):** set up as in that test, then run `game.setControl(a,'none'); pa.buttons[7].value=0; readControls(.04); pa.buttons[7].value=.7; readControls(.04)`. `b.input.throttle` becomes 0.7.
- **Repair:** bind each car to a specific pad with a "press any button to claim" step and store `Gamepad.index` on the driver. Add gamepad drivers to the blur handler. Apply a 5% trigger dead zone. Warn on a non-standard mapping.

**M3 · One car's link loss or connection fault raises no shared stop and no alarm**

- **Where:** `app.mjs:132` (on GATT disconnect: one log line and `connected = false`). `car.mjs:58-66` (one rejected write faults the car permanently). `game.mjs:52` (a `closed` event is only logged). `app.mjs:492-495` with `car.mjs:146-149` (Recover stays visible but does nothing for a disconnected off-track car; the card says "reconnect to recover", yet the only path is remove and re-add).
- **Consequence:** the round continues around a car whose physical state is unknown. Whether it is still moving is exactly the unverified link-loss question. The log is collapsed by default, so the operator may not notice.
- **Repair:** treat any unexpected disconnect or fault on a car with non-zero commanded speed as a shared pit stop. Show a persistent banner naming the car. Replace the dead Recover button with "Remove car".

**M4 · Scan and pit resume start motion with no countdown**

- **Where:** `app.mjs:139-142` calls `game.resume()` then `game.startScan()`. `game.mjs:91` picks the first connected car whatever its driver setting, including Parked and phone-owned cars. `game.mjs:99` commands up to 450 mm/s at once. `game.mjs:79-88` un-halts everything on "Track clear", so CPU cars launch on the next tick.
- **Consequence:** the page never says which car will move. Other real cars stay on the track as obstacles in the scan lane. The un-halt that follows hands on the track is the one un-halt with no countdown.
- **Repair:** let the host choose the scanner. Require a "track clear, other cars removed" confirmation. Reuse the 3 s countdown for scans and for pit resume.

**M5 · Lane-sign learning can flip on one sample**

- **Where:** `car.mjs:99-103` (one contrary pair scores -2 from a starting tally of 0 and flips the sign). `car.mjs:106-110` (the host then overwrites the car's own offset using the flipped sign).
- **Consequence if the sign is wrong, at first or after a spurious flip:** a car at lateral +45 mm told to go to centre moves 45 mm outward, to about 90 mm, past the 68 mm lane limit. The default agrees with the SDK text, so the main exposure is a spurious flip from a stale reading during a lane change, or a hand-moved car.
- **Evidence limit:** the simulator applies offsets instantly and exactly (`sim.mjs:54-59`). The passing test "learns either left/right sign convention" cannot show this.
- **Repair:** require two consistent observations before flipping. Hold lane commands while a calibration is unacknowledged. Run the first hardware lane test from a centre lane with a 9-22 mm step, where either direction is safe.

**M6 · No fault containment; rendering shares the control thread**

- **Where:** `app.mjs:518-531` runs controls, simulation, game tick, round logic and UI refresh in one unguarded timer callback. `app.mjs:533-542` and `render3d.mjs:135-153` rebuild effect and mine geometry every frame on the same thread. `app.mjs:595-611` loads Three.js and compiles shaders on first use.
- **Consequence:** an exception in any stage skips everything after it on every tick, including the phone dead-man check. STOP ALL still works because it calls `halt()` directly. Opening the 3D studio while cars move can stall ticks and the Escape handler for the length of the load. I could not measure this.
- **Repair:** wrap the tick and call `halt('Internal error')` on any exception. Allow the first 3D load only while halted. Record tick lateness and warn above 100 ms.

**M7 · Stopped cars drift on the map, then become untargetable**

- **Where:** `track.mjs:224-229` dead-reckons at the last reported speed up to the end of the piece and ignores commanded stops. After 2 s without a code the car is unlocated. `battle.mjs:63-67` gives unlocated cars no position, so weapons and mines cannot hit them. `battle.mjs:158` keeps recharging their energy.
- **Consequence:** for up to 2 s after a stop, the map, the 3D view and targeting place the car as much as a piece length ahead of where it sits. After that, a stationary car is invulnerable and healing. Braking for two seconds is the best defensive move in Battle rush. `review/INDEPENDENT-REVIEW.md:64` notes the expiry, not the exploit.
- **Repair:** clamp dead reckoning with the commanded speed profile. Keep a stopped car at its last confirmed pose as "parked" and targetable, or make stationary cars drain energy.

**M8 · Task progress resets on any non-positive movement sample**

- **Where:** `session.mjs:153-154` requires `movement > 0` for a sample to count. `session.mjs:164` zeroes scan time and `session.mjs:167` zeroes carry distance on any sample that does not. `session.mjs:145-147` also resets on a 1 s gap.
- **Consequence:** on real telemetry the estimate snaps backward whenever a code arrives later than the dead-reckoned position. It also holds at 0.999 while a transition is pending (`track.mjs:227`). Each event zeroes a carry that needs 35% of the circuit unbroken. The simulator has exact speed and no latency, so `session.test.mjs:150-172` passes. Story missions may be impossible to finish on hardware.
- **Repair:** accumulate with a grace window, for example 300 ms or 2% of the circuit of non-conforming samples. Add latency and jitter to the simulator before trusting the result.

**M9 · Lap progress wiped by stops, knockouts and other people's pit stops**

- **Where:** `session.mjs:91` zeroes lap distance whenever a car is unlocated. `session.mjs:184` zeroes every driver's lap on a pit pause. Knockout recovery is 2.0 s + 0.8 s (`data/vehicles.json`, `battle.mjs:119`), longer than the 2 s location window.
- **Consequence:** braking for traffic, being knocked out, or another car leaving the track all cost the partial lap. In Lap sprint a trailing player can lift their own car to erase a rival's nearly finished lap.
- **Repair:** keep lap distance across an unlocated gap when the car re-localizes within a quarter circuit of where it stopped. On a pit pause, preserve progress for cars that were not the cause.

**M10 · Battle balance**

- **Pulse ram:** x52 and x52 Ice deal 99999 damage for 6 energy with a 3 s recharge (`data/weapons.json`, `battle.mjs:261-268`). Energy recharges at 1.5 per second, so an instant knockout every four seconds is sustainable. Any car can be set to that model in the garage.
- **Boost:** it adds speed (`battle.mjs:322`) that `game.mjs:173` then clamps to the ceiling. At full throttle it does nothing.
- **Lane pushes:** horn and scrambler pushes (`battle.mjs:160, 238`) are overwritten on the next tick by `game.mjs:174` for every phone, gamepad and CPU driver.
- **Repair:** cap single-hit damage at a fraction of maximum energy. Make Boost an effect that works under a ceiling, such as faster acceleration or an energy refund. Lock the victim's lane input for the push duration. Offer a "stock loadout" option for classes.

**M11 · Race and mission structure**

- **Lap sprint:** at a fixed ceiling every car at full throttle has the same commanded speed, trucks 15% less (`game.mjs:171`). Over four curves the inside lane is about 0.85 m shorter than the outside lane. The result follows lane and model choice, not driving.
- **Goals:** plain Crew mission needs three laps per driver whatever the track length or ceiling (`session.mjs:51`), and one CPU can supply all of them. Story durations are fixed (`session.mjs:13-15`) while task distances scale with the track. By my arithmetic from the guidance ratios (`session.mjs:138`), a CPU car at a 400 mm/s ceiling needs about 8 s per metre of track per delivery. Dawn Patrol's 150 s is then close to the limit on the 6 m built-in layouts and out of reach on longer circuits. The tests cover only Capsule and Figure eight.
- **Gates:** every driver gets the same gate lanes and slow speed bands (`session.mjs:22-23, 124`). With three or four real cars they queue in one lane, and a car behind cannot pass without missing the gate.
- **Idle players:** Story completes only when every roster car finishes (`session.mjs:117`). One idle or disconnected player fails the mission for all.
- **Repair:** scale goals and durations to measured track length and ceiling. Rotate lanes per driver. Let the host hand an idle car to a CPU mid-mission.

**M12 · Host-code rate limit does not limit guessing**

- **Where:** `platform/slipstream-relay.mjs:147-153` compares the code first. It consults the bucket only to choose between 403 and 429 for a wrong code. `platform/slipstream-relay.test.mjs:91-104` asserts that the right code works during a guessing run.
- **Consequence:** guesses are unlimited. The generated code has about 49 bits, which is adequate. A chosen eight-character `SLIPSTREAM_HOST_CODE` on a Public port is not. SECURITY.md's "limited to 10 per minute" is not what the code does.
- **Reproduce (not executed):** send eleven wrong codes, then the right one. The last request returns 201.
- **Repair:** when the bucket is empty, refuse before comparing. Use a per-address bucket so a stranger cannot lock out the host.

**M13 · Slipstream mode still serves the course bench and mock API**

- **Where:** `platform/server.mjs:93-119, 152` mounts the worksheet API and bench pages in every mode. `app.mjs:438` and `README.md:86` tell users to set the port to Public. SECURITY.md says of the same API: "Do not expose it beyond a private forwarded port." `DEPLOYMENT.md:30-34` says the repo does not publish the port. README uses port 8000; the devcontainer and DEPLOYMENT use 3000.
- **Consequence:** a Public port publishes the mock API, whose operator tokens are public by design, and any student notes stored in it.
- **Repair:** do not mount the bench or support API when `--slipstream` is set, or run them as separate processes. Pick one port and one visibility instruction.

**M14 · Saved map trusted without verification**

- **Where:** `app.mjs:147-149` offers "Use saved map" for any stored real-track plan. `game.mjs:117-121` accepts it if it closes. `track.mjs:191-196` silently re-localizes whenever observed pieces contradict the map.
- **Consequence:** a track rebuilt from the same pieces in another order loads, shows cars as located, and scores from wrong geometry. The session's teleport guard catches only large jumps.
- **Repair:** require one verification lap whose observed piece order matches the saved order before a round can start. Count contradictions and prompt a rescan after two.

**M15 · Host and phone legibility**

- **Measured from CSS values, not rendered:** the "LIVE HARDWARE · SUPERVISE" chip is 7.7 px (`style.css:64`) and hidden at 1200 px and below (`style.css:73`). Round help, key legend and scene note are 8.4-9.2 px. Phone weapon names are 11 px grey on the button gradients at 1.1-2.2:1 contrast, and the FIRE label is 2.3:1 at the gradient centre (`pad.html:33-36`). A disconnected car card drops to 2.9:1 (`style.css:27`). "Finish round & stop" is 30 px tall (`style.css:79`), small buttons are 32 px, and resize handles are 6 px wide.
- **Repair:** a fixed status bar showing LIVE or SIMULATION at 14 px or more on every width. Minimum 12 px text. Solid dark label plates on the weapon buttons. 44 px minimum targets for anything that stops motion.

**M16 · Lists rebuilt under the pointer**

- **Where:** `app.mjs:379` calls `renderPlayers()` for every relay message, including each input from a driving phone, 4-15 per second per phone. `app.mjs:397-416` recreates every row and button. `pad.mjs:124` rebuilds the car-pick buttons on every state message, five per second.
- **Consequence:** a click needs pointer-down and pointer-up on the same element. "Let in", the remove button and "pick a car" fail intermittently, and keyboard focus is lost on every rebuild.
- **Repair:** re-render only when the player list changes. Update text in place.

### Low-severity findings

All are confirmed by reading the cited lines unless marked "likely".

| ID | Finding | Where | Repair |
| --- | --- | --- | --- |
| L1 | Inputs carry no sequence number and a release carries no car ID. In HTTP fallback a late message can re-apply an old throttle after BRAKE, or release a newly picked car. | `pad.mjs:128-135`; `net.mjs:88-91`; `app.mjs:368-375` | Per-player counter; host drops older inputs; put the car ID in the release. |
| L2 | A held ArrowUp on the focused phone throttle slider ramps throttle again after a stop and resume. Host fire buttons re-fire on key repeat after a resume. | `pad.mjs:159-163`; `app.mjs:75` | Ignore `event.repeat`; require key-up after any reset. |
| L3 | Failed kick calls are swallowed. A removed player returns as approved on the next host resync. | `app.mjs:362, 391, 404` | Log and retry; keep a local deny list. |
| L4 | `decode` throws on a malformed tail and the caller drops the whole notification, including a valid off-track message ahead of it. | `protocol.mjs:83-92`; `car.mjs:76` | Return the messages parsed before the error. |
| L5 | Battery is read once. Low-battery, on-charger and on-track flags are decoded and unused. instructor-drive enforces a 3500 mV floor. | `car.mjs:27, 81, 155` | Poll battery; warn and block rounds below a floor. |
| L6 | The minimum ceiling is 300 mm/s and scans run at min(ceiling, 450). The only hardware pulse on record was 100 mm/s. | `index.html:75`; `game.mjs:15, 99` | Add a 100-250 mm/s commissioning range. |
| L7 | The mapper commits a phantom piece on one differing piece ID. Its `votes` field is never used. An unclosed loop retries forever. | `track.mjs:112-114, 145-146` | Majority vote per piece; lap budget. |
| L8 | The free-drive lap counter counts both directions across the wrap boundary and skips a lap when no code was read on the last piece. Round scoring does not use it. | `track.mjs:205-217` | Derive it from the session's distance logic. |
| L9 | The Battle table shows KOs, Lost and Laps but sorts by points, which appear only on the result card. A shield held at the final tick stays drawn. Double-tap to switch weapon collides with rapid fire on multi-weapon trucks. | `app.mjs:509-513`; `battle.mjs:374-377`; `pad.mjs:182` | Show points live; clear the shield in `stop()`; use a separate switch control. |
| L10 | Reduced motion drops every transient effect with no static substitute. The 2D mine ring still pulses. 3D has no cue for ram hits. Gate markers sit at the centre whatever the target lane. | `render3d.mjs:107, 151, 166-168`; `render.mjs:61, 74` | Static badges; add `ram`; offset markers to the lane. |
| L11 | `/slipstream` without the trailing slash likely returns 404, because directory redirect is off. The phone wake lock is requested once and not re-acquired after the page was hidden. | `platform/server.mjs:138-145`; `pad.mjs:56` | Redirect to the slash form; re-request on visibility change. |
| L12 | No join rate limit or room lock: anyone with the projected QR can keep the eight waiting slots full. Heartbeats send pings but never drop sockets that stop answering. | `platform/slipstream-relay.mjs:78-81, 214-233` | Per-room join bucket and a Lock room toggle; terminate on a missed pong. |
| L13 | The Python simulator's profile HMAC covers only `{max_speed}`. A signed profile can be replayed on any vehicle by any team, indefinitely. | `lapreturn/core.py:138-155` | Sign the vehicle, team and an expiry. |
| L14 | Keyboard, on-screen and phone throttles all latch, and the phone holds a wake lock. No control is hold-to-run. This is a design choice to test, not a defect. | `app.mjs:322-324`; `pad.mjs:56, 165-172` | Offer hold-to-drive per player; decide the default in a playtest. |

### Evidence gaps

These are not defects. They are claims the repository cannot yet support.

| ID | Unproven | Why it matters | How to close |
| --- | --- | --- | --- |
| E1 | What a car does when the host dies or the link drops | Top safety item. The simulator stops instantly on close (`sim.mjs:44`), so no test can speak to it. | Stage 1 of the hardware plan. |
| E2 | The F&F reverse-engineering record | `review/native-coverage.json` and `source-identities.json` describe the standard OVERDRIVE library only; its addresses match INDEPENDENT-REVIEW, not the F&F table. The F&F hashes and addresses exist only as prose, from a third-party mirror. | Commit an F&F identities and coverage file and label the mirror. |
| E3 | Car-side delocalization behaviour | The app message catalogue (ANALYSIS.md:128-142) and the committed inventory name messages for a maximum delocalization speed, skipping auto-drive in delocalization, and auto-recovery entered and succeeded. Slipstream neither sends nor decodes them. Names do not establish semantics. | Record what a car does when lifted and replaced, in SDK mode with the override flag. |
| E4 | Light commands on F&F cars | `instructor-drive/VALIDATION.md` records that 0x33 patterns produced no visible change on the MXT. Slipstream's first-run check (`README.md:195-196`) and hit feedback (`battle.mjs:326-339`) rely on them. | Retest with SDK flag 1. Do not use lights as a go or no-go signal. |
| E5 | The Codespaces path | Third-party reports say the forwarding proxy rewrites a same-origin Origin header to localhost. The relay compares Origin with Host (`platform/slipstream-relay.mjs:285-286`). If Host is not rewritten too, every WebSocket is refused and clients silently fall back to HTTP (`net.mjs:80`). GitHub's docs say terminal output resets the idle timer, so the five-minute status line (`platform/server.mjs:201`) probably keeps a forgotten codespace running. | In a Codespace, read `slipstream.transport` and `slipstreamPad.transport`; expect "socket". Stop the codespace after class. |
| E6 | Transition frame layout on F&F firmware | Decoder, simulator (`sim.mjs:106-109`) and SDK header agree on 18 bytes with wheel distances at bytes 16-17. The repo reports a third-party x52 trace decoding cleanly but holds no hardware fixture. | First recorded trace. |
| E7 | Test results and CI status | I could not run the suites, and the PR page showed no check results. | Section 6. |

## 2. Five highest-value improvements

The first change removes three of the four High findings: one arming rule on the host for every control type, plus a telemetry watchdog. Effort figures are my estimates for one developer who knows the code.

| # | Improvement | Addresses | Effort | Dependencies |
| --- | --- | --- | --- | --- |
| 1 | **One arming rule plus watchdogs.** Every driver, human or CPU, moves only after a host arm event and a fresh neutral input. Any dead-man trip, halt, link change or seat change disarms. Add the stale-telemetry watchdog, stop verification, a shared pit on link loss, and a countdown on every un-halt. | H1, H2, H3, M3, M4, L2 | 2-3 days | None to build. Thresholds need Stage 1-2 hardware data. |
| 2 | **Hardware traces as fixtures, then a noisy simulator.** Record first traces from the F&F cars, with and without the special tile, and replay them in CI. Add latency, jitter, missed codes and silent-link faults to the simulator, calibrated from those traces. | H4, M5, M8, E1-E6 | One supervised session, then 2 days | Hardware access. Do improvement 1 first for a safer session. |
| 3 | **Seat protocol v2.** Sequence-numbered inputs, release with car ID, no seating on reconnect after a leave, pad claiming by button press, and lists that update in place. | M1, M2, M16, L1, L3 | 2 days | None. |
| 4 | **Fairness pass.** Parked cars stay targetable, or limp home instead of stopping dead. Lap progress survives short gaps. Goals and durations scale with track length. Per-driver gate lanes. A damage cap. Live points. | M7-M11, L9 | 3 days | Improvement 2, for tuning. |
| 5 | **Operator interface pass.** A fixed LIVE and STOP status bar, 12 px minimum text, 44 px stop targets, readable phone labels, a commissioning speed range, and a setup wizard that ends in one consistent port instruction. | M13, M15, L6, L11 | 2 days | None. |

### Design ideas through four lenses

These are my own suggestions, framed through four design perspectives. Nobody from any studio or company was consulted.

| Lens | Idea | What it addresses |
| --- | --- | --- |
| Themed entertainment | **Named show states.** One state machine with four spoken cues: Standby, Go, Hold, All stop. Show the current cue full-width; a student marshal calls it aloud. | Makes the stop state unmistakable; supports H1-H3 repairs. |
| Themed entertainment | **Crew roles for people without a car.** Marshal owns STOP, Spotter calls off-track, Timekeeper runs the clock. Rotate each round. | Idle players and supervision in one move. |
| Themed entertainment | **Grid walk.** The setup wizard goes car by car: placed, lane, battery, driver named. | First-time setup; doubles as the safety checklist. |
| Animation and storytelling | **Limp home, not lights out.** A knocked-out car crawls at 30% in the outer lane for the recovery time instead of stopping. | Keeps the car located (M7, M9), removes stationary obstacles, reads as character. |
| Animation and storytelling | **A turn at half time.** The dock moves, or one lane "closes", midway through a mission. | Scan-carry-deliver repeated one to three times is the only mission shape today. |
| Animation and storytelling | **Recap from real events.** The result card tells the round in three lines drawn from the event log, such as "Car 2 delivered the last packet with 4 s left." | Confusing outcomes. |
| Animation and storytelling | **Telegraph before effect.** A 400 ms cue on the victim's phone before a forced slow-down lands. | Hits feel fair despite position latency. |
| Console game | **Draft meter.** Leaders run at 92% of the ceiling. Following in the same lane at a generous gap fills a meter that lifts the follower to 100% for three seconds. Nobody exceeds the ceiling. | A comeback mechanic and a skill lever for Lap sprint (M11). It is also the project's name. |
| Console game | **Open assist levels.** Auto-lane for newcomers, manual lane for experienced players, shown on the scoreboard. | Mixed-skill groups without hidden handicaps. |
| Console game | **Arm by tutorial.** During the countdown each player presses each of their controls once. That teaches the layout and performs the arming step. | First-time use; gives the arming rule a friendly face. |
| Accessibility | **One-button drive.** Hold to go, release to stop, lanes automatic. Works with a switch or a single key. | Motor access; also a true hold-to-run option (L14). |
| Accessibility | **Speed-band tone.** For precision gates, pitch rises into the target band, with a caption. | Eyes stay on the physical track; less reliance on small text. |
| Accessibility | **Identity beyond colour.** Each car gets a shape and a number used on the map, the phone and the scoreboard. | Colour-vision differences; identical car models. |
| Accessibility | **Left-handed and large-type phone layouts.** Mirror the throttle and fire columns; offer a high-contrast host theme. | M15, handedness. |

## 3. Compatibility and evidence matrix

No part of Slipstream has hardware evidence. The strongest evidence is my SDK cross-check of packet layouts, and one 100 mm/s wheels-up pulse on an MXT through the separate instructor-drive code.

**Levels.** Cross-checked: I compared it with the public SDK source. Repo claim: stated by the repo from app analysis I could not inspect. Simulator: exercised only against `sim.mjs` or DOM stubs. Other code path: observed on hardware, but not through Slipstream. None: no evidence.

| Area | Component | Evidence available | Level | Notes |
| --- | --- | --- | --- | --- |
| Kit | F&F cars: International MXT and Ice Charger | One 100 mm/s pulse and stop on an MXT, firmware 9511 (`instructor-drive/VALIDATION.md`) | Other code path | Slipstream shows them under app codenames, Mammoth (18) and Dynamo (19). Auto-detect needs `watchAdvertisements`; the fallback is model 8. |
| Kit | F&F curves and straights | App piece tables | Repo claim | Never read by Slipstream on hardware. |
| Kit | F&F special tiles 53, 54, 57 | App tables with the kind defaulted to straight | Contradicted in repo | H4. |
| Kit | Power Zone effects | Not implemented; supercodes decoded for diagnostics | None | Stated in HANDOFF. |
| Kit | Standard OVERDRIVE cars, models 8-12 and 14 | App vehicle table | Repo claim | Weapons follow the model chosen in the garage, not the physical car. |
| Kit | Supertrucks, models 15-17 | App table; the 0.85 speed factor is Slipstream's own | Repo claim | Pulse ram balance, M10. |
| Kit | Start and finish 34/33, straights, curves | App tables | Repo claim | Frame decoding cross-checked; piece IDs not. |
| Kit | Intersection 10 | App table | Simulator | Intersection messages (0x2a) are decoded and unused. |
| Kit | Jumps 43/46 and 58/63 | Mapped as flat straights | Simulator | Nothing is sent to help a car clear a jump (README). |
| Kit | Anki DRIVE printed mats | Not supported | None | Stated in README. |
| Protocol | Twelve command encoders | SDK-compiled vectors in `protocol-review.test.mjs` | Cross-checked | I matched the struct layouts in `protocol.h`. |
| Protocol | Position, transition, intersection, offset decoders | SDK header | Cross-checked | Real F&F frames not yet recorded (E6). |
| Protocol | Collision, jump, speed, status, supercode messages | App analysis | Repo claim | Not in the public SDK. I could not inspect the APK or Ghidra output. |
| Protocol | Lane sign, positive = right | SDK tool help text | Cross-checked | Not confirmed on a car (M5). |
| Protocol | Stop on link loss or host death | None | None | E1. |
| Control | Host on-screen controls and keyboard | Handlers run against DOM stubs | Simulator | H3 for the dropdown. |
| Control | Gamepad | Fake pad objects in `host.test.mjs` | Simulator | No real pad; mapping unchecked (M2). |
| Control | Phone touch | Handlers run against DOM stubs | Simulator | HANDOFF reports manual browser walkthroughs; I could not repeat them. |
| Control | Phone tilt | Logic test only | None on device | README: not tried on a physical phone. |
| Control | Phone haptics | Feature-detection test | None on device | Visual fallback exists; DESIGN.md notes iPhone Safari lacks the Vibration API. |
| Control | CPU drivers | Simulator rounds | Simulator | Starts on selection in free drive (H3). |
| Deployment | Local `npm run slipstream` | Relay and server tests | Software tests, not run by me | Section 6. |
| Deployment | Docker compose | HANDOFF reports a local non-root build | Repo claim | I did not build the image. Compose binds host loopback only. |
| Deployment | Codespaces, private port | None | None | Phones would need a permitted GitHub sign-in. |
| Deployment | Codespaces, public port | None | None | Also publishes the bench and mock API (M13). |
| Deployment | WebSocket through Codespaces | None | None | Origin rewrite risk (E5). |
| Deployment | HTTP fallback transport | Relay tests | Software tests, not run by me | No ordering guarantee (L1). |
| Deployment | Two to four Bluetooth links from one laptop | None | None | README: not tried. |
| Deployment | Dependencies | `npm audit`: 0; 69 lockfile entries with integrity | Verified by me | Image and devcontainer are tag-pinned, not digest-pinned. |

## 4. Staged hardware validation plan

Start with one car with its wheels off the ground, and do not put a car on a track until Stage 1 has measured what it does when the host disappears.

**Rules for every stage.** One operator at the laptop and one spotter at the track who may lift the car at any time. Press Record before the first command and commit the saved trace afterwards. Battery at or above the repo's 3500 mV floor. Advance only after a stage passes three times in a row. Any stop criterion ends the session, not just the stage.

**Before Stage 2.** Fix H1-H3, or work around them: no phone drivers, click the map after using any dropdown, and select Computer only while cars are stopped. The ceiling slider bottoms out at 300 mm/s (L6). Until that changes, set a lower ceiling from the console with `slipstream.game.topSpeed = 150`; the object is exposed at `app.mjs:28`. I have not run that line.

| Stage | Setup | Tests | Pass | Stop criteria |
| --- | --- | --- | --- | --- |
| 0. Identify and talk | One car on a block, wheels free, no track. No driver assigned. | Connect. Read firmware and battery. Send a light colour. Save the trace. Send no speed command. | Version and battery decode. Model and firmware are written down. | Wheels move at all. Battery under 3500 mV. Unknown firmware: pause and record before going on. |
| 1. Stop authority and link loss | Same car on the block. Ceiling 150 mm/s. Keyboard driver. Film the wheels against a clock. | Five runs each: (a) Brake key and Esc, (b) STOP ALL, (c) hide the tab, (d) close the tab, (e) kill the browser, (f) laptop Bluetooth off, (g) close the lid, (h) carry the laptop out of range. | (a)-(c): wheels stop within 0.5 s every time. (d)-(h): the stop time is recorded, whatever it is. | Wheels still turning 5 s after (a), (b) or (c): power the car off and end the session. If any of (d)-(h) leaves the wheels turning, every later stage stays at one car per adult within arm's reach, and classroom use stays closed. |
| 2. One car on a plain loop | Closed loop without special tiles, soft barrier around it. Ceiling 200 mm/s. | One creeping lap. From a centre lane, one 9-22 mm lane step each way. Lift the moving car. Put it back before pressing Recover. Recover, then Track clear. Scan three times. | Left is left with no sign flip. Every lift opens the pit within 1 s. The replaced car does not move by itself. Three identical maps that match the table. | A lane command takes the car off the track. Any wheel motion while the page says stopped. Wheels turning with no position updates. A scan still open after three laps. |
| 3. Special tile | Stage 2 loop with tile 53, 54 or 57 inserted. | Scan three times. Ten laps across the tile in each of three lanes. Run `tools/inspect_trace.mjs` on the trace. | Maps close identically. Positions do not jump on the tile. Supercode frames are logged. | Maps differ between scans. The car slows, stops or changes lights on the tile. This stage settles H4. |
| 4. Remote controls | One car, ceiling 300 mm/s. Phone on mobile data. One real gamepad. Server in the Codespace. | Phone to airplane mode. Laptop Wi-Fi off for 3 s. Leave car, then lock and unlock the phone. Tilt on one iPhone and one Android. Unplug the gamepad. Click another window with the trigger held. Read `slipstream.transport`. | Every stop holds until a fresh input. A left car stays left. Transport reads "socket". | Any self-resume. Any car that keeps moving after its controller is gone for 1 s. |
| 5. Two cars | Human plus CPU, ceiling 300 mm/s, ten minutes. | Each mode once. A pit stop while the other car moves. Power one car off mid-lap. Swap drivers between rounds. | No write timeouts or faults in the log. The pit flow stops and releases both cars correctly. | Any uncommanded motion. More than one connection fault in ten minutes. |
| 6. Four cars | Ceiling 400 mm/s, 15-minute soak, four phones, classroom network. | Log tick lateness, write timeouts, relay reconnects and phone input age. | Zero faults. No relay reconnect produces motion. | Any car fault. The operator cannot say which car is which within 3 s. |
| 7. Classroom pilot | Small group, marshal and spotter roles, one mode, ceiling 400 mm/s, written incident log. | One 20-minute session. Ask each student to state the objective and the result. | No missed-stop event. Students describe objective and result correctly. | Any missed stop. Any car retrieved while moving. |

**A note on Stage 1.** A car on a block may report itself delocalized as soon as its wheels turn. Slipstream would then open a pit stop on every attempt. If that happens, record it and run Stage 1 on a short straight of track with a soft stop at the end.

**What only hardware can answer.** Stop behaviour on link loss, braking distance, lane sign, real frame lengths, the special tile, visible light response, stability of two to four Bluetooth links, phone sensors and haptics, and latency through Codespaces on the school network.

## 5. Readiness assessment

The software is a credible simulator demo today, a candidate for a wheels-up bench trial, and some distance from a classroom.

| Use | Verdict | Conditions and reasons |
| --- | --- | --- |
| Simulator demo | Ready, with cautions | Re-run the suites first, since I could not. Use simulated cars only. Expect H3, M1, M2, M7, M10 and M16 to be visible to a curious audience. Do not present Story completion or battle balance as evidence about real cars (M8). |
| Supervised hardware trial | Stages 0-1 now; Stage 2 onward after H1-H3 are fixed or worked around | One car, two adults, no students at the controls, ceiling at or below 200 mm/s. The trial's first job is to measure link-loss behaviour, not to play a round. Treat the F&F special tile as a separate stage (H4). |
| Classroom use | Not ready | Needs a recorded Stage 1 link-loss result, H1-H4 and M1-M4 closed, at least one hardware trace replayed in CI, the Stage 6 four-car soak passed, and the legibility fixes in M15. |

## 6. Checks run, results, and what I could not verify

I confirmed the commit, installed dependencies, ran the audit and cross-checked the protocol against the SDK. I did not run any test suite, browser, container or hardware.

**Reading scope.** Read in full: all fourteen Slipstream runtime modules, both pages and the stylesheet, the relay and server, `lapreturn/core.py`, the three review notes, the extraction and export tools, and the safety, host and protocol-review tests. Read by name and excerpt: the other Slipstream and relay tests, README, DESIGN and ANALYSIS. Not read: the `bench/` changes, the other Python files and tests, `dependency-lab`, and FIRMWARE-TWIN.md.

| Check | Method | Result |
| --- | --- | --- |
| Commit under review | `git fetch origin refs/pull/4/head`, `git rev-parse`, `git ls-remote` | Head is `2835eb6d729f988debec92bef762fe15223f3b7d`, equal to the branch tip. Merge base is `main` at `ab80945`. Diff: 78 files, +9,662 and -566 lines. |
| Dependency install | `npm ci --ignore-scripts` on Node 22.23.4 | 68 packages added. |
| Advisories | `npm audit` | Found 0 vulnerabilities. |
| Node suites | `npm test` | **Not run.** This session's policy blocked executing repository code. |
| Python suites and probes | `python3 -m unittest`, `lapreturn.cwe_lab`, `npm run dependency-lab` | **Not run**, for the same reason. |
| Test count | Counted `test(` declarations and expanded the loops by hand | 419 Node tests declared; 38 Python test methods. Both match HANDOFF. |
| Lockfile | My own script over `package-lock.json` | 69 entries; all have `integrity` and a registry URL; none has an install script. |
| Protocol | Cloned `anki/drive-sdk` at `4103526`; read `protocol.h`, `vehicle_cmd.c`, `advertisement.c` | Message IDs, command structs, four telemetry structs, parsing flags, lane-sign text and model-byte offset all agree with `protocol.mjs`. |
| Page wiring | My own script comparing element IDs | Every ID used by `app.mjs` and `pad.mjs` exists in the HTML. |
| Legibility | Contrast ratios and pixel sizes computed from CSS values | Figures in M15. Nothing was rendered. |
| Data tables | My own scripts over `data/*.json` | 21 pieces, 21 models, 38 weapons, as documented. |
| Pull request | Fetched the PR page | Open, 9 commits, head `2835eb6`, no reviews. Check results were not shown. |
| CI | Fetched the commit's checks page; tried the GitHub API | Rate-limited twice; API not enabled for this session. **CI status unverified.** |

### Not verified

- **Test results and CI.** Everything in HANDOFF about passing suites is the repo's claim.
- **Any rendered interface.** Host, phone and 3D findings come from reading HTML, CSS and JavaScript. Layout at 390x844 and 844x390, focus order, 3D frame rate and WebGL fallback are unchecked.
- **Docker and Codespaces.** I did not build the image or open a Codespace.
- **Reverse-engineering sources.** I did not obtain or inspect any APK, OBB, JADX output, Ghidra project or firmware, and executed none. I read only the repo's review notes, tools and committed JSON. The third-party x52 trace mentioned in INDEPENDENT-REVIEW is not in the repo.
- **Hardware.** No car, track, phone or gamepad was involved.

### Test credibility

The suites are a sound regression net for host logic. They say little about real cars, and a few titles claim more than their assertions.

**Simulator assumptions that mirror the code under test**

- Closing a link stops the simulated car instantly (`sim.mjs:44`). Any "stops on disconnect" result is circular.
- The transition frame is built to the decoder's own layout (`sim.mjs:106-109`). Curve inference uses a 6 cm wheel-distance threshold against the simulator's 44 mm wheel track, which gives 6.9 cm (`sim.mjs:102-103`, `track.mjs:130`).
- Offsets apply instantly and U-turns are instantaneous (`sim.mjs:54-59, 77-80`).
- Speed is exact, latency is zero, and a code is always read within 5.5 mm (`sim.mjs:115-134`).
- The simulator never emits delocalized, collision, status, intersection or speed messages, and never loses a link on its own.
- A built-in layout treats F&F tiles 53 and 57 as straights (`sim.mjs:14`).

**Titles that outrun their assertions**

- "guessing it is rate-limited" also asserts that the right code works mid-run (M12).
- "do not shift other car slots" never changes another car's control type (M2).
- "must not resurrect a held human input" (`safety.test.mjs:128-130`) writes `d.input` directly. In the app, `readControls` rebuilds it from devices on every tick, so the phone path in H1 is outside the test.
- "22,620 association states" enumerates a static targeting matrix. It has no time, motion or latency.
- "four phone task dashboards fit the relay message limit" checks one scenario against 3,500 bytes. The enforced limit is 4,096 and `LIMITS.stateBytes` is never read (`platform/slipstream-relay.mjs:21`). My own worst-case estimate is about 3,000 bytes, so I see no defect, only an unenforced constant.

**Code with no behavioural test**

- `ble.mjs` is never instantiated by any test. `render3d.mjs` is never loaded.
- The Bluetooth disconnect path at `app.mjs:132` cannot run, because the harness stubs Bluetooth as unavailable (`host.test.mjs:44`).
- Window-level phone handlers for blur, visibility and keys are stubbed out (`pad.test.mjs:22-25`).
- The host harness strips imports with a regular expression and runs `app.mjs` in a VM. Module wiring is untested.

**Tests worth adding**

- **Fault-injecting transport.** Wrap the simulator link with latency, jitter, dropped notifications, reordered inputs, hung and rejected writes, a silent link, and a late delocalized message. Run every mode and car count under it.
- **Property: no motion without arming.** Over random interleavings of inputs, relay status changes, seat changes, pad slot changes and halts, no non-zero speed is written until an arm event and a neutral input for that car.
- **Property: leave is final.** A player who released never holds a car again without a later explicit pick.
- **Property: scoring is bounded.** Laps never exceed distance travelled divided by track length, under any telemetry gaps or U-turns.
- **Property: mapper stability.** For any rotation and direction of a closed layout with up to k missed codes, the result is the same loop or no map.
- **Narrow formal model, seat protocol.** Phone, relay and host with message loss, duplication and reordering. Check single ownership per car, no input from a non-owner, eventual release acknowledgement, and no seating after a leave.
- **Narrow formal model, arming.** States for halted, pit, countdown and per-driver armed. Invariant: a non-zero command implies armed and fresh input.
- **Trace replay.** Once Stage 0-3 traces exist, replay them in CI and diff the commands the controller sends.

## Sources

- [Pull request #4](https://github.com/matthewluallen/cs460-second-lap-overdrive/pull/4), reviewed at commit `2835eb6`.
- [anki/drive-sdk](https://github.com/anki/drive-sdk), commit `4103526`, cloned for the protocol cross-check.
- [GitHub Docs: Restricting the idle timeout period](https://docs.github.com/en/codespaces/managing-codespaces-for-your-organization/restricting-the-idle-timeout-period), for what resets a codespace's idle timer.
- [Ruby on Rails forum: Project doesn't run in GitHub Codespaces](https://discuss.rubyonrails.org/t/project-doesnt-run-in-github-codespaces/84046), a third-party report that the forwarding proxy rewrites the Origin header to localhost.
