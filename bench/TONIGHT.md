# Tonight: charge, connect, light

The goal is one documented attempt with **your assigned stationary car**:
charging observations, a Chrome connection, a live battery reply if available,
and a visible engine LED change. No driving is part of this activity. A supplied
5 November 2026 trace contains live battery replies, but successful LED behavior
and the remembered-car workflow remain **hardware-unverified** on the course kits.

**Preparation:** the fleet/engine LED update is on PR branch
`codex/classroom-charge-connect-led`, not yet `main`. Merge the reviewed PR before
assigning this workflow. Each of the 15 students then creates or updates their
own GitHub Codespace from **main** for their own two Fast & Furious cars. Start
with [pair enrollment and the before-class browser trial](FLEET.md). Ice Charger and
International MXT names repeat; physical labels `S01-A`/`S01-B` through
`S15-A`/`S15-B` identify your own pair. Save your mappings locally; no central
instructor enrollment database is required.

For this documented activity, open the [evidence page](evidence.html) **before
starting replay or connecting a car** (`http://localhost:8000/evidence.html`
locally). The main [Quick activity](index.html) page has compact car controls;
LED observation forms and Save/Clear trace controls are on the evidence page.
Finish and disconnect before switching pages. Session state and traces do not
transfer; switching requires a fresh attempt. Use your normal Chrome profile on
your physical laptop and bookmark the exact private forwarded HTTPS address for
your Codespace's port 8000. Use the same profile and origin at home and in class.
The cloud serves the page; the laptop owns the radio. Private Codespace access
does not establish car ownership or hide other students' nearby cars.

## 1. Prepare and charge the assigned kit

- Label the car and record its model, assigned kit label and starting Git revision.
  Do not infer the model or student assignment from a browser ID.
- Optionally record a Bluetooth address from a separate trusted source in your
  private inventory or connection context. An address suffix can be included in
  the Assigned car label (maximum 80 characters) **before first enrollment**;
  keep an already saved label unchanged. The page cannot read a MAC, match typed
  addresses or connect by address, and the chooser may not display one. This is
  an operator note, not verified identity. Keep actual addresses out of the public
  GitHub repository; see [FLEET.md](FLEET.md).
- Use the charging equipment provided for your kit and the instructions for that
  kit. Record when charging started and ended, the charger used, and what its
  indicators actually did. Do not assume one light color or charging time applies
  to every model. If the car or battery is damaged, swollen or unusually hot,
  stop and tell the instructor; do not open or repair it during this activity.
- Take the car **off the charger**, power it on and keep it stationary with wheels
  clear. Release other apps, tabs and laptops that may still control it. At home,
  enroll one of your cars with your second car off. In class, use a quiet area
  away from the shared tracks and other powered cars, or coordinate nearby
  owners to switch their cars off briefly. Only your intended car should be in
  this enrollment area's Bluetooth reach; the whole class need not power down.
- Open the evidence page in desktop Google Chrome on the physical laptop. Follow
  [laptop setup](LAPTOPS.md) and [launch instructions](BENCH.md). Start connection
  in Chrome's chooser; OS pre-pairing is not the default step.

## 2. Save the replay baseline

Choose **Start replay → Battery**. Expect a **REPLAY** result of **3700 mV**.
Save the trace, disconnect, then clear the trace before live work. Replay is a
synthetic fixture and does not test the radio, charger or car. The separate
[support worksheet](worksheet.html) is also synthetic; keep real kit observations in your trace
and evidence record.

## 3. Choose and confirm the right car

1. On the evidence page, enter the assigned car label and charging/context notes. These
   notes are captured when connecting. Later edits prepare the next session;
   use the LED observation’s final-detail field for the current attempt’s outcome.
2. Click **Choose assigned car**. The default chooser filters for the Anki
   service. Select only an entry you can identify as your assigned car. A model
   name can be shared by several cars; an absent or duplicate name is not enough.
   **Cancel if uncertain** and improve the physical isolation. Do not use another
   student's car to find out. Signal strength/RSSI or a disconnected candidate
   is not proof that a car belongs to you.
3. If the filtered chooser is empty, release competing connections and check
   power first. Some firmware may not advertise the service. Only after isolating
   the assigned car, explicitly select the all-devices fallback and try again.
   This exposes unrelated peripherals too; cancel if identification is ambiguous.
4. Wait for **LIVE GATT: notify ready**. Check the selected Chrome name and browser
   device ID shown on the page. The ID is scoped to this browser/site permission;
   it is **not a hardware serial number, MAC address or proof of ownership**.
