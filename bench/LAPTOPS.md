# First lab: Chrome setup and a battery check on one car

Follow [tonight’s charge, connect and light checklist](TONIGHT.md) for the full
activity; this page covers laptop setup and the battery evidence checkpoint.
Each of the 15 students owns two Fast & Furious cars and uses their own GitHub
Codespace. Enroll your uniquely labelled pair using [FLEET.md](FLEET.md).
Repeated Ice Charger or International MXT names do not identify your car.
**Preparation:** before class, create or update your own Codespace from **main**
and record its served revision. Look for `identify-v1`. Do not assume an older
Codespace includes the fleet/engine controls.

The optional [power/proximity and visible-pattern trial](IDENTIFY.md) is on
`main` through PR #2. Its radio sampling and light behavior remain
hardware-unverified.

Use **desktop Google Chrome on the student's physical laptop** for all four platforms.
A Codespace can serve the page; it cannot use its remote host as your laptop's radio.
Use your own normal Chrome profile and the private forwarded HTTPS address for
port 8000 in a separate tab. Bookmark that exact address for home and classroom
use. A local http://localhost:8000 launch is an alternative origin with separate
permissions and labels. Access to your private Codespace is not permission to
control a particular car; Chrome can still show other students' nearby cars.
Do not open the HTML as a file, use an editor preview iframe, or use a remote desktop browser.

For the saved battery checkpoint below, choose the [evidence page](evidence.html)
before starting: `http://localhost:8000/evidence.html` locally, or `evidence.html`
on the same forwarded HTTPS origin. The main page is a compact quick activity;
the evidence page contains the observation and trace controls. Finish and
disconnect before switching pages. Their session state and traces do not transfer.

## Prepare the laptop
| Laptop | Before clicking Choose assigned car |
| --- | --- |
| Chromebook | Select the time in the lower right, then Bluetooth → On. Use the normal ChromeOS browser. A Linux container is unnecessary. If the switch or chooser is blocked on a managed Chromebook, note the policy and use the reference laptop. |
| Windows | Use local Chrome on a Windows laptop with a Bluetooth Low Energy adapter. In Windows 11 open Settings → Bluetooth & devices → Bluetooth On. If the toggle is absent, check the adapter/driver with staff. Start selection on the bench page; do not begin in Add device. |
| MacBook Pro | Turn on Bluetooth in System Settings → Bluetooth. When Chrome requests Bluetooth access, allow it. If previously denied, use System Settings → Privacy & Security → Bluetooth → Google Chrome; reopen Chrome if prompted. Having Bluetooth on and allowing Chrome to use it are separate checks. |
| Linux | Use native desktop Google Chrome on the host with the USB/internal radio, not Chrome running inside a VM or Codespace. Check the desktop Bluetooth toggle; on a BlueZ host, the read-only command `bluetoothctl show` can identify a controller and its Powered state. Linux Chrome's Web Bluetooth implementation is partial/unsupported in the published status and may require the experimental web platform features flag. Do not require students to change flags or managed policy. Try approved standard Chrome first; if the API is absent, use replay and move the same car to a reference ChromeOS, Windows or macOS host. An instructor may separately rehearse an experimental Linux setup and document the Chrome/OS versions. |

Chrome's GATT chooser grants the **web origin** access to the selected device.
It is distinct from OS pairing/bonding. Start in Chrome, with the OS radio on.
An OS prompt may appear; follow it only for the positively identified course car.
Do not guess a PIN. Absence of a PIN dialog does not establish how the link is secured.

## Remembering the assigned pair

After an isolated chooser connection and **Confirm assigned car**, use **Remember
confirmed car** for your labels, such as `S01-A` and `S01-B`. These are your local
assignment hints, not an instructor-managed database. Keep the same page open:
its retained device objects let you select a label and **Reconnect remembered
car** without `getDevices()`. Confirm the physical car again before LED/SDK changes.

