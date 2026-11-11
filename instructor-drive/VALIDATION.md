# Audit and validation record

Date: **11 November 2026**. Audited base: [`main` at `92ea7893df0b80fc7a54df4952328fb031376f99`](https://github.com/matthewluallen/cs460-second-lap-overdrive/tree/92ea7893df0b80fc7a54df4952328fb031376f99). This record covers source review, software tests, a native desktop-browser simulation and a real GATT session with the operator's selected International MXT. **The custom light pattern was not observed. A later completed power-button identity check enabled one real 100 mm/s pulse: the operator observed the raised wheels move briefly and stop. Track discovery, stopping distance, emergency-stop and link-loss behavior remain unqualified.** The proposed feature stays on a review branch, disabled by default, pending physical acceptance.

## Repository and course audit

The audit examined current main, commit parent relationships, prior bench/fleet/identification changes, test suites, Web Bluetooth code, dependency pins, contributing rules and the attached [CS 460 Fall 2026 project brief](../docs/CS_460_FA_26_Semester_Project.docx). The brief was extracted, rendered and visually checked across all four pages. Its SHA-256 remains `5d79a187e6f6832d82bcd8e8e359f4a86c52a13281e76924bd30c6e21d439826`. The November 11 Canvas project page was inspected read-only; it does not require live driving. Course modules and the brief were not changed.

The brief distinguishes sensed, inferred and commanded state, requires exact assigned-car evidence and peer checking, and allows negative hardware results to earn credit. Room-wide incidents remain in emulation. The proof of concept is a separate instructor qualification activity; no student coursework requirement is replaced with a driving requirement.

Preservation checks cover:

- The stationary bench's replay, battery raw-mV evidence, LED observations, physical identification flow, trace bounds and original no-motion codec.
- The separate Python simulator and its absolute simulation envelope; no simulator command or worksheet authorization controls a radio.
- Intentional simulator exercises (CWE-863, CWE-837, unsigned-profile-digest/CWE-345 teaching concept) and worksheet cross-team read/write exercises (CWE-639/CWE-862).
- Exact Express 4.17.1 and Lodash 4.17.15 teaching pins/lockfile, fixed-input dependency demonstrations, simple query parser and loopback-only server. No dependency modernization or `audit fix` was performed.
- Constructed scenario chronology, documented in [CHRONOLOGY.txt](../bench/CHRONOLOGY.txt) and [history/README.md](../history/README.md), retained as coursework evidence. New observations use their actual test date.

## Executed software checks

The baseline ran on Node **v25.6.1** and Python **3.14.7**. Dependency installation used `npm ci --ignore-scripts --no-audit --no-fund`, retaining the lockfile and skipping lifecycle scripts.

| Check | Observed result | Scope |
| --- | --- | --- |
| Baseline `npm test` | 160 passed, 0 failed | 142 existing bench tests plus 18 platform/dependency tests before this change. |
| Current `npm test` | **294 passed, 0 failed, 0 skipped** | Current checkpoint includes connection recovery, remembered-device reconnect, track recorder, scan qualification/fault handling, UI and the unchanged course suites. |
| `python3 -m unittest discover -s tests -v` | **28 passed, 0 failed** | Existing coursework simulator regression suite. |
| Official Anki SDK C suite, compiled on this host | **19 passed, 0 failed, 0 skipped** | 12 upstream protocol, 5 vehicle-advertisement and 2 BLE-advertisement tests at official commit `410352617b8660338746a6bb2b2dd173afb1b91a`; no radio involved. |

The new checks exercise exact packet bytes and bounds, both permitted version widths, unknown-firmware refusal, physical-confirmation prerequisites, the power-off window and exact-ID reconnect before GATT, single-pulse arming/expiry, timeout/error/disconnect handling, late writes and cancelled setup, trace exhaustion, failed STOP, one-tab ownership and default-off HTTP routing. The transport tests use the real existing `CarLink` class against explicitly mocked Bluetooth devices. A successful software assertion does not establish car identity, motor behavior or stopping distance. Saved outputs: [JavaScript](validation/javascript-tests.txt), [Python](validation/python-tests.txt), [official SDK C](validation/upstream-sdk-tests.txt).

## Native Chrome rehearsal

The installed desktop Chrome browser opened the local page and completed the then-current UI flow in **SIMULATION**, using the page's synthetic transport. This was a browser validation, not a hardware test. The saved [simulation trace](validation/simulation-chrome.txt) contains source-labeled synthetic evidence. This rehearsal preceded the later three-step UI and power-button identification addition; acceptance of those revisions must be recorded separately rather than inferred from this trace.

- The page initially displayed SIMULATION. Missing physical-safety acknowledgement blocked selection.
- The full select → signal → exact-label/device confirmation → arm → one pulse flow completed without a radio.
- A simulated nonzero request was logged at `2026-11-11T22:11:40.229Z`; automatic STOP was requested at `2026-11-11T22:11:40.981Z`: **752 ms** observed, against a **750 ms scheduling target**. This illustrates normal scheduler delay; it is not a maximum physical travel time or real BLE latency measurement.
- Losing window focus caused the page to request STOP and disconnect. The browser UI required another deliberate setup before another attempt.
- Browser validation exposed an `Illegal invocation` error from native timer functions called with an unintended receiver. Arrow-function wrappers now preserve native invocation through the controller, transport and inherited `CarLink` identification path. A browser-style timer regression test was added. The native simulation flow was repeated after the fix.

A browser can schedule late, freeze, sleep or terminate. The tests do not convert JavaScript timers into a physical safety mechanism. STOP delivery after radio loss remains unavailable, and a successful write remains only command-delivery evidence.

## Hardware check and stopping point

The operator identified one instructor-assigned **International MXT** and confirmed a wheels-clear setup, other cars off, other controlling apps closed and a nearby observer. Exact private device identifiers and the original conversation are not published here.

An initial chooser attempt was cancelled because several advertisements were ambiguous. Later, at approximately **22:17 UTC**, the operator manually selected the intended International MXT and the browser made a real GATT connection. The operator reported its top light changing from green to pulsing blue upon connection. That connection-state observation does not prove the requested custom identification pattern or complete physical confirmation.

Multiple bounded light trials completed their writes: identification SDK on (`03 90 01 00`), `0x33` engine off → green → off, then SDK off (`03 90 00 00`). **The operator saw no corresponding custom light change.** This is a negative physical result, not successful light identification. The unchanged stationary bench codec supplied these packets. [Selected LIVE trace, with identifiers removed](validation/live-led-excerpt.txt).

Unsolicited `0x1B` battery notifications decoded to **3528, 3491, 3483, 3506, 3494 and 3505 mV**; one 3483 mV value repeated. These are real telemetry observations, not synthetic or correlated responses to this feature's arming request. Several readings fall below the provisional 3500 mV floor. **Charge and inspect before any motor test; the 3500–4500 mV gate was not lowered.** A higher isolated sample does not cancel the low readings or establish battery capacity/health.

The session was explicitly disconnected at **22:22:24 UTC**. **No speed opcode `0x24`, including a zero-speed STOP command, was sent to hardware in this session.** No actual movement, braking, stopping distance, emergency-stop behavior or link-loss stop was tested. The custom light check remained incomplete, so driving was not authorized.

Firmware **9511** was indicated by the encoded advertised name, with the repository's earlier user trace separately establishing extended version decoding. This LIVE excerpt does not establish a fresh arming/version-response exchange. Firmware **11866** has attributed community hardware evidence. Both remain provisional qualification candidates; neither is accepted as proof that this implementation moves/stops this International MXT.

After the unsuccessful LED check, a power-button identity alternative was implemented and covered by software tests: an initially 30-second expected-disconnect window (now two minutes), an operator's deliberate power-off, explicit reconnect to the same browser ID checked before GATT, and explicit operator attestation. The light trial is now optional. The subsequent power-button acceptance observation is recorded below; a blue connection light or an unrelated radio dropout cannot replace its deliberate physical observation.

## Release acceptance remains pending

Do not publish LIVE driving to students until an instructor records the exact privately retained car identity, firmware, browser/adapter, **either a visibly observed custom light match or a completed power-off/same-device-reconnect check with operator attestation**, actual low-speed pulse and STOP behavior, measured stopping latency/distance, fixture fault tests and a contained-track trial. Charge/inspection and a fresh valid telemetry exchange precede motor qualification. Code review and the [hardware checklist](README.md#hardware-acceptance-record--all-items-initially-pending) remain release conditions. No firmware updates, lane commands or multi-car actions are part of this change.

## AI assistance disclosure

Codex assisted with public-source research, source audit, original implementation, tests and documentation; parallel agents reviewed protocol evidence and integration. Claims were checked against pinned code, existing course documents, actual test runs, a native browser rehearsal and the limited LIVE observations above. Human peer review and instructor hardware validation are still required. No private transcripts, credentials, physical inventory labels, MAC addresses or real browser device IDs are included in this record. [SOURCES.md](SOURCES.md) records provenance and why restricted/unlicensed community implementations were not copied.


## Revised interface verification

After the three-step interface and power-button identity path were added, the
installed Chrome completed select, simulated light identification, explicit
confirmation, arm, pulse and STOP again. Debug remained collapsible and trace
export worked. Ten reproducible UI integration tests now cover the actual UI,
controller, codec and trace modules with a synthetic DOM and explicitly fake
LIVE transport; they use no radio. That earlier local `npm test` checkpoint was 241/241; the current result is 294/294.

In an additional LIVE trial, the browser observed the operator's prompted
physical OFF action and entered `POWER_OFF_SEEN`. A premature reconnect was
cancelled/timed out before successful re-identification; the interface remained
disarmed. This partial result does not qualify the car for motion. A continuous
operator-run identity/drive trial remains pending and must be recorded separately.

## Discovery recovery and experimental track work

The operator’s 22:34 trace showed GATT connection succeeding, followed by service discovery stalling until the old 10-second deadline. Its later disconnected error followed our cleanup; it does not prove the original cause. The old implementation also permanently blocked retries after the original browser operation had settled. The new transport preserves the pending operation, waits for actual settlement, and permits only a deliberate same-device retry. Its setup budget is 30 seconds; motor-write/reply budgets are unchanged.

At 22:48 UTC, native Chrome completed connection, fresh service/characteristic discovery and notification setup. The operator’s prompted physicalOFF action produced the expected disconnect at22:49:14 UTC. Chrome then cancelled a redundant second chooser in about 130 ms, leaving the session disarmed. [Redacted discovery trace](validation/live-discovery-recovery.txt). This prompted a further fix: explicit same-car reconnection now reuses only the previously selected permitted BluetoothDevice, validates its ID again, and rediscovers all attributes. It never auto-reconnects or opens a fallback chooser. The stationary physicalOFF window is now two minutes to accommodate operator interaction.

The experimental scan controller requires a successful 750 ms pulse-limit STOP plus explicit observed physical movement/STOP in the same session, and cannot exceed that pulse’s speed or 200 mm/s. It schedules STOP within 45 seconds, checks ping replies, and aborts if no valid optical position arrives within 5 seconds or subsequent position readings disappear for 2 seconds. Disconnects, cancelled scans, malformed/ambiguous evidence and STOP revoke scan qualification. Browser scheduling and radio delivery remain best effort.

The recorder independently decodes full classic 0x27 position and 0x29 transition messages. Synthetic tests cover start/finish halves, missing/unknown pieces, turn inference, flat position-and-heading closure, malformed packets, bounds, timeouts and session isolation. It does not fabricate missing tiles or return a sample track in SIMULATION. Special Fast & Furious tiles are retained as unsupported evidence, preventing a false complete layout. A generated schematic is derived only from supported observed loop geometry and still needs physical comparison.

Current local verification: **294 JavaScript tests and 28 Python tests passed**. Scan tests use explicit mock transports and synthetic optical packets; they do not establish actual movement, link-loss stop, track sensing or a real mapped lap. The public draft PR’s earlier seven-job matrix passed at its first checkpoint: [CI run](https://github.com/matthewluallen/cs460-second-lap-overdrive/actions/runs/43112540000). Later changes require their own CI result.

## First observed real motor pulse

At **22:53 UTC**, the corrected direct reconnect completed against the same previously selected browser device after the operator’s prompted physical OFF/ON check. The operator’s reports and observed disconnect/reconnect were used for the explicit physical confirmation. No second chooser or automatic reconnect was used.

Fresh replies were `05 19 27 25 00 00` (**firmware 9511**), `03 1b 0a 0e` (**3594 mV**), and `01 17` (ping). The page then sent SDK `03 90 01 01`, speed zero, a fresh ping and the single **100 mm/s** command `06 24 64 00 e8 03 01` at **22:53:56.133 UTC**. The 750 ms timer requested zero at **22:53:56.885 UTC**, and the write completed at **22:53:56.889 UTC**:752 ms to the scheduled STOP request,756 ms to its completed write. These are host timestamps, not measured mechanical stopping latency. [Redacted LIVE pulse trace](validation/live-pulse-excerpt.txt).

The nearby operator separately reported that the raised wheels **moved briefly, then stopped**. This is the first positive movement/physical-STOP observation for this exact MXT/session. It does not establish actual100 mm/s wheel speed, track travel, braking distance, behavior after radio/browser failure, or suitability for students. The same-session observation was recorded to permit the next explicitly supervised contained-track scan at no more than100 mm/s. All broader acceptance items remain pending.
