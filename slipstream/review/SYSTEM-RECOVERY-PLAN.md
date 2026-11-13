# Slipstream recovery and acceptance plan — 13 November 2026

Status: source/trace review, not a proven repair. Cars remain stopped. No runtime change or deployment is included in this plan. Branch: slipstream-and-security-hardening; do not merge main.

## Evidence reviewed

Compared 31cf5fc (documented successful physical SDK scan) through 5b3816d (steering offset experiment), including car.mjs, game.mjs, protocol.mjs and initialization.mjs. Read the three committed Groundshock captures and local F&F native exports native-control.c, native-systems.c and zone-receiver.c; consulted the local official drive-sdk protocol.h. No APK/firmware was executed and no new Ghidra run is claimed.

## Findings and attribution

1. **Recent steering changes do not directly explain the two latest spin-offs.** Neither failed run contains a lane (0x25) or offset (0x2c) command, position/transition update, or lane cancellation. The changed steering, calibration and cancellation branches therefore were not exercised. Speed encoding and SDK initialization are unchanged across the reviewed range. This is evidence against blaming those branches, not proof that all software is correct.
2. **The successful scan is not a controlled baseline for cold SDK free drive.** In its cumulative recording, F&F initialization precedes disconnect and SDK reconnect. That may leave firmware settings; a power cycle is not recorded/proven by these bytes. SDK scan sends a lane command before 300 mm/s, with its first position 1627 ms later. Recent free drives sent only 240 or 150 mm/s. Initialization history, bootstrap command, placement and car condition are confounders. Prior numbered steering captures did receive track telemetry, so missing initialization alone is not established as the cause.
3. **Free drive permits nonzero speed without any optical position, using the five-second first-position watchdog.** This existing behavior allows the car to leave the track before localization. The second trial stopped after 5002 ms, not the intended brief pulse. Browser round trips must not implement diagnostic timing.
4. **Battery/status evidence is collected but poorly surfaced.** Car stores status without displaying its flags or age. The native status ToString maps bytes to on-track, on-charger, low-battery and charged in the same order as our decoder. The earlier low-battery flag is meaningful evidence, but stale and not proof of the spin-off cause; no fresh battery sample followed the operator-reported recharge.
5. **Speed reports are not independent ground truth.** Native speed message pack/unpack agrees structurally with three signed 16-bit fields. Its consumer admits 0–5 m/s as a broad plausibility range. Thus 1802 is not an obvious byte-order bug or guaranteed physical speed. In trial two the final field was 100, despite the same lack of track data. Preserve both raw and interpreted values, source and age.
6. **The new steering reference can be unknown or stale.** `lateral` starts at zero and is updated from a recognized printed-code geometry, not an independent continuously measured offset. `steerTo()` treats that estimate as a current reference; scan calls it before its first position. The SDK reference tool resets to zero for relative movement; that does not prove our absolute-reference strategy or that 0x2c is universally required. Correct overconfident comments/reports and test this as an experiment.
7. **STOP guarantees remain limited by transport/host failure.** The queue prioritizes STOP after an in-flight write; host timers cannot guarantee delivery after Bluetooth loss or browser suspension. Existing software checks are not a firmware watchdog or formal proof of physical safety.

## Work order and exit criteria

### 1. Make observations trustworthy before changing driving

- Add exact Git build/revision, connection-session ID, initialization profile/history and monotonic timestamps to every export. Replace the static diagnostics build label.
- Show last battery/status sample age, charger and low-battery flags, optical telemetry freshness, command versus reported speed, and user-confirmed physical stop separately.
- Add a stationary refresh action using documented battery/ping requests. Never invent a status-request opcode. Missing replies must be shown as unknown/stale, not healthy.
- Preserve collision and unknown packets prominently in incident summaries. Include the exact stop trigger and time from first nonzero command to STOP queued/write-completed; do not call that physical stop latency.
- Add an app-owned, one-shot diagnostic mode with a short explicit duration and speed ceiling, neutral/countdown requirements, no concurrent CPU/phone/lane commands, no automatic retry and STOP on deadline/cancel/visibility loss. Expiry must clear pending motion; stalled/rejected writes must fail closed. A browser deadline is still best-effort, not a radio-independent guarantee.
- Separate normal race/free-drive readiness from an explicitly supervised localization acquisition procedure. Do not simply require a fresh position for every first movement: that creates a bootstrap deadlock on cars that must move to read a code. Design the narrow bootstrap path and test it before hardware use.
- Keep existing two-second track-gap default, shared pit, STOP priority, neutral rearming and special-piece quarantine. No blanket timeout increases or silent speed adjustment.

Exit: meaningful fake-clock and delayed-write tests demonstrate that a diagnostic never restarts after expiry, STOP or reconnect; stale samples cannot appear current. Run the full Node/Python/course lab checks and security/dependency checks for the actual implementation changes. A simulated radio validates host behavior only.

### 2. Establish a reproducible optical-localization baseline

