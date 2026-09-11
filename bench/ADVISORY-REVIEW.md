# Adversarial advisory review

Review baseline: `9e9fdc0c2242c9e27f290b9f760409cb33c6dfd5` (PR #1).
This record describes actual source inspection and software reproductions.
Commit calendar dates in this teaching repository are constructed scenario
metadata; they are not dates of hardware qualification.

## Advisory perspectives

Three separate AI review passes used these occupational responsibilities as
lenses. They are simulated advisory perspectives, not actual practitioners,
O*NET endorsements, professional certifications or human peer review.

| Perspective | O*NET basis | Assigned questions |
| --- | --- | --- |
| Software quality assurance | [Software Quality Assurance Analysts and Testers, 15-1253.00](https://www.onetonline.org/link/summary/15-1253.00): test execution, defect analysis and operational design review. | Can cancelled or overlapping asynchronous work change a newer session? Can evidence appear successful without its prerequisite? Do regressions distinguish the original failure? |
| Information security | [Information Security Analysts, 15-1212.00](https://www.onetonline.org/link/details/15-1212.00): vulnerability assessment, mitigation and protection against unauthorized changes/disclosure. | Which flaws are deliberate lessons, which threaten availability or evidence, and what prevents a simulator/worksheet action from reaching a car? |
| Human factors | [Human Factors Engineers and Ergonomists, 17-2112.01](https://www.onetonline.org/link/details/17-2112.01): task analysis, interface assessment and operating/training requirements. | Can a student select the wrong car, reuse a stale observation, lose the final result, or misunderstand a failed or pending operation? |

Coverage included every executable Python module in `lapreturn`, every bench
JavaScript module, their existing tests, the HTML interface, profile data and
relevant operating/protocol/scenario documents. New modules and regression
cases were inspected again during integration. The reviews used local mocks and
subprocesses; no physical car, student trial or Bluetooth-radio experiment was
performed. Prior primary-repository analysis remains in [RESEARCH.md](RESEARCH.md).

## Findings and disposition

P2 denotes a reproducible operational defect; P3 denotes a bounded local concern
or contract ambiguity. These priorities are project judgments, not CVSS scores.

| ID | Finding and reproduction at baseline | Disposition and regression |
| --- | --- | --- |
| QA-1 / P2 | Cancel one `CarLink` during notification setup, connect a second instance to the same browser device, then settle the first promise: stale cleanup disconnects the replacement. The UI's earlier single-instance guard did not protect the transport API itself. | Fixed in `link.mjs`: shared ownership claims, rejection of duplicate active owners, and cleanup that respects a newer claim. Tests cover same objects, different wrappers with the same browser ID, failures and late chooser results. Claims apply within one module/page, not across apps or tabs. |
| QA-2 / P2 | Battery request 1 times out; request 2 starts; a delayed response to request 1 is displayed as the new result. The wire packet has no transaction ID. | Live timeout/write failure makes the result inconclusive and requires reconnect before another battery request. Local attempt labels organize evidence; they are not wire correlation IDs. Results say the notification was observed during the window. Reconnect reduces ambiguity; it does not create authenticated or cryptographically correlated telemetry. |
| QA-3 / P2 | A never-settling GATT write leaves commands busy after the five-second battery RX timer expires. | Controlled recovery: show the inconclusive timeout and explicit Disconnect recovery, keep Disconnect available, reject concurrent writes, and suppress a late completion after disconnect. No unsupported promise-cancellation guarantee is made. A pending chooser/setup must settle before another live attempt; replay remains available. |
| QA-4 / P2 | Each notification joins/redraws the entire unbounded trace, causing progressively more work and memory growth. | `TraceLog` renders the latest 200 retained lines and exports all accepted lines. Capture stops at 10,000 lines or 2,000,000 characters, whichever comes first, with one explicit incomplete-evidence marker. New commands are blocked, including a TX attempt that cannot be retained. Save/disconnect/clear provides recovery; no silent eviction or automatic car commands. |
| HF-1 / P2 | After a lamp write and lost connection, the observation button is unavailable; editing the context field changes no saved evidence. | Retain an immutable confirmed session/attempt context for explicit post-disconnect operator reports. A new session or clear removes it. Replay cannot record physical observations. Session notes are labelled as captured at connection. |
| HF-2 / P2 | Record “Light visibly on,” then send Headlight off and click Record again: the old selection/detail is reused without association to a command. | Clear fields on every lamp attempt and after recording. Require a fresh selection; associate reports with the command, local attempt, write outcome and confirmed session. Physical reports remain distinct from RX telemetry. |
| SEC-1 / P2 | A 20,001-character line containing 10,000 nested JSON arrays raises uncaught `RecursionError` on Python 3.12, terminating the shell and losing state. | Catch nesting errors with a bounded structured message and continue. Tests exercise actual deeply nested input, a deterministic parser exception, prior state survival and a following valid request. Interpreter-specific thresholds are not assumed. |
| SEC-2 / P3 | `dict(request)` accepts an array of key/value pairs even though the protocol requires a JSON object. | Require an object and string operation before dispatch. Tests reject non-object roots, malformed operations and unhashable fields without changing state. |
| SEC-3 / P3 | Unlimited worksheet additions grow tab memory even though each note has a length limit. | Cap at 1,000 records including seeds, reject before consuming IDs or changing state, keep existing records readable, and document reset. This does not change the intentionally missing ownership checks. |
| INT-1 / P3 | Control characters in diagnostic text can create apparent new lines or misleading direction in a plain-text evidence file. | Trace fields escape line/control/directional characters; tests prove one input remains one evidence row. The log is not a signed or tamper-proof record and operator/device text is still untrusted. |

The trace budget allows one fixed-size limit marker beyond its data budget so
incompleteness is always visible. The display is a tail, not data loss. If capture
stops while a command is pending, no later outcome can be inferred from omitted
traffic. Record any final physical observation separately; reconnect and confirm
again for needed cleanup after saving and resetting the trace.

## Intentional lessons preserved

The simulator's request-controlled team authorization, repeated-nonce execution,
cross-team telemetry and caller-supplied profile checksum are documented by its
scenario history/evidence. They remain deliberate investigation targets. The
new `DeliberateScenarioCharacterizationTests` explicitly reproduce them across
teams; passing these tests means the supplied flawed baseline is reproducible,
not secure. Student fixes should replace those expectations with denial or
idempotence tests while retaining legitimate operation and the absolute
simulation envelope.

The worksheet's CWE-639 and CWE-862 cases remain separate disposable exercises
in [CWE-LAB.md](CWE-LAB.md). The worksheet now lives on `worksheet.html` with its own module and no car-control imports. No worksheet handler sends Bluetooth commands. The
Python simulator still has no radio driver, network server, external-command
execution or firmware path. Motion remains confined to in-memory simulation.
Browser confirmation is an operator assertion, not a trusted authentication or
proof-of-ownership mechanism; developer tools can change client-side state.

## Residual limits and release boundary

- Physical charging, model/firmware compatibility, actual chooser identity and
  LED behavior remain unverified. Follow [TONIGHT.md](TONIGHT.md) and retain the
  exact kit/host/revision and observed result or failed stage.
- The simulator retains events/nonces for the lifetime of its local process.
  An unbounded scripted workload can exhaust memory. A cumulative policy was
  deferred because it must preserve stop availability and complete evidence;
  no silent truncation or arbitrary denial of stop was introduced. Use bounded
  exercises and reset the disposable simulator between runs.
- A browser/OS operation that never settles is not forcibly cancelled by a
  JavaScript timer. Disconnect is the recovery action; reload if native setup
  remains stuck. This does not prove the physical lamp or SDK state reset.
- No review of all source can establish freedom from defects. The tests target
  the reproduced failures and preserved legitimate use. Physical and human peer
  validation remain separate acceptance evidence.

Run `node --test bench/*.test.mjs` and
`python3 -m unittest discover -s tests -v`. See [VALIDATION.md](VALIDATION.md) for
the observed runtime matrix and browser rehearsal. GitHub CLI access is selected
as the Illinois-linked `matthewluallen` account. After the account owner authorized
workflow-file access, the branch adds automated regression on pull requests and
pushes to `main`. The workflow has read-only permissions, pinned actions, no
persisted checkout credentials and bounded job durations. Actual hosted results
belong to the revision shown in the PR checks, not to the fictional commit dates.
These software-only checks do not certify the intentional CWE lessons or hardware.


## Classroom page simplification

The main `index.html` now ends after battery/headlight controls. Detailed trace
and observation controls remain on `evidence.html`; the optional worksheet is
separate. The same transport/session controller runs both bench pages with an
explicit evidence-view boundary, preserving confirmation and stale-session
protection. Compact-page errors and session-limit recovery remain visible.
Generic command feedback excludes battery notifications so a late or unretained
reply cannot look like a newly credited result. Separate mocks cover all three
pages; a Chrome replay rehearsal checked both bench pages and trace download.
The intentional worksheet and simulator weaknesses remain available. Operational
recovery and evidence controls were not replaced with vulnerable hardware paths.

The separate simulator investigation runner now demonstrates three existing
weaknesses using fixed synthetic inputs and fresh state: CWE-863 incorrect team
authorization, CWE-837 repeated logical action, and the CWE-345 authenticity
concept. See [SIMULATOR-CWE-LAB.md](SIMULATOR-CWE-LAB.md) for mapping limits and
student repair criteria. The vulnerable operations in `core.py` and `records.mjs`
are unchanged. A result explicitly reports `security_pass: false`; normal use,
intentional defects and operational recovery have separate test assertions.


## Direct dependency baseline

Express 4.17.1 and Lodash 4.17.15 are now actual runtime dependencies, pinned to
upstream commit archives plus lockfile integrity. Express serves the unchanged
bench and a loopback-only MOCK support API; Lodash sorts/groups its records.
The explicit shared worksheet mode preserves the two deliberate authorization
cases and uses process-restart reset semantics. Tab-local mode remains available.
The full car transport, codec, Records operations and Python simulator core are
unchanged. The shared API has no radio, motor, proxy or template-execution route.

[DEPENDENCY-LAB.md](DEPENDENCY-LAB.md) separates advisory exposure, direct-library
reproduction and application reachability. Tests keep the two fixed dependency
reproductions intact, but do not assert every advisory is reachable. The server
selects simple query parsing, so the installed historical qs nested-query vector
is not the normal request path. Fixed prototype-marker and Location-header
experiments run in a bounded child process and do not mutate the active server.

Integration review corrected a shared-store capacity error that incorrectly said
reload to reset, preserved unknown outcomes if an addition loses its response,
and corrected the browser fetch receiver after Chrome rehearsal exposed it.
Tests cover normal platform use and intentional flaws separately. This is still
an intentionally vulnerable local course baseline, not a production service.

## November 5 engine LED and fleet follow-up

Read-only AI advisory passes checked protocol evidence, assignment boundaries,
concurrent writes and browser-local label persistence. The live user trace
confirmed communication, not a visible LED result: SDK was left before the next
headlight attempt. Fixed engine RGB commands now prepare SDK within one serialized
sequence; failure, disconnect or trace refusal stops the remaining writes.
Version decoding accepts the exact observed 32-bit form without relaxing battery
framing. Real hardware acceptance is still outstanding.

Fleet review found two additional operational defects before publication:

- A new browser device could initially reuse another saved car's physical label.
  Confirmation now rejects both ID-to-label and label-to-ID mismatches, including
  case-insensitive duplicate labels. An explicit forget and isolated reenrollment
  is required after permission identity changes.
- A stale tab could overwrite a newer saved registry. Saving/removing now checks
  the backing value and rejects a detected change with disconnect/reload guidance.
  This protects ordinary stale-tab edits, not an atomic simultaneous transaction;
  the classroom guide uses one enrollment tab per student.

The new safeguards affect real-car selection and operational evidence only;
intentional simulator, worksheet and dependency lesson behaviors remain intact.

The student-owned Codespaces follow-up moves the saved-ID check before GATT
connection. A wrong chooser selection cannot connect, write commands or disturb
an existing connection to that other car. Returning students can use this check
even when the browser needs a chooser instead of exposing saved-device lookup;
it depends on the browser retaining the saved permission identity. It does not
identify an unknown first-time car in a room full of duplicate model names.
Each student owns a separate browser/site mapping for their own pair; GitHub
access and shared track use do not authenticate car ownership.

Protocol review also found that Anki's advertising name format can contain
control bytes. The optional saved display name is now escaped and bounded so it
cannot prevent enrollment, while the browser ID is unchanged and the original
selection remains trace evidence. This is a compatibility precaution from
primary-source review, not an observed cause of this user's LED issue.

## Power-cycle and candidate signal review

AI advisory reviews separated a browser-permitted candidate from a confirmed
physical assignment. The optional advertisement probe never connects GATT or
writes to a car. Silence alone does not establish power-off: baseline, return
and all three near/far pairs must contribute measured samples before the
uncalibrated consistency rule can be met. Invalid or absent RSSI stays missing;
sample limits cannot turn continued advertisements into a quiet result.

The separate candidate signal uses one selected device and one write lock.
SDK/LED completion and a human visual report remain distinct; neither sets the
assigned label or saves a registry entry. Disconnect, hidden-page cancellation,
a deadline, refused evidence or a late wire completion cannot switch targets or
write cleanup to a replacement session. Cleanup may be unavailable, so the UI
reports an unknown physical outcome instead of promising a restored state.
Integration testing found and fixed closing a never-opened link when no pending
write existed. Legacy battery/replay evidence and deliberate vulnerability
exercises remain in regression coverage. Physical acceptance is still required.
