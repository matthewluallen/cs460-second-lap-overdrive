# Trace fixtures

Each `.json` file here is a recording of every byte exchanged with one or more cars,
made with **Record** then **Save trace** on the host page. `core.test.mjs` replays
every file through the real decoder, track mapper and localiser.

`sim-capsule.json` was recorded from the built-in simulator. It proves the record
and replay path works; it proves nothing about real cars.

## Adding a real recording

1. On the host page press **Record**, connect and scan with a real car, change lanes
   left and right a few times, then **Record** again to stop and **Save trace**.
2. Put the file in this folder.
3. Optionally add an `expect` object so the test checks the result, not just that it
   decodes:

   ```json
   "expect": {"pieces": 8, "offsetSign": -1}
   ```

   `pieces` is how many pieces the physical loop has (the start piece counts as two).
   `offsetSign` is `-1` if the car treats a positive lane offset as right, `1` if left;
   leave it out until you have watched which way the car really moved.

A trace holds car names, model ids and message bytes. It holds no player names.

### groundshock-sdk-recovery-spin-2026-11-18.json

Unmodified 30-event export from `84f799c`; SHA-256
`3617ae69dfe2919c2d0567c81f88e8be2e5a26d1a055f202cf18bd6c4ed74686`.
Ordinary SDK mode, firmware 11866, battery 3834 mV and one 300 mm/s command.
No optical positions, transitions or lateral commands. Firmware reports recovery
entry, recovery success and then off-road before the host sends STOP. The operator
reported slight forward movement followed by spinning and later confirmed power-off.
No map completed. Initial model identity remains unknown; later manual identity and
physical observation are retained separately. No credentials are present. See
[the follow-up report](../review/SCAN-RETRY-AND-APP-MODE.md#follow-up-sdk-scan-entered-firmware-recovery-before-spinning).

### groundshock-sdk-cold-curve-scan-no-position.json

Unmodified 18 November 2026 final export from build `5f3ebbf`, 42 events with
zero drops; SHA-256 `8ffa6240c75eae7a2fb8300cefe46b2888127edbdb97d4f457bda43dae9c2c03`.
Records full SDK connection, firmware 11866, battery 4106 mV, one 300 mm/s scan
command, no optical positions and no lateral commands. Unknown-offset transitions
precede the normal two-second gap stop. A late transition caused another STOP;
it does not prove continuing motor activity. The operator observed spin-off
entering a curve and then confirmed power-off. No map or forward baseline passed.
Initial unknown-model metadata is preserved; Groundshock is operator-identified.
No host/player credentials are present. See
[the evidence report](../review/GROUNDSHOCK-COLD-CURVE-SCAN.md).

### groundshock-sdk-ordered-start-curve-spin.json

Unmodified 18 November follow-up on `c39567c`, 30 events with zero drops;
SHA-256 `f75f5ed28066ee0b01f9d5a08597c45879fe41dbd357f72ee610a633ca44386c`.
Orderly SDK startup, firmware 11866, refreshed battery 4043 mV; one 300 mm/s
command, zero optical positions, one unknown-offset transition, then the normal
two-second gap stop. No offset/lane/turn/configuration command. The operator
confirmed stopped after entering the next curve and spinning midway through it.
No map or forward laps passed. Unknown initial model metadata remains unchanged;
Groundshock identification and physical stop are operator observations. No
credentials are present. See the follow-up in the same evidence report.

## Inspect a capture before interpreting it

`groundshock-sdk-plastic-comparison-spin.json` is the unmodified 38-event export
from `a79c006` on 18 November 2026. SHA-256:
`c415a3f6ef8be14abddb38aed046c6a3f79fc67f294827620f069f2292550855`.
It records the explicit plastic-setting/pong sequence, then a 300 mm/s scan with
no optical positions or transitions before the five-second watchdog STOP. The
operator reported immediate spinning and subsequently confirmed powered off and
stationary. No map or forward laps completed. Groundshock is operator-identified;
initial unknown-model metadata remains. No credentials are present. The setting
is not a proven fix or confirmed firmware readback; see the latest report above.

```sh
node slipstream/tools/inspect_trace.mjs path/to/recording.json
```

The offline report lists each car separately, firmware replies, seen piece IDs,
message counts, malformed notifications, and supercode observations. Its bounded
`acquisition` report separates positive-speed command intervals, first raw and
decoded optical readings, unknown-offset transitions, wheel-distance samples,
offset/lateral command counts, and track traffic after requested STOP. These are
packet observations, not evidence of physical movement, braking or cause of a
departure. An offset opcode does not identify an optical-calibration purpose.
Truncation counters make omitted intervals/samples explicit. `0x4f` and
`0x53` remain distinct; their unsigned code and final raw byte are preserved.
They do not identify a Power Zone location or enable attacks. The examples in
tests are synthetic native-layout vectors, not real-car recordings.

New recordings retain firmware known at capture start and later version replies.
An absent version remains null; recording after initialization may miss a reply
unless the host already knows it. Empty recordings are labeled `unknown`, mixed
real/simulated sessions `mixed`, and all-real sessions `hardware`. Those labels
are self-reported metadata, not proof of physical provenance. Old recordings
without firmware fields still work. A restarted recording ignores old callbacks.

For Fast & Furious, record an ordinary-piece baseline and a supervised Power Zone
pass, noting the physical piece, travel direction and car/firmware in the trace
note. Keep the observations separate from assumed gameplay semantics. Do not
infer accurate zone geometry, stopping behavior or firmware compatibility merely
from a successful decode. Keep raw traces private until their contents are reviewed.

### groundshock-sdk-scan-steering.json

Unmodified operator export from 13 November 2026; 170 events, two sequential
connection profiles on one Groundshock firmware 11866. SDK scanning mapped an
11-piece circuit; operator confirmed the map and physical stop. Contains special
piece 57, which remains unverified for scoring. The later -45 mm lane request
receives a stationary 0x80 cancellation report after 53 ms; no steering success
is claimed. Original Unidentified-car metadata is retained. See MVP-ACCEPTANCE.md
for source hash, timings and limitations. No host or player credentials are present.

`groundshock-numbered-steering-cancelled.json` is the unchanged operator-supplied
13 November 14:17:51Z export (SHA-256
`762dc54ff8d315b7e075f9aa056edf2eeaec106f9cc83b9a0dac414cee7a6e3c`).
Groundshock firmware 11866, SDK, build 6c16578. Command #1 is followed 41 ms later
by cancellation 0x80 and same-recorded-millisecond STOP. No offset calibration
writes occur. Received/executed SDK fields stay 255/129 with sideways speed 70;
they do not acknowledge ID 1. Operator confirms stopped with no leftward shift.
The recording's initial model is unknown; operatorNotes and diagnostics identify
Groundshock. This is not proof of stop latency or valid ACK semantics on this firmware.
