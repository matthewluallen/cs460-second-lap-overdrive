# Classroom bench validation record

Software execution evidence is distinct from the constructed scenario commit
dates described in [CHRONOLOGY.txt](CHRONOLOGY.txt).
Baseline: `56aec5088a39b2f8543a0f5ff3299467cd0d0643`. The uploaded semester brief
is byte-identical to `docs/CS_460_FA_26_Semester_Project.docx` (SHA-256
`5d79a187e6f6832d82bcd8e8e359f4a86c52a13281e76924bd30c6e21d439826`).

## Reproducible software checks

From the repository root:

```sh
node --test bench/*.test.mjs
python3 -m unittest discover -s tests -v
# For the pinned Node platform as well:
npm ci --ignore-scripts
npm test
```

The original baseline passed four bench tests and four simulator tests before
editing. The expanded bench checks cover:

- Exact allowlisted packets, SDK without localization override, headlight change
  masks, concatenated replies, malformed lengths and false battery evidence.
- Service-filter chooser and explicit broad fallback, cancellation, notification
  readiness, assignment confirmation, both write methods, failed writes, session
  cleanup and overlapping-operation rejection. No setup command is sent.
- Actual UI with a minimal mock DOM and deterministic timers: replay-to-live
  reset, five-second battery timeout, late/unrelated RX, trace export, clear only
  after disconnect, literal rendering of names/notes, and LED observations
  labelled as operator reports rather than telemetry.
- Disconnection during lamp writes reports unknown outcome. Cancelling setup
  blocks another live attempt until the old promise settles, preventing its late
  cleanup from disconnecting a new session; replay remains available meanwhile.
- Bounded capture with a visible incomplete marker, full retained export and a
  200-line display; no command or connection begins when its trace cannot be
  recorded. Cross-instance ownership protects replacement connections.
- Immutable physical-observation context after disconnect, fresh LED fields per
  attempt and explicit inconclusive battery retry recovery.
- The disposable worksheet's ordinary behavior and intentional CWE-639/CWE-862
  defects. These are characterization tests, not security certification. The
  standalone worksheet UI operates without browser Bluetooth, fetch or CarLink.
- The compact classroom page has no observation form, trace/export controls,
  worksheet or pilot footer. It retains assignment gates, battery timeout/retry
  rules, visible setup errors and explicit session-limit recovery. The evidence
  page retains full trace export and physical-observation controls.

Pre-fleet revision `bfe6e66` was checked with Node 25.6.1 and Python 3.14.7:
71 bench tests, 18 platform/dependency tests and 28 simulator/lesson tests passed.
Python checks also pass on bundled Python 3.12.14.
The earlier 59-test bench suite also passed on Node 18 and Node 22,
invoked locally through the official Node packages. No car is used by these
tests.

The [regression workflow](../.github/workflows/bench-regression.yml) runs these
same suites for pull requests and pushes to `main`: bench on Node 18/22/24,
platform/dependency tests on Node 22/24, and Python 3.10/3.12 on Ubuntu 24.04. Node 18 and Python 3.10 are end-of-life minimum-version
compatibility checks, not recommended runtimes. Use Node 24 and Python 3.12 or
newer for new setups. The workflow uses read-only repository permissions,
commit-pinned GitHub actions, no persisted checkout credentials, ten-minute job
limits and cancellation of superseded runs. It has no radio or deployment step.
Check the PR's actual Actions result for the tested revision; adding a workflow
does not by itself establish a passing run or physical acceptance.

## Chrome replay rehearsal

The revised page was served on localhost and exercised again in desktop
Chrome 155 on macOS after the advisory fixes:

1. Browser path reported secure, direct tab, Web Bluetooth API present.
2. Start replay → Battery displayed `REPLAY RX: battery 3700 mV` and raw frame
   `03 1b 74 0e`; the outgoing request was `01 1a`.
3. Headlight on/off produced `REPLAY TX` frames `02 1d 11` / `02 1d 01` and the
   message “command rehearsed; no physical LED.” Physical-observation recording
   remained disabled in replay.
