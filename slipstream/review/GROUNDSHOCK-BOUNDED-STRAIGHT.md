# Groundshock bounded straight test — 13 November 2026

Build tested: ceb863c, SDK profile, firmware 11866. This is one supervised physical trial, not full-system acceptance. The operator confirmed: **stopped; moved and stayed on track**. No steering was requested. Battery immediately before the test was 4125 mV; status did not report charging or low battery.

Evidence: `../fixtures/groundshock-sdk-bounded-straight.json`, exported directly through the browser download interface. All 26 events retained, zero dropped. Original connection metadata says unidentified/model 0 because the operator selected Groundshock after connection; diagnostics and operator observation identify the model. The diagnostics build string is still a static label, so the tested Git revision is a deployment record rather than trace self-attestation.

## Recorded timeline

Times below are milliseconds from recorder start. TX records occur after the browser write promise completes (`Car.#write`), not at radio reception or motor actuation.

| Time | Evidence |
| --- | --- |
| 21360 | Battery response: 4125 mV |
| 24895 | Three-second countdown marker |
| 27926 | Diagnostic starts; 150 mm/s requested for 500 ms |
| 27927 | Nonzero speed write completes: `06 24 96 00 e8 03 00` |
| 27991 | Speed response: desired 150, reported actual 0 |
| 28427 | Deadline marker requests STOP, 501 ms after start |
| 28478 | STOP write completes, 551 ms after motion write completion |
| 28478 | Collision notification `03 4d 01 00` |
| 28530 | Speed response: desired 0, acceleration 2500, reported actual 194 |
| 28712 | Status reports on-track true, charging false, low battery false |
| 29156 | Another collision notification `03 4d 01 00` |

An additional collision notification occurred during stationary initialization at 240 ms. There were no position, transition, off-road, recovery-entry/success, lane-change or offset messages. No subsequent speed report proves measured zero; physical stop is supported by the operator observation. The UI's retained 194 mm/s reading is stale, not proof of ongoing motion or calibrated physical speed.

## Interpretation and next gate

The host deadline operated and the operator observed a successful brief straight movement. The 51 ms STOP write duration is transport completion latency, not physical stopping latency. This pulse is too short to require crossing an optical code; zero optical messages do not alone establish localization failure.

Collision notifications around/after STOP remain unexplained. Their presence during stationary initialization cautions against equating each packet with an observed impact. Do not discard them or weaken the collision stop policy. No evidence here establishes why the earlier longer drives left the track, nor that steering is repaired.

Before increasing duration, inspect car tires/sensor/track joints and establish whether the original app drives/maps this same charged car and circuit. Preserve its comparison observations and supported Bluetooth capture if available. A further Slipstream attempt should change one variable, retain an automatic deadline, and have fresh supervised readiness. Longer free drive, steering, scan, race and attacks remain separate acceptance gates. Do not repeat the previous five-second unlocalized trial.

Validation: existing offline trace inspector accepts the recording. Documentation/fixture-only change; no controller or safety behavior changed.
