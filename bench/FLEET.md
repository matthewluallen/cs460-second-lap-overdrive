# Your two cars, at home and in class

**Preparation:** each student creates or updates their own GitHub Codespace
from **main** and records the served revision. The fleet/engine controls were
integrated through PR #1; look for `fleet-led-v2`. Missing
controls mean the revision needs checking. Successful engine LED behavior and
the full remembered-car workflow remain hardware-unverified on the course kits.

An optional [power, proximity and visible-pattern trial](IDENTIFY.md) is being
prepared on `codex/car-identification-checks`; it is not part of `main`. Use its
reviewed branch and record the revision when trying those additional controls.
It never assigns a car automatically from signal strength.

Each of the 15 students owns two Fast & Furious cars. Give your own pair unique
physical labels such as `S01-A` and `S01-B`, using your student number, and record
which is your Ice Charger and which is your International MXT. Other students
can have the same models and advertised names. The mapping belongs to your
browser; this is not a central instructor enrollment or ownership database.

If a separate trusted source gives you a car's Bluetooth address, you may record
it beside the physical label and model in your **private personal inventory**.
Before first enrollment, an address suffix can be part of the Assigned car label
(80 characters maximum). Keep an already saved label unchanged; put additional
address details in your paper inventory or the connection's context notes.
Changing an enrolled label through this UI requires forgetting and enrolling it
again. The page cannot read a hardware Bluetooth address, match a typed address
or connect directly by MAC. Its `BluetoothDevice.id` is an opaque browser/site
permission ID, not that address. Do not depend on Chrome's chooser displaying
an address. A written address is an operator note, not verified identity. Keep
your inventory and traces containing actual addresses out of the public GitHub
repository.

## Keep one browser and one Codespace address

Use your own normal Chrome profile on your physical laptop. Your Codespace
serves the page; the laptop's browser and radio connect to the car. Keep the
forwarded port private and bookmark your **exact forwarded HTTPS address for
port 8000**. Use that same Codespace address and profile at home and in class.
Access to a private Codespace controls access to the web page; it does not grant
ownership of a car or prevent your chooser from showing another student's car.

Saved labels and Bluetooth permissions are scoped to the browser/profile and
web origin (scheme, hostname and port). Another student's Codespace, a newly
created Codespace, a different port, or `localhost` instead of forwarded HTTPS
is a different origin. The registry does not transfer through GitHub or between
those origins. Updating code on `main` at the same address does not itself
change the origin. Cleared site storage or revoked permissions can require
enrollment again. Do not assume an address or permission will persist forever.

Choose the [detailed evidence bench](evidence.html) **before connecting** when
you need saved traces and LED observation records. The [classroom bench](index.html)
has compact controls. Paths on the same origin can share saved labels, but
switching pages loses the current page's device objects and session. Finish,
save evidence and disconnect before navigating; sessions and traces do not transfer.

## First enrollment: establish your own pair physically

At home, enroll one of your cars at a time with your second car off. First
enrollment can also happen in class: move to a quiet enrollment area away from
the shared tracks and other powered cars, or coordinate with nearby owners to
switch their cars off briefly. Choose a location where no other candidate car
is within this laptop's Bluetooth reach. The whole class does not need to power
down, and students do not need a central enrollment appointment.
If entries remain ambiguous, cancel and arrange a brief quiet enrollment window
with the nearby groups; replay remains available while you wait.

1. Keep one bench tab open in your intended Chrome profile and exact Codespace
   origin. Follow the [charging checklist](TONIGHT.md). Take your physically
   labelled car off its charger, keep its wheels clear and release any other
   controller. Power only this car in your enrollment area.
2. Enter its physical label and click **Choose assigned car**. Use the default
   Anki-service chooser first. The all-devices fallback is an explicit second
   attempt for an isolated car missing from that filter. It can show unrelated
   devices too. If duplicate or unknown entries remain, cancel and improve the
   isolation. A repeated model name, signal strength/RSSI or a dropped connection
   does not establish which physical car you selected. For a coordinated
   candidate trial, use the dedicated [identification workflow](IDENTIFY.md)
   on its branch rather than treating the ordinary controls as a search tool.
3. Match the selection to the isolated physical car and click **Confirm assigned
   car** before any LED/SDK command. Click **Remember confirmed car** to save its
   browser device ID against your label. The saved mapping records your assertion;
   it is not a hardware serial lookup, authenticated identity or proof of ownership.
4. Perform the LED sequence below. Disconnect and power this car off before
   repeating enrollment for your second car. Both saved labels remain local to
   this browser and origin.

### When you want to compare a candidate with your actions

