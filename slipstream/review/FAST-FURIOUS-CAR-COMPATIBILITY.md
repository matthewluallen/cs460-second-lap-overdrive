# Ice Charger and International MXT — compatibility pass

18 November 2026. Base `5236343`, branch `week-4-student-driving`; runtime `2026-11-18-ff-compatibility`. This pass checks the application/server paths for both Fast & Furious cars. No physical vehicle, APK or firmware was executed. Software checks do not establish physical compatibility.

## Identity and source evidence

| Model ID | F&F physical name | Internal/later name | Car class |
| --- | --- | --- | --- |
| 18 | International MXT | Mammoth | Ordinary car, no trailer |
| 19 | Ice Charger | Dynamo | Ordinary car, no trailer |
| 17 | X52 Ice | x52ice | Supertruck; **not** Ice Charger |

Read-only inspection of retained build-403 `vehicleTypes.json` confirms `name_localized` for IDs 18/19 and inheritance from ordinary base 99. Both specify length 86.2 mm and width 44.2 mm. The [manufacturer/support FAQ](https://support.anki.bot/article/329-overdrive-2-6-frequently-asked-questions) independently identifies Mammoth as the renamed MXT and Dynamo as the renamed Ice Charger. Neither a shell name nor a Bluetooth advertisement is a cryptographic or unique physical identity.

Artifact: `/tmp/slipstream-native-nov18/main.403.com.anki.foxtrot.obb`, SHA-256 `24861aa707f06eeba958bdee4294ef4d2de63c04a26113b15a6cc9c9a1eb1991`.

- `assets/rams/foxtrot/basestation/config/gameData/vehicleTypes.json`: `83d2e46c8be1d762bab3f9ffd3298d6d1591cbadc948382126f0c930d1386af7`.
- `assets/rams/foxtrot/basestation/config/gameData/items.json`: `015ffe65a5cac4c54777dee783e8032d4e68233fd9542743e45fac56da03e4d1`.

See [original artifact provenance](FAST-FURIOUS-REVIEW.md). No proprietary binaries, images, sounds or decompiled function bodies are added. Extracted data tables remain unchanged; the new `vehicle-models.mjs` supplies presentation aliases.

## Reproduced faults and repairs

1. **Unrecognizable model picker and connected identity.** The picker and advertised-model connection only showed Mammoth/Dynamo. Two new regressions failed on that behavior. Game names, picker entries, paired cards, scan selection, phone dashboards, maps and reports now use **International MXT / Mammoth** and **Ice Charger / Dynamo**, retaining numeric IDs 18/19 and their own loadouts. Unknown advertisements stay unidentified. Manual selection still requires the user to match the physical car. Label sorting does not change the established practice-car roster.
2. **Premature startup acknowledgment.** App ping barriers and SDK/app version barriers accepted a reply even while their own request was still queued behind another write. A delayed pong could collapse the road-network barrier and reorder subsequent queued settings. Three new regressions failed before repair. Every ping/version phase now requires its exact request to enter the serialized transport before a reply can advance the phase. The native `0x23` requirement, packet contents, serialized writes, STOP priority and stop latches are unchanged. The protocol has no reply correlation ID: a reply after request entry remains a sequencing signal, not proof of firmware acceptance.
3. **Edition/protocol ambiguity.** “Kit connection” is now **Connection protocol**. The original F&F app handshake is explicitly experimental. Selecting an MXT or Ice Charger does not silently change the protocol. Classic SDK remains the classroom starting point, not a claim these particular cars have passed hardware acceptance.

## Coverage

- Actual host handlers: advertised IDs, both names in picker and phone state, initialization at zero speed, distinct model and session IDs, unchanged default protocol, and four longer-name dashboard payloads below the existing relay budget.
- Actual localhost HTTP/WebSocket relay: two and four cars, repeated model types, unique invitations, per-seat private dashboards, other-seat/model-ID substitution rejection, recovery release fields, brake and stopped/neutral state. The relay needs no model-specific production change; it routes approved session seats, not firmware model IDs.
- Eight ordinary-track simulator matrices: MXT alone, Ice Charger alone, pair, and four cars, through both normal simulation and SDK Car guards over a simulated radio. Each scans with unchanged 5 s / 2 s and 45 s / 3 lap limits, keeps the other cars stopped during discovery, drives two simulator laps with mixed human/CPU control, checks explicit CPU arming, left/right movement after fresh codes, full 300 mm/s ceiling without a Supertruck penalty, unique colors and STOP latching.
- Distinct MXT cannon/shield and Ice Charger charged attack/boost loadouts; support energy use, maximum-speed clamp and zero-throttle behavior. These are Slipstream game effects, not an exact recreation of every original app effect.
- Startup regressions cover five F&F ping barriers, SDK ping, both version barriers and held road-network writes. Existing initialization, BLE buffering, scan-bootstrap, watchdog and optional SDK-config tests remain in the regression suite.

SimWorld is not an original-firmware emulator. The SDK matrix exercises physical-car host guards over synthetic motion; it does not pretend to emulate F&F app initialization. Opposite steering checks wait for a new optical code after the previous maneuver; rapid consecutive steering is not accepted by this evidence.

## Remaining physical and parity limits

- The retained MXT firmware 9511 app-mode startup has pongs/version but no native `0x23` confirmation and no ordinary positions. Its eight-byte transition frames remain unsupported; they cannot safely identify track pieces or keep a motion watchdog alive. The repaired implementation correctly refuses that incomplete startup. No speculative compact-frame decoder or confirmation bypass was added.
- No Ice Charger physical trace exists in the retained evidence. Guardian's earlier accepted behavior cannot be transferred to either model.
- Shared optical calibration uses the existing SDK-derived path. Native app finite-offset correction/state gates differ; this pass does not guess a new steering protocol without a fresh discriminating trace.
- Rendering uses original generic car bodies, not exact shell models. Extracted gameplay omits MXT splash and Ice Charger scramble fields; exact stock-app weapon parity is not claimed. The custom Power Zone rules and special-piece scored-round gate remain unchanged.

The remaining acceptance run is startup-inclusive recording for each charged car in Classic SDK, physical LED/identity check, scan, forward laps, isolated left/right shifts and observed stop. Begin at 300 mm/s on an ordinary circuit. Preserve the recording if a phase fails; do not bypass the watchdog or change profiles while connected. Higher speeds, real phone driving, mixed physical cars and special-track effects need their own acceptance.

## Verification

Node 22.23.5: **934/934 tests pass** (917 baseline plus 17 new compatibility/ordering regressions). Python 3.14.7: **38/38 pass**. CWE and dependency regressions pass; npm 11.9.0 audit reports **zero vulnerabilities**. No dependencies changed. The Student browser was checked with both simulated cars selected by physical name, separate green/blue colors and zero commanded speed, with no console warnings/errors. [Browser evidence](assets/ff-models-student.jpg). No physical car was connected.
