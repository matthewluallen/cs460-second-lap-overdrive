# F&F connection initialization

12 November 2026. This implements an interoperable connection path from the
retained build 403 library (SHA-256
`0eef63a8135f4cfe7bb16b4effa1f720192cc2c1f340d0c8c8f0c2b9835f3d7f`).
It does not reproduce the entire game, licensed assets, or firmware. Hardware
compatibility remains to be checked with startup-inclusive traces.

## Evidence

Fresh `ExportMxtStartup.java` decompilation exported 63/63 selected entries.
`DumpMxtInitialization.java` reads data directly from the analyzed library,
without executing it. Image base is 0x10000. Prior hashes and decompiler limitations
are in `MXT-DECOMPILE-FOLLOWUP.md`.

| Operation | Evidence |
| --- | --- |
| Mode `02 22 01` | Constructor `006b8350`, serializer `006b83d8`, ParseOperatingMode `007a7624`. Resolved string globals identify 0=rc, 1=drone (default), 2=ai. |
| Vehicle settings `03 45 00 00` | Constructor `006af598`; ToString `006af664` identifies obeyJumpBoostCode and isVinylTrack. Both false here: no autonomous jump boost, modular track. |
| Clear network `01 21` | Constructor `006b8928`. |
| Default road info, network and metadata | GetDefaultInfoCMessage `0088abb0`, GetDefaultNetworkMessage `0088abf8`, GetDefaultMetaMessage `0088ac40`. Literal tables at `00e69e90`, `00e69ea8`, `00e69ec0` provide the 20/20/9-byte packets retained in `initialization.mjs`. |
| Delocalized speed limit `03 37 00 00` | Constructor `006ac3d4`, serializer `006ac468`; zero speed is deliberately conservative. |
| Phase ping barriers | ExecutePhase `007aff3c` and Update `007b0080`. A pong proves a subsequent response, not semantic acceptance of every preceding setting. |

The port deliberately differs from the full app: STOP precedes initialization,
SDK override is explicitly disabled for the app path, jump boost is disabled,
delocalized speed is capped to zero, playback assets and analytics/DAS setup are
omitted, and STOP is sent again at completion. No nonzero speed, steering or U-turn
is accepted by Car while initialization is pending. This does not prove a firmware
enforced stop; keep host watchdogs and physical supervision.

The classic SDK option remains separate. It sends the documented SDK enable packet
and waits for ping/version replies, rather than mixing app and SDK operating modes.
Fast & Furious modular kit is the default connection choice for this deployment.
Simulator transports remain deterministic and do not pretend to verify app-mode
firmware semantics.

## Recording and validation

Recording attaches before the first Car.start command, retains version/ping
responses, and includes failures. The UI displays the current initialization phase.
Unknown advertised models remain Unidentified car instead of assuming Groundshock.
The kit profile is operator-selected, not inferred from that label.

Tests cover ordered initialization, no motion during setup, missing acknowledgments,
a STOP latch during initialization, early trace coverage and native-data golden
packets. Full suite: 484 Node tests pass. Prior MXT short-frame replay and existing
fault matrices remain passing. A connected/initialized label does not certify
position telemetry, track mapping or F&F Power Zone compatibility.

The next hardware step is a stationary reconnect and inspection of the new startup
trace, followed by a supervised scan only if initialization succeeds. Do not extend
the two-second telemetry watchdog or 45-second scan budget to conceal failures.

## Live follow-up with startup recording

The deployed profile completed all version/ping stages on both the operator's MXT
(firmware 9511) and replacement Groundshock (11866). This verifies replies, not
semantic acceptance of every setting. Fixtures preserve the two hardware traces:
`mxt-app-init-link-loss.json` and `groundshock-app-init-timeout.json`.

MXT lost Bluetooth about four seconds after scan start; the operator reported the
car turned off and suspected battery depletion. Groundshock returned firmware,
pings, battery and a lane-update message, but no position/transition messages during
the scan. The first-track watchdog stopped it after five seconds. Its displayed
battery was approximately 4.14 V. The UI later logged another Bluetooth disconnect
at 17:36:33, after the recorded scan and STOP. The operator subsequently confirmed
turning the car off to leave; this later disconnect is not an unexplained failure. Its physical motion during the scan
has not yet been confirmed by the operator. No map was completed. Do not claim this
profile fixes localization merely because the initialization replies succeeded.

Subsequent regression: [CAR-COMPATIBILITY-REGRESSION.md](CAR-COMPATIBILITY-REGRESSION.md).
Startup now also requires native 0x23 initialization confirmation; ping alone is
insufficient. The unlocalized-speed bootstrap question remains unresolved.

Operator-approved follow-up: initialization still sets zero delocalized speed,
but an explicit supervised scan now temporarily permits up to 300 mm/s until its
first position or stop. See the compatibility regression report for reset paths
and the unresolved link-loss limitation.