4. Disconnect disabled commands. Save trace downloaded a timestamped text file;
   its contents were inspected and contained only replay evidence. Clear reset
   the trace and battery/lamp result text.

This exercises a real browser's UI and download path, not its Bluetooth chooser
or GATT connection. Automated mocks additionally exercise live-path behavior.

## Page split rehearsal

After the compact page change, desktop Chrome 155 on macOS again displayed
REPLAY battery 3700 mV and the headlight rehearsal's “no physical LED” label.
The main page ended after the battery/headlight controls; the removed forms,
trace buttons, worksheet and footer were absent. Disconnect remained usable.
The separate `evidence.html` started a fresh replay session, displayed the
battery reply, disconnected, and downloaded a 775-byte trace. Its contents were
inspected: REPLAY-labelled lines, the raw battery packet and disconnect, with
no LIVE evidence. Clear reset the result display after disconnect. The separate
worksheet loaded correctly and reproduced red reading blue record 102.
Sessions do not transfer between pages. Detailed observation
and overflow cases are covered by the UI mocks; no physical car was used.

## Physical acceptance still required

Use [TONIGHT.md](TONIGHT.md) on the exact assigned car and host. Record a result
or a failure for each row; no row below has been completed on physical hardware
by this software review.

| Check | Evidence required |
| --- | --- |
| Charging | Assigned kit, charger, observed indicators, start/end times and safe physical condition; no inferred capacity from an indicator. |
| Discovery and assignment | Unique physical label, isolated chooser enrollment, displayed name/browser ID and physical assignment confirmation; cancel on ambiguity. |
| Remembered pair | Explicit label save, refresh of retained grants, one selected reconnect and physical confirmation again; absent/off cars must not be described as online. |
| GATT setup | Expected service/characteristics, notification-ready trace, exact failed stage if unavailable. |
| Battery | Off-charger state, `01 1a` TX attempt/completion, `0x1b` RX mV within five seconds, or timeout/error. |
| LED | Engine green/off bytes and separate visible observations of the assigned car; SDK-on must precede the pattern and remain requested through off. Legacy headlights are a separate comparison. |
| Cleanup | Lamp off and SDK off if used, followed by disconnect; record failed/unknown cleanup without claiming reset. |

The wire battery reply has no request sequence number. A reading means a
well-formed battery notification was observed on the selected connection during
the single pending five-second window, not proof of causation or identity. A
live timeout or write failure is inconclusive and blocks further Battery requests
until reconnect. A late reply stays in the raw trace but does not pass the timeout.
No tests establish charge capacity, firmware compatibility, Bluetooth encryption,
authenticated vehicle identity, or safe motion. The bench has no motor commands.

AI assisted source review, implementation and test generation. A separate review
identified the stale-setup reconnect race and branch documentation links; both
were corrected and the race has a regression check. The software checks and
Chrome rehearsal are the independent execution evidence available here;
physical observations and human peer review remain explicit next steps.

The [O*NET-aligned advisory review](ADVISORY-REVIEW.md) records the adversarial
findings and dispositions. Python coverage now includes schema/nesting recovery,
state preservation, envelope/isolation checks and explicitly named intentional
flaw characterizations. Role-based AI advice is not human peer certification.


## Deliberate CWE lesson checks

`python -m lapreturn.cwe_lab` exercises three existing flaws through actual
`Pilot` calls: request-controlled team authorization (CWE-863), a repeated
logical action applied twice (CWE-837), and a caller-recomputed profile checksum
accepted without publisher authentication (CWE-345 educational concept, with its
mapping caveat). Eight additional tests verify real state changes, fresh state,
CLI selection, control cases and truthful reports if a policy is later repaired.
All existing intentional worksheet and simulator weaknesses remain reproducible;
normal-operation and recovery tests remain in the same regression run. Passing
these characterization tests is not security certification. The runner changes
no live car code and leaves the absolute simulation envelope in place.

## November 5 live trace and follow-up boundary

