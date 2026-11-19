# Week 4 — Map, drive and explore

**Goal:** connect a car, discover the track, and drive from your laptop or phone.
You can also practice entirely in simulation. Coordinate use of the shared track
with the instructor; each host laptop controls only its own connected cars.

## 1. Open your copy

1. Open **matthewluallen/cs460-second-lap-overdrive** on GitHub and select branch
   **`week-4-student-driving`**. Choose **Code → Codespaces → Create codespace**.
2. Wait for setup. The supplied Codespace starts Slipstream automatically. If
   needed, run `npm run slipstream:up` in its terminal; running it again checks the
   existing server instead of replacing it.
3. Open forwarded **port 3000**, add **`/slipstream/`** to the address, and use that
   HTTPS page in **Chrome or Edge on the laptop beside the track**.
4. For phone/iPad access, use **Ports → port 3000 → Port Visibility → Public**.
   Leave the forwarded port protocol set to HTTP; its public browser address is HTTPS.

**Student mode needs no typed host code.** The Codespace hosts the website; the
nearby laptop supplies Bluetooth. Phones and iPads use their browsers and do not
need Bluetooth access to the car. Keep the laptop awake and its host tab visible.

## 2. Identify your car

1. Switch on a charged car normally and take it off its charger.
2. Choose **Connect car**, select the device and finish Connect/Pair.
3. Match **Car model** to the name printed on the car. A Bluetooth name such as
   “Z. Drive” does not establish its physical model.
4. Choose an LED color while stopped. Check the real light against the card and
   map color. Each car in this host uses a distinct available color.

Use the instructor's accepted car. Guardian has limited supervised acceptance;
the Groundshock that spun in independent testing is excluded.

## 3. Discover the track

1. Place the car on a printed lane; keep hands clear and watch the track.
2. Check the confirmation box and choose **Scan track**.
3. After the three-second countdown, the car requests a scan at no more than
   **300 mm/s**. Discovery may need more than one circuit.
4. Confirm that it physically stopped and that the displayed map matches the track.

If scanning fails, read the visible reason. Confirm the car is stopped on track,
use its **Recover** button when required, then **Clear pit · keep stopped**.
A new **Scan track** action starts a separate countdown.

## 4. Choose your controller

**Laptop:** choose **Drive here → Start driving**. Keep throttle at zero until
ready, then raise it. Use the left/right buttons on a readable straight; **Brake**
returns throttle to zero. Start driving enables control without applying throttle.

**Phone or iPad:**

1. Choose **Phone / QR on your car's card**. Each car has its own invitation.
2. Scan it, open the link, enter your name and join.
3. On the laptop, choose **Let in** for your name, then **Start driving**.
4. On the phone, **hold** the drive button to drive and **release** it to request
   a stop. Use arrows for steering and **STOP** when needed. Tilt is optional.

An unused QR stays stable. Approval replaces it; changing controller, removing the
car or revoking its invitation invalidates the old access. Choose **Phone / QR**
again for a new driver. Keep watching the car: phone-controlled physical driving
still needs acceptance on the actual classroom network.

## 5. Try the Week 4 options

Press **STOP ALL** before changing driving settings. Start with the defaults.

| Option | What to try |
| --- | --- |
| Maximum driving speed | Default **300 mm/s**. Higher settings up to **1200** are software options, not accepted physical speeds; use simulation or an instructor-supervised trial. Scans remain capped at 300. |
| Acceleration | Direct throttle or a **1-, 2- or 4-second ramp** toward your requested speed. Reducing throttle or pressing STOP does not wait for the ramp. |
| Telemetry gaps | Keep **Strict · stop after 2 seconds** initially. Optional brief-gap recovery gives eligible mapped driving at most one extra second at limited speed, with steering and attacks locked. It needs two consistent readings to recover; otherwise STOP is requested at the 3-second gap. Scans and diagnostic tests stay strict. |
| Power Zone rule | Default **Off**. On a mapped piece 57, **Charge shield** earns a virtual shield after a confirmed crossing and ordinary exit. **Boost after exit** can add up to 75 mm/s for up to one second after a suitable straight exit, within your maximum and throttle. At the maximum there is no extra boost. These are custom Slipstream rules, not the original app's lane attack, and remain physically unverified. |

Open **3D studio** to choose **Circuit overview**, **Chase cam**, **Driver view**,
**Trackside** or **Auto director**, and select a car. These are rendered views of
track readings, not live video. Uncertain position returns to overview. Captions
are the default; **Captions + voice** is optional, and **Off** disables commentary.
Camera and voice controls do not drive the car.

## Practice and investigate

For practice without hardware, choose **Advanced → Add simulated car**, then
return to **Student** for the same scan, on-screen and phone steps. Up to four
simulated cars can share a host. Advanced also contains computer drivers and games;
selecting Computer does not start it—use the explicit start and countdown.

Open **Investigate the system** to examine track sensing, hardware and software
inventories, radio labels and security questions. Record a prediction, an observed
result and what the evidence cannot prove.

## Keep control of the physical test

- Stay beside the track, with hands clear and the means to stop a car physically.
- **STOP ALL / Esc** requests a stop for this laptop's cars; it does not stop cars
  connected to other laptops. A lost connection can prevent delivery.
- Confirm the physical stop before touching or repositioning a car.
- Keep the host laptop awake and its tab open. The map and replies are evidence,
  not proof that a maneuver completed.
