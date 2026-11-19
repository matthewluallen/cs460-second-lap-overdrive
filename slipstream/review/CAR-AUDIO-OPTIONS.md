# Car audio options — 18 November 2026

## Decision

Use optional sound on the laptop, phone or iPad for Week 4. Treat **on-car audio as unsupported** for Guardian, Groundshock and International MXT: this review found no verified onboard speaker or supported audio command for these cars. That is a capability limit, not a claim that every hardware revision has been physically inspected.

The original Fast & Furious app has an application-side audio system, engine simulation and sound banks. We can reproduce the *kind* of feedback with original synthesized sounds; we should not copy its licensed movie voices, music or effects. Sound must remain presentation only, with no new BLE commands or dependency in the driving/STOP path.

## Confirmed evidence

| Evidence | What it establishes | Limit |
| --- | --- | --- |
| Pinned [Anki Drive SDK protocol](https://github.com/anki/drive-sdk/blob/410352617b8660338746a6bb2b2dd173afb1b91a/include/ankidrive/protocol.h) | The declared vehicle commands include movement, lights and telemetry; no speaker, tone or audio-stream command is declared. Local header and implementation searches also found none. | The [SDK describes itself as a protocol subset](https://github.com/anki/drive-sdk/tree/410352617b8660338746a6bb2b2dd173afb1b91a). Absence here cannot prove that all private firmware capabilities are absent. |
| Original F&F OBB archive | `assets/rams/foxtrot/basestation/audio/` contains **35 sound-bank ZIPs**, including car, throttle, items, UI, engine and character voice banks. Inspecting the car-bank ZIP's directory shows a `.bnk` and `.wem` members. `config/audio/vehicleAudioPackages.json` defines app engine-audio models and bank selection. | Read-only directory/configuration inspection; no audio was played or copied into the repository. These are app assets, not an onboard speaker BOM. |
| Original Android native engine | `libDriveEngine.so` links `libOpenSLES.so` and imports `slCreateEngine`. Fresh Ghidra exports show `OverDriveAudioController::Initialize` obtains the Android JNI context and initializes the app audio engine; it also posts audio events. | Static evidence of the Android playback path, not a physical listening test. [Android documents OpenSL ES as its native audio interface](https://developer.android.com/ndk/guides/audio/opensl/opensl-for-android). |
| Official [Universal/Anki F&F announcement](https://www.universalproductsexperiences.com/news/fast-and-furious-anki-overdrive) | The game advertised vehicle-specific effects and movie characters. | Marketing language about car sound effects does **not** identify a speaker inside the plastic car. |

This corroborates application/device playback as the intended integration point. It does not justify inventing an audio BLE opcode, borrowing Vector/Cozmo audio commands, or driving the wheel motors to make tones.

## Hardware identity and FCC limits

No photographed underside labels or complete component-level HBOM for the user's three cars were available in this pass. Their display names, shell designs and firmware versions do not prove a particular FCC filing or PCB revision. The existing classroom HBOM deliberately records capabilities rather than guessed ICs or speaker part numbers.

The [official FCC equipment search](https://apps.fcc.gov/oetcf/eas/reports/GenericSearch.cfm) returned HTTP 403 in this review. Search results exposed filings for other Anki products, including the X52 Ice truck and Vector; neither was substituted for Guardian, Groundshock or MXT. A model-specific hardware conclusion requires the actual FCC/model label, matching manufacturer-submitted internal photos, and, if still unclear, an authorized powered-off inspection. No disassembly is required to use browser audio.

## Useful sound design now

1. **Default off; explicit “Enable sound” and volume/mute.** Initialize/resume Web Audio from that click. Browser audio can be blocked or suspended; show that state without blocking car controls. [MDN's Web Audio guidance](https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API/Best_practices) covers user activation and user control.
2. **Short, distinguishable cues:** countdown, a verified completed lap, custom Power Zone charge/boost, and “STOP requested.” An acknowledgment or requested lane change must not sound like verified physical completion. Keep an equivalent visible message.
3. **Optional engine character per selected car:** synthesize a quiet tone from current displayed pace/throttle, labeled as a game effect rather than measured engine RPM. Fade on stale data, link loss, STOP, hidden page or mute; do not let sound imply the car is still located or physically stopped.
4. **Choose one listening role:** host ambience/commentary for the room, or private phone feedback for its approved driver. Avoid simultaneous full-volume commentary on every phone. Trusted map positions can later drive screen-relative stereo panning; stale/ambiguous positions must lose spatial placement.

This runs in the client's browser; Codespaces serves the application rather than producing audible output at the track. The [Web Audio standard](https://www.w3.org/TR/webaudio-1.1/) supplies synthesis, gain and spatial audio primitives. A room speaker connected to the host is optional; actual output routing and latency depend on the browser, OS and device. No new hardware is necessary.

## If sound must travel with the physical car

A separate, removable audio module is a future engineering experiment: independent controller, amplifier/transducer, power source and event receiver. It should have no authority over wheel commands. Before choosing parts, measure payload mass, mounting clearance, center-of-mass change, runtime, latency and radio coexistence. Avoid loading the Anki battery or modifying its charging circuit without an actual electrical design. A small transducer gives limited volume and bass; a room speaker is simpler for classroom use. This pass neither selects a product nor claims an onboard retrofit is validated.

## Reproducible local provenance

Fresh static work used Ghidra 12.1.3, `-readOnly -noanalysis`, against the existing imported native library; APK/firmware code was never executed. No binaries, proprietary decompiled bodies, sound banks or audio samples are added to Git.

- `/tmp/slipstream-native-nov18/com.anki.foxtrot.apk` — SHA-256 `78c63be8ee611adf1894c4d32c1b70418d921fefa667ab3d0d8e645164b1b60b`.
- `/tmp/slipstream-native-nov18/main.403.com.anki.foxtrot.obb` — `24861aa707f06eeba958bdee4294ef4d2de63c04a26113b15a6cc9c9a1eb1991`.
- `/tmp/slipstream-native-nov18/libDriveEngine.so` — `0eef63a8135f4cfe7bb16b4effa1f720192cc2c1f340d0c8c8f0c2b9835f3d7f`.
- Fresh local `/tmp/slipstream-native-nov18/audio-options.c` — `f655c4257a4cd2f79b7fa4551c9d1a0845794a4ea3931ec518e752467883db5c`. Ghidra addresses: `OverDriveAudioController::Initialize` **005c5b10**; `AudioEngineController::InitializeAudioEngine` **00a85ec2**; `AudioEngineController::PostAudioEvent` **00a860c4**; `VehicleThrottleRevAudioClient::SetThrottleAmount` **005d0428**. These are static exports, not a full audio-system equivalence proof.
- OBB member `assets/rams/foxtrot/basestation/config/audio/vehicleAudioPackages.json` — `a1b289e661d2e2f21655176fecd15ba01a4689c931cf819686bab568790d0389`.
- `/tmp/slipstream-sdk-acquisition/include/ankidrive/protocol.h` at SDK revision `410352617b8660338746a6bb2b2dd173afb1b91a` — `5982fb0f866b7c36fbfbcc8cc8b7adc386ce591fa00310c659ab051faf4e8fcd`.

No new physical test was conducted. Browser/iPad audio behavior, room acoustics and any prospective payload still require separate acceptance checks.

## Implementation update — 18 November 2026, classroom build

The browser-side proposal above is now implemented in
`2026-11-18-week4-classroom`: host and phone **Sound & screen** controls provide
opt-in synthesized cues, volume/mute and a separately optional engine game tone.
Both audio choices start off. The tone follows allowed displayed game state;
STOP, hidden pages, stale state and lost connections silence it. Spoken 3D
commentary remains a separate option. No original sound bank or new BLE audio
command was added, and no onboard speaker capability is claimed.

The same panel shows screen-awake request status and explicit retry; support is
requested while connected and may be denied or released. Its lifecycle cannot
resume driving. Mocked audio/wake-lock and simulator checks pass as part of the
917-test Node suite. Actual audible output, phone/browser differences and room
acoustics remain unaccepted on hardware. The earlier recommendations remain the
research record; the on-car audio retrofit is still only a future experiment.
