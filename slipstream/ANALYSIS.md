# The original Android app: what Slipstream is built on

Analysed 12 November 2026 to rebuild browser control of the cars. This is the one
file that names the third-party products involved, because it has to say what was
examined. Slipstream itself is independent of them.

## What was examined

- **Package:** `Overdrive.zip` from Digital Dream Labs' own asset host
  (`assets.anki.bot/anki-apks/Overdrive.zip`, linked from their support article
  "Download the Drive & OVERDRIVE Android APKs"). It contains `1502.apk`
  (OVERDRIVE 3.4.0, build 1502) and two OBB expansion files.
- **APK SHA-256:** `b38cfb62e99b7d530f8a58da74cf6ba3cd62c88a426707e3022cdbb05ab97155`
- **Tool:** Ghidra 12.2 headless on `lib/armeabi-v7a/libDriveEngine.so`
  (15.5 MB, 32-bit ARM, SHA-256 `88bbb08b…5887778`). Auto-analysis took 11 minutes.

Nothing from the app is redistributed here: no code, art, audio or text. The JSON
tables under `data/` are numeric measurements and gameplay parameters derived by
`tools/extract_config.py`, which you can re-run against your own copy of the OBB.

To re-derive the tables yourself, unzip the main OBB and run
`python3 -I tools/extract_config.py <unzipped>/assets/rams/overdrive/basestation/config data`.

## Structure of the app

| Library | Role |
|---|---|
| `libunity.so`, `libmono.so` | Unity front end: menus, 3D garage, HUD |
| `libDriveEngine.so` | The game: all car communication, track mapping, AI and weapons, in C++ |
| `libDAS.so` | Analytics |

The engine library keeps its C++ symbol names (about 20,000 non-library functions),
so its design is readable directly. The main namespaces are `BaseStation` (cars,
track, game rules; 7,570 functions) and `Anki::DriveEngine` (services and the
interface to the Unity layer).

Classes that matter for control:

- `CarComms`, `CarMsg*` (about 70 classes): one class per Bluetooth message, each with
  a byte parser and a `GetBytes` serialiser.
- `VehicleMessenger`: one `Send…` method per command.
- `Localization`, `TrackMapper`, `MasterTrackHistory`, `RoadNetworkDefBuilder`,
  `RoadPiece`: track scanning and car position.
- `EnergySystem`, `VehicleItem*`, `ItemSpeedController`, `SpecialAbilityItem`:
  weapons and damage.
- `VehicleAIComponent`, `AIItemUseBrain`, `LocalPlanner` (555 functions): computer
  drivers.

## Findings used in this project

1. **The public SDK layouts are what the app sends.** `CarMsgSetVehicleSpeed::GetBytes`
   packs 7 bytes (size, id, int16 speed, int16 acceleration, flag) and
   `CarMsgChangeLane::GetBytes` packs 12 (size, id, two uint16, float offset, two
   bytes). These match `drive-sdk/protocol.h` exactly, as do ping, version, battery,
   lights, offset and turn.
2. **Message catalogue.** `CarComms::CreateMessageFromBuffer` is a switch on the id
   byte. It gives the full table below, including messages the SDK never documented.
   This project decodes four of them: speed update `0x36`, status `0x3f`, collision
   `0x4d` and jump result `0x4e`.
3. **`0x2b` means "car off road"**, not just "delocalised" as the SDK names it.
4. **The app does not use SDK mode.** It uploads the whole road network to each car
   (`SetRoadPieceInfoC/X`, `SetRoadNetworkInfo/Meta`, ids `0x46`–`0x49`) and the
   car then drives itself between commands. This project uses SDK mode (`0x90`)
   instead, which is documented, simpler, and leaves steering decisions to the host.
5. **Track pieces are data, not code.** The main OBB holds one definition file per
   piece under `basestation/config/modularRoadPieceDefinitionFiles/racing/`. Each
   lists the piece's connector poses and the exact pose of every printed location
   code. From these come the piece lengths (560 mm straights, 280 mm curve radius,
   start 340 + finish 220), and for each location id the lane offset and distance
   along the piece. That is what makes exact lane positions and layout drawing possible.
6. **Every curve is defined as a left turn** in the direction its codes are read, so
   the "reverse parsing" flag in a position update tells left from right.
7. **Weapons are data too.** `gameData/items.json` defines 14 item types and 225
   items; `vehicleTypes.json` maps each of 21 car models to its default items and
   gives the energy system (10 energy, 1.5 per second recharge, 2 second recovery).
   `battle.mjs` implements each type with those numbers.
8. **Scanning in the app** (`TrackMapper`, `MasterTrackHistory`) collects code
   entries from all cars, matches repeated sequences to find the loop, substitutes
   pieces whose code was missed using wheel encoders, and handles jumps and start
   pieces specially. The mapper here follows the same outline with one car.

## Message ids

"Bytes on the wire" includes the leading size byte. Sizes come from each class's
`GetBytes`. `0x90` (SDK mode) is absent because the app never sends it.

