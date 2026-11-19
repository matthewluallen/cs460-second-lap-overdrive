# Week 4: a programmable Slipstream Power Zone

This feature gives piece **57** an optional, host-owned **whole-piece checkpoint**.
It does not reproduce the original Fast & Furious marked-lane attack. Default is
**Off**. The host explicitly chooses **Charge shield** or **Boost after exit**.
No firmware setting, new command identifier, or track-coordinate value is added.

## What was verified again

The exact F&F build 403 source OBB remains locally available. Re-running
`tools/extract_config.py`'s `piece()` function on
`assets/rams/foxtrot/basestation/config/modularRoadPieceDefinitionFiles/racing/0_7_57.txt`
reproduces every committed geometry/location value for 57: a **560 mm straight
footprint**, with the existing printed-code coordinates. The current extractor
also reports `raw_kind_code`; that additive field does not change the coordinates.
No numeric edit to `data/pieces.json` is warranted.

The retained `groundshock-sdk-repaired-scan.json` already reconstructs the correct
closed 11-section circuit, including 57 with no inferred sections. The operator
confirmed that map and physical stop. During 57, actual SDK notifications report
reverse codes **23 → 22 → 21**, at 25096, 25786, 26416 ms: travel progress
**0.143 → 0.5 → 0.857**, lateral **+22.5 mm**, a 1320 ms crossing. The next ordinary
section is39. A new rule replay proves that these recorded observations satisfy
our checkpoint when replayed as free-driving evidence. The recording itself was
a scan; no Power Zone effect occurred or was physically validated in it.

There is no reproduced piece 57 mapping defect in that evidence. Its brown
presentation previously conflated a recognized geometric section with unverified
native effects. Traversals now carry an explicit `powerZone` label for the UI.
The existing `unverified` flag remains: it still prevents special-piece automatic
calibration and scored rounds. Unscored mapped driving already supports traversing
57, and the custom rule can operate there. Pieces 53 and 54 remain unsupported
special sections; neither is silently renamed or enabled as 57.

## Native behavior and its limits

The earlier [Power Zone audit](POWER-ZONE-AUDIT.md) identifies the original action
as **opponent disabling**, not an automatic speed boost. Source `gameData/zonefx.json`
selects the disabling effect. That complete original targeting/cooldown/immunity
lifecycle is not ported here.

A fresh read-only Ghidra export of `TrackConstants::GetZoneRegionInfo`
(**00898458**) corroborates longitudinal bounds approximately **170–390 mm** and
internal lane-index bands **2–8** or**11–17**, depending on parsing direction.
That is evidence of a marked subregion, not proof of our physical lane-side
interpretation. The original `0x53` supercode path and its hardware emission remain
unaccepted. Our rule neither synthesizes that message nor calls every 57 code an
original-app trigger.

Our deliberately different checkpoint uses **any readable lane across57**. This
avoids guessing which physical side would activate the native attack. The two
observed codes must bracket the central 170–390 mm region, and the car must then
produce a fresh code on the **adjacent ordinary section** in the same direction.
This establishes observed traversal endpoints; it does not prove the exact path
between them or establish equivalence to firmware behavior.

## Rule contract

`power-zone.mjs` exports `POWER_ZONE_MODES`, `POWER_ZONE`, and
`PowerZoneController({pieces, mode:'off'})`. It emits decisions only and imports
no car, transport, browser, or network API.

Call `observe({carId,message,observedAt,now,localization,track,runId,lap,active,moving})`
after the localizer processes the actual notification. `observedAt` is the
original Car receive timestamp. `localization` is `localizer.diagnostics(now)`;
`runId` is the current drive epoch and `lap` is its optical lap count.

Required evidence:

- A closed map without inferred sections; uniquely confirmed, current printed
  code evidence matching the exact message, timestamp, map index and direction.
- Positive requested movement and positive measured position speed. `active`
  must be false during STOP, scanning, pit, setup, diagnostics or degraded telemetry.
- Two different 57 code observations spanning the central region within the
  existing 2000 ms optical freshness limit, followed by a fresh adjacent ordinary
  exit within the same limit. Prediction, transitions and supercodes cannot earn
  an effect. Neither repeated packets nor two cars can share a crossing.
- One opportunity per zone per optical lap in a drive epoch, plus a 3000 ms
  custom-game cooldown. STOP/recovery, a new drive, a map change or a rule change
  discards incomplete evidence. A rejected exit cannot queue an effect for later.

Effects are explicit custom game choices:

| Choice | Decision |
| --- | --- |
| Off | No effect. |
| Charge shield | A 3000 ms virtual shield/charge after the ordinary exit; no motion command. |
| Boost after exit | At most 1000 ms of a requested 75 mm/s addition, only after a fresh ordinary **straight** exit with at least 250 mm remaining. |

The effect object includes `type`, `carId`, `at`, `expiresAt`, `pieceIndex`,
`exitIndex`, `source:'slipstream-custom'`, and `scope:'any-lane'`. Boost also includes
`extraSpeed` and the observed `remainingMm`. Game owns effect application: it must
respect current throttle, the selected maximum, curve/battle/degraded limits,
STOP and every safety latch. An effect cannot arm or restart a car. A cap of 300
with a current request of 300 leaves no boost headroom; that is expected.

## Validation and remaining acceptance

Nine focused module tests cover the actual captured sequence, both directions,
separate cars, duplicate codes, lap suppression, unsupported/special exits,
stale/future/mismatched/ambiguous evidence, STOP/recovery, new-drive invalidation,
and prevention of delayed boosts. Together with existing repaired-scan and
track-validation tests, **15/15 passed on Node 22.23.5** in this pass. Game/Battle
integration has its own validation; this count covers the pure rule and unchanged
map/scoring behavior only.

No physical Power Zone reward trial has occurred. The next supervised check must
record the selected rule, code endpoints, ordinary exit, applied capped effect,
and physical outcome. Native lane-trigger parity, every car model, and effects
with multiple real cars remain open. No APK or firmware was executed.

## Reproducible provenance

- Fresh static export `zone-region-week4.c` (Ghidra 12.1.3) SHA256:
  `e4ba5821ecbe3cbd386a7202fc4a345e10182233348c9f68d1e52c62d4255128`.
- F&F build 403 library SHA256:
  `0eef63a8135f4cfe7bb16b4effa1f720192cc2c1f340d0c8c8f0c2b9835f3d7f`.
- Main OBB SHA256:
  `24861aa707f06eeba958bdee4294ef4d2de63c04a26113b15a6cc9c9a1eb1991`.
- Piece 57 source SHA256:
  `4e0385148c8f92def1228b32022d3e9fcf922cfc93bcc531e71b7e09b350b235`.
- `gameData/zonefx.json` SHA256:
  `55e7e093314ffdb9663a02ce490fd115fe89a81019f5a4e415d1d284c3d346bf`.

Acquisition/authenticity limits remain those in
[the F&F review](FAST-FURIOUS-REVIEW.md). Native exports and source assets stay
outside the repository. The existing Universal announcement URL redirected to an
unavailable page during this pass; no fresh web verification of that historical
announcement is claimed.
