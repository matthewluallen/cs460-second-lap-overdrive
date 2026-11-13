# Track discovery, racing, attacks and UI: evidence audit

Reviewed code: 7b1d87d plus the fixes accompanying this report. No physical car was
connected or moved. This is a targeted review of primary sources and retained
artifacts, not a claim to have reviewed all information on the Internet.

## What can be confirmed

| Claim | Finding |
|---|---|
| Automatic track discovery | Implemented. `Game.startScan` drives the selected car after the host countdown; `TrackMapper` consumes position codes/transitions, determines order/direction, anchors on start/finish or repeated sequences, and checks geometric closure. Missing-code wheel inference is explicitly marked. Built-in layouts and reverse traversal pass simulator tests. Successful discovery on the user's actual MXT/Groundshock is still unproven. |
| Ordinary racing | `Lap sprint` supports 2–4 participants for 120 seconds; most complete laps wins. One-car `Beat your best` is 90 seconds. The actual browser exposed a scoring clock bug missed by fixed-clock tests; repaired in this pass with a failing advancing-clock reproduction. |
| Racing with attacks | `Battle rush` implements moving cars, virtual weapons, energy, disables/recovery, targeting and alliances. It awards 100 points per knockout and 25 per assist/lap. This is a battle-score competition, NOT a first-to-N-laps race with weapons. Ordinary Lap sprint does not enable weapons. Physical targeting remains dependent on validated localization. |
| Amazing UI | Not an objective or established fact. The current desktop view has a cohesive dark palette, prominent STOP, resizable columns and original 3D circuit rendering. It is still crowded: driver controls fall below the fold at 1280×720, diagnostics compete with gameplay, and initial countdown wording is generic. Mobile/iPad usability needs real-device testing. |

## SDK and APK comparison

Re-read the retained official SDK's `include/ankidrive/protocol.h`: position message
0x27 contains road-piece ID and code ID; transition 0x29 contains network indices
and wheel travel. These are distinct identifiers. The SDK explicitly describes
itself as a limited protocol subset, not a complete OVERDRIVE game engine:
https://github.com/anki/drive-sdk

Rechecked the retained F&F build 403 native library hash:
`0eef63a8135f4cfe7bb16b4effa1f720192cc2c1f340d0c8c8f0c2b9835f3d7f`.
Re-read its existing Ghidra exports for `TrackMapper::BuildRoadNetworkDefWithStringMatching`
(0089eb34) and `TrackMapper::BuildNetwork` (0089f2d4). They show code-history segment
matching, unknown trimming, loop closure, road-network construction and subsequent
vehicle-network initialization. This supports automated discovery as the original
app architecture. Our smaller mapper is not a formally equivalent reconstruction.
This pass did not execute the APK/firmware or claim a fresh whole-app decompilation.
Prior Ghidra/JADX findings and byte-level startup tests remain relevant; none proves
firmware behavior on the user's hardware.

Public cross-checks include Partydrive (Unity interface and scanning),
OpenOverdrive's protocol/design notes, and the sources pinned in
COMMUNITY-PROTOCOL-REVIEW.md. Their implementation claims do not validate ours:
- https://github.com/MasterAirscrachDev/Anki-Partydrive
- https://github.com/dschwen/OpenOverdrive/blob/main/DESIGN.md

Vendor scanning guidance recommends a basic oval for troubleshooting and notes
that larger vehicles may struggle on certain special/elevated layouts:
https://support.anki.bot/article/268-detecting-and-connecting-to-vehicles
The vendor explicitly states that OverDrive 2.6 does not support F&F Power Zone.
That is a warning against assuming interchangeability, not proof that our mapper
supports it. Pieces 53/54/57 remain quarantined:
https://support.anki.bot/article/329-overdrive-2-6-frequently-asked-questions

## Browser finding and repair

The local current-build browser demo visibly drove cars but produced zero round
laps. `world.step` emits telemetry synchronously with fresh timestamps. The host
previously captured `now` before that step, so localization correctly rejected the
new samples as future-dated when scoring. The fixed-clock harness hid this ordering.

A new default-speed two-CPU Lap sprint regression advances the clock between reads.
Before repair it fails with both cars scoring zero; after repair it must produce
laps for both drivers and stop at the deadline. The host now samples after telemetry
for control/scoring. Position freshness, watchdog thresholds and rearming are not
weakened. The ordinary-race scoreboard now shows best/last lap times; battle retains
knockouts/losses and objective modes retain points/tasks.

## Deployment finding

A real Codespace shutdown/resume exposed an unresolved deployment failure: the
running Alpine environment lost Node and its previous home-directory runtime/log
state. This is not the configured Node 22 Debian devcontainer. Reinstalled official
Alpine Node/npm to recover the service, started the managed server with private
state in `/workspaces/.slipstream-managed`, and restored the authorized public port.
The host code was regenerated because the previous private state was absent; the
new code is only in that private directory. Old rooms were already lost on shutdown.
The URL again returned HTTP 200. Do not describe this manual recovery as successful
automatic restart or a tested devcontainer rebuild. That was the initial failure; subsequent acceptance is recorded below.

## Remaining release gates

1. Successfully scan an ordinary physical loop with usable position telemetry;
   verify piece order, direction, closure and observed stop against the real track.
2. Validate steering and stop behavior, then 2–4 concurrent Bluetooth cars and
   human/CPU combinations; retain existing telemetry watchdogs and shared pit.
3. Verify phone/iPad join, neutral recovery, sensors and haptic fallback on devices.
4. Validate battle hit geometry on actual localization and confirm the desired
   rules if a lap-winning race with attacks is required instead of Battle rush.
5. Simplify the playing view; retain deployment restart regression checks.

Validation after repair: **537 Node tests pass**. In the actual browser, the corrected
Lap sprint showed Boson at 7 laps and BigBang at 6 laps with finite lap times at the
captured observation. This is browser/simulator evidence, not a physical-car race.

Browser race completion: the corrected 120-second Lap sprint ended automatically
with Boson at **8 laps**, BigBang at **7 laps**, a winner, lap times and both
simulated cars stopped. The original pre-fix browser battle was observed moving
and associating a target but did not show a knockout. Additional exploratory
all-CPU default-loadout battle checks also produced no knockout; a guaranteed
knockout is not currently a game rule, and the temporary assertion was not retained
as a required regression. Directed weapon/disable/recovery and four-bot battle
regressions pass. Default two-car battle pacing therefore still needs a fun/feedback
review; do not turn weapon implementation coverage into a claim that every matchup
is engaging or that physical targeting is validated.

## Deployment repair acceptance

The configured Debian/Node container was rebuilt with persistent private state and
the official SSH feature (`c88a504`). Node reports v22.16.0. A private checksum check
confirmed that the host code survived both rebuild and subsequent shutdown/resume.
The server started automatically in live mode, with a new boot ID after each cycle.
The first check immediately after SSH became available preceded application startup;
a subsequent readiness check succeeded without manually launching the server.
After rebuild, four approved clients passed input, state and revocation checks via
both WebSocket and forced HTTP through the public HTTPS proxy; temporary rooms
were removed. This verifies deployment and relay behavior, not BLE or phone sensors.

GitHub reset forwarded port 3000 to private during shutdown/resume. Restored the
user-authorized public visibility. Automatic server startup is verified; persistent
public forwarding is not. Check visibility before sharing the classroom QR code.
