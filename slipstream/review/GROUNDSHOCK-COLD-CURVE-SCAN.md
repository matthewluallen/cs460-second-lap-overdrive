# Cold scan failed before optical acquisition — 18 November 2026

## Latest physical comparison: plastic setting did not restore acquisition

The explicitly authorized `a79c006` comparison sent `03 45 00 00` at 119 ms, its ping at 120 ms, received pong at 262 ms, and then completed version/startup while stopped. The car remained in SDK mode. Refreshed battery was approximately 3.98 V. The subsequent 300 mm/s scan received **zero optical positions and zero transitions**; the first-telemetry watchdog sent STOP at 77210 ms, 5040 ms after the positive command. No offset, lane, turn, `0x35` or `0x37` command was added. The operator reported **“it spun immediately”**, then explicitly confirmed **powered off and stationary**. No map or forward laps completed.

Original 38-event recording: [`groundshock-sdk-plastic-comparison-spin.json`](../fixtures/groundshock-sdk-plastic-comparison-spin.json), recorded from `2026-11-18T18:23:57.902Z`, SHA-256 `c415a3f6ef8be14abddb38aed046c6a3f79fc67f294827620f069f2292550855`, zero drops. Initial unknown-model metadata is retained; Groundshock is operator-identified. No credentials are present. Communication sequence completion was observed while connected; the final diagnostics correctly clear that live status after disconnection. The raw sequence remains the historical evidence.

The first STOP response reported desired zero with an actual field of 117 mm/s. This does not prove eventual stopping; the operator's power-off confirmation establishes the final physical state. Later host STOP requests are retained. The configuration comparison therefore **did not repair this observed failure**. Its pong is not firmware settings readback, so this is not proof of the internal parser state or its causal relevance. Default SDK remains unchanged. Do not repeat the same Groundshock comparison; a different charged car or a verified original-app comparison is now more discriminating than another identical run.

The operator subsequently requested instructions for connecting and driving independently. No further motion was requested; use the normal Classic SDK / On-screen controls / Free drive route only after a successful scan and normal observed following. The experimental parser option is not promoted to the default.

## Follow-up on `c39567c`: orderly startup, same missing optical data

The next authorized SDK scan again failed. The operator confirmed **“stopped now, moved forward to next curve track and then got midway through and spun.”** Groundshock was subsequently disconnected while physically stopped. No forward-lap run started.

The unchanged 30-event export is [`groundshock-sdk-ordered-start-curve-spin.json`](../fixtures/groundshock-sdk-ordered-start-curve-spin.json), recorded from `2026-11-18T18:15:02.799Z`, SHA-256 `f75f5ed28066ee0b01f9d5a08597c45879fe41dbd357f72ee610a633ca44386c`. It contains zero dropped events, firmware 11866, initial battery 4067 mV and refreshed battery 4043 mV. Initial unknown-model metadata is retained; the operator identified Groundshock. No credentials are present.

Startup now follows STOP → SDK → ping/pong → version without incidental game-loop STOP writes. The only positive command is the same 300 mm/s packet, at 40570 ms. There are **zero optical positions**. One transition at 41793 ms reports unknown offset 654321 and wheel distances 24/25 cm. Watchdog STOP completes at 43805 ms, 2012 ms after the transition, and a zero-speed response arrives at 43864 ms. No offset, lane, turn, recovery-policy or `0x45` command was sent. Balanced wheel readings up to that transition do not contradict the operator's later mid-curve spin.

This establishes that removing startup interleaving was insufficient to restore optical acquisition. It does not identify the physical cause. Exact replay expectations retain zero positions, one transition and no invented map/localizer.

## Explicit plastic-track comparison

The new **Classic SDK · plastic-track comparison** connection option retains SDK mode but adds exactly one configuration phase after its initial pong: `03 45 00 00`, then ping/pong, then the existing version/completion sequence. It explicitly selects plastic parsing and turns off autonomous jump-code boosts. The normal Classic SDK option is unchanged. Selecting the option or completing initialization does not request motion.

The phase must receive its pong after its own ping enters the transport; a reply received while configuration is still queued cannot complete it. A missing reply fails initialization. Diagnostics distinguish the requested option and completed communication sequence; `firmwareApplied` stays null because pong is not settings readback. STOP priority, all motion guards, the scan ceiling and watchdogs remain unchanged. No `0x35`, guessed offset, lane request or recovery change is bundled with this comparison.

