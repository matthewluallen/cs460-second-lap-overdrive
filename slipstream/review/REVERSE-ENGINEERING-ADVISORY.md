# Independent reverse-engineering advisory — 13 November 2026

Three independent AI reviewers inspected source, recorded hardware packets, local official SDK checkout and existing decompiled F&F exports. These are O*NET-informed analytical perspectives, not real professionals, certifications or O*NET endorsement. Roles: embedded/hardware integration, communications software, and software QA/control-systems review. Occupational anchors: [Computer Hardware Engineers](https://www.onetonline.org/link/summary/17-2061.00), [Software Developers](https://www.onetonline.org/link/summary/15-1252.00), [Software Quality Assurance Analysts and Testers](https://www.onetonline.org/link/summary/15-1253.00).

Baseline reviewed: 8868f1b. No reviewer issued hardware commands. Existing native exports were inspected; no fresh APK execution or Ghidra run is claimed.

## Findings and repairs

| Finding | Evidence | Action |
| --- | --- | --- |
| Explicit scan reference overwritten | calibrateScanStart(22.5), then steerTo(22.5) emitted offsets -22.5 then 0 | Preserve operator-derived lateral estimate with provenance; failing regression now passes. Does not invent optical telemetry. |
| Straight diagnostic still calibrated | Real position packet triggered automatic 0x2c despite driver-control exclusion | Suppress calibration, lane and U-turn actions during diagnostic while retaining telemetry. Failing optical-packet regression now passes. |
| Expired motion could start late | Delayed STOP completion before overdue timer callback let queued150 enter transport after500ms | Capture motion deadline and check immediately before transport invocation. Expiry uses existing fail-safe STOP/close. Reproduced ordering regression now passes. Already in-flight writes/browser suspension remain limitations. |
| Negative status aged into permission | lowBattery=true became nonblocking after30s if voltage refreshed | Known charger/low-battery flags remain blocking until explicitly cleared. Regression covers both. |
| Startup notification loss | Fake RX emitted status during startNotifications before Car existed | Buffer up to64 packets of at most512 bytes, drain after recorder attached; overflow rejects initialization. Tests cover exactly-once ordered delivery, overflow and close. |
| Unknown recovery event | First incident RX01 43 at193986, 281ms before off-road | Exact-length0x43/0x44 decoding, counters and timestamp; neither refreshes track watchdog nor resumes driving. |

## Native and SDK evidence

F&F CarMsgDelocAutoRecoveryEntered constructor006ba6c4/serializer006ba6ec use size1/id0x43; 0x44 denotes success. VehicleMessenger::ProcessIncomingMessage007b5310 enables a filter on0x43; on0x44 it clears the filter and calls ExecuteLastDrivingIntention. Host software deliberately does not copy automatic resume behavior. These events do not explain why localization was lost or prove the reported1802 was physical speed. Only the first incident contains recovery entry; the second cumulative recording includes that same event, not a second occurrence.

SDK protocol.h states zero-offset reset supports relative movement and lane changes require a moving vehicle. Native Vehicle::ChangeLane007a8b78 derives an absolute target from road geometry. These are distinct strategies. Our scan queues a lane request before speed; its acquisition effect is unproven. Our reference-before-lane patch remains a hypothesis, not a universal firmware requirement.

The successful scan followed F&F then SDK setup in its recording, whereas recent failures used free drive without lane commands. Retained state is a hypothesis, weakened by an earlier operator/UI-recorded cold SDK session that received8 positions/4 transitions. That cold session lacks a committed raw capture; retain the evidence distinction.

Speed and collision replies show notifications were active during the failures. Neither raw capture contains optical position/transition packets. The startup capture gap cannot by itself explain missing packets minutes later. Native message-enable0x50 fields concern transition2, steering diagnostics, every barrier code and cycle timing; they do not establish a switch for ordinary0x27. Do not guess enable flags.

## Next discriminating work

1. Finish repair verification and deploy without moving a car. Retain old live session until stopped/reconnect is explicit.
2. Review native SkipAutoDriveInDeloc0x35 call sites and recovery-filter behavior before proposing firmware policy. Do not send experimental settings merely because an opcode exists.
3. Obtain fresh original-app success/failure evidence on the same charged car/ordinary track and complete startup capture. Power-cycle explicitly between variants and record fresh voltage/status and placement.
4. Change one justified initialization/acquisition variable in a supervised bounded diagnostic. Neither timer nor ACK proves physical stopping; operator observation remains mandatory.
5. Proceed through optical localization, steering, mapping, races, then attacks as SYSTEM-RECOVERY-PLAN.md defines. No blanket rollback, increased timeout, disabled SDK override or claimed firmware fix is justified by current evidence.

## Remaining limits

Motion-window timing is a host deadline; it cannot stop a car after radio/host failure with certainty. Low-battery/charger flags are not a full hardware-health assessment. Operator reference survives immediate scan bootstrap but can become stale if the car is physically moved; full confidence/invalidation policy is still open. Formal checks cover host assumptions, not physical firmware behavior. TX trace times remain write-completion timestamps, not over-air acknowledgements.

## Repair verification

Follow-up review found no blockers in deadline/status/calibration repairs or normal app BLE capture. Added Car/Recorder integration coverage proving early packets are recorded and overflow closes initialization. Exports label buffered packet timestamps as drain-time rather than reception-time; a raw over-air timing claim is still invalid. The app explicitly selects SDK/F&F profiles; legacy transports do not use BLE startup draining.
