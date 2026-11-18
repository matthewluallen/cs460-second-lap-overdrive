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

### guardian-sdk-computer-crew-2026-11-18.json

Unmodified cumulative 136-event `96fc393` export; SHA-256
`e4021edf2b7607c414cce747b324d0d3464e7b322af4df584d0ee50098de8aae`.
Retains the accepted isolated shifts, then a one-car Computer Crew round at
constant requested 300 mm/s for 31.735 seconds. Two automatic lane targets
request a 27 mm left move and a 45 mm right move; replies are noncancelled,
ACKs match and later printed codes confirm the resulting lanes. The new run
contains 47 positions/22 transitions, maximum position gap 1501 ms, and no
recovery/off-road/cancellation. UI reaches three laps and automatically stops.
Independent route reconstruction supports at least three complete traversals;
the distance-based score and stricter start/finish counter use different anchors.
The operator subsequently confirms stopped, stayed on track and saw lane changes.
The raw snapshot's pending note/stop flag predates that confirmation. No
credentials are present. See [the physical result and scoring audit](../review/RELATIVE-LANE-CONTROLS.md#guardian-computer-round-physically-confirmed).

### guardian-sdk-left-shift-accepted-2026-11-18.json

Unmodified 32-event `96fc393` export; SHA-256
`2da8ac2f1b6cdc9596584cbf26b57d73763db0311711d43719af5beb6771212d`.
Guardian, SDK, firmware 11866; fresh battery 3791 mV. A qualifying 39/code 22
reverse reading triggers reference +4.5 mm followed by wire target −18 mm / ID 1,
requesting a travel-relative 22.5 mm left shift. Noncancelled lane update and
received/executed 1/1 follow; automatic STOP is written 750 ms after the lane
write. The operator confirms physically stopped, clearly shifted left and stayed
on track. The saved note contains that observation; the automated stop-proof
flag remains false. Physical displacement was not measured.

### guardian-sdk-left-right-shifts-accepted-2026-11-18.json

Unmodified cumulative 48-event `96fc393` export; SHA-256
`81d726d86f5ca2863730eb0fb3117896f135b299e23d0cbb60485e00aa74c00e`.
Retains the accepted left trial, then a separate right diagnostic after
repositioning and a 3752 mV battery sample. Position 39/code 31 reverse supplies
+22.5 mm; reference −22.5 and target negative-zero / ID 2 request a 22.5 mm right
shift. Noncancelled lane update and received/executed 2/2 follow, then STOP
751 ms after the lane write. The operator confirms physically stopped, clearly
shifted right and stayed on track. Both confirmations are in operator notes.
These are isolated small shifts, not repeated Computer racing or exact native
fine-lane steps. No credentials are present. See [the steering acceptance and
lane model](../review/RELATIVE-LANE-CONTROLS.md#guardian-left-and-right-shifts-physically-confirmed).

### guardian-sdk-unsolicited-lane-cancel-2026-11-18.json

Unmodified cumulative 52-event export from `835f77b`; SHA-256
`331055a00d4bc6b4b2d23d5e2ad9500900e7040e48c8fb8ca14f7aa2e1bf77f1`.
The earlier 29-event trial is retained verbatim. After confirmed physical stop,
entrance repositioning, explicit stopped pit recovery and a fresh 3894 mV sample,
the new diagnostic receives no optical position or transition. It reports
off-track status at +670 ms, an intersection-family packet at +1039 ms and
lane cancellation state `0x81` at +1279 ms; host STOP follows at +1280 ms.
There is no host lane, cancel-lane or turn command in the entire capture.
The operator missed the movement, then confirmed stopped on track; no path or
lane-completion observation is claimed. This is not rejection of a newly sent
host lane request. Initial metadata and pre-confirmation flags remain unchanged.

### guardian-sdk-eligible-straight-no-attempt-2026-11-18.json

Unmodified cumulative 72-event export from `835f77b`; SHA-256
`7d88e6b51d74530c03f21cbcd5f230a133c8b92008fe7e731d28f79cf7a2f4e6`.
The operator requested a watched repeat after confirming stopped on track.
Battery is 3814 mV. The four-second diagnostic reads ordinary straight 39/code
20 then 19, reverse, with 440.16 and 280 mm remaining; both geometrically
qualify for a +9 mm target from the measured −13.5 mm lane. No lane request is
sent. One optical calibration is sent; no new cancellation or recovery event
occurs, and the normal deadline stops the run. The operator confirms physically
stopped, moved normally and stayed on track. This evidence prompted the
advancing-clock regression; a fixed-clock replay must not be presented as an
exact reproduction of the recorded no-attempt behavior. Neither recording
contains credentials. See [the paired-trial report](../review/RELATIVE-LANE-CONTROLS.md#entrance-attempt-and-watched-repeat).

### guardian-sdk-lane-no-attempt-late-straight-2026-11-18.json

Unmodified 29-event export from `835f77b`; SHA-256
`aea4422fb668da9b915687faefc439620d5d70d5e8e6a94832986b2674f602dd`.
The operator identified the charged **Z. Drive without P** as Guardian and
confirmed presence beside the track. Initial battery is 4117 mV; no moving
low-battery, charging, recovery or off-road report appears. Its first code,
39/33 reverse, arrives 1163 ms after positive speed with only 119.84 mm of the
ordinary straight remaining; the 250 mm gate withholds steering. Later codes
are curves. One ordinary optical offset calibration is written; no lane/turn
request is sent, and STOP follows at the four-second deadline. The operator
subsequently confirms physically stopped and stayed on track without spinning;
no steering maneuver was attempted. The initial model metadata, pre-motion
operator note and pre-confirmation `physicalStopVerified: false` are retained;
no credentials are present. See
[the charged-trial analysis](../review/RELATIVE-LANE-CONTROLS.md#charged-guardian-trial-late-straight-reading).

### guardian-sdk-lane-no-attempt-low-battery-2026-11-18.json

Unmodified 46-event export from `a028e4e`; SHA-256
`3c2dc7aec7e200b6b203a425c73523cb6e36d823c38de93aa39c12ef0fc3947d`.
Trace car 0 is the other device, removed without motion; trace car 1 / driver 2
is Guardian reconnected as “Z. Drive.” Its initial battery reading is 3631 mV.
The short left diagnostic requests 300 mm/s, then receives a low-battery status
359 ms later. Five position readings identify finish 33 and curves 17/20, so no
ordinary-straight gate qualifies and no lane/offset/turn command is sent. STOP
comes from the four-second deadline. The operator subsequently confirms physically
stopped and only about halfway around; power-off/charging is requested, not confirmed.
This is **no steering attempt**, not a failed lane maneuver or race. See
[the trial and diagnostic-health repair](../review/RELATIVE-LANE-CONTROLS.md#first-short-guardian-trial-no-lane-request).
The original snapshot predates that observation; no credentials are present.

### guardian-sdk-three-forward-laps-2026-11-18.json

Unmodified cumulative 184-event export from runtime `84f799c`; SHA-256
`733bba74f5a7dbc5a9869736c93e23af14841158fc703b55741328f518286ad0`.
It retains the accepted scan above the new forward-run traffic, on trace car
index 2 / driver 4. The separately authorized forward check requests 300 mm/s,
adds 52 optical positions and 29 transitions, counts three full observed laps
and sends STOP after 36.310 seconds. One code-derived offset calibration occurs;
no lane/turn/recovery-policy command or recovery/off-road message occurs.
The operator subsequently confirmed stopped and all laps on track without spinning;
that later observation is documented in [the acceptance report](../review/FORWARD-BASELINE.md#guardian-physical-acceptance).
The immutable export predates that confirmation and retains automated
`physicalStopVerified: false`. No credentials or proprietary binaries are present.

### guardian-sdk-scan-2026-11-18.json

Unmodified 88-event export from unchanged runtime `84f799c`; SHA-256
`f65bcc19eadeda9c68bfedf3f099220d1019725abf7080f09506dfe151ddd592`.
The first two trace cars are stationary identification attempts; the actual scan
is trace car index 2 / driver 4, physically identified as Guardian by a power-off
check and reconnected alone. SDK firmware 11866, battery 3762 mV, ceiling 300 mm/s.
Fifteen positions and eight transitions close a seven-section, 2.879 m map with
no inferred/special sections. One normal optical offset calibration follows the
first code; no lane/turn request, recovery or off-road notification occurs.
STOP follows closure. The snapshot's notes still say acceptance is pending;
the operator subsequently confirmed stopped, stayed on track, and map matches.
That later observation is recorded in [the report](../review/SCAN-RETRY-AND-APP-MODE.md#guardian-sdk-scan-passed-physical-acceptance),
not retroactively inserted into the original capture. Initial unknown-model
metadata is preserved; final diagnostics name Guardian. No credentials are present.

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