This remains a hypothesis test until the next physical recording shows actual optical acquisition and the operator confirms normal movement. Reconnect once with this explicitly selected option, preserve initialization in the recording, and keep the existing scan-to-forward progression conditional on a successful map and observed normal driving. An acquisition failure or further spin ends this attempt.

Build checkpoint: **745/745 Node tests pass** on Node 22.23.5 and 25.6.1 (734 before this follow-up). New coverage comprises eight configuration-phase checks, two host connection/selection checks and one retained failed-trace check. The complete host suite passes 102 tests; default SDK/F&F packet phases are explicitly checked unchanged. No physical parser-comparison result is implied by these tests.

## Earlier cold-start capture

**Hardware acceptance failed. Groundshock is powered off.** On build `5f3ebbf`, the operator reported that the car spun off immediately after entering a new segment, then confirmed: **“Powered off; entered a curve.”** This was the normal SDK scan, not the new three-lap forward baseline. The scan did not identify a map, so the conditional forward baseline was never started. Do not repeat the unchanged scan or proceed to lanes/races from this result.

## Recording and physical observations

The operator had confirmed charged, power-cycled readiness on a clear track and selected Groundshock. The host used Classic SDK mode, a 300 mm/s ceiling and no experimental starting calibration. Recording began at connection, retaining SDK initialization, ping/version replies, battery status, the scan, STOP requests and disconnection. No native app or firmware was executed for the offline analysis.

The unmodified final export is [`groundshock-sdk-cold-curve-scan-no-position.json`](../fixtures/groundshock-sdk-cold-curve-scan-no-position.json), recorded from `2026-11-18T17:46:46.235Z`, containing 42 events and zero dropped events/markers. SHA-256: `8ffa6240c75eae7a2fb8300cefe46b2888127edbdb97d4f457bda43dae9c2c03`. It preserves the earlier 38-event export exactly and adds later traffic. The fixture was reviewed for credentials; no host/player credentials or proprietary binary content are included.

Initial recorder metadata says `Unidentified car`, model 0, firmware 11866, profile `sdk`. Groundshock identity comes from the operator, not a model identification decoded from these packets. The later diagnostics/operator notes preserve that distinction. The battery reply was **4106 mV**; that is a reported sample, not a load test. [Stopped/disconnected controller capture](evidence/groundshock-cold-curve-scan-stopped.jpg).

## What the bytes establish

| Evidence | Result |
|---|---|
| Initialization | SDK `03 90 01 01`, successful pong, version 11866, battery reply; no failed write recorded. |
| Positive speed | Exactly one `06 24 2c 01 e8 03 00`, requested 300 mm/s at 25104 ms. Byte-identical to the accepted scan. |
| Printed positions | **Zero raw `0x27` frames**, not merely positions rejected by the decoder. |
| Initial transitions | At 26431, 27391 and 27481 ms; all contain unknown-range offsets: 654321, 654195, 654195. They do not identify the physical curve. |
| Host lateral/recovery commands | No `0x25`, `0x2c`, `0x32`, `0x34`, `0x35` or `0x37` writes. No host lane request, offset correction, turn or recovery-policy change preceded the departure. |
| Telemetry stop | Watchdog marker at 29503 ms, **2022 ms after the last transition**. STOP writes completed at 29504 ms. The five-second first-telemetry and two-second gap defaults were unchanged. |
| Speed response | Zero-speed response at 29551 ms, 47 ms after the first recorded STOP completion. This is not a measured physical braking time. |
| Late traffic | A fourth transition at 121177 ms, offset 654231, followed by the existing STOP-not-confirmed alarm and repeated STOP. No later positive-speed command. |
| Physical outcome | Operator observed spin/departure entering a curve, then confirmed power-off. No three-lap or map acceptance. |

The fourth transition arrived 91.673 seconds after the first STOP during the later handling/power-off period. It does not prove sustained motor activity; neither its activity byte nor the preceding speed report establishes that. The alarm remains appropriate as an unresolved host observation. Bluetooth disconnected after the power-off report.

