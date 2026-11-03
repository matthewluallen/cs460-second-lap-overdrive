# Thirty cars: assign once, reconnect deliberately

Updated November 5, 2026. This workflow is available on
`codex/classroom-charge-connect-led`; use that branch until its PR is merged.
Engine LED behavior remains hardware-unverified. A completed Bluetooth write
does not establish that a light changed.

For 15 students with two cars each, attach physical labels `S01-A`, `S01-B`
through `S15-A`, `S15-B`. Record the assigned student and visible model alongside
each label. Ice Charger and International MXT names can repeat: do not infer a
unique car, assignment or model from the chooser name or browser device ID.

Choose the [detailed evidence bench](evidence.html) **before connecting** when
you need downloadable traces and LED observation records. The
[classroom bench](index.html) keeps the compact controls. Finish and disconnect
before switching pages; active sessions do not transfer.

**First enrollment — instructor-managed, one powered car at a time**

1. Use the student's own laptop and intended Chrome profile, with one bench tab open. Complete the
   [charging checklist](TONIGHT.md), then take the assigned car off its charger,
   keep its wheels clear and release any other controller.
2. Keep **every other classroom car powered off**, including the student's
   second car. Power on only the physically labelled car beside this laptop.
   Students must take turns for this step; simultaneous enrollment defeats the
   isolation.
3. Enter its physical label, then click **Choose assigned car**. Use the default
   Anki-service chooser first. Use the explicit all-devices fallback only after
   the filtered chooser fails and the assigned car is isolated. Cancel if the
   selection is ambiguous; unrelated Bluetooth devices may still appear.
4. Match the selection to that physical assignment and click **Confirm assigned
   car** before any LED command. Click **Remember confirmed car** to save the
   browser device ID with this label. Saving records the operator's assertion;
   it is not an automatic identity check or a hardware serial lookup.
5. Perform the LED sequence below, disconnect and power this car off before
   enrolling the next one. Repeat for the student's second car.

**Later sessions**

Keep the enrollment page open. Select a saved physical label, click **Reconnect
remembered car**, then match the physical car again and click **Confirm assigned
car**. Disconnect before selecting the other car. The page retains each enrolled
Bluetooth device object, so this path does not require `getDevices()` or another
chooser. Only one car is connected at a time.

After a page reload, click **Refresh remembered cars**. Where supported,
`getDevices()` restores previously granted objects for saved IDs. Saved labels
may appear without usable grants. If this API is unavailable, keep the page open
and select each isolated car again to restore its device object; remembered
labels remain hints and never unlock light controls automatically.

Chrome's published implementation status still lists saved-device lookup and
persistent permissions behind experimental flags. Our Chrome 156-based preview
did not expose `getDevices()`. Do not assume that ordinary Web Bluetooth support
also includes saved-device lookup. No browser flags are changed by this bench.
[Implementation status](https://github.com/whatwg/bluetooth/blob/main/implementation-status.md) ·
[Chrome saved-device sample](https://googlechrome.github.io/samples/web-bluetooth/get-devices.html)

Refresh does not scan the room, connect automatically or discover MAC addresses.
A remembered object or permission record does not establish that a car is
powered on, nearby or available.
[Web Bluetooth: getDevices](https://bluetooth.spec.whatwg.org/#dom-bluetooth-getdevices)

Keep the same Chrome profile, site origin and permissions. Bookmark the exact
instructor-provided URL, including its port: `localhost` and `127.0.0.1` are
different origins. A changed hostname, scheme, port or profile, cleared site
storage, or revoked Bluetooth permission can require enrollment again. If
remembered-device access is unsupported or unavailable, use the chooser and the
same physical-isolation procedure; never guess between duplicate names.
[Chrome Web Bluetooth guide](https://developer.chrome.com/docs/capabilities/bluetooth)

**Forget selected label** removes the local mapping; it does not revoke Chrome's
Bluetooth permission. If a label was assigned incorrectly, disconnect, forget
that mapping and repeat isolated enrollment. Do not repair an uncertain mapping
by trying commands on several cars.

**One confirmed car's LED sequence**

Click **Engine LED green / identify**, observe that physical car, click **Engine LED off**,
observe again, then **Leave SDK mode → Disconnect**. Engine commands first
request SDK mode with flags `0` if it has not already been requested for this
session; leave it enabled through both LED attempts. Requested or completed
writes are not proof of SDK state or visible light behavior. Record no change,
an unexpected color, or failed cleanup as
observed. Do not blink the fleet to identify cars or run batch commands.

The existing battery workflow is unchanged: rehearse **Start replay → Battery**,
then disconnect before live work. Keep REPLAY fixture results separate from LIVE
replies; a battery reply establishes communication at that instant, not capacity
or runtime. After timeout or write failure, disconnect and reconnect before
retrying. Use the detailed evidence bench to save the trace and observations.
