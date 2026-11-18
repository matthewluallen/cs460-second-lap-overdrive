# Fast & Furious decompilation after the first MXT scan

12 November 2026. Owner requested another Ghidra pass after a real scan failed.
This is a fresh focused decompilation using the saved, previously analyzed F&F
Ghidra project, plus a fresh JADX run. It is **not** a fresh whole-library automatic
analysis. No app or firmware was executed and no additional car commands were sent.

## Evidence identity and tools

The retained `com.anki.foxtrot` build 403 artifacts still hash to:

- APK SHA-256: `78c63be8ee611adf1894c4d32c1b70418d921fefa667ab3d0d8e645164b1b60b`
- ARM library SHA-256: `0eef63a8135f4cfe7bb16b4effa1f720192cc2c1f340d0c8c8f0c2b9835f3d7f`

See [the earlier F&F review](FAST-FURIOUS-REVIEW.md) for third-party provenance
and signature limitations. Ghidra 12.2/OpenJDK 25 processed the project read-only.
`ExportMxtTelemetry.java` exported 190/190 selected entries; `ExportMxtReceive.java`
exported 47/47. Neither export failed or was cancelled. These include linkage stubs
and duplicate constructors, not 237 independently verified behaviors. The exports
contain 66 and 15 decompiler warning comments. Preserve uncertainty around inferred
types, indirect calls and structure offsets. Addresses use image base `0x10000`.

JADX 1.5.3 processed 1,597 classes and reported two errors. Fresh VehicleController,
LeService and GattAttributes sources are byte-identical to the previous F&F outputs.
This does not turn the incomplete Java decompilation into an error-free one.

[Coverage manifest](MXT-DECOMPILE-COVERAGE.json) records names, addresses, output
hashes and counts. Proprietary APKs, library and decompiled C/Java remain outside
this repository in `/tmp/slipstream-mxt-reanalysis` and the earlier artifact directory.

## Hardware observations, separated from inference

The operator identified the car as International MXT and reported almost three
laps during the 45-second scan. The track includes start/finish and F&F Power Zone.
The UI's Groundshock/model 8 label was its fallback; it does not establish identity.
Firmware query reported 9511, but that alone does not establish notification mode.

The partial capture began approximately 20 seconds into scanning. Its hardware-only
fixture contains 32 received eight-byte `0x29` frames, six battery reports, one
four-byte `0x36` report, and three outgoing STOP commands. It contains **zero `0x27`
position frames**. The original recording additionally contained two simulated-car
STOP commands; those were removed from the hardware fixture. No hardware bytes
were altered. The partial trace cannot tell us what was sent or accepted at startup.

Thus, this is not evidence that a 45-second budget was simply too short. It also
cannot establish that Power Zone alone caused the failure. No position IDs are
available in this capture with which to identify even the ordinary pieces.

## Fresh native and Java findings

| Entry | Address | Finding and limit |
| --- | --- | --- |
| CarMsgRoadPieceTransitionUpdate constructor / GetBytes | `006b4290` / `006b43e4` | Classic transition serializer writes 18 bytes; constructor uses the corresponding full field sequence. It does not establish the meaning of an eight-byte firmware variant. |
| CarMsgPositionUpdate constructor / GetBytes | `006b3970` / `006b3ab0` | Distinct position message and serializer; position observations must not be synthesized from the short transition capture. |
| VehicleInitSequence::ExecutePhase | `007aff3c` | Phases include version request, set-car-mode, vehicle parameters, default road network V2, max-delocalized-speed, initial playback sequences and DAS categories. Several phases send ping requests. |
| VehicleInitSequence::Update | `007b0080` | Advancement depends on state and a vehicle field, rather than issuing all phases blindly; indirect callbacks require care. |
| VehicleMessenger::SendSetCarMode | `007b86cc` | Sends the mode stored on the vehicle. |
| CarMsgSetCarMode constructor / GetBytes | `006b8350` / `006b83d8` | Three-byte packet, length byte 2, command `0x22`, mode byte. This is not the public SDK `0x90` packet and is not authorization to try guessed modes on hardware. |
| Vehicle::ParseOperatingMode | `007a7624` | Maps configuration branches to mode values 2, 1 and 0; the 0 branch is labeled RC. Full application context matters; no new mode command was implemented. |
| JNI NativeOnUpdateValueForToPhoneCharacteristic | `0069bde4` | Checks notification length against a 20-byte buffer, copies received Java bytes into a vehicle message and dispatches asynchronously. No short-to-full frame reconstruction is visible in this inspected entry. This is not a proof about every downstream handler. |
| VehicleController.onDataAvailable / sendMessage | Java | Passes characteristic bytes to JNI and outgoing bytes to LeService. No expansion or short-transition interpretation appears in these methods. |

Slipstream currently queues SDK mode, version, battery and lights; it does not
reproduce the application's phased initialization. That difference is an
**investigation lead**, not a demonstrated root cause. Public SDK mode is an
alternative documented path; application initialization is not automatically a
required replacement. The partial capture does not prove SDK mode was accepted.

## Resulting action and next test

Before this decompilation, the captured hardware replay reproduced a safety bug:
our decoder accepted short `0x29` messages as transitions, refreshing the watchdog
without trusted track fields. Commit `99869aa` requires the full supported layout;
all 480 Node tests pass. The new decompilation supports keeping that conservative
boundary. It does **not** solve missing localization or establish Power Zone support.
The already-open host page still has its loaded code; it was not refreshed during
this static investigation, and its stopped/recovery state was not cleared.

Next useful evidence is a trace **from before connection**, including SDK-mode
write, version/ping responses and initial notifications. Add startup recording and
explicit initialization diagnostics first; compare ordinary track and Power Zone
only in separately supervised tests. Do not solve this by extending watchdogs,
guessing short-frame fields, or copying the whole app's initialization onto a car.

The manufacturer's [2.6 FAQ](https://support.anki.bot/article/329-overdrive-2-6-frequently-asked-questions)
separately says that edition renames the F&F cars Mammoth/Dynamo and does not support
Power Zone. That is edition-specific background, not proof of this scan's cause or
an exact MXT-to-model mapping from our captured data.

## Reproduction

With the separately retained artifacts and analyzed `foxtrot` project:

```sh
jadx --no-res -d /tmp/slipstream-mxt-reanalysis/java com.anki.foxtrot.apk
analyzeHeadless projects foxtrot -process libDriveEngine.so -noanalysis -readOnly \
  -scriptPath slipstream/tools -postScript ExportMxtTelemetry.java native-telemetry.c
analyzeHeadless projects foxtrot -process libDriveEngine.so -noanalysis -readOnly \
  -scriptPath slipstream/tools -postScript ExportMxtReceive.java native-receive.c
```

Inspect export coverage and warnings, not just process exit status. Neither this
static pass nor the one physical scan establishes complete-system correctness.
