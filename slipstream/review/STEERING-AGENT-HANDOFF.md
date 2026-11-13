# Groundshock driving and steering handoff

13 November 2026. Current priority is **repeatable stable forward following before additional lane tests**. Read root HANDOFF.md and [COMPUTER-DRIVER-HARDWARE.md](COMPUTER-DRIVER-HARDWARE.md) first. [STEERING-ROOT-CAUSE.md](STEERING-ROOT-CAUSE.md) is now a corrected evidence report; its historical filename does not assert a known root cause.

Repository: https://github.com/matthewluallen/cs460-second-lap-overdrive

PR: https://github.com/matthewluallen/cs460-second-lap-overdrive/pull/4

Branch: `slipstream-and-security-hardening`. Do not merge main.

## Current evidence and limits

One left shift was physically confirmed on08fe678; see [GROUNDSHOCK-LEFT-STEERING-ACCEPTED.md](GROUNDSHOCK-LEFT-STEERING-ACCEPTED.md). Repeated Computer lanes later cancelled, including after settled speed. The latest79f9350 reference-first run read start34/code12→13, then the two-second telemetry watchdog stopped it. The operator confirmed stopped and on the track, but reported spinning. Its29-event fixture is `fixtures/groundshock-sdk-reference-spin.json`.

That last capture contains no lane, turn or offset write. The earlier successful repaired scan did send finite0x2c after its first code. Reference acquisition deliberately suppresses calibration until its confirming callback finishes; no later code arrived in the spin run. This is a known sequence difference, not a demonstrated physical cause. Do not claim fixed steering, repeated laps, racing, attacks or native-app parity from software tests.

The operator authorized one explicit cancellation comparison that locks further lateral requests after cancellation while forward driving continues at ceiling300. It retains all other stop/pit protections and applies only when deliberately started. It is not the default policy and is not authorization to weaken other stops. Recent failed forward runs never exercised a lane-cancellation exception.

At the last recorded physical handoff the operator confirmed stopped, the car was disconnected, and the page remained in a telemetry-timeout pit. Verify current session state rather than assuming that historical state or readiness persists.

## What to investigate next

1. Compare current scan and reference-acquisition behavior with the same recorded optical input, including exact command order, unknown/finite offsets, STOP and connection reuse.
2. Keep coordinate ownership explicit. SDK vehicle-tool resets offset to zero for relative steering; native Vehicle::ChangeLane derives targets from drivable-section geometry. Slipstream's printed-code-derived reference plus absolute target is a distinct strategy. “Current measured offset” is not an accurate description of that estimate.
3. Native offset conversion classifies values greater than500000 as unknown654321. Native0x34 adjustment and0x2c reset/setting are distinct operations. Do not infer one from the other's name or copy only a serializer.
4. Do not infer a rejection cause from recvID0xFF. CheckForDroppedCommand tests executed ID and the host's saved/current request state before a timed retry; it does not establish the old “missing0x2c caused rejection” claim. High-bit IDs also have special semantics.
5. Preserve STOP priority across calibration/lane multi-write sequences; stale measurements, cancellation, reference loss and reassignments must not revive discarded lateral work.
6. The next physical baseline should retain startup-inclusive recording and the accepted scan policy. A later forward-only mapped trial should suppress lane/turn intent while preserving the intended calibration policy. Explain any changed variable and use the current operator/session readiness; this handoff itself does not authorize movement.

The ordinary-curve extractor correction now removes chord-centroid bias from228 lateral values on IDs17,18,20,23,24,27. Progress and other geometry remain unchanged. The new synthetic-circle and independent lane-record tests are numerical evidence, not hardware proof. No speculative0x35, SDK flag or watchdog change follows from that repair.

## Historical chronology

