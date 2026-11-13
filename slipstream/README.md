# Slipstream

Control one to four robotic race cars from a browser, with human or computer
drivers, a live track map, and phone controllers. Choose Arcade, Competition or
Story missions. Simulated practice works without owning any hardware.

**Status: limited supervised hardware acceptance.** Groundshock SDK firmware 11866 has scanned one 11-piece circuit and completed one observed leftward maneuver and stop. See [the hardware evidence](review/GROUNDSHOCK-LEFT-STEERING-ACCEPTED.md). Repeated autonomous driving, right steering, multi-car races, attacks and other models remain unverified. Automated transports and captured traces do not establish general physical compatibility. Packet layouts use the published SDK and static app reviews ([standard OVERDRIVE](review/INDEPENDENT-REVIEW.md), [Fast & Furious](review/FAST-FURIOUS-REVIEW.md)); complete original-app parity is not claimed. See [First run with real cars](#first-run-with-real-cars).

## Start it

```sh
npm ci --ignore-scripts
npm run slipstream        # serves http://127.0.0.1:8000/slipstream/
```

Open the page in desktop Chrome or Edge. Plain `npm start` does not serve this page or
its relay; the hardened stationary course bench remains available separately.

To try it without hardware: add one to four simulated cars, choose their human or
computer drivers, **Scan track**, choose a feel and challenge, then **Start round**.
The countdown leads into a short round and a result card. **Play again** explicitly
starts a new round. Simulated cars exercise the controller code; agreement with
the simulator does not prove agreement with physical hardware.

## 3D studio and remote hosting

Select **3D studio** above the map for an orbitable, zoomable circuit view. The
original procedural cars, lighting and track use Three.js; no Unity install or
app artwork is required. **2D map** remains available, including when WebGL fails.
The 3D view includes energy bars, shields, numbered mission gates, and attack/
recovery cues. Shared gates list every assigned car number. Reduced motion removes
animated effects while keeping persistent energy, shield and objective indicators.
The scene visualizes telemetry and inferred track geometry, not measured height
or collision avoidance. Drag the desktop panel dividers, or focus one and use
Left/Right/Home. Narrow screens stack the panels; phones have a dedicated pad.

For Codespaces or Docker, follow **[DEPLOYMENT.md](DEPLOYMENT.md)**. The nearby
laptop owns Bluetooth and runs the game; the remote server serves pages and relays
phone inputs. Keep that laptop awake with the host tab visible.

## Choose your kind of fun

| Feel | One active car | Two to four active cars |
|---|---|---|
| Arcade | Beat your best | Battle rush: virtual knockouts and complete laps |
| Competition | Beat your best: fastest complete lap | Lap sprint: most full laps; ties share the finish |
| Story missions | Deliver the crew's signal yourself | Contribute together to a shared lap target |

Computer drivers use the same countdown and stop controls as people. They slow to two-thirds of the selected ceiling on curves, special/unknown sections and near the end of a straight; fresh ordinary-straight geometry permits the full ceiling. Automatic lane changes require fresh printed-code localization and sufficient remaining straight. Unscored **Free drive** alternates left/right targets; scored rounds retain their battle or mission intents within these limits. This is Slipstream gameplay, not a reconstruction of the original app’s planner.

All modes allow human and computer drivers. A car set to **Parked** does not enter
the round. Bots are labeled and use the same limits. Story choices are **The Signal
Run**, **Beacon Network**, and **Dawn Patrol**: original briefs using cooperative
lap goals, not a branching campaign. Round times and results are visible on the
host; phone players receive their own state and the round objective.

Solo rounds last 90 seconds; sprint and battle default to 120 seconds. Story goals
scale with active car count. A complete lap requires continuous mapped progress;
U-turns and lost localization reset an incomplete lap. Pause time does not count.
The round engine awards full-lap and completed-crew badges from measured results.
See [DESIGN.md](DESIGN.md) for the design lenses, accessibility and future ideas.

## Who does what

| Part | Runs where | Job |
|---|---|---|
| Host page (`index.html`) | A laptop next to the track | Holds every Bluetooth link, runs the game, draws the map |
| Server (`platform/server.mjs --slipstream`) | Codespace or the laptop | Serves the pages; relays phone inputs to the host page |
| Controller (`pad.html`) | Each player's phone or laptop | Throttle, tilt or key steering, weapon buttons |

A Codespace has no Bluetooth radio, and browsers only allow Web Bluetooth from the
page the user is looking at. So the radio must live in one browser near the cars.
The server's only live job is passing messages between phones and that host page.
If the server disappears, the host page keeps driving with keyboard, gamepad and
computer drivers; only phone players drop out, and their cars stop.

### Phones

1. Run the server in a Codespace and open the forwarded HTTPS address on the host
   laptop. Tilt sensors and Bluetooth both need HTTPS. The server prints a **host
   code** when it starts.
2. Start with `PORT=3000 npm run slipstream:live`. In the Ports panel set port 3000 to **Public**, or each phone must be signed in to
   an account permitted to access the forwarded port. Keep the host code private.
   Configure the Codespace idle timeout explicitly; periodic server output is not
   a guarantee that the environment stays awake.
3. On the host page type the host code, then press **Code** on a car's card. That
   car gets its own QR code and link.
4. A participant scans it and types a name. They appear under **Remote players** as
   "wants <car>". Press **Let in**. Only then do they get the car, and their screen
   takes its colour and name.
5. The car's code is replaced the moment someone is let in, so a photo of an old
   code is useless. Press **Code** again for a fresh one.
6. **Show shared code** gives one code for "any free car"; those players are also
   let in by the host, then take a car whose driver is set to **Phone or link**.

The same link works on a laptop with no sensors: open it in a browser and drive with
W S (speed), A D (lane), F G R (fire, support, special), Q E (switch weapon) and
X (U-turn), or click the on-screen controls. **Leave car** frees the car.

Inputs travel over one WebSocket per player. If a network blocks WebSockets the
page falls back to ordinary HTTPS requests by itself.

The phone shows throttle, steering, weapons, energy and round feedback. Tilt is
optional: enable **Tilt steering**, hold the phone comfortably, and use **Center
tilt** to set neutral. **Flip tilt** reverses direction. Orientation changes
recenter steering; arrow buttons and keyboard controls remain alternatives. Sensor
permissions and behavior vary by browser and must be tested on real devices.
Double-tap a weapon button to switch weapons where the car has multiple choices.

**Haptics** are optional and off by default. Supported browsers can give short,
rate-limited feedback with matching visible messages. Unsupported devices show
that haptics are unavailable; iPhone/Safari does not implement the browser
Vibration API. Haptics never replace STOP or prove a motor stopped. After a
reconnection, return throttle to zero before driving again.

A phone that stops sending has its throttle set to zero after 0.7 seconds while
the host loop is running. Network, browser and physical braking delays still
need measurement; this is not a verified maximum physical stopping time.

### Keyboard and gamepad

| | Player 1 | Player 2 |
|---|---|---|
| Faster / slower | W / S | Up / Down |
| Lane left / right | A / D | Left / Right |
| Fire, support, special | F, G, R | K, L, O |
| Switch attack / support weapon | Q / E | I / P |
| U-turn | X | M |

Gamepad: right trigger throttle, left stick lane, A fire, B support, Y special.
**Esc** or **STOP ALL** always stops and latches the cars; STOP never becomes a
resume button. **Free drive** is a separate explicit action. Starting a new round
uses its own countdown. An off-track report requests a stop for **every car** and pauses the round. Confirm all cars are physically still before recovery, press each affected car’s **Recover** button, then use **Track clear · Continue round**. Battle timers pause too; charged weapons are cancelled. A connection fault needs
a fresh connection. Hiding the host tab halts real cars even if they were stopped
at the moment the tab became hidden.

The host's driver selection is authoritative. Changing a phone car to **Parked**
or a local controller releases its phone assignment; later phone inputs cannot
silently reclaim it.

## Track mapping

**Scan track** drives one car at up to 300 mm/s with the Fast & Furious profile
(450 mm/s for other profiles), capped further by the chosen speed limit.
The F&F profile temporarily allows 300 mm/s before localization, restoring zero
on the first position or a stop. A lost connection can prevent that reset; remain
beside the car during this still-unverified hardware procedure. Each track piece has printed codes that the
car reads and reports as a piece id and a location id. The mapper commits one piece at
each transition bar, starts the map at the start/finish piece, and accepts the loop
when the start piece comes round again and the pieces close geometrically. The map
grows on screen as pieces are found. If a piece's code is missed, its shape is taken
from the left and right wheel distances.

Supported pieces are all 21 modular piece ids in the app's data: straights
(36, 39, 40, 48, 51), curves (17, 18, 20, 23, 24, 27), start and finish (34, 33),
intersection (10), jump and landing (43, 46), and the Fast & Furious pieces
(58, 63). Fast & Furious pieces 53, 54 and 57 are **special and unverified**;
any map containing them is blocked from scored rounds. Their displayed geometry
is provisional, not a supported physical classification. The older one-piece printed mats are not supported.

Once mapped, every car is placed by matching the pieces it reports against the map,
in either direction of travel. The exact lane comes from the location code. A real
track's map is saved in the browser and can be reloaded with **Use saved map**.

## Battle

The tables cover 21 car models and the battle code implements 14 weapon types
using extracted parameters and some approximations/defaults. This is not a
verified reproduction of the original game's balance or hardware behavior:

machine gun · cannon (single shot and charged) · mine · tractor beam · boost · shield ·
reverse drive · horn · e-brake · scrambler · gravity trap · pulse ram · and the two
truck rage modes.

Each car has 10 energy that recharges at 1.5 per second. Weapons spend it and hits
remove it. At zero the car is disabled: it stops, flashes red, and returns with full
energy after about 3 seconds. The controller represents a hit with a speed limit, a forced lane
change or a stop, plus engine-light commands; physical responses are unverified. Beams, mines and explosions are
drawn on the map. A real collision reported by a car costs 1 energy.

Choose each car's model in the garage; the model sets its weapons. Cars report their
model in their Bluetooth advertisement, which the page reads when the browser allows
it; otherwise pick it from the list.

## Recording real cars for the tests

The simulator and the controller were written together, so the simulator can only
show that they agree with each other. **Record** on the host page captures every
byte to and from each car; **Save trace** downloads it. Put the file in
[`fixtures/`](fixtures/README.md) and the test suite replays it through the real
decoder, mapper and localiser from then on. Until a hardware trace is there, the
suite prints "NO HARDWARE TRACES YET".

## First run with real cars

1. One charged car on a closed loop, someone beside the track, **Top speed** at 400.
2. **Connect car**, pick it in the browser's chooser. Its engine light should turn
   to its team colour. If nothing changes, stop and check the log.
3. Set the driver to keyboard, explicitly choose **Free drive** if stopped, then
   tap W. Check braking with S and STOP with Esc. STOP must remain latched.
4. Tap A and D. The code assumes a positive lane offset means right, then corrects
   itself from the track codes if a car answers the other way. Watch that left is left.
5. **Scan track** and compare the drawn map with the table.
6. Test off-track recovery, hiding the host, a phone disconnect and an explicit
   control handoff. Keep someone able to stop the car physically. Add a second
   car only after these checks; four simultaneous cars need a separate trial.

The selected speed ceiling also applies to scans and boosts; the protocol has an
additional 1400 mm/s maximum. Lane targets stay within 68 mm of the centre line.
Software stop requests and disconnects are best effort: host death, radio loss
and actual braking distance remain unverified.

## Compatibility and credits

Slipstream is an independent project. It is not affiliated with or endorsed by the
maker of the cars or of the original game. The interface and data retain vehicle
names and weapon identifiers from source configuration, alongside derived numeric
measurements and selected structured gameplay parameters. These are not
numeric-only tables. No executable app binaries, artwork or audio are bundled by
the extractor. Attribution does not establish permission to redistribute these
fields; distribution terms remain unresolved. See [ANALYSIS.md](ANALYSIS.md) and
the repository's `LICENSE.txt`.

## Files

| File | Purpose |
|---|---|
| `protocol.mjs` | Message encoders and decoders |
| `track.mjs` | Piece table, mapper, layout geometry, localiser |
| `car.mjs`, `ble.mjs` | Per-car control and the Web Bluetooth link |
| `battle.mjs` | Energy, weapons, computer driver |
| `game.mjs` | Scan, battle and control loop, no DOM |
| `session.mjs`, `DESIGN.md` | Timed rounds, original mission briefs and design rationale |
| `sim.mjs` | Simulated cars and practice layouts |
| `app.mjs`, `render.mjs`, `index.html`, `style.css` | Host page |
| `pad.mjs`, `pad.html`, `net.mjs` | Phone pad and relay client |
| `trace.mjs`, `fixtures/` | Recording, replay and recorded sessions |
| `data/*.json` | Tables derived from the app's config by `tools/extract_config.py` |
| `../platform/slipstream-relay.mjs` | The relay |

Tests: `node --test slipstream/*.test.mjs platform/slipstream-relay.test.mjs`.

## Not done yet

- No run against physical cars from this code (see Status).
- Jumps are mapped and drawn; nothing special is sent to help a car clear one.
- At an intersection a car's position is known only from its entry and exit codes.
- Weapon upgrades, a persistent/branching campaign, commanders and sound are not included.
- A firmware-level QEMU "digital twin" of the car is not practical; see
  [FIRMWARE-TWIN.md](FIRMWARE-TWIN.md). The behavioural twin in `sim.mjs` is the
  working alternative.
- If the host laptop sleeps or crashes, it cannot send STOP. A device-enforced
  timeout or verified link-loss stop is still needed; host pings alone are not proof.
- Tilt direction depends on how the phone is held; use **Flip tilt**. Tilt has not
  been tried on a physical iPhone or Android phone.
- Four simultaneous Bluetooth links from one laptop have not been tried on hardware.

## Precision and cooperative tasks

Select **Precision run** in Arcade or Competition to match four virtual gates’ lane and speed bands. Each car’s next target appears in its card, on its phone, and as a numbered map marker. Full throttle alone earns no gate points.

Story missions require every car to scan, carry and deliver its own packets. One car does the sequence alone; up to four human/computer drivers contribute independently. CPUs follow the task requirements and wait when finished. Phone score feedback is optional, with visible task cues on every device.


### Circuit planning and crews

Open **Build a circuit** to add known section codes in driving order, reverse
curves, undo a section, or copy the current map. The preview reports whether the
ends meet. **Try this circuit** loads a closed design into the simulator with
cars stopped. For physical cars, construct the layout and scan it; the drawing
cannot establish real geometry, bridge clearance or jump feasibility. Sections
inferred from wheel travel remain provisional and cannot start a scored round.

Choose **Battle alliance** on each car: Independent, Sun or Moon. Teammates cannot
hit each other; helping disable the same opponent earns 25 assist points. Target
numbers and crew/assist feedback appear on host and phone. Alliances work with
human or CPU drivers, browser or phone controls. Two allied cars can play a Crew
mission; Battle rush needs an opposing racer. Changing crews ends the round.
Positions older than two seconds wait for new codes before targeting/scoring;
this conservative software rule still needs physical timing validation.

See [independent verification and its limits](review/INDEPENDENT-REVIEW.md),
[reverse-engineering tools](review/REA-REVIEW.md), and the coordinated-game design
ideas in [DESIGN.md](DESIGN.md). Tests do not establish real host-loss stopping.

### Controller handoffs

Leaving a car locks phone controls until the host confirms the release. The phone
retries that request after reconnecting; a stale car snapshot cannot restore
throttle. Gamepads keep their browser slot when another controller disconnects.
After a stop, reconnect or control reassignment, release the throttle trigger and
weapon buttons and center the steering stick before driving again. The host shows
“Release gamepad controls to arm” while it waits. These are software safeguards;
physical stopping behavior still requires hardware validation.

### Safety changes from the external review

Phones must send fresh neutral input after any stop, control handoff, relay status
change or dead-man expiry. For a gamepad, press a button to claim its controller,
then release buttons/triggers and center the stick; unsupported mappings stay
stopped. Selecting Computer does not start a car: use Start round or Free drive
and wait for the three-second countdown.

Choose the scan car and confirm the track is clear with other cars removed before
scanning. Scans and shared-pit resume use the same three-second countdown. Scan
completion or cancellation latches STOP. Moving cars request a shared pit after
5 seconds without a first position/transition or a 2-second gap thereafter.
Scans are bounded to 45 seconds and three anchor returns. Continued track telemetry
more than a second after a stop triggers another STOP and a visible pit alarm.
These are software defaults requiring physical validation, not proven stop times.

Slow Story/Precision missions on intersection maps are blocked pending validation
under the unchanged 2-second watchdog. IDs 53, 54 and 57 remain special/unverified
and cannot enter scored rounds. See [the review response](review/PR4-REVIEW-RESPONSE.md)
for evidence and outstanding hardware and security work.

### Diagnosing a real scan

**Live car checks** separates requested speed from reported speed, shows packet
counts and freshness, and identifies unknown lateral offsets. **Save trace** works
while recording and includes your **Physical observations**, scan settings and
stop events. Scan attempts automatically start capture if needed.

Optional **Scan-start calibration** accepts a measured starting position on a
straight piece, with separate confirmation. Leave it blank for an unchanged
baseline; never guess that the centre is zero when the car is on another lane.
Left/right hardware sign remains unverified. Follow the controlled comparison in
[Live diagnostics](review/LIVE-DIAGNOSTICS.md).
