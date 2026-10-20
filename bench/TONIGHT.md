# Tonight: charge, connect, light

The goal is one documented attempt with **your assigned stationary car**:
charging observations, a Chrome connection, a live battery reply if available,
and a visible headlight change. No driving is part of this activity. The live
path is implemented but **hardware-unverified** on the course kits.

## 1. Prepare and charge the assigned kit

- Label the car and record its model, assigned kit label and starting Git revision.
- Use the instructor-provided charging equipment and the instructions for that
  kit. Record when charging started and ended, the charger used, and what its
  indicators actually did. Do not assume one light color or charging time applies
  to every model. If the car or battery is damaged, swollen or unusually hot,
  stop and tell the instructor; do not open or repair it during this activity.
- Take the car **off the charger**, power it on and keep it stationary with wheels
  clear. Release other apps, tabs and laptops that may still control it. Stagger
  team attempts so only the assigned car is powered in the test area.
- Open the bench in desktop Google Chrome on the physical laptop. Follow
  [laptop setup](LAPTOPS.md) and [launch instructions](BENCH.md). Start connection
  in Chrome's chooser; OS pre-pairing is not the default step.

## 2. Save the replay baseline

Choose **Start replay → Battery**. Expect a **REPLAY** result of **3700 mV**.
Save the trace, disconnect, then clear the trace before live work. Replay is a
synthetic fixture and does not test the radio, charger or car. The separate
support worksheet is also synthetic; keep real kit observations in your trace
and evidence record.

## 3. Choose and confirm the right car

1. Enter the assigned car label and charging/context notes on the bench.
2. Click **Choose assigned car**. The default chooser filters for the Anki
   service. Select only an entry you can identify as your assigned car. A model
   name can be shared by several cars; an absent or duplicate name is not enough.
   **Cancel if uncertain.** Do not use another student's car to find out.
3. If the filtered chooser is empty, release competing connections and check
   power first. Some firmware may not advertise the service. Only after isolating
   the assigned car, explicitly select the all-devices fallback and try again.
   This exposes unrelated peripherals too; cancel if identification is ambiguous.
4. Wait for **LIVE GATT: notify ready**. Check the selected Chrome name and browser
   device ID shown on the page. The ID is scoped to this browser/site permission;
   it is **not a hardware serial number, MAC address or proof of ownership**.
5. Use **Confirm assigned car** only after matching the physical kit to the
   selection. This records your assertion, not an automatic identity check.
   Headlight and SDK controls remain locked until confirmation. If the choice is
   wrong, disconnect and select again; no command is sent just by connecting.

## 4. Collect battery and LED observations

- Select **Battery** once and wait up to **five seconds**. Save the outgoing bytes
  and matching **LIVE RX** battery reply in millivolts, or the exact failed stage
  and timeout. Ping and Version are optional diagnostics, sent one at a time.
- Select **Headlight on**, watch the assigned car, and record whether its light
  visibly changed. Then select **Headlight off** and record that observation too.
  Choose the matching **Visible LED observation**, add **Observer / detail**,
  and click **Record LED observation** for each attempt. These are operator
  reports, not telemetry. A completed write is not proof that a light changed.
  A replay light command cannot supply physical evidence.
- If the assigned firmware needs SDK mode, record the original result, enable
  SDK mode, retry once and record the second result. Leave SDK mode before
  disconnecting if you enabled it. SDK compatibility is hardware-unverified.
- Disconnect, then save the live trace before another person takes over. Keep the car
  stationary throughout. If a connection fails before cleanup, record which
  commands could not be completed; do not claim that the lamp or SDK state reset.

A valid off-charger battery reply shows power and data exchange at that instant.
It does not establish usable capacity, charging-circuit health, runtime or safe
motion. Charger indicators, battery telemetry and physical LED observations are
three separate kinds of evidence. No universal voltage pass threshold is assumed.

## Record for each attempt

Keep the replay trace separate from the live trace. Record kit label/model,
charger observations and times, off-charger state, OS and Chrome versions,
Git revision, chooser mode, selected name/browser ID, connection stage, request
bytes, response bytes and millivolts or timeout, SDK attempts, visible LED on/off
observations, observer and unresolved questions. Record only your assigned
course device's identity information. Exported traces should accompany your
team evidence register; an operator note is not sensor telemetry.

If a stage fails, change one variable: try this car on the reference laptop,
then the reference car on this laptop, disconnecting before each handoff.
Keep the failure as evidence and continue in replay if necessary.

Before claiming success on hardware, an instructor or student must record a real
chooser/connection attempt, notification delivery, battery reply, SDK behavior
(if used), and visible headlight on/off on the exact kit/model/firmware and host.
The automated checks use fixtures and mock GATT objects; they do not qualify any
physical car, charger, firmware or Bluetooth adapter.