- Use one charged Groundshock on an ordinary printed straight, same direction and placement, with clean sensor window/tires and checked track joints. Record firmware and fresh electrical/status evidence.
- Operator power-cycle between initialization variants; record the action explicitly. Keep phone controllers and additional cars disconnected during diagnosis.
- First verify the original app can drive/map this same car and circuit after recharge. Capture supported Bluetooth logs if available; do not assume its previous success proves present hardware condition.
- Compare known successful scan sequence with current SDK bootstrap offline. Review native driving mode, modular-track config, message-enable and localization handling; distinguish firmware defaults from host-maintained state.
- Test one documented initialization/bootstrap difference per supervised, automatically bounded attempt. Do not flip SDK override off casually: official SDK protocol.h explicitly requires the override flag for speed and lane commands.
- If the original app also fails, investigate car/track condition before protocol experimentation. If only ours fails, compare actual outbound packets and received optical messages, then reproduce the difference in a transport test before repair.

Exit: repeatable optical position/transition messages and observed on-track travel from an explicitly recorded fresh start. ACKs, collisions, pings and speed replies cannot satisfy this gate.

### 3. Prove steering independently

- Establish fresh ordinary-piece localization first. Define a single coordinate frame and track estimate confidence/age; block reference updates from unknown/special pieces.
- Reconcile SDK relative steering with our absolute targets; test signs, reverse travel, reference expiry, command cancellation, and STOP between the reference and lane write. Ensure interleaved/latest-wins commands cannot pair a stale reference with a different target.
- Conduct one bounded left request and then a separately authorized right request. Record reference, target, wire sequence, reply, code-derived lateral change and operator observation. A cleared cancellation bit/ACK is insufficient without visible lateral movement.

Exit: repeatable left/right movement and stopping on ordinary pieces; no silent retries or automatic reference correction on unverified geometry.

### 4. Track discovery and trustworthy rendering

- Repeat full scans of ordinary closed layouts with start/finish; compare physical piece order/count, direction and closure. Test reverse traversal, duplicate IDs, interrupted scans, intersections, lost codes and partial maps.
- Preserve raw piece IDs, confidence and provenance. A saved map is not evidence of the current car's location. Unknown/special pieces remain visually distinct and unscored until validated.
- Treat F&F Power Zone 57 as a separately verified special feature. Do not equate its map color or detection with a working boost/attack. Native evidence currently suggests attack behavior, not a generic speed boost.

Exit: operator-confirmed repeatable maps and lap counting without fabricated closure or scoring through ambiguous sections.

### 5. Race acceptance, then attacks

- Progress from one human time trial, to one CPU, to two cars, then three/four. Verify every human/CPU mixture supported by the product, driver reassignment and independent device bindings.
- Test browser, Android phone and iPad control for neutral rearming, disconnect, stale inputs, tilt calibration, permission denial, orientation changes and fallback touch controls. Haptics are optional enhancement with feature detection, never safety feedback.
- Confirm countdown, lap direction, finish order, pause/resume and per-car watchdog/shared pit on hardware. Replay mode/car-count fault matrices with telemetry silence, delayed packets, host/relay outage and reconnect.
- Add attacks only after reliable localization/steering: deterministic targeting, range, cooldown, teams, immunity and clear feedback. Begin with effects that reduce commanded speed; no collision-based gameplay requirement or unvalidated acceleration. Power Zone activation and multi-car Bluetooth behavior require separate physical trials.

Exit: repeatable complete races and correctly attributed attacks with retained traces, explicit operator observations and no weakened stop rules.

### 6. Delivery, presentation and overall release gate

- Keep Codespaces as HTTPS server/relay and the local laptop as Bluetooth owner. Verify public QR URLs, authenticated host actions, revoked seats, rate limits and anonymous teaching-route isolation. Phone/iPad support is controller support, not an assumption of Web Bluetooth availability.
- Make STOP, connection freshness, localization and physical-recovery status obvious at laptop/tablet/phone widths; keyboard and touch accessible. Render 3D only from verified map data, retain a clear 2D fallback and avoid implied precision for unlocalized cars.
- Add optional haptics/audio/animation for countdown, attacks and finish, with mute/reduced-motion and browser capability fallbacks. Polish follows reliable hardware behavior.
- Validate a host/bridge failure-stop mechanism independently; a ping loop alone is not a watchdog. Document residual link-loss risk if firmware cannot autonomously stop on loss of host control.
- Formal/property checks cover host state-machine invariants, queue ordering and scoring under declared assumptions. They cannot prove optical sensing, firmware semantics, physical stop distance or battery behavior. A fake car speaking the protocol does not formally verify original firmware.

Release checklist: versioned software checks pass; reproducible mapping/steering; 1–4 car race/control matrix accepted; attack/Power Zone gates individually recorded; responsive accessible UI inspected; security/relay checks pass; operator can diagnose and recover without command-line work; unresolved hardware limitations remain explicit.

## Immediate next implementation

Implement phase 1 diagnostics and bounded test harness, correct overstated steering claims, and add a byte-level successful-versus-failed sequence report. Do not roll back safety fixes or change firmware parameters without a reproduced reason. Then run phase 2 with fresh supervised authorization. No further unchanged free-drive trial is part of this plan.
