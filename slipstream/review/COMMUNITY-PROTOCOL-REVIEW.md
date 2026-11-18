# Community protocol and APK cross-check — 12 November 2026

## Conclusion

We have strong agreement on classic command framing, Bluetooth UUIDs, and serialized
writes. We **cannot yet certify the best complete control path**: our hardware
captures still lack positions, MXT emits unsupported short frames, and physical
stopping after host failure is unverified. The most useful new lead is **initial
lateral-offset calibration before scanning**, not another generic SDK replacement.

This pass downloaded 76 source/document files at immutable commits from four
repositories, re-read the previously pinned Overdrive Arena and official SDK, and
freshly exported 29/29 selected F&F native functions with Ghidra. Selected entries
include linkage stubs. APK/firmware and downloaded programs were not executed;
no car commands or deployment occurred. File hashes and capture observations are
in [COMMUNITY-PROTOCOL-EVIDENCE.json](COMMUNITY-PROTOCOL-EVIDENCE.json).

## Most important finding: unknown lateral offset

Our Groundshock firmware-11866 recording contains this complete 15-byte lane-change
update at 62,735 ms:

`0e 41 10 bf 1f 49 10 bf 1f 49 00 00 00 00 80`

Both little-endian float offsets are **654321.0**, not measured track coordinates.
The F&F serializer `CarMsgLaneChangeUpdate::GetBytes` (006aed3c) and its field labels
(006aed9c) identify current and target offsets at bytes 2 and 6. Partydrive's
[independent decoder](https://github.com/MasterAirscrachDev/Anki-Partydrive/blob/c2d161bfd47ee453aa343658e86fa2762e259354/OverdriveServer/Protocol.cs)
agrees with these positions. That agreement establishes the numeric observation,
not why firmware produced it.

Overdrive Arena's author [reports physical tests on firmware 11866](https://antoine.weill-duflos.fr/en/post/overdrive-arena/)
and describes 654321 as unknown offset, with lane changes ignored until offset is
initialized. Its [connection code](https://github.com/Leicas/overdrive-arena/blob/ff03e265e77be237c329a512b92b6fb579abbeb9/anki/vehicle.py)
sends SDK enable followed by offset zero. This is relevant third-party hardware
evidence, not validation of our Groundshock or of the F&F app profile.

Fresh Ghidra findings strengthen the sequencing concern:

- `TrackDiscoveryBehaviorScript::Update` (0082fd30) has a conditional path that
  sends **set-offset before lane-change**.
- Assembly at 0082fefa reads the discovery record's float at +0x18; 0082ff02
  negates it; 0082ff5c places that value in the argument register; 0082ff6a calls
  the set-offset command. It does **not** establish an unconditional zero default.
- `Localization::ProcessLocationUpdateMessage` (0071a270) also participates in
  absolute/relative offset correction. The original engine maintains richer state
  than our initial lane command.
- Slipstream currently calibrates from a recognized position later in `Car.#lane`,
  but `Game.startScan` sends its initial lane request before receiving that position.

**Inference:** missing initial calibration may explain the ineffective lane request
and may contribute to scan failure. It does not yet explain the absence of position
messages. The approved unlocalized-speed change addresses a separate possible
bootstrap obstacle; neither change has a successful physical scan yet.

**Next controlled test:** use a known printed starting lane and record its physical
placement. Set the corresponding offset while stopped, verify any offset/lane
response, then use the already-authorized scan countdown and 300 mm/s ceiling.
Compare with an unchanged baseline, one car/profile at a time. Do not blindly set
zero and label that a measured location. Avoid changing scan speed, firmware format,
and calibration together, because the result would not identify the cause.

## Which sources are useful, and which ideas not to copy

| Source and pinned revision | Useful evidence | Limits for Slipstream |
| --- | --- | --- |
| [Official drive-sdk](https://github.com/anki/drive-sdk/tree/410352617b8660338746a6bb2b2dd173afb1b91a) | Classic command oracle; our earlier compiled vectors remain relevant | Limited protocol subset, not proof of all OVERDRIVE firmware behavior. [Issue 40](https://github.com/anki/drive-sdk/issues/40) reports transition indices stuck at zero; indices must not be confused with physical piece IDs. |
| [Overdrive Arena](https://github.com/Leicas/overdrive-arena/tree/ff03e265e77be237c329a512b92b6fb579abbeb9) | Offset initialization, code-based lane calibration, wheel-distance observations, retained hardware trace | SDK path; does not prove our app-mode initialization. Its parser also cannot validate our eight-byte MXT transitions. |
| [Partydrive](https://github.com/MasterAirscrachDev/Anki-Partydrive/tree/c2d161bfd47ee453aa343658e86fa2762e259354/OverdriveServer) | Rich field catalogue, separate firmware handling, multiple-lap map validation and explicit inferred segments | V4 speed framing applies to its identified 12385/12386 versions, not automatically our 9511/11866. Its reconnect/remembered-command policies should not replace our neutral-rearm rules. |
| [OpenOverdrive](https://github.com/dschwen/OpenOverdrive/tree/a7062464d87686ea09acf5892bb5b9a2d14c255c) | Notifications-before-startup, response verification, BLE diagnostics and property-aware write selection | Its design notes describe repeated SDK enable; that is a hypothesis for a stopped, bounded connection retry, not permission to repeat motion. Android behavior does not prove Web Bluetooth timing. |
| [super-anki SDK](https://github.com/super-anki/anki-sdk/tree/7cb97e683353be13bbbee5025b4370c5445138f5) | Independent TypeScript message inventory and track-validation structure | Full-size transition parser reads through byte 17 without supporting our compact trace. Scanner registers/removes separately bound callbacks; do not copy that listener-lifetime pattern. README test counts are not real-car acceptance. |
| [AnkiNodeDrive](https://github.com/gravesjohnr/AnkiNodeDrive/tree/91ef23d3ede63197e2a8da38bb91eb3511dafd01) | Historical recorded 19-byte transition example and wheel-shape observations | Its wheel byte positions differ from the 18-byte SDK/native layout. Its length guard allows 18 bytes before reading byte 18; do not copy the guard or treat one layout as universal. |

The additional V4 byte is described as allowing driving without localization. It
must not be silently enabled as a repair for older firmware or used to bypass our
stop policy. The classic seven-byte speed command remains appropriate to the
inspected F&F app. Partydrive's [version classification and command choice](https://github.com/MasterAirscrachDev/Anki-Partydrive/blob/c2d161bfd47ee453aa343658e86fa2762e259354/OverdriveServer/CarSystem.cs)
provide a concrete reason for a version-specific compatibility table.

GitHub did not report a license for the pinned Partydrive/OpenOverdrive repositories;
that is not a license grant. This review publishes observations, hashes and our
analysis script, not copies of their implementation or proprietary decompilation.

## Telemetry and mapping policy

Keep exact frame length, raw bytes, timestamp, firmware, selected profile and
connection identity together. A matching message ID is insufficient to establish
layout. The current captures independently show:

| Capture | Firmware | Relevant observations |
| --- | --- | --- |
| MXT original partial scan | 9511 | 32 eight-byte 0x29 frames; one four-byte 0x36; no positions in retained interval |
| MXT app-profile startup/scan | 9511 | Pings/version/battery; four-byte 0x36; no 0x23 or positions in this recording |
| Groundshock app-profile scan | 11866 | 0x23 confirmation; 15-byte 0x41 with both offsets 654321; no positions |

Do not count the unknown compact formats, battery, pong, or offset/lane reports as
usable position telemetry. Retain the existing first-position and gap watchdogs.
Absence of positions across the full Groundshock recording is stronger evidence
than inferring movement from the host's requested-speed display.

For mapping, cross-check repeated piece-code sequences against geometric closure
and supported wheel-distance fields. Keep inferred pieces visible as inferred.
Curve direction deserves a comparison between code orientation and wheel evidence;
neither another controller's fixed flag equality nor a fallback guess establishes
our physical left/right sign. Keep 53/54/57 quarantined. The [vendor's Overdrive 2.6 FAQ](https://support.anki.bot/article/329-overdrive-2-6-frequently-asked-questions)
explicitly excludes the F&F Power Zone, so success with ordinary pieces or another
app edition cannot certify that tile.

## Control architecture and remaining acceptance

Retain one local Bluetooth owner on the laptop and serialized per-car queues. Phone,
iPad and browser controls should continue through the authenticated relay; the
Codespaces server does not have the laptop's Bluetooth adapter. Current write-without-
response selection agrees with the inspected APK path; add timing experiments only
when captured evidence points to write pacing, not because another platform uses
write-with-response. A GATT write completion or pong is not semantic acceptance.

No source inspected establishes a firmware-enforced stop on host death for these
cars. Ping health monitoring and a host watchdog cannot prove that property.
A future designated-device Android Bluetooth HCI capture of the original F&F app
would be more decisive than another broad decompile: compare stationary startup,
first movement, first position, scan completion, STOP and disconnect against our
raw traces. Collect only the designated test session and retain device/firmware/app
identities. No packet capture or app execution was performed in this pass.

Use [REA's previously reviewed workflow](REA-REVIEW.md) for retained artifact-bound
analysis, JNI references and targeted Ghidra inspection. Installing another agent
framework will not itself resolve the wire-format or firmware questions. Our direct
Ghidra/JADX tools already support the needed static checks.

This pass changes documentation and adds a reproducible Ghidra export script only.
The last controller baseline remains commit 3d358b3 with 501 passing Node tests.
Successful supervised scanning, correct lane direction, STOP behavior and subsequent
one-to-four-car sessions remain required before claiming real-car compatibility.