After reload, **Refresh remembered cars** can recover permission objects where
that optional browser API works. If a saved label has no usable object,
**Reconnect remembered car** opens a guarded chooser: a different browser ID is
rejected before GATT connection or commands. This helps only while the original
browser identity remains available. Cancel when entries are indistinguishable;
use physical isolation rather than guessing, and re-enroll if permission/ID
changes prevent a match. Refresh is not a scan or online-status check. There is
no automatic fleet scan, model inference or MAC-address lookup.

Use the same Chrome profile and exact origin (scheme, host and port) each time.
For example, `localhost:8000` and `127.0.0.1:8000` are different origins, as is a
new port, newly created Codespace or different forwarded HTTPS address. IDs are
useful only within the retained browser/site permission; they are not hardware
serials or Bluetooth addresses. Clearing permissions or
site data, changing profile/origin or losing the saved label requires isolated
enrollment again. Labels do not transfer between your classmates' Codespaces.
Moving between quick and evidence paths on the same origin can retain the
registry, but loses the old page's device objects and never transfers a session
or trace. Save and disconnect before navigating. Pulling updated `main` at the
same origin does not itself change the browser's permission scope.

You may keep a Bluetooth address from a separate trusted source in your private
car inventory or connection context. Before initial enrollment, an address suffix
can be included in the 80-character Assigned car label. Keep an already enrolled
label unchanged unless deliberately forgetting/re-enrolling it. The page cannot
read or match a typed MAC address, and Chrome's chooser is not promised to show
one. This note does not verify identity; do not publish actual addresses in the
GitHub repository. See [FLEET.md](FLEET.md) for the inventory guidance.

Before class, rehearse same-page reconnection and, after saving/disconnecting,
a reload plus **Refresh remembered cars** on this exact laptop/profile/origin.
Record support and outcomes; ordinary Bluetooth support does not guarantee
saved-device lookup or persistent permissions. See [FLEET.md](FLEET.md) for the
home trial and a crowded-class first-enrollment plan. No flags are changed by the app.

## Optional candidate check

Follow [IDENTIFY.md](IDENTIFY.md) to select one candidate while disconnected,
compare your own car's off/on and three near/far cycles, then explicitly connect
that retained candidate for a fixed light pattern. `watchAdvertisements()` is
an optional experimental capability; ordinary Chrome GATT support and a working
Battery button do not establish that advertisement sampling is available.
The bench changes no browser flags. If sampling is unavailable or inconclusive,
the coordinated visible-pattern trial or isolated enrollment remains available.
Signal strength is not distance or identity proof. Record what you physically
observed, then confirm and remember deliberately; the app never infers a match
or saves a label from the radio result.

## Positive control, then live observation
1. Label the kit; charge it, take the car **off the charger**, power it on and
   keep it stationary with wheels clear. Release other controller apps/tabs.
   At home, enroll one of your cars with the second off. In class, use a quiet
   area away from shared tracks and powered cars, or coordinate with nearby
   owners to switch their cars off briefly. Only the intended car should be in
   this enrollment area's Bluetooth reach; the whole class need not power down.
   If you cannot identify the chooser entry, cancel. Never select a nearby
   peripheral just to see whether it is your car.
2. On the evidence page, Start replay → Battery. Expect a **REPLAY** reply of 3700 mV. Save a trace,
   disconnect and start a fresh trace before live work. The fixture never touches the radio.
3. Enter the assigned kit label and context notes, then click **Choose assigned car**.
   The default chooser filters for the Anki service. Names may be absent or
   duplicated; cancel if the entry remains ambiguous. Use the explicit all-devices fallback only
   after isolating the assigned car if it does not appear in the filtered chooser.
   Wait for the **LIVE** notification-ready line. Check the selected name and
   browser-scoped ID; neither is proof of physical identity. Select **Confirm
   assigned car** after matching the physical kit. This unlocks LED/SDK changes.
