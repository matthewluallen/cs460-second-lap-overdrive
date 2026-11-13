# Firmware emulation: evidence and limits

The repository has no verified runnable car-firmware image or validated peripheral
model. The useful next step is recording physical-car traces and comparing them
with the behavioural simulator. Firmware emulation remains a separate research
project; its feasibility has not been established by this review.

This memo corrects the earlier claim that entropy analysis "confirmed" encryption.
The original APK/OBB, firmware files, disassembly and measurement commands were
not independently examined during the code review. The observations below are
reported by the original author, not new verified findings.

## What the earlier analysis reported

The hardware account described an STM32F051K8 microcontroller for motor control,
an nRF8001 BLE connectivity IC, an optical track sensor, Hall-effect wheel
feedback, and motors. Its cited sources were iFixit's *Anki Drive Teardown*, EE
World's *Teardown: Inside the Anki Overdrive racecar set*, ST/Power Systems Design,
and a community PCB trace. Exact board revisions and peripheral behavior still
need direct verification before choosing an emulator model.

The earlier OBB inspection described `basestation/firmware` update files under the
name "RushHour", including factory/Drive version identifiers `2031`, `2062`,
`2120`, `2149`, and `7d7d`. It reported:

- `.ota` files with magic `c0 ff ee 54`, a header, and approximately 28–36 KB size.
- `.safe` files with the ASCII magic `DriveHW5`, a header, and approximately
  46–58 KB size.
- Body entropy of 7.99–8.00 bits per byte; attempted decompression unsuccessful;
  no recognized readable strings, symbols or STM32 vector table in the inspected
  payloads.
- Conditional `.ota.h` arrays referring to `DEV_FEATURES_ALLOWED`.

High entropy and failed attempts with unspecified decompression methods do not
prove encryption or rule out compression, packing, or another container format.
No algorithm, key, authenticated format, executable entry point, or successfully
loaded image was verified here. Encryption is a hypothesis from the earlier
analysis; it should not be presented as a confirmed technical or legal conclusion.
This project has not pursued firmware decryption or protection bypass.

A reproducible follow-up would need exact source hashes, the files and byte ranges
measured, the scripts/commands used, decompressor versions and results, and evidence
for the image/container format. The original report's statements that no public
image exists or no emulator supports the chip are time-dependent and were not
reverified here.

## Why a CPU image would not be a complete car simulator

Even with a runnable firmware image, a useful emulator would need the relevant
clocks, timers, SPI/radio behavior, sensor inputs, wheel feedback and motor-output
interpretation. It would also need a track-and-motion model to turn commands into
physical effects. CPU instruction execution alone does not demonstrate steering,
localization, braking or loss-of-link behavior.

The existing `sim.mjs` instead models the Bluetooth boundary: commands in,
notifications out, and simulated motion. This is useful for testing host logic,
but it is not firmware-faithful evidence. The controller and simulator share many
assumptions, so agreement between them is not independent validation.

## Next useful work

1. Capture one supervised physical-car run with **Record** and retain the layout,
   model, firmware version, control settings and expected observations alongside
   the trace. Add assertions with explicit expected mapping and lane direction.
2. Measure notification cadence separately from optical sensor sampling. The
   earlier note conflated approximately 500 Hz with 20 ms; those are different
   rates, and neither should be adopted as a verified BLE cadence.
3. Measure left/right steering, off-track reporting, stop/braking behavior, host
   loss and Bluetooth link loss. Then repeat with two and four cars.
4. Compare the simulator against those observations before adding realism claims.
5. Revisit a firmware emulator only if a usable image, permission to use it, and
   the peripheral-model scope are established. No distribution or legal clearance
   for third-party firmware is asserted by this document.

See [ANALYSIS.md](ANALYSIS.md) for the earlier app report and
[fixtures/README.md](fixtures/README.md) for trace handling. The missing verified
host-loss stop remains a hardware-safety issue regardless of emulator choice.
