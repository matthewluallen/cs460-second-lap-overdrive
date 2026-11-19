# Week 4 classroom feedback and reports — 18 November 2026

Base: `9cb2bff` on `week-4-student-driving`. Browser build: `2026-11-18-week4-classroom`. No merge to main. This update completes the five requested classroom additions without changing car packet layouts, track discovery, speed ceilings or physical stop thresholds.

## Implemented

- **Readiness:** the Student page names the reason Start driving is unavailable, including the particular car waiting for phone approval. Battery/model reminders are observations, not new arming gates.
- **Phone feedback:** selected ramp, commanded/requested speed, bounded telemetry-recovery countdown and Power Zone duration reach the phone. Recovery locks every maneuver while preserving only forward input permitted by the existing selected policy. Old clients should be refreshed along with the host.
- **Run report:** STOP first, open Run report, record future evidence if needed, add an observation, then download plain text or print. Reports separate requested and reported speed, first-reading delay, gaps during positive commanded-speed windows, trailing silence, STOP writes, final settings and controller lap claims. Missing/dropped/malformed data is disclosed. Parked time is excluded from driving-gap statistics. Operator observations remain separately labeled, unverified plain text; no raw packets, room credentials or transport identifiers are included.
- **Screen awake:** host connections and joined phone sessions request a screen wake lock, show its actual status, release it when hidden/disconnected, and offer a retry after denial/release. A browser request cannot guarantee OS uptime or STOP delivery.
- **Sound:** explicit Enable sound, mute, volume and an optional synthesized engine on laptop/phone. Starts off; no proprietary audio or car-speaker command. Feedback fades on stale/hidden/stopped/disconnected state, with an audio-thread freshness deadline and bounded voices. No audio was played during browser QA.

## Reproduced integration faults repaired

1. A phone's neutral steering value could be treated as a request for absolute center. Explicit `steeringActive:false` now means hold the present lane, and the host clears any retained lane target to `null`.
2. A delayed pre-recovery neutral message could unlock steering, or a delayed old gesture could return after a newer neutral acknowledgment. A bounded per-seat recovery ID now advances when a new telemetry recovery is observed. Both the release acknowledgment and every later maneuver require that current ID. The phone discards held steering when the ID changes, including when it missed the degraded-state frame. Recovery does not itself reapply a gesture. Throttle arming/dead-man rules remain separate.

Regressions exercise delayed and consecutive recoveries, lost/stale phone updates, an acknowledgment received during active grace, ordinary legacy input before any recovery, and attack/support/special/cycle/U-turn gating. The recovery ID is freshness bookkeeping inside an already approved seat, not a new authentication credential.

## Validation

Environment: Node **22.23.5**, npm **11.9.0**, Python **3.14.7**. Baseline recorded at `9cb2bff`: **886 Node tests**. Final: **917/917 Node**, **38/38 Python**, CWE regression checks and dependency lab pass; npm audit reports **0 vulnerabilities**. No dependencies added. `git diff --check` clean.

Key new regressions:

- `readiness.test.mjs`: all existing host gates and per-car explanation; no extra model/battery arming rule.
- `host.test.mjs`: four-car bounded phone state, delayed steering replay/recovery epochs, and stopped-only report generation/recording.
- `pad-student.test.mjs`: maneuver lock, forward-hold preservation, timeout release, explicit new gesture after recovery, bounded status and optional media integration.
- `run-report.test.mjs`: retained Guardian evidence (maximum active-window optical gap **1290 ms**, excluding the long parked interval), independent cars, silent/unfinished windows, clock discontinuities, malformed records, missing evidence and secret exclusion.
- `client-comfort.test.mjs`: eight denial/race/lifecycle/freshness/voice-budget checks using fake browser APIs; this is not iOS/Android audio acceptance.
- `platform/slipstream-relay.test.mjs`: strict optional intent/ID forwarding, four public browser modules return 200 with security/no-store headers, test modules return 404.

Browser QA used an isolated local simulator and a real host/phone WebSocket connection. The phone was approved for BigBang only; Start enabled after approval. Two held-drive pulses produced two positive-speed windows and recorded STOP writes on release. The downloaded [simulator report](assets/classroom-simulator-report.txt) contains 28 events, seven optical positions, two closed driving windows totaling 4.28 seconds and a maximum between-position gap of 0.72 seconds. Boson remained at zero. Run report was disabled while driving was enabled and became available after STOP.

The phone at 390 CSS pixels had no horizontal overflow. Sound remained off, engine unchecked, and screen-awake reported an active request. Print-media inspection exposed the full report height rather than its screen scroll region; no physical printer was used. [Readiness](assets/classroom-readiness.png), [phone](assets/classroom-phone.png), and [report](assets/classroom-run-report.png) screenshots are retained. Export timestamps use UTC and therefore show 19 November for the evening of 18 November in Chicago.

## Physical acceptance remains limited

No physical car was connected or commanded in this update. Guardian's earlier 300 mm/s scan, forward, left/right and Computer-round acceptance remains the hardware baseline. Higher speeds, recovery grace, Power Zone effects, real phone driving, multi-car interaction and device-specific sound/haptics still require supervised acceptance. Groundshock remains excluded after its independent Drone Mode spin. Neither these tests nor a report establishes full original-app equivalence or a formal proof of the cyber-physical system.

## Public deployment verified

Implementation commit **`b0b2169`** was pushed and fast-forwarded into the existing Codespace's clean `week-4-student-driving` checkout. The managed live-only server was identified by its saved process, command and boot ID before restart on the existing port 3000. No visibility/access setting changed. The pre-existing missing Git LFS post-merge hook warning did not prevent the fast-forward; the hook was preserved.

Anonymous public preflight passed readiness, controller availability and teaching-route isolation. All four new browser modules returned **200/no-store**; the three new test modules returned **404**. The served application contains the expected classroom build identifier. Browser verification showed the readiness instructions, Sound & screen and Run report, **STOPPED**, **0 / 4 cars**, and no warning/error console entries. Host and phone simulator layouts were also checked at 390 CSS pixels without horizontal overflow. Local simulator tabs/server were closed after testing.

Refresh any already-open host and phone pages before reconnecting. [Public deployment screenshot](assets/classroom-public.png). This deployment check did not create a live car connection or establish classroom-network/hardware acceptance.
