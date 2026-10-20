# Classroom bench validation record

Actual review and software test date: **4 November 2026**. Constructed scenario
commit dates are described separately in [CHRONOLOGY.txt](CHRONOLOGY.txt).
Baseline: `56aec5088a39b2f8543a0f5ff3299467cd0d0643`. The uploaded semester brief
is byte-identical to `docs/CS_460_FA_26_Semester_Project.docx` (SHA-256
`5d79a187e6f6832d82bcd8e8e359f4a86c52a13281e76924bd30c6e21d439826`).

## Reproducible software checks

From the repository root:

```sh
node --test bench/*.test.mjs
python3 -m unittest discover -s tests -v
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
- The disposable worksheet's ordinary behavior and intentional CWE-639/CWE-862
  defects. These are characterization tests, not security certification. A live
  mock session receives no writes from worksheet actions.

Local runtime: Node 25.6.1 and Python 3.14.7. All 36 bench tests and all four
simulator tests pass. The bench suite also passes on Node 18 and Node 22,
invoked locally through the official Node packages. No car is used by these
tests. This PR does not install a GitHub Actions workflow: the available push
credential lacks workflow-file permission; no hosted CI result is claimed.

## Chrome replay rehearsal

The page was served on localhost and exercised in desktop Chrome 155 on macOS:

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

## Physical acceptance still required

Use [TONIGHT.md](TONIGHT.md) on the exact assigned car and host. Record a result
or a failure for each row; no row below has been completed on physical hardware
by this software review.

| Check | Evidence required |
| --- | --- |
| Charging | Assigned kit, charger, observed indicators, start/end times and safe physical condition; no inferred capacity from an indicator. |
| Discovery and assignment | Chooser mode, displayed name/browser ID and physical assignment confirmation; cancel on ambiguity. |
| GATT setup | Expected service/characteristics, notification-ready trace, exact failed stage if unavailable. |
| Battery | Off-charger state, `01 1a` TX attempt/completion, `0x1b` RX mV within five seconds, or timeout/error. |
| LED | On/off command bytes and separate visible observations of the assigned car. Try optional SDK once if needed and record both results. |
| Cleanup | Lamp off and SDK off if used, followed by disconnect; record failed/unknown cleanup without claiming reset. |

The wire battery reply has no request sequence number. “Matching” here means a
well-formed battery reply on the selected connection during the single pending
five-second request window, not cryptographic proof of causation or identity.
A late reply stays in the raw trace but does not retroactively pass the timeout.
No tests establish charge capacity, firmware compatibility, Bluetooth encryption,
authenticated vehicle identity, or safe motion. The bench has no motor commands.

AI assisted source review, implementation and test generation. A separate review
identified the stale-setup reconnect race and branch documentation links; both
were corrected and the race has a regression check. The software checks and
Chrome rehearsal are the independent execution evidence available here;
physical observations and human peer review remain explicit next steps.
