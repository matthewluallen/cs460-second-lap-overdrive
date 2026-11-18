# Slipstream Lab — Quick Start

**Goal tonight:** get a car driving on the track — a real car, or a pretend one on
screen.

**Always:** keep a hand near the car, and know where **STOP** is before you start.

You each run your **own** copy. You all share **one** real track, so you take turns
on it.

---

## Part 1 — Start your own copy (about 5 minutes)

1. Go to the project on GitHub: **matthewluallen/cs460-second-lap-overdrive**.
2. Switch to the branch **`slipstream-and-security-hardening`** (or **`main`**).
   Then click the green **Code** button → **Codespaces** → **Create codespace**.
   Wait for it to finish loading.
3. In the terminal at the bottom, type these two lines (press Enter after each):
   ```
   npm run slipstream:up
   npm run slipstream:code
   ```
   The second line prints your **host code**. Write it down — your phone needs it
   later. Keep it to yourself.
4. A message says a port is ready. Open it and add **`/slipstream/`** to the end of
   the address. That's your page. Open it in **Chrome or Edge** on the laptop next
   to the track.
5. **Only if you'll use a phone:** open the **Ports** tab, right-click **port
   3000** → **Port Visibility** → **Public**.

*No car or no track yet? Skip to **Practice with no car** at the bottom — you can
still do the whole thing.*

## Part 2 — Set up your car (on the laptop)

1. Turn your car on and take it off the charger.
2. On your page, click **Connect car** and pick your car in the pop-up.
3. Set **Car model** to the name printed on your car. (The Bluetooth name is **not**
   the model.)
4. Pick a **color**. It shows on the car's light, on screen, and on the phone.
   Check that the real light matches.

## Part 3 — Map the track

1. Put the car on a printed lane.
2. Check the box that says the track is clear and you're watching.
3. Click **Scan track**. The car drives one slow lap, reads the track, and stops.
4. Make sure it stopped, and the map on screen looks like your track.

## Part 4 — Drive

**From the laptop:**
1. Click **Drive here**, then **Start driving**.
2. Use the throttle and the left/right buttons. (Start driving only turns the
   controls on — it does not move the car by itself.)

**From a phone:**
1. Type your **host code** (from Part 1) into the box. Type it **exactly** — capital
   letters matter.
2. On the car, click **Phone / QR**. Scan the code with your phone and open the link.
3. Enter your name and join. On the laptop, click **Let in**, then **Start driving**.
4. On the phone: **hold** the big button to drive, **let go** to stop, arrows to
   steer, **STOP** to stop.

**To stop any time:** press **STOP ALL** on the laptop (or the **Esc** key), or
**STOP** on the phone. Driving from a phone to a real car is still being tested, so
keep watching the car.

## How many of us can drive at once?

- **On the real track: a few at a time.** One laptop drives up to **4 cars**, and the
  track only fits a handful. Take turns in small groups — start with one or two cars.
- **Everyone at once: the practice simulator** (next section). It needs no car and no
  track, so nobody has to wait.

## Practice with no car

Click **Advanced** → **Add simulated car**. Pick drivers, click **Scan track**,
choose a game, then **Start round**. Same controls — no hardware needed.

## Want to dig deeper? (optional)

On your page, open **Investigate the system** to explore how the car reads the track,
what parts and software it uses, its FCC radio label, and some security questions.

## Safety — every time

- Someone stands by the track, ready to grab a car.
- **STOP ALL** and **Esc** always stop the cars.
- Keep the laptop awake and the page tab open.
