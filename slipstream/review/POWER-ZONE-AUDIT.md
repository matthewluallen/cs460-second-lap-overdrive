# Fast & Furious Power Zone lane review — 13 November 2026

Reviewed code: `48a74e8`. Offline static review only; no car commands, APK or
firmware execution, live reload, or runtime behavior changes.

## What the lane does

The original F&F configuration implements a **nearby-opponent disabling attack**,
not an automatic speed boost for the triggering car. This agrees with
[Universal's original announcement](https://www.universalproductsexperiences.com/news/fast-and-furious-anki-overdrive).
The operator identifies the brown-rendered piece in the scanned circuit as this
physical Power Zone. Brown currently represents special/unverified geometry in
Slipstream; it does not indicate that the attack is implemented.

`gameData/zonefx.json` selects the Foxtrot `Disable` action, `ZFXDisable` item,
one-second cooldown and three-second invulnerability interval. Its disable
sequence is `zfx_disable`. A zero `DisableDuration` is not evidence that the
feature does nothing: the native action also applies a hacked effect, damage,
a vehicle script, and a playback sequence. The configured sequence has an end
action at 1500 ms; that alone does not establish total physical stopping time.

## How the original engine uses it

| Stage | Evidence in this F&F library | Implication |
|---|---|---|
| Identify a bounded region | `TrackConstants::GetZoneRegionInfo`, `00898458` | Native region has longitudinal bounds approximately 0.17–0.39 m and inclusive internal lane indices 2–8 in parsing direction 0, 11–17 otherwise. These are internal micro-lanes, not numbered user-facing lanes. |
| Plan entry | `LocalPlanner::Planner::BeginLocalPlan_handleZoneFx`, `00754800` | Planner checks lane, longitudinal progress and direction, with look-ahead. Merely being anywhere on the piece is insufficient. |
| Read special codes | `CarMsgZoneFxSupercodeDetected`, `006b67a4`; `Localization::ProcessZoneFxUpdate`, `0071dfe0` | Separate `0x53` message exists. Localization accepts codes `0x75f9` and `0x27db` only after checking localization, current piece/index and zone piece type; it adjusts progress using direction and speed. Do not label these as proven physical entry/exit events yet. |
| Suppress repeated activation | `ZoneFxManager::HandleZoneFxSupercode`, `008a2a84` | Feature gate and per-car trigger flag guard dispatch through the current localized piece index. Precise reset timing and the complete receive-handler path still require tracing. |
| Validate and target | `ZoneFxZoneAction::Trigger`, `008a37ec`; `IsValidSourceVehicle`, `008a3920`; `ZoneFxItems::GetTargets`, `008a2100` | Source eligibility, zone cooldown, spatial targeting and per-target protection are separate checks. Do not reduce this to an unconditional speed command. |
| Apply attack | `ZoneFxAction_Disable::Trigger`, `008a3a5c` | Skips same-team vehicles, checks whether hacking is allowed, applies game damage/scripts and starts the disable playback. It iterates targets rather than hard-coding a single nearest opponent. |

`items.json` configures a rectangular targeter with length 0.56, half-width 0.2,
middle anchoring and `single_target: false`. `ZoneFxItems::GetItemPose` (`008a1d80`)
derives the effect pose from the track and region lanes. These configuration
values must not be converted into a blanket radius around the triggering car.
Exact coordinate transforms and immunity names remain to be recovered.

The piece-57 definition describes a 0.56 m straight with 20 micro-lanes spaced
9 mm apart. Region indices correspond to a band on one side and are mirrored
for reverse parsing. This supports direction-aware lane targeting, but does not
validate our present offset correction or physical left/right convention.

AI configuration (`characterItemUseConds_powerZoneFF.json`) explicitly seeks or
avoids the zone according to target separation and driving personality. With
one car there is no opponent to disable. With multiple cars, eligibility, teams,
target geometry and protection matter for both human and computer drivers.
The native autopilot eligibility flag must not be assumed synonymous with our
CPU driver setting without further tracing.

## What our capture and software establish

Re-ran `node slipstream/tools/inspect_trace.mjs
slipstream/fixtures/groundshock-sdk-scan-steering.json`. The successful SDK session
contains piece 57, 56 position messages and 27 transitions, but **zero `0x4f` or
`0x53` supercode messages**. The earlier F&F session also contains none. These are
successive connections to the same Groundshock, not two physical cars.

Slipstream decodes those messages for diagnostics only. It does not implement
the original Power Zone attack lifecycle. No trigger in this capture means we
cannot distinguish a missed active lane from a firmware/profile/message-enable
issue. The cancelled steering command makes lane alignment particularly uncertain.
Do not invent an attack from every piece-57 position message.

## Implementation and acceptance requirements

1. Fix the two reproduced control/trust faults in
   [the SDK/app audit](SDK-APK-APPROACH-AUDIT.md): special-piece data must not
   silently recalibrate the car, and cancelled steering must clear its unachieved
   target before another supervised lane attempt.
2. Finish tracing the `0x53` receiver, notification enabling, trigger reset and
   direction/offset transforms. Keep native findings separate from hardware proof.
3. Capture a deliberate crossing of the marked lane in each direction, recording
   raw notifications, piece index, position, offset and accepted/cancelled lane
   commands. Compare against an adjacent-lane pass. Movement needs a new supervised
   test; no such pass was performed for this review.
4. Implement an explicit host-owned zone event with duplicate suppression,
   cooldown, valid spatial targets, same-team exclusion and repeat-hit protection.
   Scan/pit/stopped/stale-telemetry states cannot activate effects. Effects must
   remain subordinate to every stop/watchdog latch and cannot restart a stopped car.
5. Test one-car no-target behavior and two-to-four-car eligibility before physical
   attack acceptance. Use original UI effects and art. A selectable speed-boost
   variant would be our own game design, not confirmed F&F parity.

Special pieces remain unverified for scoring. The recovered region is useful
implementation evidence, not justification for removing that gate today.

## Reproduction and provenance

F&F build 403 library SHA-256:
`0eef63a8135f4cfe7bb16b4effa1f720192cc2c1f340d0c8c8f0c2b9835f3d7f`.
Artifact acquisition/authenticity limits are in
[FAST-FURIOUS-REVIEW.md](FAST-FURIOUS-REVIEW.md).

Fresh read-only Ghidra 12.2 exports:

- `power-zone-audit.c`: SHA-256
  `c2da67a0c32293b3438e552dff3e8fb4add0eafb1590423c041ed7fad46f00d8`;
  455 exported entries including wrappers/templates, not 455 reviewed behaviors.
- `power-zone-flow.c`: SHA-256
  `8c44d5abd43d12ce73f72482974dcc642ef4d75dc97146411b03c7974e915b3b`;
  10 exported entries. Neither export contains a failed-decompilation marker.

ARM recovered signatures/types are imperfect. Key functions and configuration
were read manually; this is not formal verification. Proprietary exports stay
outside the repository. This documentation-only review reran the trace inspector,
not the full test suite; the prior 548-test result is not a fresh run.

## Repair-pass protocol follow-up

Additional read-only native exports inspected `ResetZoneTrigger` (`008a2a74`):
it clears the per-vehicle trigger flag. Its exact invocation timing is still
unresolved in this export; indirect dispatch prevents claiming a complete call
chain from static reference enumeration alone.

The `0x50` message's named accessors (`006b6bcc` through `006b6bea`) expose four
options: transition-update-v2, steering diagnostics, each barrier code, and cycle
timing statistics. None is named a Power Zone enable switch. This does not prove
that barrier diagnostics cannot affect observations, but there is insufficient
evidence to send guessed notification-enabling flags to the live car.

The repair pass adds bounded live counts for `0x4f` and `0x53`, the last unsigned
code/tag/timestamp, and a map notice explaining why Power Zone attacks are disabled.
These observations issue no commands, supply no position, and never refresh the
track watchdog. This is the evidence collection path for the next supervised
marked-lane/adjacent-lane comparison; it is not an attack implementation.
