# OVERDRIVE bench bring-up
From the repository root, run:
```sh
python -m http.server 8000 --bind 127.0.0.1 --directory bench
```
On your laptop open http://localhost:8000 in desktop Chrome. In a Codespace,
keep port 8000 private and open the forwarded HTTPS URL in a separate Chrome
tab on the laptop with the Bluetooth radio. The remote server just serves
files; the browser owns the BLE connection. No account, API key, package
install or backend device proxy is needed by the prototype.

Start with [tonight’s charge, connect and light checklist](TONIGHT.md), then the
[four-platform Chrome setup and battery checkpoint](LAPTOPS.md).

**Rehearse first.** Choose Start replay, then Ping, Version and Battery. The
battery fixture decodes to 3700 mV. Save the labelled trace, disconnect and clear
the trace before starting live work.
The fixture is synthetic. The support worksheet uses disposable records within
one tab; it never receives real telemetry or writes to a car. After the hardware
activity, the optional [worksheet CWE investigation](CWE-LAB.md) reproduces two
intentional authorization defects using only those synthetic records.

**One assigned stationary car.** Record kit/model, host, browser and revision.
Use a charged car and release any other controller. Isolate your assigned car
and cancel if you cannot positively identify it in the browser chooser.
The default chooser filters for the Anki service; the explicit all-devices
fallback is only for an isolated assigned car missing from the filtered chooser.
Choose assigned car; wait for "notify ready". Check the selected name and
browser-scoped ID, then Confirm assigned car against the physical kit to unlock
headlight/SDK controls. A browser ID is not a serial number or proof of identity.
Connecting sends no command automatically. Send Ping, Version and Battery
one at a time. Record each outgoing frame and any corresponding response type
observed during the request window, or mark
"no reply after 5 seconds". A successful GATT write is not a reply.
After a battery timeout or write error, Battery stays locked until reconnect
to avoid treating a delayed reply as a new successful request. Disconnect also
recovers a pending write. If the assigned firmware needs SDK mode, reconnect,
confirm the car, try Enable SDK mode (no localization override), retry Battery
once, and record both attempts. Try Headlight on then off;
record a fresh physical observation independent of the TX log for each attempt.
Final LED observations and cleanup notes can still be recorded after disconnect
against the last confirmed session, until another session starts or you clear. Leave SDK mode if
you enabled it, disconnect, and export the trace. This build does not request
motor motion, update firmware, scan unattended or address multiple cars.

The trace display shows the latest 200 lines; export contains the full retained
log. At its 10,000-line/2,000,000-character limit, capture and new operations
stop with an explicit incomplete-evidence notice. Disconnect, save, then clear.
Reconnect and confirm the same car for any outstanding lamp-off/SDK-off cleanup;
no automatic writes occur and an uncompleted cleanup remains unknown.

If Bluetooth is unavailable, open the HTTPS forwarded port directly, check OS
Bluetooth support/permissions and release any competing connection. If service
or characteristics are absent, record that exact stage and retry with the
reference car before drawing conclusions. Discovery, grant, connection, TX,
RX and a visible lamp change are distinct observations. A missing PIN prompt
does not on its own establish which pairing, bonding or encryption occurred.
If a kit cannot be identified or a stage fails, use replay and keep the failure
as evidence. A full driving adapter needs separate acceptance and measurements.

Limited software checks (Node 18+):
```sh
node --test bench/*.test.mjs
```
These synthetic checks cover packet framing, fixture request/reply, and mock
GATT behavior. They do not establish that a particular car appears in the
chooser, exposes the expected GATT service/characteristics, accepts SDK mode,
returns a battery reply or changes its headlight. Charging behavior and browser/
firmware compatibility also require observations on the actual kit. No physical
kit or firmware version has been qualified by these checks.

Wire specifications consulted (independent implementation):
- [Anki SDK protocol](https://github.com/anki/drive-sdk/blob/410352617b8660338746a6bb2b2dd173afb1b91a/src/protocol.h)
- [Anki message builders](https://github.com/anki/drive-sdk/blob/410352617b8660338746a6bb2b2dd173afb1b91a/src/protocol.c)
- [Community OVERDRIVE service and characteristic notes](https://github.com/MasterAirscrachDev/Anki-Partydrive/blob/main/OverdriveServer/Overdrive%20BLE.md)
- [Chrome Web Bluetooth](https://developer.chrome.com/docs/capabilities/bluetooth)

The original SDK describes DRIVE; check compatibility on each actual OVERDRIVE
kit. A vehicle version reply is shown as an integer until independently mapped
to a release. Historical scenario dates and contributors are fictional.

For the pinned source audit and its effect on this design, read [RESEARCH.md](RESEARCH.md).
For software regression evidence and remaining physical acceptance, read
[VALIDATION.md](VALIDATION.md).

The [adversarial advisory review](ADVISORY-REVIEW.md) records O*NET role lenses,
reproduced defects, corrections, deliberate teaching cases and residual limits.