The optional [identification trial](IDENTIFY.md) combines a physical off/on check
with three repeated near/far observations of only your car. It watches one
selected browser candidate while disconnected, then offers an explicit
connection to that same candidate and a fixed off/green/off light signal.
Coordinate with nearby owners before this limited light trial. Advertisement
watching may be unavailable; the visible-pattern trial remains separate.
Missing advertisements, a stronger signal or a dropped connection alone are
not proof. A consistent radio result never unlocks ordinary light controls or
saves a label. Observe the pattern on your physical car, record that observation,
then confirm and remember deliberately. Neither part has been qualified on
the classroom hardware.

## Reconnect deliberately

Select your saved physical label and click **Reconnect remembered car**, then
check the physical car and **Confirm assigned car** again. Only one car is
connected at a time; disconnect before selecting your other car.

| What is available | Reconnection path |
| --- | --- |
| The same page is still open after enrollment | Its retained Bluetooth device object permits direct reconnection without another chooser or `getDevices()`. |
| The page was reloaded and saved-device lookup works | Click **Refresh remembered cars**. A matching permission object permits direct reconnection. |
| A saved label exists but there is no usable device object | **Reconnect remembered car** opens Chrome's chooser. The bench checks the selected browser ID against that saved label and rejects a different ID **before GATT connection or commands**. This only works if Chrome still presents the same browser identity. |

The guarded chooser is for an already enrolled ID; it cannot discover an unknown
car's physical identity. Cancel if the chooser entries are indistinguishable.
Move to the quiet area when needed. If permissions or IDs changed, the old
mapping may no longer match: disconnect, forget that old mapping and repeat
physical enrollment. Do not silently relabel a different selected device.

**Refresh remembered cars** lists already permitted devices where supported.
It does not scan the room, connect automatically or prove that a car is nearby,
powered on or available. No unattended scanning occurs.
[Web Bluetooth device model](https://bluetooth.spec.whatwg.org/#dom-bluetooth-getdevices)

Ordinary Web Bluetooth support does not guarantee `getDevices()` or permission
recovery after reload. Chrome's published implementation status and sample still
describe experimental flags for saved-device functionality; this bench changes
no flags. Our Chrome 156-based preview did not expose `getDevices()`, which is
not a test of every student's browser. The same-open-page path and guarded
chooser are the available fallbacks, subject to retained browser identity.
[Implementation status](https://github.com/whatwg/bluetooth/blob/main/implementation-status.md) ·
[Chrome saved-device sample](https://googlechrome.github.io/samples/web-bluetooth/get-devices.html)

## Rehearse the browser path before class

At home when possible, enroll your pair and try disconnecting/reconnecting each
in the same page. Save your evidence, disconnect, then deliberately reload and
try **Refresh remembered cars** and the reconnection path above. Record Chrome/OS,
the exact origin, whether saved labels remain, whether refresh is supported and
whether the browser can recover the same IDs. An empty permission list before
any enrollment says nothing about later persistence. If you cannot rehearse with
cars, check the browser-path message and plan time for isolated enrollment in class.

Keep the enrollment page open during class when it is useful, but plan for a
reload or laptop restart. Neither successful home enrollment nor a private
Codespace guarantees permission recovery at the shared tracks. Bench trials
remain stationary; this workflow does not provide driving commands.

**Forget selected label** removes only this browser's local mapping, not Chrome's
Bluetooth permission. If another tab changed saved labels, disconnect and reload
before editing the registry. Use one bench tab to avoid conflicting updates.

## Observe the LED and preserve evidence

On one confirmed car, click **Engine LED green / identify**, observe that physical
car, then **Engine LED off** and observe again. Engine commands request SDK mode
with flags `0` if it has not already been requested for the session. Keep it
requested through both attempts, then **Leave SDK mode → Disconnect**. A completed
write does not establish SDK state or visible illumination. Record no change,
unexpected color or failed cleanup as observed. Legacy **Headlight on/off** is a
separate comparison. Do not blink the fleet to identify cars or run batch commands.
The dedicated candidate signal on the identification branch is a limited
pre-confirmation exception; follow [IDENTIFY.md](IDENTIFY.md), not this ordinary
confirmed-car sequence, for that trial.

Rehearse **Start replay → Battery** and keep the REPLAY fixture result separate
from LIVE replies. On the evidence page, save, disconnect and clear that replay
trace before a live session. A battery reply establishes communication at that
instant, not capacity or runtime. After timeout or write failure, disconnect and
reconnect before retrying. Save the live trace and physical LED observations;
unverified behavior stays unverified until observed on your actual kit.
