# Can we run the car firmware in QEMU as a digital twin?

Short answer: **not practically, and it is the wrong tool for a "digital twin" here.**
Two things block it, and even if both were solved QEMU would give us the least
useful part. This memo records why, from the teardown and FCC OSINT, and what to
build instead. Dates and part numbers are cited in [ANALYSIS.md](ANALYSIS.md) and
the teardown sources listed at the end.

## What the hardware actually is

Both generations use the same split design, confirmed by iFixit, EE World and a
community PCB trace:

| Part | What it is | Role |
|---|---|---|
| ST **STM32F051K8** | ARM Cortex-M0, 48 MHz, **64 KB** flash, motor-control timers | Runs the car's ~20,000 lines of firmware |
| Nordic **nRF8001** | BLE **connectivity IC** (a slave, driven over SPI) | Radio only; runs no application code we could emulate |
| Optical sensor + IR LED | Reads the track's printed codes ~500×/second | The car's only real input |
| Hall-effect sensor | Counts drive-gear teeth | Wheel speed feedback |
| DC motors | Drive and steer | The car's only real output |

The important shape: the firmware is a tight **sensor → control loop → motor**
program. Almost all of its behaviour is reacting to the optical and Hall inputs and
driving the motors. The "intelligence" (track map, strategy, weapons) was always in
the phone app, not the car — iFixit and ST both say so.

## Blocker 1: we have no firmware binary

The firmware lives in the STM32's internal 64 KB flash. To emulate it we need that
image, and there are only three ways to get one, all with problems:

1. **Dump it off a car.** STM32 flash has Readout Protection (RDP). Getting past it
   is published research — cold-boot stepping (Fraunhofer, WOOT '17), the
   "Exceptional Failure" glitch, the Pi-Pico `picopwner` tool, and commercial RDP1
   decryptors — but every method needs the physical chip, a glitching rig and hours
   of fiddling, and it is an attack on a device's protection. It is not a software
   task and not something to do casually.
2. **Use the firmware-update images in the app — checked, and they are encrypted.**
   The app's OBB ships a `basestation/firmware` folder of OTA images under the
   project codename "RushHour" (Anki Drive's internal name; the manifest carries a
   2013 Anki copyright). It holds the full version history — factory 2013 (`2031`),
   Drive 2.0.1 (`2062`), 2.1.x (`2120`), 2.2.x (`2149`) and a "Future" build
   (`7d7d`) — in two formats:
   - `.ota`: 4-byte magic `c0 ff ee 54`, then an 8-byte header, ~28–36 KB.
   - `.safe`: 8-byte ASCII magic `DriveHW5`, then a header, ~46–58 KB.

   Every file's body has Shannon entropy of **7.99–8.00 bits/byte**, the payloads do
   not decompress, and across ~1 MB of images there is **no readable string, symbol
   table or STM32 vector table**. That is the signature of encryption, not
   compression — consistent with Anki's advertised 128-bit encryption. So these are
   confirmed **not runnable**: there is no image to load into an emulator without
   first defeating the encryption. The decryption key would live in the app's native
   engine or the car's bootloader; recovering it to decrypt the images is a
   protection-circumvention exercise this project does not pursue. (The empty
   `.ota.h` C arrays in the OBB only hold real bytes under a `DEV_FEATURES_ALLOWED`
   build flag, which the shipping app does not set; the binary `.ota`/`.safe` files
   are the real, encrypted payloads.)
3. **Ask someone who already dumped one.** No public Anki *car* firmware dump
   exists that I could find (unlike the Vector robot, whose OTA images were
   decrypted by its rooting community).

## Blocker 2: QEMU gives us the CPU, not the car

Even with an image:

- Mainline QEMU has **no STM32F0 machine**. STM32 support lives in forks, mostly
  F1/F4. Emulating the F051 means writing a machine model (clocks, flash, the
  TIM1/TIM3 motor timers, SPI, USART, GPIO, ADC).
- A running CPU does nothing without the **physical world**. The firmware spins
  waiting on the optical sensor and Hall sensor and writes motor PWM. To make it
  *drive* you must model all of that and feed it a simulated track — the optical
  code stream for a given position, the Hall pulses for a given speed, the SPI
  traffic to and from the nRF8001. That track-and-physics model is the actual work,
  and it is the same model we would write anyway without QEMU.

So QEMU would reproduce the one part that is already simple (a small Cortex-M0
control loop) while we still hand-write the hard part (the track, sensors and
motor response). That is a poor trade.

## What a digital twin should be here, and mostly already is

The useful twin models the car **at the Bluetooth boundary** — same packets in,
same notifications out, same timing — not the transistors. That is exactly what
[`sim.mjs`](sim.mjs) is: a `SimCar` accepts the real wire bytes and emits real
position, transition and status notifications, and the whole stack above it
(decoder, mapper, localiser, battle) runs against it unchanged. It is a behavioural
digital twin already.

To make it firmware-faithful rather than merely plausible, in rough order of value:

1. **Validate against real cars.** Record traces with the host page's **Record**
   button and drop them in [`fixtures/`](fixtures/README.md); the test suite already
   replays them. This is what turns the sim's assumptions into pass/fail, and needs
   no firmware at all.
2. **Match the real cadence and quirks** from those traces: the ~500 Hz / 20 ms
   sensor interval, the exact delocalization behaviour when the car leaves the line,
   the battery-voltage curve, the version/ping reply timing.
3. **Only if a real image is ever dumped**, revisit emulation — and then reach for
   **Renode** or a QEMU STM32 fork with a custom peripheral+track model, scoped as
   its own project, not a weekend task.

## Bottom line

A firmware-in-QEMU twin is blocked on having no runnable image, and even unblocked
it would emulate the easy part and leave the hard part (track physics) to us. The
behavioural twin we already have is the right abstraction; the highest-value next
step is recording real-car traces to validate it. The OBB firmware images have now been
fingerprinted and are confirmed encrypted (see Blocker 1), which closes the last
"maybe" — there is no shortcut to a runnable image here.

## Sources

- iFixit, *Anki Drive Teardown* — STM32F051K8, nRF8001, optical sensor.
- EE World Online, *Teardown: Inside the Anki Overdrive racecar set* — optical
  sensor ~500/s, Hall-effect wheel sensor, Nordic BLE.
- ST / Power Systems Design — STM32 selected by Anki, "20,000 lines of code,"
  track analysed 500×/second.
- Community PCB trace (Fisch37 gist) — STM32F051K8 + nRF8001, J2 header on USART1
  (PA9/PA10), likely UART system bootloader.
- STM32 RDP research: Obermaier et al. (Fraunhofer WOOT '17); "Exceptional Failure"
  (zapb.de); `CTXz/stm32f1-picopwner`; reports of commercial RDP1 decryptors.