4. Select **Battery** once; wait up to five seconds for a live RX battery response.
   A timeout or write error is inconclusive: disconnect and reconnect before
   another Battery request. For an optional SDK retry, confirm the assigned car
   again, enable SDK mode and retry Battery once, then leave SDK mode. If the
   write is still pending after five seconds, Disconnect remains available.
   Follow the checklist for a separate **Engine LED green / identify → Engine LED off**
   trial. Engine commands request SDK mode first when needed; keep it requested
   through the LED-off attempt, then leave SDK mode and disconnect. Completed
   writes do not establish SDK state or illumination. Legacy headlights remain
   a separate comparison.
5. Save the timestamped trace. Record kit label, off-charger state, OS, Chrome
   version, Git revision, connection stage, outgoing bytes, returned bytes and
   decoded millivolts. A failed stage and exact error are valid results.

**Observed:** a well-formed live RX battery frame during the request window, from your identified,
off-charger car. This shows the car had enough power to communicate at that
instant and that Chrome could exchange GATT traffic. A chooser entry or successful
write alone is insufficient. There is no wire request sequence number, so the
observation does not prove which request caused the reply. A reading does not
measure usable capacity, verify
the charging circuit, or demonstrate safe driving. No universal millivolt pass
threshold is assumed. Record a later timed off-charger observation or separate
instructor-approved runtime test before making a battery-life claim.

## When the check fails
- No chooser/API: check the bench's browser-path line, direct HTTPS/localhost tab,
  host Chrome and OS permission. Managed policy or Linux support may be the cause.
- Chooser empty: verify only the assigned powered car is nearby; release the old
  laptop/app's connection. The service filter may hide a car whose firmware does
  not advertise the service; the isolated-car fallback is an explicit second
  attempt, never an automatic broad scan. Failure to advertise is different from
  an empty battery. Cancel on duplicate or unrecognizable names.
  Signal strength/RSSI or disconnecting a candidate is not proof of ownership.
- Connected but no RX: record notification setup, request bytes and timeout;
  check the exact model/firmware and optional SDK step before assigning cause.
- Battery replies but no light: use the engine LED control while SDK mode remains
  requested. The supplied 5 November trace disabled SDK mode before further
  legacy headlight attempts; it did not demonstrate an LED attempt in SDK mode.
  Keep the result as unknown until a person observes the assigned car change.
- Remembered car absent/unreachable: a grant is not proof that the car is powered
  or in range. Release competing controllers and check the label and origin;
  re-enroll in isolation if the grant or local label was lost.
- Change **one variable**: test the suspect car on the known-working Chrome laptop,
  then the reference car on the suspect laptop. Disconnect the previous host before
  every handoff. Tag results observed/unknown. Replay is the independent path
  while a teammate completes the hardware check. Do not record other people's device IDs.

Platform references (consulted 4 November 2026; platform support is not proof of kit compatibility):
[Chrome Web Bluetooth](https://developer.chrome.com/docs/capabilities/bluetooth) ·
[implementation status](https://github.com/whatwg/bluetooth/blob/main/implementation-status.md) ·
[ChromeOS radio](https://support.google.com/chromebook/answer/15470857) ·
[Windows radio](https://support.microsoft.com/en-us/windows/hardware/bluetooth/turn-bluetooth-on-or-off-in-windows) ·
[macOS privacy settings](https://support.apple.com/guide/mac-help/mchl211c911f/mac) ·
[Ubuntu Bluetooth](https://help.ubuntu.com/stable/ubuntu-help/bluetooth-turn-on-off.html).

Remembered-device semantics rechecked 5 November 2026:
[Web Bluetooth permission and device model](https://bluetooth.spec.whatwg.org/#dom-bluetooth-getdevices).

### Browser without saved-device lookup

Ordinary Bluetooth support does not guarantee `getDevices()`. Keep one enrolled
bench page open for direct reconnection using retained objects. After reload,
the guarded chooser can reconnect an already saved ID if Chrome retains that
identity; otherwise repeat isolated enrollment. A saved label alone does not
prove a grant persists. See [FLEET.md](FLEET.md) for the browser-support references
and before-class trial. No flags are changed by the app.