| Stage | Evidence and scope |
|---|---|
|1e19867|Blocked unverified/special geometry from automatic calibration; moving cancellation opens the default shared pit.|
|6c16578 / e4930da|Added seven-bit request IDs and ACK diagnostics, then retained the numbered cancellation fixture. Numbering did not establish physical steering.|
|14:17:51Z export|Bare0x25 at32780ms, cancellation-state0x41 and STOP at32821ms, no offset write. Operator: stopped, no leftward shift. Fixture SHA256 `762dc54ff8d315b7e075f9aa056edf2eeaec106f9cc83b9a0dac414cee7a6e3c`.|
|Historical cold start|Operator power-cycled at approximately08:20 America/Chicago; SDK firmware11866, about3.82V. UI recorded8 positions/4 transitions, then cancelled laneID1 with no observed shift. The raw download was not retained as a committed byte fixture; screenshots/notes must not be represented as complete wire evidence.|
|5b3816d|Added keyed SDK-only0x2c→0x25 with a code-derived absolute reference. Six new tests;563-test software checkpoint. The claim that omission caused firmware rejection was a hypothesis, not a confirmed root cause.|
|15:03 and15:09 exports|Pre-steering spin-offs occurred without new lane or offset writes. See [GROUNDSHOCK-PRESTEERING-OFFTRACK.md](GROUNDSHOCK-PRESTEERING-OFFTRACK.md).|
|08fe678|Accepted11-piece scan and one physically confirmed left shift. ACK/code observations and operator confirmation are retained separately.|
|Later Computer trials|Partial lateral motion followed by cancellation persisted despite ID and speed-confirmation changes. See the complete hardware chronology.|
|ae3012b|Comparison attempt left track before any lane request; one automatic curve offset occurred. Cancellation policy was not exercised.|
|79f9350|Reference-first acquisition and untrusted-marker fixes; latest start34-only run spun without any new offset/lane/turn command.|
|c148060|Preserved spin trace, repaired false first-lap counting and stale CPU encounter state. Neither host defect emitted a steering packet in that capture.664-test software checkpoint.|

The original SDK scan fixture includes an earlier F&F connection before SDK. The later repaired-scan fixture contains SDK startup. Avoid conflating these connection histories. Raw trace TX times are recorded write completions, not proof of over-air receipt or physical braking latency.

## Artifacts and independent tools

Working checkout:
`/Users/matthewluallen/.codex/.chatgpt-projects/g-p-6aac4813500c8191b52bc463fbd70382/slipstream-work`.

SDK checkout: `/tmp/slipstream-independent-review/drive-sdk`, revision
`410352617b8660338746a6bb2b2dd173afb1b91a`.

F&F library: `/tmp/slipstream-independent-review/foxtrot/libDriveEngine.so`, SHA256
`0eef63a8135f4cfe7bb16b4effa1f720192cc2c1f340d0c8c8f0c2b9835f3d7f`.
Configuration: `/tmp/slipstream-independent-review/foxtrot/config`.
Provenance: [FAST-FURIOUS-REVIEW.md](FAST-FURIOUS-REVIEW.md).

Ghidra12.2:
`/tmp/slipstream-independent-review/ghidra_12.2_PUBLIC/support/analyzeHeadless`.
Project directory `/tmp/slipstream-independent-review/ghidra-project`, project
`foxtrot`, program `libDriveEngine.so`. Use read-only/noanalysis scripts with output outside the repo. Java25:
`/opt/homebrew/opt/openjdk/libexec/openjdk.jdk/Contents/Home`.

Independent Thumb instruction checks use LLVM `/usr/bin/objdump` with
`--triple=thumbv7`; ELF addresses are Ghidra addresses minus0x10000 for this image.
Check symbols/segments before mapping other regions. Decompiler argument recovery is imperfect: assembly exposed a missing final output-pointer argument in the optical-acquisition call.

No APK/firmware execution is needed for this review. Do not upload APKs, OBBs, firmware, proprietary decompiled bodies or licensed artwork. Preserve fixture bytes. Local temporary artifacts may disappear: verify existence/hash before claiming a fresh analysis.

## Verification and delivery

Use Node>=22. Run the relevant failing regressions before repair, then npm test,
Python unittest discovery, the CWE/dependency labs and npm audit. Preserve the1–4-car mode/fault matrix. Record current counts in root HANDOFF.md rather than presenting historical counts as current.

Keep new work on the PR branch, preserve unrelated edits, and commit/push after the authorized verification pass. No merge, deployment, port-visibility change or physical control is implied by this offline review.
