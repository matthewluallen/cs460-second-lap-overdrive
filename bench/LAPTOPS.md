# First lab: a Chrome battery check on one car
Use **desktop Google Chrome on the student's physical laptop** for all four platforms.
A Codespace can serve the page; it cannot use its remote host as your laptop's radio.
Use the private forwarded HTTPS port in a separate tab (or local http://localhost:8000).
Do not open the HTML as a file, use an editor preview iframe, or use a remote desktop browser.

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

## Positive control, then live observation
1. Label the kit; charge it, take the car **off the charger**, power it on and
   keep it stationary with wheels clear. Release other controller apps/tabs.
   Stagger team attempts and have only the assigned car powered in the test area;
   if you cannot identify the chooser entry, cancel. Never select a nearby
   peripheral just to see whether it is your car.
2. Start replay → Battery. Expect a **REPLAY** reply of 3700 mV. Save a trace,
   disconnect and start a fresh trace before live work. The fixture never touches the radio.
3. Click **Choose assigned car**. Select the assigned car and grant site access.
   Wait for the **LIVE** notification-ready line. Select **Battery** once; wait
   up to five seconds for a live RX battery response. If the kit needs SDK mode,
   record that change, retry once, then leave SDK mode. Disconnect when finished.
4. Save the timestamped trace. Record kit label, off-charger state, OS, Chrome
   version, Git revision, connection stage, outgoing bytes, returned bytes and
   decoded millivolts. A failed stage and exact error are valid results.

**Pass:** a matching live RX frame after the request, from your identified,
off-charger car. This shows the car had enough power to communicate at that
instant and that Chrome could exchange GATT traffic. A chooser entry or successful
write alone is insufficient. A reading does not measure usable capacity, verify
the charging circuit, or demonstrate safe driving. No universal millivolt pass
threshold is assumed. Record a later timed off-charger observation or separate
instructor-approved runtime test before making a battery-life claim.

## When the check fails
- No chooser/API: check the bench's browser-path line, direct HTTPS/localhost tab,
  host Chrome and OS permission. Managed policy or Linux support may be the cause.
- Chooser empty: verify only the assigned powered car is nearby; release the old
  laptop/app's connection. Failure to advertise is different from an empty battery.
- Connected but no RX: record notification setup, request bytes and timeout;
  check the exact model/firmware and optional SDK step before assigning cause.
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
