# Bluetooth telemetry reliability — Week 4

Branch `week-4-student-driving`; reviewed base `10f1760`. Runtime build `2026-11-18-bluetooth-reliability`. No physical cars were connected or moved. Do not merge main.

## What was reproduced and repaired

| Reproduction | Repair and regression evidence |
| --- | --- |
| A delayed optical callback runs before an overdue control tick, replacing `lastTrackAt` and concealing an expired first-reading, strict-gap or optional-recovery deadline. | `Game` evaluates the existing deadline before `Car` applies optical evidence. An overdue coalesced batch cannot restore calibration or localization after its first frame trips STOP. Separate later notifications still support the existing continuing-motion alarm. `telemetry-ordering.test.mjs`. |
| A queued acceleration crosses the transport boundary after the telemetry deadline. | The same deadline evaluation runs immediately before motion writes, before epoch/guard checks. Entry into optional recovery invalidates older queued acceleration. Existing serialized STOP priority remains. |
| A late pong or fulfilled write beats its overdue timer after a host stall. | Initialization and write completion compare the absolute monotonic deadline. A known-fulfilled late write remains in the trace and allows one serialized fail-safe STOP attempt; an unresolved write timeout closes without overlapping a new GATT operation. `transport-health.test.mjs`. |
| A complete off-track frame followed by a truncated optical frame loses the safety event because whole-notification decoding throws. | Only complete, aligned safety frames preceding the malformed tail are retained. No resynchronization, cross-notification reassembly, speculative compact decoding, optical evidence or initialization confirmation is invented. Tests cover off-road, recovery-entered, lane cancellation, collision and unhealthy status, plus exclusion of ordinary/init frames. |
| A closed or disconnected connection finishes asynchronous setup; old listeners survive, or a disconnect occurs before a subscriber attaches. | Setup checks lifecycle at every awaited GATT boundary, disconnects late results, removes listeners, validates notification/write capabilities and reports an already-observed disconnect to a late subscriber. Invalid callback values are counted and discarded. `ble-reliability.test.mjs`. |
| Simulator silence drops safety messages coalesced with optical telemetry. | `FaultTransport` filters only supported complete position/transition frames. Bounded deterministic delay and burst loss supplement silence, relay outage and late-delocalized cases. Malformed tails remain unchanged. `fault-transport-reliability.test.mjs`. |
| A position arrives before the write API resolves, so a report incorrectly suggests a silent driving interval. | Report windows are explicitly API-completion windows, not actual motion intervals. Host-received optical intervals and final lifetime timing snapshots are separated; boundary uncertainty remains visible. `run-report.test.mjs`. |

No firmware packet layouts, initialization profile defaults, motor limits, steering signs, authentication or phone permissions changed. First-reading timeout remains 5 seconds; ordinary telemetry gap remains 2 seconds; scan budget remains 45 seconds/three anchor returns. The existing explicitly selected recovery option still ends at the original reading plus 3 seconds, caps forward speed at 300 mm/s, locks maneuvers and requires two consistent ordinary readings. Scans and diagnostics do not gain that grace.

## Evidence the operator can collect

**Advanced → Live car checks** shows accepted optical readings, rejected overdue frames, notification age, pending writes, longest queue wait, completed API duration, failed writes, timeout breaches and uncapped host callback gaps. **STOP ALL → Run report** exports readable timing summaries. The JSON trace additionally retains bounded BLE lifecycle/callback/buffer counters. Student defaults and phone flow remain simple.

- Queue time separates waiting behind another request from the current browser API operation. Keyed coalescing is intentional replacement of an unsent request, not packet loss.
- `completed` counts fulfilled calls, including `lateCompletions`. A late completion also counts as a timeout breach; those totals overlap. Unresolved timeouts are not logged as completed TX events. The first write failure is retained separately from a subsequent failed STOP attempt.
- `hostTiming` samples the real callback gap before the simulation step clamps its delta. It is observational and creates no new stop threshold.
- RX times are host callback/drain receipt times. Neither notification timestamps nor write promise completion measure firmware sampling time or over-the-air latency. Final snapshots include parked periods and are not recording-only measurements.

