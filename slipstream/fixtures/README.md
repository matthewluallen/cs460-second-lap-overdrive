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

## Inspect a capture before interpreting it

```sh
node slipstream/tools/inspect_trace.mjs path/to/recording.json
```

The offline report lists each car separately, firmware replies, seen piece IDs,
message counts, malformed notifications, and supercode observations. `0x4f` and
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
