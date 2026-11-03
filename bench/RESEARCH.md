# Public implementation review for the classroom bench

Initial research: **2026-11-04**; LED/fleet follow-up: **2026-11-05**. These are actual review dates; dates in the
repository's fictional company history are separate. The review inspected source
at the revisions below, not just project descriptions. No physical car, firmware,
charger or browser Bluetooth combination was qualified during this review.

Public implementations now demonstrate substantially more than basic driving:
cooperative track reconstruction, controller assignment, RGB effects, battery
status, reconnect handling and offline telemetry tests. They do not establish
universal compatibility or make a model name a unique car identity. Tonight's
bench therefore retains one explicitly chosen car, stationary LED controls and
the existing LIVE/REPLAY request-and-reply evidence. See [TONIGHT.md](TONIGHT.md).

## Sources and architecture

| Source and inspected revision | Implemented capabilities | Relevance and limits |
| --- | --- | --- |
| [Anki drive-sdk, `4103526`](https://github.com/anki/drive-sdk/tree/410352617b8660338746a6bb2b2dd173afb1b91a) | Original C message builders and advertisement structures | Primary wire-format reference for DRIVE; OVERDRIVE firmware still needs verification. |
| [Overdrive Arena, `ff03e26`](https://github.com/Leicas/overdrive-arena/tree/ff03e265e77be237c329a512b92b6fb579abbeb9) | Native Python/Bleak and pygame; discovery, lights, telemetry, track scanning, racing | Useful recent implementation and recorded-data tests; no Chrome BLE adapter. |
| [Anki-Partydrive, `c2d161b`](https://github.com/MasterAirscrachDev/Anki-Partydrive/tree/c2d161bfd47ee453aa343658e86fa2762e259354) | Unity client and C# BLE server; model discovery, status, RGB patterns | Gateway architecture; public server source differs from distributed closed-branch builds. |
| [OpenOverdrive, `a706246`](https://github.com/dschwen/OpenOverdrive/tree/a7062464d87686ea09acf5892bb5b9a2d14c255c) | Native Android Kotlin/Compose discovery, driving and diagnostics | Alternative phone application, not Web Bluetooth; no repository LICENSE or automated tests found at this revision. |
| [AnkiNodeDrive, `91ef23d`](https://github.com/gravesjohnr/AnkiNodeDrive/tree/91ef23d3ede63197e2a8da38bb91eb3511dafd01) | Older Node/Raspberry Pi BLE-to-HTTP controller | Historical protocol examples; unsafe identity and HTTP-success assumptions for this lab. |
| [Bleak v3.0.2, `bb49377`](https://github.com/hbldh/bleak/tree/bb49377d38afb3a9fac9022aaf2c8f59d4ef7cfe) | Generic cross-platform Python BLE transport | Relevant to a future native adapter; does not implement Anki messages or run inside Chrome. |

## Arena source findings

The [author's September 7, 2026 article](https://antoine.weill-duflos.fr/en/post/overdrive-arena/)
reports trials on firmware **11866**, using X52, Mammoth and Dynamo. Its hardware
observations are useful testimony, not tests of our assigned kits. The inspected
September 20 revision is newer: cooperative scanning and persistent starting-grid
retries supersede parts of the article's first-completed-lap and exclusion behavior.

**Discovery and identity.** Arena accepts the service UUID, manufacturer key
`0xEFBE`, or a name containing “drive”, then sorts candidates by signal strength.
Its model decoder reads byte 1 from the first manufacturer entry without checking
that entry's key. The application connects all candidates by default, with an
optional strict address filter. The displayed name is the model. Research tools
can fall back to the first car when a requested model/address is absent. None of
those defaults establishes classroom assignment; retain isolation, cancellation
on ambiguity, and physical confirmation. Sources: [discovery](https://github.com/Leicas/overdrive-arena/blob/ff03e265e77be237c329a512b92b6fb579abbeb9/anki/vehicle.py#L24-L67),
[connection selection](https://github.com/Leicas/overdrive-arena/blob/ff03e265e77be237c329a512b92b6fb579abbeb9/app.py#L90-L122),
[tool fallback](https://github.com/Leicas/overdrive-arena/blob/ff03e265e77be237c329a512b92b6fb579abbeb9/tools/lights_test.py#L20-L26).

**Connection sequence.** Arena connects, starts notifications on `…bee0`, then
publishes the usable client and sends SDK mode `03 90 01 01`, followed by offset
zero `05 2c 00 00 00 00`. Writes to `…bee1` are serialized and explicitly use
write-without-response. Notification readiness is a sound prerequisite for
requests. The offset command addresses later lane changes; this source does not
show that battery or LED operation requires it. The bench uses flags zero,
without localization override. SDK mode is requested by its explicit control or
as the first step of a user-selected engine LED command; connecting alone sends
no command. Sources:
[initialization](https://github.com/Leicas/overdrive-arena/blob/ff03e265e77be237c329a512b92b6fb579abbeb9/anki/vehicle.py#L102-L110),
[writes](https://github.com/Leicas/overdrive-arena/blob/ff03e265e77be237c329a512b92b6fb579abbeb9/anki/vehicle.py#L163-L167).

**LED bytes.** Arena's helpers corroborate the SDK's distinction between channels
to change and their new values. Headlight on is `02 1d 11`; off is `02 1d 01`.
`02 1d 00` changes no channel. Arena's identification effect combines headlights
and front lights (`02 1d 55` / `02 1d 05`). Its `0x33` builder supports up to three
channel/effect/intensity tuples, used for RGB player colors and game effects.
The light experiment explicitly anticipates possible reboots, and its “OK” checks
link survival, not visible illumination. The bench retains legacy headlights
and now offers a fixed steady green/off engine pattern; record the physical
observation separately from TX completion. Sources:
[encoders](https://github.com/Leicas/overdrive-arena/blob/ff03e265e77be237c329a512b92b6fb579abbeb9/anki/protocol.py#L88-L121),
[identify](https://github.com/Leicas/overdrive-arena/blob/ff03e265e77be237c329a512b92b6fb579abbeb9/game/game.py#L453-L454),
[light experiment](https://github.com/Leicas/overdrive-arena/blob/ff03e265e77be237c329a512b92b6fb579abbeb9/tools/lights_test.py#L1-L44).

**Charging and battery.** Request `01 1a` receives `0x1b` with little-endian mV.
Arena decodes `0x3f` as on-track, on-charger, low and charged flags. Its charger
property prefers live status, otherwise a cached advertisement hint. Every four
seconds it polls voltage; percentage and sag are derived from recent readings
and commanded speed. Charging samples are excluded from resting estimates.
These are application heuristics, not capacity measurements. The CSV records
time, model, mV and speed/charging, without unique-car identity, raw request/reply
bytes or LIVE/REPLAY provenance. It cannot replace our trace. Sources:
[decoding](https://github.com/Leicas/overdrive-arena/blob/ff03e265e77be237c329a512b92b6fb579abbeb9/anki/protocol.py#L227-L240),
[battery monitor](https://github.com/Leicas/overdrive-arena/blob/ff03e265e77be237c329a512b92b6fb579abbeb9/game/battery.py#L15-L106),
[polling](https://github.com/Leicas/overdrive-arena/blob/ff03e265e77be237c329a512b92b6fb579abbeb9/app.py#L537-L540).

**Lifecycle and browser boundary.** A ping encoder exists, but the application has
no dedicated ping keepalive. Reconnect attempts are serialized, separated by at
least five seconds, and search for the same address before reinitialization.
Disconnect attempts speed zero, a protocol disconnect, then GATT disconnect;
errors are swallowed. The browser feature only serves a loopback scoreboard, not
car commands. These game-oriented behaviors should not hide classroom failures
or automatically start a fresh evidence session. Sources:
[reconnect](https://github.com/Leicas/overdrive-arena/blob/ff03e265e77be237c329a512b92b6fb579abbeb9/app.py#L555-L578),
[disconnect](https://github.com/Leicas/overdrive-arena/blob/ff03e265e77be237c329a512b92b6fb579abbeb9/anki/vehicle.py#L113-L140),
[HTTP surface](https://github.com/Leicas/overdrive-arena/blob/ff03e265e77be237c329a512b92b6fb579abbeb9/game/score_page.py#L18-L44).

Arena also has useful limitations to study: its parser ignores the declared frame
length, accepting malformed `00 1b 74 0e` as 3700 mV; its name helper strips six
bytes only for a nonprintable first character. A printable state byte is missed,
while treating an already-clean name as raw state can invent charger flags.
The bench must preserve strict framing and distinguish unknown from observed
state. [Parser and name helpers](https://github.com/Leicas/overdrive-arena/blob/ff03e265e77be237c329a512b92b6fb579abbeb9/anki/protocol.py#L209-L263).

**Improvements beyond tonight.** Cooperative scanning combines compatible partial
lap evidence and accepts a map only when known pieces/turns form a closed loop.
Tests include conflicting laps and lost transition messages. Notification receipt
timestamps survive queuing; tests exercise delayed processing and stale motion.
These are concrete advances in reconstruction and reliability, not proof that
every apparent motion gap is software-caused. Sources:
[scan completion](https://github.com/Leicas/overdrive-arena/blob/ff03e265e77be237c329a512b92b6fb579abbeb9/anki/track.py#L384-L417),
[scan regressions](https://github.com/Leicas/overdrive-arena/blob/ff03e265e77be237c329a512b92b6fb579abbeb9/tests/test_scan_fusion.py#L23-L100),
[telemetry regressions](https://github.com/Leicas/overdrive-arena/blob/ff03e265e77be237c329a512b92b6fb579abbeb9/tests/test_telemetry.py#L39-L79).

## Identity corrections and other implementations

The original SDK explicitly separates user-defined name in **LOCAL_NAME** from
hardware identifier in **MANUFACTURER_DATA**. Its full eight-byte manufacturer
record contains big-endian product bytes 0–1, reserved byte 2, model byte 3 and
big-endian identifier bytes 4–7. Its local-name parser starts text at byte 8.
Libraries that expose the first two bytes as a dictionary key shift the remaining
payload offsets. Do not propagate earlier chat claims about `0x09C7`, names stored
in manufacturer data, or a little-endian identifier. Do not assume the SDK's raw
layout matches every sanitized browser name. Sources:
[structures](https://github.com/anki/drive-sdk/blob/410352617b8660338746a6bb2b2dd173afb1b91a/src/advertisement.h#L41-L72),
[parsers](https://github.com/anki/drive-sdk/blob/410352617b8660338746a6bb2b2dd173afb1b91a/src/advertisement.c#L109-L144),
[light masks](https://github.com/anki/drive-sdk/blob/410352617b8660338746a6bb2b2dd173afb1b91a/src/protocol.h#L253-L270).

Partydrive corroborates manufacturer key 61374 (`0xEFBE`) and model at payload
index 1. It constructs display names from model/platform ID or saved settings;
initialization automatically sends SDK, version, battery and RGB commands.
Its `0x33` support demonstrates richer lights but is not a drop-in browser API.
The [protocol research notes](https://github.com/MasterAirscrachDev/Anki-Partydrive/blob/c2d161bfd47ee453aa343658e86fa2762e259354/OverdriveServer/Overdrive%20BLE.md)
are community reverse engineering; their status and flag interpretations need
model-specific checks. The README explicitly says distributed server builds come from a closed branch
not kept current publicly: public source cannot verify those binaries. Sources:
[discovery](https://github.com/MasterAirscrachDev/Anki-Partydrive/blob/c2d161bfd47ee453aa343658e86fa2762e259354/OverdriveServer/BluetoothInterface.cs#L38-L63),
[identity](https://github.com/MasterAirscrachDev/Anki-Partydrive/blob/c2d161bfd47ee453aa343658e86fa2762e259354/OverdriveServer/CarSystem.cs#L128-L154),
[initialization](https://github.com/MasterAirscrachDev/Anki-Partydrive/blob/c2d161bfd47ee453aa343658e86fa2762e259354/OverdriveServer/CarSystem.cs#L283-L306),
[release caveat](https://github.com/MasterAirscrachDev/Anki-Partydrive/blob/c2d161bfd47ee453aa343658e86fa2762e259354/README.md#L85-L90).

OpenOverdrive offers native address/model selection and diagnostics. Its drive
screen retries notification setup and SDK commands three times with 150 ms
delays; the SDK builder defaults to localization override. Its battery percentage
uses a heuristic interpretation of raw values, so retain measured mV for evidence.
These retries are implementation choices, not a verified universal handshake.
Sources: [drive initialization](https://github.com/dschwen/OpenOverdrive/blob/a7062464d87686ea09acf5892bb5b9a2d14c255c/feature-drive/src/main/java/feature/drive/DriveScreen.kt#L187-L200),
[protocol](https://github.com/dschwen/OpenOverdrive/blob/a7062464d87686ea09acf5892bb5b9a2d14c255c/core-protocol/src/main/java/core/protocol/VehicleProtocol.kt).
The README's claim of no proprietary dependencies also needs qualification:
the [network module](https://github.com/dschwen/OpenOverdrive/blob/a7062464d87686ea09acf5892bb5b9a2d14c255c/core-net/build.gradle.kts#L14-L17)
declares Google Play Services Nearby. Assess dependency and license provenance
from the build and available notices, not the headline alone.

AnkiNodeDrive targets an older Node/noble stack. Duplicate model-name lookups
select the last match. Its “headlights” endpoint actually uses front-light mask
`0x44`/`0x04`; connection enables localization override. HTTP handlers can return
“Success” before BLE work completes, and port 7877 has no host restriction or
authentication in the server. Its inconsistent battery-percentage conversions
reinforce keeping raw mV. Sources: [controller](https://github.com/gravesjohnr/AnkiNodeDrive/blob/91ef23d3ede63197e2a8da38bb91eb3511dafd01/ankiNodeUtils.js),
[HTTP server](https://github.com/gravesjohnr/AnkiNodeDrive/blob/91ef23d3ede63197e2a8da38bb91eb3511dafd01/server.js),
[alternate battery denominator](https://github.com/gravesjohnr/AnkiNodeDrive/blob/91ef23d3ede63197e2a8da38bb91eb3511dafd01/messageParse.js#L19-L25),
[dependencies and GPL-3.0 declaration](https://github.com/gravesjohnr/AnkiNodeDrive/blob/91ef23d3ede63197e2a8da38bb91eb3511dafd01/package.json).

## November 5 LED and fleet follow-up

A user-provided live trace contains ping and battery replies, plus version frame
`05 19 27 25 00 00`. It records legacy `0x1d` headlight writes without a visible
change reported by the operator. SDK mode was enabled and then disabled before
the next light attempt: the trace does not test a light while SDK mode remains
enabled. It does not establish charging success, capacity or LED compatibility.
The full trace and identifying timestamps are not published here.

Partydrive decodes the version as a 32-bit little-endian value: **9511 / 0x2527**.
The original SDK defines a 16-bit value. The bench therefore accepts the exact
legacy four-byte and observed six-byte version frames, retaining raw bytes.
[Partydrive decoder](https://github.com/MasterAirscrachDev/Anki-Partydrive/blob/c2d161bfd47ee453aa343658e86fa2762e259354/OverdriveServer/Protocol.cs#L331) ·
[legacy version definition](https://github.com/anki/drive-sdk/blob/410352617b8660338746a6bb2b2dd173afb1b91a/src/protocol.h#L92).

For engine RGB, the full `0x33` frame carries three five-byte entries:
`channel, effect, start, end, cycles`. Red/green/blue are channels `00/03/02`;
steady is `00`, intensity is bounded at `0e`, and these commands use zero cycles.
Both engine actions request `03 90 01 00` first if SDK mode has not already been
requested this session. Keep that request active through the off attempt, then
leave SDK mode with `03 90 00 00`. The displayed state means a write completed,
not that firmware acknowledged a mode or a person saw the LED.

```text
engineGreen: 11 33 03 00 00 00 00 00 03 00 0e 0e 00 02 00 00 00 00
engineOff:   11 33 03 00 00 00 00 00 03 00 00 00 00 02 00 00 00 00
```

These fixed packets agree with the [official definitions](https://github.com/anki/drive-sdk/blob/410352617b8660338746a6bb2b2dd173afb1b91a/src/protocol.h#L272),
[steady RGB example](https://github.com/anki/drive-sdk/blob/410352617b8660338746a6bb2b2dd173afb1b91a/examples/vehicle-tool/vehicle_cmd.c#L719),
[Partydrive builder](https://github.com/MasterAirscrachDev/Anki-Partydrive/blob/c2d161bfd47ee453aa343658e86fa2762e259354/OverdriveServer/CarSystem.cs#L478)
and [OVERDRIVE-specific Node implementation](https://github.com/gravesjohnr/AnkiNodeDrive/blob/91ef23d3ede63197e2a8da38bb91eb3511dafd01/ankiNodeUtils.js#L383).
The Node source distinguishes the newer pattern API from limited legacy light
behavior. This is source agreement, not a successful LED test on firmware 9511.

For 15 assigned pairs, [FLEET.md](FLEET.md) uses unique physical labels and a local
label registry keyed by browser device ID. **Remember confirmed car** is explicit;
**Refresh remembered cars** intersects those saved IDs with `getDevices()` grants.
This is permission lookup, not a scan or presence test. Reconnect targets one
saved device and requires fresh physical confirmation. No model inference, MAC
lookup, fleet blinking or automatic multi-car connection is involved. IDs and
saved labels belong to the retained browser profile/origin; lost grants or a
changed origin require isolated enrollment again.
[Web Bluetooth device/permission model](https://bluetooth.spec.whatwg.org/#dom-bluetooth-getdevices).

These updates are on PR branch `codex/classroom-charge-connect-led` until merged.
Actual testing/review dates above remain distinct from fictional Git chronology.

## Future native adapter and validation boundary

Current [Bleak scanner documentation](https://bleak.readthedocs.io/en/latest/api/scanner.html)
provides `discover(return_adv=True)` pairs of `BLEDevice` and `AdvertisementData`;
names may arrive later in scan responses. Pass the discovered device to the client,
specify write response mode explicitly and subscribe before requesting replies.
Since 1.0, connect/disconnect return `None`, not success booleans. On macOS the
address is a host-specific UUID, not a MAC address. These API facts support a
future Python adapter; they do not solve physical assignment or Chrome support.
[Client](https://bleak.readthedocs.io/en/latest/api/client.html) and
[macOS](https://bleak.readthedocs.io/en/latest/backends/macos.html) references.

Arena's eight cooperative scan tests and recorded-lap replay passed during this
review. Pure encoder/parser checks confirmed the listed frames and malformed-frame
behavior. The full pygame-dependent suite was not run. Those checks validate
software examples, not radio connectivity, charging or illumination. Arena's
[MIT license](https://github.com/Leicas/overdrive-arena/blob/ff03e265e77be237c329a512b92b6fb579abbeb9/LICENSE)
requires notice preservation when copying substantial code; its
[credits](https://github.com/Leicas/overdrive-arena/blob/ff03e265e77be237c329a512b92b6fb579abbeb9/README.md#L317-L327)
identify SDK and Partydrive inputs. The bench's BLE protocol code does not import
these implementations; its optional Node platform dependencies are documented
separately in [DEPENDENCY-LAB.md](DEPENDENCY-LAB.md).

Track fusion, native gateways, arbitrary RGB patterns and multi-car control remain separate
future acceptance work. Tonight, save synthetic REPLAY 3700 mV first, disconnect
and clear, then collect a matching LIVE reply or exact five-second failure stage.
Record charging and LED appearance independently. No successful write, inferred
percentage or replay result proves a physical car responded.
