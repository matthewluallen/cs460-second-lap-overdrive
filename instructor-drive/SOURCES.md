# Protocol evidence and adoption decisions

Reviewed 11 November 2026. The new encoder is independently authored from documented packet layouts. Source agreement, upstream tests and community reports establish a plausible interoperable implementation; they do **not** establish that this browser has moved or stopped the instructor's physical car. Read [the run and acceptance checklist](README.md) before enabling LIVE.

## Sources inspected

| Source and pinned revision | What it contributes | Limitation |
| --- | --- | --- |
| [Anki's official Drive SDK, `4103526`](https://github.com/anki/drive-sdk/tree/410352617b8660338746a6bb2b2dd173afb1b91a) | C structures, command builders, GATT UUIDs and byte-vector tests. | Historical SDK 0.3.0; last inspected commit 2018-01-15. DRIVE documentation is not universal OVERDRIVE firmware qualification. |
| [Leicas/overdrive-arena, `ff03e26`](https://github.com/Leicas/overdrive-arena/tree/ff03e265e77be237c329a512b92b6fb579abbeb9) | Current Python/Bleak implementation, explicit hardware observations and classic command framing. | Last inspected commit 2026-09-20. The author's hardware results are not our results. |
| [MasterAirscrachDev/Anki-Partydrive, `c2d161b`](https://github.com/MasterAirscrachDev/Anki-Partydrive/tree/c2d161bfd47ee453aa343658e86fa2762e259354) | Detailed C# protocol, firmware profiles, 32-bit version decoding and Overdrive-specific behavior. | Last inspected commit 2026-09-03. [README disclosure](https://github.com/MasterAirscrachDev/Anki-Partydrive/blob/c2d161bfd47ee453aa343658e86fa2762e259354/README.md#server-information) says released server builds derive from a more complete closed branch. |
| [dschwen/OpenOverdrive, `a706246`](https://github.com/dschwen/OpenOverdrive/tree/a7062464d87686ea09acf5892bb5b9a2d14c255c) | Android/Kotlin legacy and V4 packets, GATT serialization and notification setup. | Last inspected commit 2025-08-25. Not a browser library; no license file found. |
| [jtg-code/anki-overdrive-windows-sdk, `2eae856`](https://github.com/jtg-code/anki-overdrive-windows-sdk/tree/2eae856ff20f78c5079778bfd05e9f8fd5bd1e3e) | A second actual Bleak implementation corroborating SDK enable and speed-zero before disconnect. | Last inspected commit 2023-07-09. Restrictive license and async implementation concerns; not adopted. |
| [praneet22/Anki-Overdrive-Python, `8e54c89`](https://github.com/praneet22/Anki-Overdrive-Python/tree/8e54c89210753d541f700387945b5e1d7314fe9b) | Legacy speed layout; derived from xerodotc's implementation. | Uses **bluepy**, not Bleak; Linux-specific, last inspected commit 2019-07-13. |
| [andy008/AnkiOverDriveJS, `3e13130`](https://github.com/andy008/AnkiOverDriveJS/tree/3e131303de85e1b2db9da2118e3031c0eb42935f) | Browser GATT feasibility and legacy speed framing. | Example auto-starts at 1000 mm/s, lacks equivalent guards and misreads multi-byte values. Not adopted. |

## Exact protocol used

The [official GATT header](https://github.com/anki/drive-sdk/blob/410352617b8660338746a6bb2b2dd173afb1b91a/include/ankidrive/vehicle_gatt_profile.h#L20-L30) specifies:

| Role | UUID |
| --- | --- |
| Vehicle service | `be15beef-6186-407e-8381-0bd89c4d8df4` |
| Notifications | `be15bee0-6186-407e-8381-0bd89c4d8df4` |
| Commands | `be15bee1-6186-407e-8381-0bd89c4d8df4` |

In the [official structures](https://github.com/anki/drive-sdk/blob/410352617b8660338746a6bb2b2dd173afb1b91a/include/ankidrive/protocol.h#L78-L122), byte 0 counts all remaining bytes, byte 1 is the opcode, and the payload is at most 18 bytes. The [builders](https://github.com/anki/drive-sdk/blob/410352617b8660338746a6bb2b2dd173afb1b91a/src/protocol.c#L25-L50) and [upstream tests](https://github.com/anki/drive-sdk/blob/410352617b8660338746a6bb2b2dd173afb1b91a/test/test_protocol.c#L35-L55) establish SDK and speed vectors. Speed and acceleration are little-endian 16-bit fields; this feature accepts only nonnegative bounded speed.

| Operation | Exact bytes/layout | Interpretation |
| --- | --- | --- |
| Motion SDK enable | `03 90 01 01` | Enable with localization override; not a firmware acknowledgement. |
| Default pulse | `06 24 64 00 E8 03 01` | 100 mm/s, acceleration 1000 mm/s², respect-road-limit flag 1. |
| Maximum pulse | `06 24 C8 00 E8 03 01` | 200 mm/s, same acceleration/flag. |
| STOP | `06 24 00 00 E8 03 01` | Requested speed zero; actual deceleration/stop remains physical evidence. |
| Ping | `01 16` → `01 17` | Request/response liveness, not motion evidence. |
| Version | `01 18` → `03 19 VV VV` | Official 16-bit little-endian reply. |
| Observed extended version | `05 19 27 25 00 00` | Exact 32-bit form decoded as 9511; retain raw bytes. |
| Battery | `01 1A` → `03 1B BB BB` | Raw unsigned little-endian millivolts, not battery percentage or capacity. |

The official speed builder sets its road-limit flag to 0. The POC uses 1, corroborated by [Leicas' encoder](https://github.com/Leicas/overdrive-arena/blob/ff03e265e77be237c329a512b92b6fb579abbeb9/anki/protocol.py#L10-L77) and [the Bleak controller](https://github.com/jtg-code/anki-overdrive-windows-sdk/blob/2eae856ff20f78c5079778bfd05e9f8fd5bd1e3e/anki_sdk/controllers.py#L24-L45). The chosen low speed, acceleration, 750 ms STOP scheduling target and 3500–4500 mV gate are provisional application policy, **not manufacturer-certified safe limits**.

The optional light identification check reuses the original bench's bounded off → green → off trial, including its SDK setup and cleanup. [Bench research](../bench/RESEARCH.md#november-5-led-and-fleet-follow-up) documents those exact `0x33` packets. It uses `03 90 01 00` without motion's localization override; motion setup later uses `03 90 01 01`. A completed LED write is not a person's confirmation that the correct car changed lights.

The alternative [power-button identification check](IDENTIFICATION.md#power-button-check) sends no identification opcode. It combines deliberate physical power-off, an observed GATT disconnection within a 30-second window, explicit chooser selection of the same browser ID checked before GATT reconnect, and operator attestation. It is original application logic, not a manufacturer identity protocol; its physical workflow still requires acceptance testing. Both methods bind one physical label to one browser session and require a human observation. Neither supplies cryptographic hardware identity.

## LED investigation and negative hardware result

The November 11 LIVE trial established GATT communication and received unsolicited battery notifications, but repeated custom off → green → off sequences produced **no observed light change**, despite completed writes. No `0x24` speed command was sent. The operator's observed green-to-pulsing-blue change on connection is not the requested custom pattern. [Redacted evidence](validation/live-led-excerpt.txt) and [validation limits](VALIDATION.md#hardware-check-and-stopping-point) preserve this negative result.

The inspected primary code does not establish a firmware-9511-specific fix:

- The [official light definitions](https://github.com/anki/drive-sdk/blob/410352617b8660338746a6bb2b2dd173afb1b91a/include/ankidrive/protocol.h#L272-L310) set maximum intensity to **14**, and the [official builder](https://github.com/anki/drive-sdk/blob/410352617b8660338746a6bb2b2dd173afb1b91a/src/protocol.c#L97-L110) clamps to that value. [Leicas' current encoder](https://github.com/Leicas/overdrive-arena/blob/ff03e265e77be237c329a512b92b6fb579abbeb9/anki/protocol.py#L104-L121) also uses 0–14. Raising intensity to 255 is unsupported by those sources and is not adopted.
- The [official SDK-mode documentation](https://github.com/anki/drive-sdk/blob/410352617b8660338746a6bb2b2dd173afb1b91a/include/ankidrive/protocol.h#L330-L342) explicitly requires the localization override for **speed and lane changes**, not lights. [Partydrive's SDK initializer](https://github.com/MasterAirscrachDev/Anki-Partydrive/blob/c2d161bfd47ee453aa343658e86fa2762e259354/OverdriveServer/Protocol.cs#L237-L243) sends the override but describes it as deprecated/unused. These sources do not prove that the identification trial's flag 0 caused the missing light response.
- [Partydrive's engine-light helper](https://github.com/MasterAirscrachDev/Anki-Partydrive/blob/c2d161bfd47ee453aa343658e86fa2762e259354/OverdriveServer/CarSystem.cs#L461-L490) uses FADE with equal start/end intensity and one cycle, whereas the inherited trial uses STEADY and zero cycles. That difference is a possible future stationary experiment, **not a verified repair**, and the existing bench codec is unchanged.
- No explicit SDK-enable or light-command acknowledgement was verified in the inspected protocol subset. GATT write completion does not prove firmware acceptance or a visible effect. [Official SDK issue #34](https://github.com/anki/drive-sdk/issues/34) contains an upstream description of throbbing blue as connection state, reinforcing why that observation alone is insufficient.

Real battery readings crossed below the provisional 3500 mV gate. Charge and inspect the car before further motor qualification; the gate was not lowered to obtain movement. The power-button identity alternative avoids making successful custom LED behavior a prerequisite, while retaining exact physical confirmation.

## Why firmware is restricted

The provisional allowlist is **9511 and 11866 only**:

- **9511:** existing [course bench validation](../bench/VALIDATION.md#november-5-live-trace-and-follow-up-boundary) records a user-supplied November 5 trace containing ping, battery and extended version replies. It explicitly does not establish LED success, movement or stopping. [Partydrive's version decoder](https://github.com/MasterAirscrachDev/Anki-Partydrive/blob/c2d161bfd47ee453aa343658e86fa2762e259354/OverdriveServer/Protocol.cs#L331) corroborates the 32-bit interpretation. Inclusion permits a controlled qualification attempt; it is not hardware certification.
- **11866:** [Leicas' pinned README](https://github.com/Leicas/overdrive-arena/blob/ff03e265e77be237c329a512b92b6fb579abbeb9/README.md#protocol-notes-firmware-11866-verified-on-x52--mammoth--dynamo) reports testing on X52, Mammoth and Dynamo. Its [vehicle implementation](https://github.com/Leicas/overdrive-arena/blob/ff03e265e77be237c329a512b92b6fb579abbeb9/anki/vehicle.py#L102-L175) subscribes before SDK initialization, serializes writes and attempts speed zero before disconnect. It does not demonstrate a guaranteed link-loss stop.

[OpenOverdrive](https://github.com/dschwen/OpenOverdrive/blob/a7062464d87686ea09acf5892bb5b9a2d14c255c/core-protocol/src/main/java/core/protocol/VehicleProtocol.kt#L60-L80) and [Partydrive](https://github.com/MasterAirscrachDev/Anki-Partydrive/blob/c2d161bfd47ee453aa343658e86fa2762e259354/OverdriveServer/Protocol.cs#L164-L175) have an eight-byte V4 speed variant with size `07` and trailing `01`. Partydrive [maps versions](https://github.com/MasterAirscrachDev/Anki-Partydrive/blob/c2d161bfd47ee453aa343658e86fa2762e259354/OverdriveServer/CarSystem.cs#L495-L545) 12385/12386, 12411/12412 and 3387 to other profiles. The POC does not guess a variant, enable free drive, or change firmware. Unknown/new profiles remain blocked.

Leicas reports unreliable optical position codes below approximately 250 mm/s and uncertain initial lane offset. That is why this low-speed POC uses ping responses for liveness and omits lane changes, turns and track scanning. Its [author's technical account](https://antoine.weill-duflos.fr/en/post/overdrive-arena/) also describes battery sag and host-adapter contention. These observations motivate acceptance tests; they do not fix a universal speed threshold.

## Public technical conversations checked

These are attributed observations, not independent reproduction:

- [Official SDK issue #38](https://github.com/anki/drive-sdk/issues/38) reports track-search behavior after a car leaves the track. [Issue #43](https://github.com/anki/drive-sdk/issues/43) reports nonfunctional left/right intersection turns despite other commands working. Keep initial tests in a fixture/contained track and leave turns out.
- [OpenOverdrive issue #1](https://github.com/dschwen/OpenOverdrive/issues/1) reports controlling starter-set cars on Android 16 when the original app could not discover them; this is viability evidence for that setup only.
- [Public captured-message discussion](https://www.reddit.com/r/AnkiOverdrive/comments/1p5de3g/anki_overdrive_programming_undocumented_message_id/) reports SDK 0.3 still working and provides sample status bytes. A [follow-up protocol discussion](https://www.reddit.com/r/AnkiOverdrive/comments/1q6grtp/anki_overdrive_programming_messages/) distinguishes voltage/status/recovery events and disagrees about reset behavior. No speculative reset/power commands are adopted.
- [Partydrive issue #2](https://github.com/MasterAirscrachDev/Anki-Partydrive/issues/2) documents deprecated/broken web-panel scanning. Its web panel is not proof of a complete direct browser-BLE solution. [PR #4](https://github.com/MasterAirscrachDev/Anki-Partydrive/pull/4) adds Mac/CoreBluetooth support, so older Windows-only descriptions are stale.
- [The maintainer's Partydrive discussion](https://www.reddit.com/r/AnkiOverdrive/comments/1ueawkc/partydrive_420_is_now_available_for_windows_and/) describes a desktop server with same-network phone controllers. This POC instead connects the local browser directly to one car; it adds no network motor API.

## Browser requirements and failure limits

[Chrome's primary guide](https://developer.chrome.com/docs/capabilities/bluetooth) requires a secure context and a user gesture for the chooser, describes notification subscriptions and disconnect events, and cautions against concurrent GATT operations. The [browser implementers' status table](https://github.com/whatwg/bluetooth/blob/main/implementation-status.md) lists desktop Chrome on Mac/Windows/ChromeOS and Edge support; ordinary Firefox and Safari do not provide this API, and Linux support is incomplete. Use current desktop Chrome or Edge with a working BLE adapter and OS Bluetooth permission for the first qualification. Record the exact browser/OS version. Do not assume an embedded preview supports the chooser.

The [Secure Contexts specification](https://w3c.github.io/webappsec-secure-contexts/#is-origin-trustworthy) treats loopback origins as potentially trustworthy. This prototype is served at `http://127.0.0.1:8000/` and requires an instructor-controlled local host; ordinary remote HTTP is unsuitable. Keep the page in the foreground and the computer awake.

The 750 ms timer is a scheduling target, not a hard upper bound; the native Chrome SIMULATION trial requested STOP at 752 ms. A disconnected or crashed browser cannot deliver STOP. No car-side expiry or physical emergency-stop mechanism was verified in the inspected subset. A timer, successful write Promise, ping or software state label proves neither mechanical motion nor stopping. The UI must preserve that uncertainty; operator observation and physical intervention remain necessary.

## Licenses and copied-code inventory

No third-party implementation, assets, firmware, binaries or runtime libraries were copied into this feature. Its minimal encoder/controller are original; its browser transport reuses this repository's existing bench connection and identification code. Protocol values are cited for interoperability. No dependency upgrades are introduced.

| Inspected source | License found | Adoption decision |
| --- | --- | --- |
| Official Drive SDK | [Apache-2.0](https://github.com/anki/drive-sdk/blob/410352617b8660338746a6bb2b2dd173afb1b91a/LICENSE); examples/dependencies have separate licenses | Reference documented protocol facts and tests; no source vendored. If later adapting code, retain applicable license/notices and mark changes. |
| overdrive-arena | [MIT](https://github.com/Leicas/overdrive-arena/blob/ff03e265e77be237c329a512b92b6fb579abbeb9/LICENSE) | Corroboration only; any future substantial copy requires its notice. |
| Anki-Partydrive | No LICENSE/COPYING/NOTICE found in inspected tracked tree | Do not copy code, location tables, assets or firmware. Public availability is not a reuse grant. |
| OpenOverdrive | No license file found in inspected tracked tree | Corroboration only; no Kotlin copied. |
| jtg-code Bleak SDK | [Custom noncommercial restriction, including nonprofits](https://github.com/jtg-code/anki-overdrive-windows-sdk/blob/2eae856ff20f78c5079778bfd05e9f8fd5bd1e3e/LICENSE) | Do not copy or depend on it. |
| praneet22 Python SDK | [MIT](https://github.com/praneet22/Anki-Overdrive-Python/blob/8e54c89210753d541f700387945b5e1d7314fe9b/LICENSE) | Corroboration only; no Python copied. |
| AnkiOverDriveJS | No license file found in inspected tracked tree | No JavaScript copied. |

The new feature therefore introduces no third-party runtime-license combination to resolve. The repository's existing intentionally pinned teaching dependencies and their obligations remain as before.
