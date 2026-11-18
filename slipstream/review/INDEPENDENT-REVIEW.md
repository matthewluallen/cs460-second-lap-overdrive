# Independent protocol, native-engine and game review

12 November 2026. Scope: PR #4 follow-up. This review independently downloaded the vendor-hosted APK/OBBs, ran JADX and Ghidra, compiled the public SDK, inspected eight community/official example sources, and exercised Slipstream. It does not certify the complete application, firmware or hardware. No APK was executed and no car was driven.

## Reproducibility and analysis quality

Artifact hashes and exact external revisions are in [source-identities.json](source-identities.json). The APK and ARM library match the earlier reported hashes. Re-extracting the main OBB produced byte-identical `pieces.json`, `vehicles.json`, and `weapons.json`: 21 piece definitions, 21 vehicle models, 38 selected weapons. This corroborates extraction, not permissions or physical calibration.

JADX 1.5.3 produced 1,597 Java classes, reporting two errors. HTTP/analytics methods contain incomplete decompilation; inspected VehicleController/LeService paths were readable. Ghidra 12.2 used its macOS ARM native components built with the bundled Gradle workflow and OpenJDK 25. The initial broad run failed to save when disk space ran out; an earlier run also lacked the native decompiler. Those runs were superseded, not counted as successful evidence.

The corrected full import/analysis completed in 359 seconds and saved successfully, without an analysis timeout or ERROR entries. It emitted **3,013 warnings**: 2,808 external-data relocation notices, 127 decompiler callback warnings, 41 demangled address-table warnings, 36 flow-repair warnings and one trust-manager warning. There are 486 unresolved external symbols. This is not a warning-free reconstruction: Android/C++ external library resolution, indirect ARM jumps, recovered types and some function bodies remain uncertain.

Two exports from the saved project completed: **443 control/message functions**, and **656 broader subsystem functions**, with zero export-level decompilation failures. Counts include import stubs/thunks, not 1,099 unique fully understood algorithms. The exports contain 20 and 152 decompiler warning comments respectively. [native-coverage.json](native-coverage.json) retains addresses, symbols, output hashes and counts without redistributing decompiled source. The original helpers are [ExportControl.java](../tools/ExportControl.java) and [ExportSystems.java](../tools/ExportSystems.java). The subsystem helper exports direct callers/callees as well as C-like output; virtual/indirect calls are not a complete call graph.

Reproduction, after obtaining the separately distributed artifacts and tools:

```sh
jadx --no-res -d java 1502.apk
analyzeHeadless projects broad -import libDriveEngine.so -analysisTimeoutPerFile 900 \
  -scriptPath slipstream/tools -postScript ExportControl.java native-control.c
analyzeHeadless projects broad -process libDriveEngine.so -noanalysis \
  -scriptPath slipstream/tools -postScript ExportSystems.java native-systems.c
```

Inspect the logs and save result, not just the process exit code. The SDK harness `tools/sdk_vectors.c` must be compiled against the pinned official SDK's `src/protocol.c` and headers; its output supplies twelve independent golden command vectors in `protocol-review.test.mjs`.

## What the broader native pass establishes

Addresses below use Ghidra's image base `0x10000`, with the Thumb address bit cleared. They are not raw ELF symbol values.

| Area | Evidence reviewed | Consequence for Slipstream |
|---|---|---|
| Java/Bluetooth | `VehicleController.sendMessage`; `LeService.onServicesDiscovered`, `writeCharacteristic`, `onCharacteristicWrite` | UUIDs agree; Android sets write-without-response and serializes writes per characteristic. Slipstream's serialized browser writes are consistent with that pattern, but browser timing is not proved. |
| Message construction | Speed `006ab944`, lane `006aba70`, version `006add38`, factory `006a9604` | Classic frames agree with public SDK vectors. Version can carry 32 bits. Do not mix V4's different speed frame into this protocol silently. |
| Initialization | `VehicleInitSequence::ExecutePhase` `007aff54`, `Update` `007b0098`; `SendPingRequest` `007b7bf4` | App stages version/car configuration, road network, delocalization speed, playback and pings. A ping is used in initialization sequencing; this does **not** demonstrate a firmware host-loss watchdog. |
| Off-road/recovery | `ProcessDelocalizationUpdate(float)` `0071e190`; `CheckBSDelocalizationThreshold` `0071e370`; `SendSkipAutoDriveInDeloc` `007b9000`; `SendSetMaxDelocSpeed` `007b8d48` | App invalidates localization, updates history/state and may enqueue a localization action. Slipstream deliberately uses a shared latched pit stop and explicit recovery. These commands do not prove stopping after browser death. Exact recovered float arguments remain uncertain. |
| Localization | Position `0071bdd8`, transition `0071c678`, intersection `0071cd28`, offset `0071d16c` | Original engine has richer history, network and correction logic. Slipstream's single-car mapper/localizer is a simplified implementation, not a faithful port. Repeated codes, direction, unknown pieces and freshness need independent tests. |
| Track building | `TrackMapper::AddNewCodeEntry` `0089ee5c`, `SetLatestLocalizationInfo` `0089ee90`, `MasterTrackHistory::HandleUnknownEntries` `00892ccc` | Histories are associated with VehicleId; missing codes require explicit handling. Geometric closure alone does not certify a layout or distinguish every repeated physical piece. |
| Weapons and AI | `AIItemUseBrain::Update` `00715f3c`, `UpdateItemUsage` `00715fa8`; `ItemSpeedController::Update` `007e2634`; `Planner::PopulateVehicleLaneSpeedPlan` `00758be8` | App separates use conditions, energy and physical speed/lane plans. Our simpler bots and game effects are original approximations using extracted configuration, not behaviorally equivalent native code. |
| Previously unnamed telemetry | Collision `006b6fc8`, jump `006b6214` ToString plus serializers | Collision booleans mean side-on/front-back; jump fields mean launch speed/jump failed. Added named fields, preserving old aliases. |

