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

**Rehearse first.** Choose Start replay, then Ping, Version and Battery. The
battery fixture decodes to 3700 mV. Save the labelled trace and disconnect.
The fixture is synthetic. The support worksheet uses disposable records within
one tab; it never receives real telemetry or writes to a car.

**One assigned stationary car.** Record kit/model, host, browser and revision.
Use a charged car and release any other controller. Isolate your assigned car
and cancel if you cannot positively identify it in the browser chooser.
Choose assigned car; wait for "notify ready". Send Ping, Version and Battery
one at a time. Record each outgoing frame and its matching response or mark
"no reply after 5 seconds". A successful GATT write is not a reply.
If needed on the assigned firmware, try Enable SDK mode (no localization
override), retry once, and record both attempts. Try Headlight on then off;
record a physical observation independent of the TX log. Leave SDK mode if
you enabled it, disconnect, and export the trace. This build does not request
motor motion, update firmware, scan unattended or address multiple cars.

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
These synthetic checks cover packet framing, fixture request/reply, and a
mock GATT session. No physical kit or firmware version has been qualified by them.

Wire specifications consulted (independent implementation):
- [Anki SDK protocol](https://github.com/anki/drive-sdk/blob/410352617b8660338746a6bb2b2dd173afb1b91a/src/protocol.h)
- [Anki message builders](https://github.com/anki/drive-sdk/blob/410352617b8660338746a6bb2b2dd173afb1b91a/src/protocol.c)
- [Community OVERDRIVE service and characteristic notes](https://github.com/MasterAirscrachDev/Anki-Partydrive/blob/main/OverdriveServer/Overdrive%20BLE.md)
- [Chrome Web Bluetooth](https://developer.chrome.com/docs/capabilities/bluetooth)

The original SDK describes DRIVE; check compatibility on each actual OVERDRIVE
kit. A vehicle version reply is shown as an integer until independently mapped
to a release. Historical scenario dates and contributors are fictional.