There was no off-road `0x2b`, recovery-entry `0x43` or lane-cancellation `0x41` notification in this capture. The status flag remained `onTrack: true` during the initial traffic. **That flag cannot override the operator's observed departure.** Raw collision-family notifications also occurred before motion; they are not independent confirmation of physical impacts.

## Native and successful-scan comparison

Fresh static inspection of `CarMsgRoadPieceTransitionUpdate`'s decoding constructor (`006b4290`) and `Localization::ProcessTransitionBarUpdate` (`0071c660`) in the exact-hash F&F library confirms the transition fields used by the decoder. Received/executed lane IDs are bytes 8/9; follow-line drift and lane-change activity are bytes 12/13; the final wheel-distance fields are bytes 16/17. See [the native artifact provenance and tool limitations](FORWARD-BASELINE-NATIVE-NOTES.md).

The first three wheel-distance pairs are **24/28, 7/37 and 0/21 cm**. These are asymmetric firmware reports consistent with the observed spin, not calibrated physical measurements or a diagnosis of a motor, tire or sensor fault. The activity byte also occurs in the accepted scan without a host lane request, so it does not prove that Slipstream requested steering.

The [accepted repaired scan](SCAN-START-REGRESSION.md) received its first printed code, piece 33/code 5, **818 ms after the positive-speed write**, then sent a single optically grounded −22.5 mm reference correction. This failed attempt never received an optical code that could authorize that correction. It therefore does not exercise the recent curve-coordinate or optical-calibration changes, or the forward-baseline controller.

Initialization content matches the accepted scan. The observable order difference is one extra zero-speed write: accepted `SDK → ping → zero-speed`, failed `SDK → zero-speed → ping`. Both completed the reply barriers. SDK-to-positive-speed intervals were 22.318 and 25.061 seconds respectively; no reviewed evidence establishes that difference as causal.

## Configuration lead: plastic versus vinyl parsing

The pinned public SDK documents experimental `SET_CONFIG_PARAMS` (`0x45`) with a track-material field that changes scan parsing/code interpretation. Plastic is enum value 0 and vinyl is 1. The SDK example's ordinary connection does not set this field, and neither does Slipstream's SDK profile. Slipstream's app profile does. This is a **configuration-parity question, not a proven missing SDK prerequisite**. [Official header](https://github.com/anki/drive-sdk/blob/410352617b8660338746a6bb2b2dd173afb1b91a/include/ankidrive/protocol.h), [official serializer](https://github.com/anki/drive-sdk/blob/410352617b8660338746a6bb2b2dd173afb1b91a/src/protocol.c), [connection example](https://github.com/anki/drive-sdk/blob/410352617b8660338746a6bb2b2dd173afb1b91a/examples/vehicle-tool/vehicle_cmd.c).

Compiling that unmodified C serializer independently produced:

| Inputs | Packet |
|---|---|
| Supercode mask 0, plastic | `03 45 00 00` |
| Supercode mask 0, vinyl | `03 45 00 01` |

These cases are retained in `slipstream/tools/sdk_vectors.c` for independent recompilation against that revision. The reviewed SDK source/header SHA-256 values are `ed5c6fadf277d63e60d726623d44e0b9d0134944cb7ba03d1bdc6f29a595e2dc` and `5982fb0f866b7c36fbfbcc8cc8b7adc386ce591fa00310c659ab051faf4e8fcd` respectively.

The native app's initialization phase 5 sets the vinyl argument false (`007aff86`, call `007aff98`). Its other argument comes from vehicle parameters and controls jump-boost-code handling; it is not proven universally zero. The native constructor (`006af598`) places these values in wire bytes 2/3; its named diagnostic formatter (`006af664`) distinguishes them. Thus our existing mask-zero app-profile packet selects plastic and disables autonomous jump-code boosts, but should not be described as the original app's exact vehicle-specific policy.

The SDK and APK do not establish firmware 11866's power-on default, reset behavior or persistence of this configuration. The accepted repaired scan explicitly made no power-cycle claim. An earlier scan had app-profile initialization before SDK, but intervening power cycles prevent assuming that setting persisted into the later success. A controlled comparison must record this state explicitly. No `0x45` packet has been added to the SDK profile or sent to Groundshock in this review.