## Independent example-code cross-check

These are targeted protocol, transport and control-path reviews, not a claim to have audited every line or dependency of eight repositories. Sources were inspected without running their motor-control examples. Public availability does not grant a copying license.

| Source | Useful corroboration | Defect or boundary found |
|---|---|---|
| Official `anki/drive-sdk` | Compiled byte oracle for twelve classic commands | SDK and native app use differing signedness descriptions in some telemetry; Slipstream supports bounded positive drive speeds. |
| `Leicas/overdrive-arena` | External x52 lap fixture decoded: 15 transitions, 29 positions, one status, no decoder failures | Transition bytes 12–13 are drift/activity in SDK/native code, not desired speed. A third party's reported real trace is not our hardware validation. |
| `dschwen/OpenOverdrive` | Kotlin classic framing; serialized BLE operations; capability-dependent writes | V4 speed framing is separate; do not assume firmware compatibility from model names. |
| `jtg-code/anki-overdrive-windows-sdk` | Discovery and command examples | Ping/disconnect extra payload, synchronous sleeps and a busy loop are not patterns to adopt in the browser. |
| `praneet22/Anki-Overdrive-Python` | Legacy bluepy framing | Lane command omits the two trailing classic SDK fields. Legacy examples are not a universal oracle. |
| `andy008/AnkiOverDriveJS` | Browser UUID and command examples | Automatic 1000 mm/s example movement, notification setup not awaited, and single-byte battery/version reads should not be copied. |
| `gravesjohnr/AnkiNodeDrive` | Little-endian speed/lane serialization | Exact equality on parsing flags is weaker than testing the relevant flag bit. |
| `MasterAirscrachDev/Anki-Partydrive` | Targeted `CarSystem.cs`/`Protocol.cs`: 12-byte lane, 32-bit version, collision/jump meanings | Separate V4 speed variant; restoring remembered motion/reissuing speed on an off-track update conflicts with our latched-stop design. |

REA's useful ideas and deployment limitations are separately assessed in [REA-REVIEW.md](REA-REVIEW.md). Its runtime was not installed into the game.

## Repairs and verification contracts

- A short version reply no longer aborts decoding of subsequent off-road notifications in the same batch. Non-finite position offsets are rejected.
- Unknown pieces use wheel inference when available and retain inferred provenance; rounds refuse inferred maps. Saved plans reject malformed, oversized and unsupported sections.
- Startless mapping retains two candidate laps, supporting the configured 64-section limit. Scan completion no longer invents a starting location before a real code arrives.
- Unknown location codes and observations older than two seconds cannot authorize targeting. This conservative window also expires stopped-car evidence; drawing may retain a tentative pose while targets and scoring wait for new observations. It needs tuning against real low-speed traces.
- Parked/disconnected cars cannot be opponents; shields resolve before attacks regardless of join order. Crew mates cannot damage or target each other; CPU targeting respects crews. Assists require a recent contribution to the same opponent and survive a paused game clock. Removing a car clears its mines and associated effect references.
- A plan builder supports known section IDs, reverse orientation, closure feedback and simulation. A design is not a measured physical map. Elevated crossings, collisions, jump feasibility and connector clearance are not verified by this 2D closure check.

`verification.test.mjs` exhaustively checks **22,620 discrete association states** for one through four cars: three crew assignments × participation × connection per car, with identically named/modelled cars. It also checks every extracted location-code direction transform, built-in plan round trips, sampled lane-pose symmetry, 4/32/33/64-section startless loops, stale/invalid localization, shield order and paused crew assists. Existing suites cover parser/relay security, motion ceilings, pit recovery, mixed human/CPU rounds and phone controls.

These are bounded exhaustive checks and regression tests, **not a formal proof of all software or physical elements**. Continuous dynamics, radio loss, browser death, firmware, motor braking distance, optical misreads, real multi-car association and phone sensor orientation remain outside the verified model. Do not upgrade those claims based on a green test suite. The next hardware acceptance work must measure those behaviors and retain trace fixtures; host-loss stopping remains the highest-priority unresolved safety claim.

Final validation: 405 Node tests and 38 Python tests pass; `npm audit --audit-level=low` reports zero vulnerabilities. A browser walkthrough verified custom-layout loading, crew selection and the medium-width scrolling repair. No hardware was exercised.
