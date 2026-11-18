# Slipstream — Student Quick Start (try it tonight)

Paste-ready for Canvas. This is the short version of the full
[student guide](README.md#student-view-default). Do every step with someone's
hand ready to grab the car, and keep **STOP ALL** in reach.

---

## What you'll do

Connect your car → identify it (model + LED color) → scan your track → drive it,
from the laptop or from your phone.

## Set up your own Codespace (do this first)

Each of you runs your **own** server in a GitHub Codespace. You can share the
physical track; everyone drives through their own server.

1. On GitHub, open **`matthewluallen/cs460-second-lap-overdrive`** and start a
   **Codespace** on the branch **`slipstream-and-security-hardening`** (the latest
   build) or on **`main`**. The `.devcontainer` installs the locked dependencies
   for you — no install scripts.
2. The Codespace runs the server on start. If you need to start it by hand, run
   `PORT=3000 npm run slipstream:up` in the terminal. Get your private room **host
   code** with:
   ```sh
   cat "${SLIPSTREAM_STATE_DIR:-$HOME/.local/state/slipstream-managed}/host-code"
   ```
   Keep that code to yourself — it's what lets phones join your room.
3. In the **Ports** panel, open the forwarded **port 3000** URL and add
   `/slipstream/` — e.g. `https://YOUR-CODESPACE-3000.app.github.dev/slipstream/`.
   Open that **HTTPS** URL in Chrome/Edge on the laptop next to the track. Leave
   the forwarded port's **protocol set to HTTP**.
4. To let phones join, set **port 3000 to Public** in the Ports panel. (Private is
   the default; GitHub's sign-in still applies until you make it public.)

Prefer to run it on your own machine instead? `npm ci --ignore-scripts`, then
`npm run slipstream`, and open `http://127.0.0.1:8000/slipstream/` (laptop only —
phones can't reach localhost). See [DEPLOYMENT.md](DEPLOYMENT.md) for details.

## Before you start

- Use **desktop Chrome or Edge** on the laptop next to the track (that laptop
  owns the Bluetooth link). Phones and iPads join over the network, not Bluetooth.
- Keep that laptop **awake** and its Slipstream tab **visible** the whole time —
  hiding the tab stops the cars on purpose.
- Open **`/slipstream/`**. You start in **Student** view on **Classic SDK** at a
  **300 mm/s** ceiling. (No car yet? You can still do everything in the
  simulator — see the last section.)

## Drive from the laptop

1. **Connect & color.** Switch on one charged car and take it off the charger.
   Choose **Connect car**, pick it in the browser's Bluetooth picker, and finish
   pairing. The Bluetooth *name* (e.g. "Z. Drive") does **not** tell you the
   model — set **Car model** to the model printed on your car. Then pick an **LED
   color**; the same color shows on the car's light, its card, the map, and any
   phone. Look at the physical light to confirm — a color command is not proof of
   identity.
2. **Scan your track.** Place the car on a printed lane. Check **"Car on a
   printed lane; hands clear; I'm watching,"** then **Scan track**. After the
   three-second countdown the car drives a lap to read the printed codes and
   stops. Confirm it physically stopped and the drawn map matches your circuit.
3. **Drive.** Choose **Drive here**, then **Start driving**. Use the throttle and
   the left/right lane buttons. *Start driving only enables the controls — it does
   not apply throttle.* After any stop, return the throttle to zero before driving
   again.

Press **STOP ALL** (or **Esc**) at any time. STOP always latches — it never
doubles as a resume button.

## Drive from a phone or iPad

1. Get the **Class host code** from your instructor and type it **exactly** —
   capitalization matters.
2. On the car's card choose **Phone / QR**, scan the QR code with the phone
   camera, open the link, enter a driver name, and join.
3. On the laptop, choose **Let in** for that name, then **Start driving**.
4. On the phone: **hold to drive**, use the left/right arrows to steer, and
   **STOP** to stop. Releasing the drive button stops the car. Tilt steering and
   haptics are optional.

The phone needs no Bluetooth of its own, and the QR code never carries the host
code or key. Phone-controlled *physical* driving is still being validated, so
keep watching the car and be ready to STOP.

## Investigate the system

Open **Investigate the system** on the page and work through any of the four
activities: how the car reads the track, a hardware-capability inventory (an HBOM
starting point), the declared software dependencies (an SBOM starting point),
FCC-label research, and the security challenges. These inventories are starting
points, not complete bills of materials — part of each activity is explaining
what evidence would actually establish a component or an FCC identity.

## No car tonight? Use the simulator

Switch to **Advanced**, choose **Add simulated car** (one to four), pick human or
computer drivers, **Scan track**, choose a feel and challenge, then **Start
round**. The simulator exercises the same controller code — agreement with it is
not proof of how real hardware behaves, but you can try the whole flow without any
car.

## Safety, every time

- Someone stays beside the track, able to stop a car by hand.
- **STOP ALL** and **Esc** always stop and latch the cars.
- Keep the laptop awake with the Slipstream tab visible.
- A software speed limit is not a guarantee of a physical stop — supervise.