5. Use **Confirm assigned car** only after matching the physical kit to the
   selection. This records your assertion, not an automatic identity check.
   LED and SDK controls remain locked until confirmation. If the choice is
   wrong, disconnect and select again; no command is sent just by connecting.
6. During enrollment, click **Remember confirmed car** to save that label against
   the browser-scoped device ID. In the same open page, select that label and
   **Reconnect remembered car** using its retained device object. After reload,
   **Refresh remembered cars** can recover permission objects where supported;
   it lists granted devices, including absent ones, without scanning or connecting.
   If only the saved label remains, **Reconnect remembered car** opens Chrome's
   chooser and rejects a different browser ID before GATT connection or commands.
   Cancel if entries are indistinguishable. If Chrome no longer retains that
   ID/permission, repeat isolated enrollment rather than guessing.
   Confirm the physical assignment on every connection. Labels and permissions
   do not transfer to a different profile, origin or another student's Codespace;
   a saved label does not prove a grant persists. See [FLEET.md](FLEET.md).

## 4. Collect battery and LED observations

- Select **Battery** once and wait up to **five seconds**. Save the outgoing bytes
  and matching **LIVE RX** battery reply in millivolts, or the exact failed stage
  and timeout. The reply has no request sequence number: it was observed during
  this request window, not proven to be caused by this particular request. A
  timeout or write error is inconclusive and locks Battery until you disconnect
  and reconnect. If a write remains pending after five seconds, use Disconnect
  to recover; do not start concurrent requests. Ping and Version are optional
  diagnostics, sent one at a time.
- Select **Engine LED green / identify**, watch the assigned car, then select **Engine LED
  off** and observe again. Each engine command first requests SDK mode with flags
  zero if it has not already been requested in this session. The visible SDK
  message remains until you leave SDK mode. This records completed writes, not
  a verified device mode or visible result. Leave SDK mode **after** the LED-off
  attempt, then disconnect. Do not turn SDK mode off between enabling it and
  trying the LED. Legacy **Headlight on/off** controls remain available as a
  separate comparison; the engine LED uses a different command.
  Choose the matching **Visible LED observation**, add **Observer / final detail**,
  and click **Record LED observation** for each attempt. These are operator
  reports, not telemetry. Each report includes the confirmed session identity,
  lamp attempt and write outcome. The form clears for each lamp attempt and
  after recording so an old choice cannot be submitted accidentally. A completed
  write is not proof that a light changed. Use the steady green/off observation
  only after physical assignment; do not blink or command a fleet to discover
  which car belongs to whom. A replay light command cannot supply physical evidence.
- Battery behavior is unchanged. For an optional SDK retry after a battery
  timeout/error, disconnect and reconnect to the
  assigned car, confirm it again, enable SDK mode, then make one new Battery
  request. Record both attempts. Leave SDK mode before disconnecting if you
  enabled it; a disconnect does not prove SDK mode reset. SDK compatibility is
  hardware-unverified. If testing legacy headlights with SDK mode, keep SDK mode
  enabled through the on/off attempts as well.
- Disconnect, then save the live trace before another person takes over. Keep
  the car stationary throughout. After a failed or completed lamp attempt, you
  can still record a visible result and **Observer / final detail** after
  disconnect. It remains attached to that confirmed car and attempt until a new
  session starts or the trace is cleared. Record failed cleanup here (choose
  **Unable to tell** when appropriate); do not claim the lamp or SDK state reset.

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

The evidence page shows the latest 200 trace lines; export retains the full accepted log.
At 10,000 lines or 2,000,000 characters, capture stops with a **TRACE INCOMPLETE**
notice instead of silently dropping old evidence. New operations and observations
are blocked. Disconnect, save the incomplete trace, then clear before continuing.
If lamp-off or SDK-off cleanup is still needed, reconnect to the same assigned
car, confirm it again and perform those steps; disconnect sends no cleanup command.
Treat the unrecorded interval and any uncompleted cleanup as unknown.

If a stage fails, change one variable: try this car on the reference laptop,
then the reference car on this laptop, disconnecting before each handoff.
Keep the failure as evidence and continue in replay if necessary.

Before claiming success on hardware, an instructor or student must record a real
chooser/connection attempt, notification delivery, battery reply, SDK behavior
(if used), and visible engine LED on/off on the exact kit/model/firmware and host.
The automated checks use fixtures and mock GATT objects; they do not qualify any
physical car, charger, firmware or Bluetooth adapter.

Keep your enrollment page open when switching between your two cars. Chrome may
not support saved-device lookup or permission recovery after reload; the guarded
chooser still requires the same previously enrolled browser ID. Rehearse that
path before class, plan a quiet area if enrollment is needed, and never assume
shared-track proximity proves ownership. See [FLEET.md](FLEET.md).