Bluetooth LE's link layer already acknowledges/retransmits ACL packets. An ATT notification lacks an ATT-layer confirmation; this does not mean it is sent over an entirely unacknowledged radio link. Browser write fulfillment is also not proof of firmware acceptance. These distinctions follow the [Bluetooth SIG LE primer](https://www.bluetooth.com/bluetooth-le-primer/) and [Web Bluetooth specification](https://webbluetoothcg.github.io/web-bluetooth/). We therefore do not add blind motion retries or claim a packet-loss percentage without a denominator. No RSSI, negotiated connection interval, radio retransmission count or firmware sensor timestamps are available in the retained browser evidence.

## Practical classroom diagnosis

Keep the Bluetooth laptop near the circuit with the controller visible and awake. The Codespace serves pages and relays phone controls; the laptop owns the Bluetooth links and deadlines. A phone-network outage and a Bluetooth notification gap are different failure paths.

Use a charged known-good car, 300 mm/s, strict telemetry, direct throttle and Power Zone off for comparison. Record startup, scan and a forward run. Compare accepted optical gaps with all-notification receipt, queue waiting, API duration and host callback gaps. A quiet optical stream with continuing other notifications suggests a different investigation from an entirely silent link, but neither proves a cause. Preserve raw evidence and observed physical results.

After a single-car baseline, repeat with two then four cars on the same laptop; keep the track and placement consistent. If problems appear only with more cars, compare each link independently before changing settings. Distance, obstruction, competing 2.4 GHz traffic and host load are hypotheses to test one at a time, not established diagnoses. A second nearby laptop/server does not provide a shared Bluetooth scheduler or coordinated collision avoidance.

A suspended browser cannot execute STOP. A lost link cannot deliver it. The repaired host checks prevent stale evidence/queued intent from bypassing deadlines when execution resumes; they do not create an onboard dead-man switch. Recovery still requires the existing explicit clear/neutral controls; there is no automatic reconnect-and-drive path.

## Verification and remaining limits

Node 22.23.5: **994/994 tests pass** (934 baseline plus 60). Python 3.14.7: **38/38 pass**. CWE and dependency regression commands pass. npm 11.9.0 audit: **0 vulnerabilities**. No dependencies changed.

The existing host fault matrix passes 42 cases across 1–4 cars and available modes. New deterministic transport scenarios cover 24 configurations: 1–4 cars, alternating Ice Charger/International MXT starting models, silence/delay/burst loss. Separate callback-order tests reproduce faults before repair. Tests model host behavior, not RF propagation or physical braking.

Existing replay fixtures now start their clocks at the selected car's first recorded timestamp; captured startup spans are 297/356 ms, not the artificial 62-second/23-minute jump from zero. The shared-pit and stale-reference fixtures isolate their intended conditions within real write deadlines. Two synthetic queue/host harnesses explicitly use longer fixture-only write budgets to isolate virtual scheduling; dedicated production-deadline regressions retain the default 1 second. No production limit was increased.

Browser verification shows stopped simulated-car health, new report fields and the unchanged strict default, with no console warnings/errors. [Simulator evidence](assets/bluetooth-health-simulator.jpg). Guardian's prior physical acceptance remains the hardware baseline. Ice Charger, MXT, four simultaneous real Bluetooth links, optional gap recovery and RF interference behavior still need supervised measurements. This pass does not certify those behaviors.

## Deployment verification

Implementation **`e804c12`** is pushed and deployed to the existing Week 4 Codespace. The clean checkout fast-forwarded, and only its identity-checked managed live server was restarted on the existing public port3000. No visibility or access setting changed. The pre-existing missing Git LFS hook warning did not prevent the update; no hook was removed.

Anonymous readiness/controller/teaching-isolation preflight passes. Public `app`, `car`, `game`, `ble`, `host-timing` and `run-report` modules are byte-identical to the tested local files. Fault and test modules return404. The reloaded public controller shows **STOPPED**, **0 / 4 cars**, **Classic SDK**, 300 mm/s and strict telemetry; no browser warnings/errors were recorded. [Public-page evidence](assets/bluetooth-reliability-public.jpg). The isolated local test tab/server are closed. Refresh host and phone pages before reconnecting cars; no hardware acceptance was added by this deployment.