| Id | App class | Bytes on the wire | In public SDK | Used here |
|---|---|---|---|---|
| `0x15` | NodeJoined | varies | no |  |
| `0x16` | PingRequest | 2 | yes | yes |
| `0x17` | PingResponse | 2 | yes | yes |
| `0x18` | VersionRequest | 2 | yes | yes |
| `0x19` | VersionInfo1 | 6 | yes | yes |
| `0x1a` | BatteryVoltageRequest | 2 | yes | yes |
| `0x1b` | BatteryVoltageResponse | 4 | yes | yes |
| `0x1d` | SimpleLights | 3 | yes | yes |
| `0x1f` | SetSystemState | 3 | no |  |
| `0x21` | ClearRoadNetwork | 2 | no |  |
| `0x22` | SetCarMode | 3 | no |  |
| `0x23` | CarInitComplete | 4 | no |  |
| `0x24` | SetVehicleSpeed | 7 | yes | yes |
| `0x25` | ChangeLane | 12 | yes | yes |
| `0x26` | CancelLaneChange | 2 | yes | yes |
| `0x27` | PositionUpdate | 17 | yes | yes |
| `0x29` | RoadPieceTransitionUpdate | 18 | yes | yes |
| `0x2a` | IntersectionPositionUpdate | 13 | yes | yes |
| `0x2b` | CarOffRoad | 2 | yes | yes |
| `0x2c` | SetOffsetFromRoadCenter | 6 | yes | yes |
| `0x2d` | OffsetFromRoadCenterUpdate | 7 | yes | yes |
| `0x2e` | SetRoadPieceIndex | 5 | no |  |
| `0x2f` | ClearPlaybackSequences | 2 | no |  |
| `0x30` | SetPlaybackAction | 20 | no |  |
| `0x31` | StartStopPlaybackAction | 4 | no |  |
| `0x32` | OpenLoopTurn | 4 | yes | yes |
| `0x33` | SetDefaultLights | 18 | yes | yes |
| `0x34` | SetOffsetFromRoadCenterAdjustment | 6 | no |  |
| `0x35` | SkipAutoDriveInDeloc | 3 | no |  |
| `0x36` | SpeedUpdate | 8 | no | yes |
| `0x37` | SetMaxDelocSpeed | 4 | no |  |
| `0x38` | ReadFlashRequest | 3 | no |  |
| `0x39` | ReadFlashResponse | 20 | no |  |
| `0x3b` | WriteFlashSinglePacket | 20 | no |  |
| `0x3c` | WriteFlashControl | 3 | no |  |
| `0x3d` | WriteFlashMultiPacket | 20 | no |  |
| `0x3e` | WriteFlashResponse | 5 | no |  |
| `0x3f` | StatusUpdate | 6 | no | yes |
| `0x40` | SetTestMode | 3 | no |  |
| `0x41` | LaneChangeUpdate | 15 | no |  |
| `0x42` | MergeReactionUpdate | 13 | no |  |
| `0x43` | DelocAutoRecoveryEntered | 2 | no |  |
| `0x44` | DelocAutoRecoverySuccess | 2 | no |  |
| `0x45` | VehicleSpecificParameters | 4 | yes |  |
| `0x46` | SetRoadPieceInfoC | 20 | no |  |
| `0x47` | SetRoadPieceInfoX | 20 | no |  |
| `0x48` | SetRoadNetworkInfo | 20 | no |  |
| `0x49` | SetRoadNetworkMeta | 9 | no |  |
| `0x4a` | StopOnTransition | 2 | no |  |
| `0x4b` | JumpPieceBoost | 6 | no |  |
| `0x4c` | PlaybackHasStopped | 5 | no |  |
| `0x4d` | CollisionDetected | 4 | no | yes |
| `0x4e` | JumpPieceResult | 5 | no | yes |
| `0x4f` | Supercode | 7 | no |  |
| `0x50` | EnableSpecificV2BMessages | 6 | no |  |
| `0x51` | RoadPieceTransitionUpdate2 | 16 | no |  |
| `0x52` | BarrierCodeDetected | 5 | no |  |
| `0x53` | ZoneFxSupercodeDetected | 7 | no |  |
| `0x86` | CycleOvertime | varies | no | yes |
| `0x87` | TransitionBarExpected | 3 | no |  |
| `0x88` | TransitionBarCycleError | varies | no |  |
| `0x89` | ResetRadio | 2 | no |  |
| `0x8a` | StatsRequest | 4 | no |  |
| `0x8b` | StatsResponse | varies | no |  |
| `0x8c` | StatsReset | 2 | no |  |
| `0x8d` | SetEnabledDASCategory | 3 | no |  |
| `0x8e` | DASEvent | varies | no |  |
| `0x8f` | SDLogging | 7 | no |  |
| `0xcf` | MessageCycleCount | 7 | no |  |
| `0xd0` | SteeringDiagnosticMetrics | 20 | no |  |
| `0xd1` | CustomRoboticsPayload | 20 | no |  |

## Not analysed

- The iOS app, the DRIVE (first generation) app and the Fast & Furious edition app.
- Car firmware. The OBB contains firmware images; none were opened.
- The road-network upload format (`0x46`–`0x49`), which would let cars lane-keep and
  merge on their own as in the original game.
- Playback sequences (`0x2f`–`0x31`), the app's scripted light and motion effects.
- The meaning of the two bytes in the collision message; they are passed through
  undecoded.
