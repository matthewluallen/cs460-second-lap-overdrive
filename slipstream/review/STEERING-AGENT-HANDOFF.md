# Next-agent handoff — 13 November 2026

## Task

Make real Groundshock steering work without weakening stop, pit, arming or
watchdog behavior. Resolve the packet/reference-frame/firmware mismatch before
attempting Power Zone effects or scored races. Hardware scanning has succeeded;
physical lane changes have repeatedly failed. Tests passing is not hardware proof.

Repository: https://github.com/matthewluallen/cs460-second-lap-overdrive
PR: https://github.com/matthewluallen/cs460-second-lap-overdrive/pull/4
Branch: `slipstream-and-security-hardening`.

Start with root HANDOFF.md, then review/SDK-APK-APPROACH-AUDIT.md,
review/POWER-ZONE-AUDIT.md, review/MVP-ACCEPTANCE.md and SECURITY.md (paths relative
to slipstream except the root files). Read the complete current files before edits.

## Saved changes and exact evidence

- `1e19867`: prevents unknown/special-piece geometry from automatic calibration;
  clears cancelled targets and queued steering; moving cancellation opens shared pit.
- `6c16578`: seven-bit steering IDs and SDK-layout acknowledgment diagnostics.
  This was deployed and tested; it did NOT fix physical steering.
- `e4930da`: unchanged numbered-trial fixture and regression; ACK UI explicitly
  labels firmware interpretation unverified. This label update was not loaded
  into the connected browser at the end of the session.
- `fixtures/groundshock-sdk-scan-steering.json`: original SDK scan and cancelled
  steering capture. Operator confirmed the 11-piece map, including Power Zone 57.
- `fixtures/groundshock-numbered-steering-cancelled.json`: full operator export
  from 14:17:51Z, SHA-256
  `762dc54ff8d315b7e075f9aa056edf2eeaec106f9cc83b9a0dac414cee7a6e3c`.
  Request at 32780 ms: `0b 25 5e 01 e8 03 00 00 b4 c1 00 01`.
  Reply at 32821 ms: `0e 41 00 00 58 c1 00 00 58 c1 00 00 f0 00 80`.
  STOP recorded at 32821 ms. No offset writes anywhere in this trial.
  Operator confirms stopped, no visible leftward shift. Physical stop latency unknown.
- Hardware fixture metadata starts with unidentified model; operator notes identify
  Groundshock. Preserve original bytes and distinguish operator identification.

## Latest cold-start trial — not yet a raw-byte fixture

Operator fully switched Groundshock off/on and put it on start/finish, then selected
it again. Browser SDK initialization succeeded at 08:20:13 America/Chicago:
firmware 11866, battery about 3.82 V. Only SDK initialization was used after restart.
After the recovery countdown, requested 240 mm/s; eight position messages and four
transitions arrived. Left command #1 targeted -22.5 mm with 350 mm/s sideways speed.
Cancellation occurred at 08:21:30; shared pit sent STOP. STOP reasserted at 08:21:34.
Operator: **stopped, no sideways shift**.

SDK-interpreted acknowledgment fields changed from pre-cycle 255/129/70 to
post-cycle 255/255/0 and stayed there around the request. Cancellation offset was
about -25.6 mm. Power Zone signals: zero. The displayed requested target was thus
only about 3.1 mm away from the cancellation offset; do not assume that this is a
measured physical displacement or that the first 'one lane' click means 22.5 mm
relative movement. Earlier larger requests also cancelled.

Evidence screenshots are in `review/evidence/`. The cold-start recording was saved
through the browser UI, but its download was not accessible as a local file and
has NOT been added as a byte fixture. Ask the operator for the newest trace when
needed. Do not fabricate it from screenshots or claim all raw captures are saved.
The preceding 14:17:51Z trace IS committed. Screenshots and these notes preserve the
later observations, with this explicit limitation.

## Known state at handoff

Groundshock physically stopped (operator confirmed); host in shared pit. No future
movement is authorized by this handoff. Browser URL:
https://curly-giggle-449vvxwxrj43jr67-3000.app.github.dev/slipstream/

