# PR4 external review response

12 November 2026. Implemented with Codex assistance on `slipstream-and-security-hardening`.
Review: `PR4-EXTERNAL-REVIEW.md`, reviewed code `2835eb6`; baseline checkout
`636b30a` adds only the review. This pass addresses H1, H2, H3, M1, M2, M3, M4,
M12 and H4, in that order. No hardware, APK or firmware was executed. No app data
were re-extracted. No deployment, merge, port visibility or access settings changed.

## Baseline and final verification

Both runs used Node **22.23.5**, npm **11.9.0**, Python **3.14.7**. The final code
commit is `38599c9`; the subsequent response/documentation commit changes no code.
All commands completed successfully in both runs:

| Command | Baseline at 636b30a | Final at 38599c9 |
| --- | --- | --- |
| `npm ci --ignore-scripts` | Passed | Passed |
| `npm audit` | 0 vulnerabilities | 0 vulnerabilities |
| `npm test` | 419 passed, 0 failed | 478 passed, 0 failed, 0 skipped |
| `python3 -m unittest discover -s tests -v` | 38 passed | 38 passed |
| `python3 -m lapreturn.cwe_lab` | All 3 regression checks passed; flaws not reproduced | Same |
| `npm run dependency-lab` | regressionCheckPassed=true, reproduced=false | Same |

The dependency and CWE checks are fixed probes, not a comprehensive security
assessment. The host tests execute actual handlers in a DOM stub with simulated
cars; they do not verify browser rendering, gamepad firmware or touchscreen behavior.

## Findings and reproductions

Each row's primary regression failed before its repair and passes afterward.
Tests were introduced sequentially against the then-current branch, preserving
prior fixes. Additional tests extend coverage after the initial reproduction.

| ID | Reproduced? | Regression test(s) | Fixing commit | Notes |
| --- | --- | --- | --- | --- |
| H1 | Yes, software behavior | `host.test.mjs`: `H1 host dead-man requires a fresh neutral phone packet before motion resumes`; `H1 relay status changes disarm phone seats even with fresh cached throttle` | `ad73c2f` | Phone packets cannot revive held throttle after timeout/status change. Host arming clears on stops and controller/seat changes; phone state staleness also clears controls. |
| H2 | Yes, missing software guards | `watchdog.test.mjs`: `H2 moving car with silent telemetry latches a named shared pit`, `H2 telemetry gap stops within the configured interval`, `H2 continued telemetry after STOP raises an alarm and resends STOP`, `H2 scan cannot run past its wall-clock budget`, `H2 scan lap budget stops repeated anchor passes without closure` | `157fcd9`; compatibility policy in `52a2747` | First four tests failed before repair. Defaults: 5 s to first track message, 2 s gap, 1 s stop grace, 45 s scan time and three anchor returns. Continued position/transition traffic is a conservative alarm, not proof of motion or physical stop verification. |
| H3 | Yes | `host.test.mjs`: `H3 selecting Computer never starts motion and releases dropdown focus` | `52a2747` | CPU selection remains stopped. Explicit Start round/Free drive arms CPUs after 3 s. Host dropdown blur is exercised in the handler test, not a physical keyboard/browser test. |
| M1 | Yes | `host.test.mjs`: `M1 leave and host revocation survive an online reconnect` | `f8d98a1` | Reconnect preserves release; a new explicit seat selection is required. |
| M2 | Yes | `host.test.mjs`: `M2 gamepad identity survives an earlier driver leaving gamepad mode and blur disarms`; `M2 an unmapped gamepad cannot arm through assumed standard buttons` | `480a650`, `38599c9` | Claim a controller by button press, then neutral. Binding preserves slot and browser-reported ID. Blur disarms; unmapped/non-standard devices cannot use assumed standard mappings. The unmapped regression also failed before its follow-up repair. |
| M3 | Yes | `watchdog.test.mjs`: `M3 moving connection fault opens a named shared pit`; `M3 unexpected transport link loss on a moving car opens the pit` | `420f15a` | Moving write fault reproduced first. Shared pit names the car; disconnected cars require remove/reconnect. Software cannot deliver STOP over a lost link. |
| M4 | Yes | `host.test.mjs`: `M4 selected scan car waits through a countdown and other cars stay latched`; existing shared-pit resume regression; `M4 cancelling a scan latches STOP against subsequent input` | `2cfbb06`, `38599c9` | Selected scanner, track-clear acknowledgment, 3 s countdown. Other cars remain latched. Scan completion/cancellation stop. Pit resume counts down. Cancellation follow-up had its own failing regression. |
| M12 | Yes | `platform/slipstream-relay.test.mjs`: `opening a room needs the host code, and guessing it is rate-limited` | `88aa4e8` | Exhausted bucket now refuses even the correct code before comparison. Successful authenticated calls refund a token only after a permitted comparison. Actual socket address is used, so proxy clients may share a bucket. |
| H4 | Software classification/scoring gap yes; physical tile behavior unverified | `host.test.mjs`: `H4 special Fast & Furious pieces cannot start a scored round` | `76906bc` | Runtime IDs 53, 54, 57 are special/unverified and block scored rounds. README and instructor-drive agree. Future extraction preserves unknown kinds/raw codes; existing tables were not re-extracted. Combat-only fixtures now use ordinary IDs rather than bypassing the guard. |

