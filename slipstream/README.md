# Slipstream

Drive real robotic race cars from a web browser: several cars at once,
automatic track mapping drawn live on the page, the original game's weapons, computer
opponents, and phone controllers that join by QR code and steer by tilting.

**Status: everything here runs and is tested against simulated cars. It has not yet
been run against a physical car from this code base.** The bytes it sends match
the manufacturer's published SDK and the layouts recovered from the Android app
([ANALYSIS.md](ANALYSIS.md)), and the repository's separate instructor trial has moved
one real car with the same speed message type. Treat the first live session as a test:
see [First run with real cars](#first-run-with-real-cars).

## Start it

```sh
npm ci --ignore-scripts
npm run slipstream        # serves http://127.0.0.1:8000/slipstream/
```

Open the page in desktop Chrome or Edge. Plain `npm start` does not serve this page or
its relay, so the stationary course bench is unchanged.

To try it with no hardware: **Add simulated car** a few times, **Scan track**,
**Start battle**. Simulated cars speak the same bytes as real ones, so the mapping,
positions and weapons you see are the real code paths.

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
2. In the Ports panel set port 8000 to **Public**, or each phone must be signed in to
   GitHub as you. Raise the Codespace idle timeout for a long session; the server
   prints a line every five minutes, which also counts as activity.
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

The phone shows a throttle slider, FIRE / SUPPORT / SPECIAL buttons with the car's
actual weapon names, an energy bar and score. **Tilt steering** uses the phone's
orientation reading (accelerometer, smoothed by the gyroscope). It works in iPhone
Safari and Android Chrome over HTTPS; iPhone asks for permission once, when the
player taps Join or Tilt steering. **Flip tilt** reverses it if left and right are swapped for the
way the phone is held. Arrow buttons work without sensors. Double-tap a weapon button
to switch weapons on cars that carry several.

A phone that locks, loses signal or closes the page stops sending; the host stops
that car within 0.7 seconds.

### Keyboard and gamepad

| | Player 1 | Player 2 |
|---|---|---|
| Faster / slower | W / S | Up / Down |
| Lane left / right | A / D | Left / Right |
| Fire, support, special | F, G, R | K, L, O |
| Switch attack / support weapon | Q / E | I / P |
| U-turn | X | M |

Gamepad: right trigger throttle, left stick lane, A fire, B support, Y special.
**Esc** or **STOP ALL** halts every car and holds them stopped until **RESUME**.

## Track mapping

**Scan track** drives one car at 450 mm/s. Each track piece has printed codes that the
car reads and reports as a piece id and a location id. The mapper commits one piece at
each transition bar, starts the map at the start/finish piece, and accepts the loop
when the start piece comes round again and the pieces close geometrically. The map
grows on screen as pieces are found. If a piece's code is missed, its shape is taken
from the left and right wheel distances.

Supported pieces are all 21 modular piece ids in the app's data: straights
(36, 39, 40, 48, 51), curves (17, 18, 20, 23, 24, 27), start and finish (34, 33),
intersection (10), jump and landing (43, 46), and the Fast & Furious pieces
(53, 54, 57, 58, 63). The older one-piece printed mats are not supported.

Once mapped, every car is placed by matching the pieces it reports against the map,
in either direction of travel. The exact lane comes from the location code. A real
track's map is saved in the browser and can be reloaded with **Use saved map**.

## Battle

All 21 car models and all 14 weapon types from the app's `items.json` are
implemented, with the app's own numbers for range, damage, energy cost and cooldown:

machine gun · cannon (single shot and charged) · mine · tractor beam · boost · shield ·
reverse drive · horn · e-brake · scrambler · gravity trap · pulse ram · and the two
truck rage modes.

Each car has 10 energy that recharges at 1.5 per second. Weapons spend it and hits
remove it. At zero the car is disabled: it stops, flashes red, and returns with full
energy after about 3 seconds. Real cars feel a hit as a speed limit, a forced lane
change or a stop, and show it on their engine light. Beams, mines and explosions are
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
3. Set the driver to keyboard, tap W. The car should move; S or Esc should stop it.
4. Tap A and D. The code assumes a positive lane offset means right, then corrects
   itself from the track codes if a car answers the other way. Watch that left is left.
5. **Scan track** and compare the drawn map with the table.
6. Add a second car before raising the speed or starting a battle.

Hard limits in the code: no speed above 1400 mm/s is ever sent, lane targets stay
within 68 mm of the centre line, and a hidden browser tab stops all real cars.

## Compatibility and credits

Slipstream is an independent project. It is not affiliated with or endorsed by the
maker of the cars or of the original game, and it uses none of their names in its
own. [ANALYSIS.md](ANALYSIS.md) names the hardware and software it was built to work
with and the published SDK its message layouts follow.

## Files

| File | Purpose |
|---|---|
| `protocol.mjs` | Message encoders and decoders |
| `track.mjs` | Piece table, mapper, layout geometry, localiser |
| `car.mjs`, `ble.mjs` | Per-car control and the Web Bluetooth link |
| `battle.mjs` | Energy, weapons, computer driver |
| `game.mjs` | Scan, battle and control loop, no DOM |
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
- Weapon upgrades, the campaign, commanders and sound are not included.
- A firmware-level QEMU "digital twin" of the car is not practical; see
  [FIRMWARE-TWIN.md](FIRMWARE-TWIN.md). The behavioural twin in `sim.mjs` is the
  working alternative.
- If the host laptop sleeps or crashes, nothing tells the cars to stop. A keep-alive
  needs a real car to verify and is the next safety item.
- Tilt direction depends on how the phone is held; use **Flip tilt**. Tilt has not
  been tried on a physical iPhone or Android phone.
- Four simultaneous Bluetooth links from one laptop have not been tried on hardware.