Codespace: `curly-giggle-449vvxwxrj43jr67`.
Remote checkout: `/workspaces/cs460-second-lap-overdrive`.
Connected browser and deployed control code: `6c16578`, SDK, command ceiling 300.
Preserve the saved map and recording before reload; reconnect requires the human
Bluetooth chooser. Do not print host codes or commit private managed state.
No server restart, port-visibility change, merge, APK execution or firmware execution
is needed for the next offline investigation.

## Next reasoning steps

1. Reproduce the saved capture and inspect exact fields; distinguish car-generated
   cancellation from STOP-induced events. Retain the pit behavior regardless.
2. Trace original app steering reference/offset setup and SDK example behavior.
   SDK header describes zeroing offset before RELATIVE lane changes; the app uses
   tracked ABSOLUTE offsets. Do not insert zero resets into absolute steering
   without explicitly handling the frame and calibration interaction.
3. Determine why IDs are not acknowledged and whether 255/high-bit values are
   sentinel, cancellation, unsupported fields or other firmware state. Do not
   infer command execution from GATT write completion or an ACK alone.
4. Inspect native command gating, hop intent, target resolution and initialization.
   Packet layout currently agrees with SDK and app; numbering and power cycling
   alone failed. Do not keep repeating unchanged physical trials.
5. Any candidate must have offline tests covering queue ordering, STOP during a
   multi-command operation, no automatic retry, unchanged watchdogs, unknown
   geometry and stale acknowledgments. Keep speculative behavior explicit and
   bounded; ask for a product decision if changing control or stop policy.
6. Get fresh supervised readiness before physical movement; one variable per trial.
   Record raw commands, responses, UI state, observed lateral movement and stop.

## Artifacts and tools

Local working checkout used during this session:
`/Users/matthewluallen/.codex/.chatgpt-projects/g-p-6aac4813500c8191b52bc463fbd70382/slipstream-work`.

Public SDK checkout: `/tmp/slipstream-independent-review/drive-sdk`, revision
`410352617b8660338746a6bb2b2dd173afb1b91a`.
F&F library: `/tmp/slipstream-independent-review/foxtrot/libDriveEngine.so`, SHA-256
`0eef63a8135f4cfe7bb16b4effa1f720192cc2c1f340d0c8c8f0c2b9835f3d7f`.
Extracted configuration: `/tmp/slipstream-independent-review/foxtrot/config`.
Provenance and third-party acquisition limits: review/FAST-FURIOUS-REVIEW.md.
Native exports remain local and are not licensed source code to redistribute.
Do not upload APKs, OBBs, firmware, proprietary exports, or licensed artwork.

Fresh review scripts are committed under `slipstream/tools/`: ExportSteeringAudit,
ExportPowerZone, ExportPowerZoneFlow, ExportZoneReceiver, ZoneReferences,
ZoneThumbReferences and ZoneDispatch (Java). Last two reference walks yielded
little additional evidence; empty reference results do not prove no callers.

Ghidra 12.2 executable:
`/tmp/slipstream-independent-review/ghidra_12.2_PUBLIC/support/analyzeHeadless`.
Project directory `/tmp/slipstream-independent-review/ghidra-project`, project
`foxtrot`, program `libDriveEngine.so`. Use `-readOnly -noanalysis` and a post-script
from the committed tools with an output path outside the repo. Requires Java 25:
`JAVA_HOME=/opt/homebrew/opt/openjdk/libexec/openjdk.jdk/Contents/Home`.
Temporary local artifacts may disappear; verify existence and hashes, don't claim
fresh decompilation if absent. Use committed reports and request original artifacts.

## Verification

Last full suite: **557 Node tests passed**, Node 22.23.5. Latest changes were packet
instrumentation, UI wording, fixture/tests and documentation. Earlier unchanged
Python suite: **38 passed**, Python 3.14.7; CWE and dependency labs passed; npm audit
zero advisories. Do not call these formal verification of firmware or hardware.

Run npm test, python3 -m unittest discover -s tests -v, python3 -m lapreturn.cwe_lab,
npm run dependency-lab, and npm audit. Use Node >=22. Local Node 22 executable:
`/tmp/cs460-review-node22/node_modules/node/bin/node`.
Preserve the existing 1–4-car mode/fault matrix. Commit and push on this branch,
update HANDOFF.md and relevant review notes with evidence and unresolved limits.
No merging to main. No claim of world-class UI, real races or attacks until observed.