## Fault matrix and compatibility decision

`faults.mjs` wraps the simulator transport with dropped position/transition
notifications and scheduled delayed delocalized notifications. Its relay companion
can drop host-bound input silently or announce an outage; it does not conflate
relay loss with Bluetooth loss. `host.test.mjs` runs all 14 existing mode/car-count
combinations under each of the three faults: **42 additional matrix tests**.
One car uses solo/team; two through four use solo/team/race/battle. The original
full-loop scoring matrix remains. Fault cases assert initial motion, then stopped
commands and the appropriate shared pit or neutral-input rearming behavior.
They test host decisions, not physical braking or measured network timing.

The owner explicitly selected this compatibility policy: **retain the 2-second
watchdog default and block affected slow intersection missions until validated**.
The host blocks Story/Precision rounds containing intersections. Story algorithm
coverage retains an explicitly labeled **simulator-only 10-second telemetry
allowance**; it is not a production default or a hardware-derived threshold.
The scan anchor budget is a conservative bound on anchor returns, not a guarantee
that repeated intersection observations uniquely identify physical laps.

## Disputes and limits of the review

No scoped finding was dismissed as non-reproducible. H4's physical interpretation
cannot be confirmed from a scoring test; quarantine is the appropriate outcome.
Likewise, H2's physical stopping consequence remains unknown. A moving car with
silent telemetry now triggers a host STOP request, but software tests cannot
establish that the car received it. No claim of classroom or hardware readiness
is made on the strength of passing tests.

## Remaining work

- No car-enforced host-loss timeout/keep-alive has been validated. A suspended host
  loop, lost laptop or broken Bluetooth connection may prevent STOP delivery.
- Validate real left/right sign, curves, all special tiles, multi-car Bluetooth,
  first/gap/scan thresholds, continued stationary telemetry, braking distances,
  phone sensors/haptics and physical controller identities. Browser slot/ID pairs
  cannot uniquely identify two identical physical controllers after replacement.
- M5, M6, M7–M11, M13–M16 and the review's lower-priority findings/evidence gaps
  are outside this pass. In particular, **M13 remains open**: Slipstream still
  shares server routes with course bench/mock APIs; public-port guidance needs a
  separate decision. Nothing here changes visibility or implies that deployment
  is safe for public access.
- Saved-map verification, control-loop fault containment, input sequencing and
  gameplay balance remain subjects for subsequent scoped work.
- The already-public external review and branch history were preserved; no claim
  is made that deleting a file would undo its prior publication.

See root `SECURITY.md` for the remediation entries and `HANDOFF.md` for the next
reviewer's starting point. Simulator tests and bounded state exploration do not
constitute formal verification of the complete cyber-physical system.