A user supplied a trace on **5 November 2026** containing live ping, battery and
version replies. The version frame `05 19 27 25 00 00` is the community decoder's
32-bit little-endian **9511 / 0x2527** form. Legacy headlight writes completed,
but the user reported no visible LED change. SDK mode was disabled before the
next light attempt. Thus this trace supplies communication evidence; it does
not demonstrate a light attempt while SDK mode stayed enabled, successful LED
operation, charging performance or fleet assignment. The full user trace and
identifying timestamps are not included in public documentation.

The follow-up adds fixed engine green/off patterns, SDK-on sequencing for those
actions, both version widths and explicitly remembered physical labels. These
changes are under review on PR branch `codex/classroom-charge-connect-led`, not
assumed present on `main`. The `fleet-led-v1` follow-up passed **119 JavaScript tests** (101 bench and
18 platform) and **28 Python tests** locally on November 5, 2026. The checks
exercise:

- SDK-on before the engine pattern, no repeated SDK-on while already requested,
  failure/disconnect during the sequence, reset on a new session and no automatic
  cleanup on disconnect; a completed write must never become a physical result.
- Exact `0x33` green/off bytes and both version forms, including malformed-frame
  rejection; LIVE/REPLAY battery timing, attribution and trace bounds unchanged.
- Saved labels for duplicate model names; explicit remembering only after
  physical confirmation; `getDevices()` restricted to saved IDs; deliberate
  reconnect followed by confirmation again, unavailable API/grant/storage
  recovery and no unprompted scan or batch connection.

A Chrome 156 macOS browser rehearsal of the evidence page returned REPLAY
3700 mV, then recorded SDK-on, engine-green, engine-off and explicit SDK-off
in that order. The interface kept the no-physical-LED label throughout. No
Bluetooth chooser or car connection was used for this rehearsal. The preview
reported `getDevices()` unavailable; its explicit fallback message was verified.
An additional two-car mock verifies reconnecting either enrolled device within
the same page without this API, no repeated chooser, renewed confirmation, and
loss of retained objects after reload.

The label registry detects a changed backing value before saving, protecting
against ordinary stale-tab overwrites; it is not an atomic transaction across
simultaneous tabs. Use one bench tab per student while enrolling labels.

Use [FLEET.md](FLEET.md) for the 15-student, two-car enrollment and physical
acceptance run. Browser ID persistence, actual reconnect and engine illumination
still require observation on the assigned Ice Charger and International MXT
kits. No radio or physical LED trial was performed by the software reviewers.


## Pinned direct runtime dependencies

The Node launcher installs actual Express 4.17.1 and Lodash 4.17.15 from
commit-pinned upstream archives. A clean `npm ci --ignore-scripts` installation
was verified separately; the lock records both archive and transitive integrity.
The audit reports eight affected packages (five high and three low) for this
lockfile; these are package counts, not eight distinct defects or proof of
application reachability. Audit failure is expected for this teaching baseline.
See [DEPENDENCY-LAB.md](DEPENDENCY-LAB.md) for exact pins and primary advisories.

All 18 platform tests pass locally: actual loopback HTTP static delivery and
module MIME, shared records/summary, preserved CWE-639/CWE-862 behavior,
malformed/oversized input recovery, capacity/reset semantics, independent stores,
browser-adapter integration, archive pins and bounded dependency demonstrations.
The demonstrations reproduce Lodash prototype inheritance and the Express
Location/parsed-host discrepancy inside a fresh process. Parent state remains
clean; no external request or car command is part of either demonstration.

Chrome 155 on macOS loaded the bench through the Express server, reported a
secure direct-tab path with Web Bluetooth available, and rehearsed battery
3700 mV, headlight on/off and disconnect. The shared worksheet listed the red
seed, created a synthetic red record, returned a Lodash summary count of two,
and reproduced red reading blue record 102. An initial browser-only fetch
receiver error was fixed and given a regression test before the successful
rehearsal. Response-read timeouts and unknown addition outcomes are also covered;
no addition is automatically retried. These are software observations only.
