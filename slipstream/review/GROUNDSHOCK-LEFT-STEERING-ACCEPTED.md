# Groundshock left steering accepted on one supervised trial

On 13 November 2026 at approximately 10:49 America/Chicago, the operator confirmed **“Stopped; clearly shifted left.”** The car was Groundshock, SDK profile, firmware 11866. The loaded browser was build `08fe678`; the later optional bounded steering diagnostic was not loaded or used. This was ordinary on-screen Free drive, requested 300 mm/s, followed by one left request and STOP.

Evidence: `slipstream/fixtures/groundshock-sdk-left-lane-accepted.json`, downloaded as `slipstream-trace-2026-11-13T16-50-08-562Z.json`. The original cumulative recording is retained unchanged. Its operator-notes field describes the earlier scan; this report separately records the subsequent operator confirmation. The final trial is isolated in `accepted-steering-trace.test.mjs`.

| Recorder time (ms) | Evidence |
|---|---|
| 1425409 | Battery reply 3932 mV |
| 1443603 | Requested 300 mm/s |
| 1444700 | First position, piece 39; code-derived lateral −22.5 mm |
| 1444701 | Reference set to +22.5 mm, after the optical reading |
| 1453310 | Straight piece 36, code 32; code-derived lateral −22.5 mm |
| 1453607 | Reference +22.5 mm immediately precedes lane target −22.5 mm, sideways 350 mm/s, command ID 1 |
| 1454540 | 0x41 lane reply, cancellation clear, ID 1 |
| 1455113 | Transition reports received/executed ID 1 |
| 1455784 | Start piece 34 code-derived lateral +31.5 mm |
| 1460841 | Straight piece 39 code-derived lateral +31.5 mm |
| 1462824 | STOP write; no later nonzero speed write in the recording |

The code-derived displacement is +54 mm (positive left). The requested nominal displacement was 45 mm; this does not establish precise target accuracy. The reply immediately after STOP still reports actual speed 312, so physical stopping is supported by the operator's observation, not that packet. No cancellation or off-road/recovery message occurred in this isolated trial. Raw collision notifications were retained as in ordinary driving; they are not confirmation of impact.

This accepts one leftward maneuver and stop on this car and circuit. Rightward steering, repeated autonomous laps, multi-car races, attacks, precise stopping distance and original-app equivalence remain unverified. SDK offset/reference behavior remains a limited implementation, not a complete native planner reconstruction.

## Computer-driver follow-up

The existing race `Bot` is being given a shared track-aware policy: fresh ordinary straight readings allow the selected speed ceiling, with two-thirds elsewhere and approaching the end of a straight. At a 300 mm/s ceiling this is 300/200 mm/s. Automatic lane requests require fresh printed-code localization, positive position-reported speed and at least 250 mm of remaining ordinary straight; transition-only prediction, special sections and stale positions cannot authorize steering. Unscored Computer driving alternates targets ±22.5 mm once per straight encounter. Active rounds retain combat/objective intent within this geometry and speed cap, including boosts. These are Slipstream gameplay rules, not claims of native-app parity or measured stopping clearance. Existing watchdogs, countdown, STOP, pit and Power Zone scoring restrictions remain.

The existing Figure-eight Story algorithm test uses its explicitly labeled simulator-only 10-second telemetry interval and isolates mission scoring from the new production steering policy. The normal controller still blocks these slow intersection missions; this algorithm exercise is not evidence that the production planner can complete them. Capsule mission tests retain the production policy.

Validation of this follow-up: 612 Node tests passed, including three accepted-trace replays and eight track-policy tests. Browser simulation verified the existing Start round countdown and a computer driver running under the new cap. No repeated physical CPU trial has yet run.