The original `BeginTrackDetection` (`007b24b0`) also checks its start-delocalized setting, sends `SkipAutoDriveInDeloc(false)`, requests configured speed/acceleration and raises the scan event. Assembly confirms this direct ordering and no direct startup offset/lane write in that function. It does not establish SDK-mode behavior or all downstream event handlers. Do not combine that recovery-policy change with the track-material comparison.

Fresh local native export hashes: configuration `c7de20cf61c698c57901951ad1605e92d15d9a7702b19a5124ac81c53e3fe2a2`; scan entry `27dc74baba6376ba08a66129a36212bc343e81bf3fbde587a5d9a8e951e6bb20`. Raw proprietary exports remain outside Git. No source-supported wheel-imbalance or transition-count trip threshold was found. A separate five-second optical deadline would not have stopped this particular failure earlier than the existing approximately 4.4-second telemetry stop.

## Reproduced host issue and regression scope

Independent review found that the normal game tick could call parked-driver `setSpeed(0)` while `Car.start()` was still waiting for initialization replies. This injected extra zero-speed writes into the declared startup phases, with order depending on scheduling. Both the accepted and failed hardware captures contain such writes: **repairing this is startup hardening, not a demonstrated spin repair**.

Ordinary driver/planner work now waits until initialization finishes. Explicit STOP, the safety-watchdog pass and the shared pit retain their existing priority. Tests reproduce delayed initialization with a live game loop and check that ordinary commands do not interleave while explicit STOP still works.

`cold-scan-trace.test.mjs` retains the hardware evidence as replay regressions: actual SDK startup replies, no invented optical positions/map, the existing telemetry stop, no lateral writes, and STOP-only handling of the late transition. Replay verifies host logic; it cannot reproduce traction, sensing or firmware behavior. The offline trace inspector separately labels commanded-motion intervals and optical acquisition; none of its output claims physical motion or stopping.

## Validation

- Before the initialization repair, **2/4 new initialization tests failed**: extra parked STOP interleaving and CPU planning during setup. After repair, those tests and the related initialization/BLE/safety/watchdog set passed **54/54**.
- Final complete Node suite: **734/734 pass** on both **22.23.5** and **25.6.1**, up from 721. The 13 additions are four initialization tests, five hardware-trace replay checks and four acquisition-report tests.
- The first full run caught a test-suite assumption that any transition-bearing recording must contain a position. The generic fixture replay now has exact expectations for this frozen failure: zero positions, four transitions, no map and no localizer. Other recordings retain their existing checks. The final complete reruns passed.
- The updated SDK-vector helper compiled against the pinned official C implementation; both material-setting vectors match the table above. This executed a host serializer, not an APK, firmware or physical-car operation.
- `git diff --check` passes. Python 38/38, CWE/dependency checks and the zero-vulnerability audit passed in the preceding build verification; this follow-up changes no Python code or dependencies and did not repeat those unchanged checks.

## Next diagnostic, before another circuit run

1. Keep this failed trace as the cold-start reference. Do not send a guessed offset or change recovery mode to make the missing first code disappear in the logs.
2. With power off, inspect the optical window, tire seating/cleanliness, obvious wheel obstructions and the curve seam for a lifted surface. Record observations rather than treating inspection as a diagnosis.
3. Prepare a stationary, explicitly labeled plastic-track configuration comparison using the verified `0x45` vector. Keep mode, speed, offset policy and recovery settings unchanged; a pong can establish request sequencing but cannot prove the firmware applied the material setting. Do not silently turn this hypothesis into a default connection change.
4. The next proposed motion comparison should isolate **first optical acquisition on one ordinary straight** from curve entry: a correctly placed car, initialization recorded from connection, and a supervised bounded acquisition check. It must not proceed onto the curve without fresh code evidence. Prepare a reviewed test mechanism and current physical placement before authorizing motion; the existing scan is not such a segment-bound test.
5. If acquisition still fails, compare a second charged car on the same placement/track, or the original app if available. The original app was previously unavailable; no successful original-app control run is assumed. A fake car can verify host packet/state behavior, not physical sensor reading or firmware compatibility.
6. Resume full mapping only after this acquisition difference is understood. Then require stable forward laps, separate completed left/right maneuvers, speed variation, and finally multi-car races/attacks. These remain hardware-unaccepted.

No new physical motion was performed during this evidence review and startup repair. The car remains powered off; an unchanged retry is not queued.
