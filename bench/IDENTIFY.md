# Check one candidate against your physical car

This optional trial is available on **`main`** through PR #2. Update your
Codespace, look for `identify-v1`, and record its revision when trying these
controls. The existing charge/connect/light activity remains available. This
combined identification workflow is **hardware-unverified**: its timing and
signal-strength rules are uncalibrated software heuristics, not a measured
distance, authenticated identity, safety certification or grading threshold.

The trial compares three things: what you physically do to your own car,
advertisements from one selected browser candidate, and a visible light pattern.
No result assigns or remembers a car automatically. A quiet enrollment area
with one powered car is still useful; see [FLEET.md](FLEET.md).

## Prepare one candidate

1. Use your own Chrome profile and exact Codespace forwarded HTTPS origin on
   the physical laptop with the radio. Open the [evidence page](evidence.html)
   before starting if you need a saved trace. Save any earlier session, then
   disconnect. Candidate selection and advertisement sampling start disconnected.
2. Enter your physical Assigned car label, such as `S03-A`. Keep your second car
   off. Take the test car off its charger, keep its wheels clear and release
   competing controllers. Coordinate with nearby owners before testing a classroom
   candidate; do not select or signal unrelated devices.
3. Click **Choose candidate for identification**. The default chooser filters
   for the Anki service; the existing all-devices fallback is an explicit second
   attempt for a car missing from that filter. Selecting a candidate grants the
   page a browser device object; it does **not** connect GATT or send commands.
   A repeated model name is only a candidate, not a confirmed assignment. If the
   label is already saved, the chosen browser ID must match that saved mapping.
4. Keep the same candidate for the complete trial. Move and power-cycle only
   your own physical car, leaving the laptop and nearby cars stationary. Keep
   its orientation as consistent as practical. Plan a near position around
   20 cm from the laptop and a far position around 2 m away. These positions
   provide a repeatable contrast; the app cannot measure either distance.

An address written on your personal inventory remains an operator note. This
page cannot read a MAC address or select a car by a typed address. Browser IDs
are scoped permission identifiers; changing origin or losing permissions may
require another enrollment.

## Power, then three near/far pairs

Click **Start power + proximity check**. The optional browser method
`watchAdvertisements()` watches advertisements for this selected candidate;
this stage opens no GATT connection and sends no car commands. Watch setup has
a 10-second deadline, and the overall trial has a 180-second limit.

For each displayed step, make the physical change first, click the ready/sample
button (its text changes with the step), then wait for the sampling window to
finish. Do not move or toggle the car in
the middle of a window. There are nine manual steps:

| Step | What you do before clicking ready | Sampling window |
| --- | --- | --- |
| 1. On baseline | Power your car on and leave it still. | 5 seconds. |
| 2. Off | Physically turn your car off using its kit instructions. | 8 seconds: 2 seconds to settle, then 6 seconds observed for quiet. |
| 3. On return | Physically turn the same car back on. | 8 seconds; advertisements must return under the same selected browser ID. |
| 4. Near 1 | Put your car at the near position. | 5 seconds. |
| 5. Far 1 | Move only your car to the far position. | 5 seconds. |
| 6. Near 2 | Return it to the same near position/orientation. | 5 seconds. |
| 7. Far 2 | Return it to the same far position/orientation. | 5 seconds. |
| 8. Near 3 | Repeat the near position. | 5 seconds. |
| 9. Far 3 | Repeat the far position. | 5 seconds. |

The software retains the first 50 raw samples per phase, counts additional
advertisements as omitted, and needs at least three valid recorded
signal-strength samples in each positive window: baseline, return and all
six near/far windows. Missing advertisements while the car is off are **not proof
that it was powered off**. Radio loss, browser behavior, low power and other
conditions can look similar. Clicking Disconnect is not a substitute for the
physical off/on steps. A changed browser ID after power-on makes this comparison
inconclusive; do not substitute a different candidate halfway through.
Reaching the sample cap does not automatically invalidate the result; preserve
the omitted count. Omitted advertisements still count against an off-window
quiet result, so the cap cannot make a transmitting car appear silent.

The displayed result can be consistent with your actions only if the power
observations fit and **all three** near/far pairs fit the software rule. Each
near median must be at least 6 dB stronger than its far median, and that gap must
exceed the larger spread of the two windows. The spread is the interquartile
range: the middle half of the readings. Otherwise the result is inconclusive.
These constants have not been calibrated on the classroom's cars or radios.
A strong signal or one dropped connection alone does not identify a car.

If advertisement watching is unavailable, setup fails, the trial times out or
there are too few samples, record that limit. Ordinary Web Bluetooth/GATT
support does not guarantee advertisement watching. Chrome's published status
lists this API behind an experimental flag; the app changes no flags or managed
policy. You can still use the explicit light trial below with nearby owners
coordinated, or return to isolated enrollment.
[Chrome implementation status](https://github.com/whatwg/bluetooth/blob/main/implementation-status.md) ·
[Chrome advertisement sample](https://googlechrome.github.io/samples/web-bluetooth/watch-advertisements.html)

## Connect that candidate and watch one light pattern

1. Let the check finish, or click **Cancel identification check**. Cancellation
   stops watching and keeps the selected candidate available; it does not qualify
   it. Once watching has ended, click **Connect selected candidate** to connect
   that retained object without opening another picker. A
   completed advertisement check never connects automatically. Wait for the
   notification-ready state before trying the pattern.
2. Click **Signal selected car** only when you can watch your physical car and
   nearby owners know a single classroom candidate may receive the trial. This
   dedicated action is allowed before assignment confirmation. It requests SDK
   mode with flags `0`, engine LED off, about 400 ms of off time, engine green
   for about 1.2 seconds, engine off, then SDK mode off. It sends no driving or
   firmware commands. Ordinary LED/SDK buttons remain locked until confirmation.
3. Observe which physical car, if any, shows the complete off/green/off pattern.
   A completed write is not a visible result. If you saw the pattern on your
   physically labelled car, explicitly record **I saw the pattern on my car**, then
   use **Confirm assigned car**, then **Remember confirmed car**. The report and
   confirmation remain your assertions, not a software identity certificate.
4. If a different car responds, nothing changes visibly, or the result is unclear,
   do not confirm or save the candidate as yours. Disconnect, record the outcome
   and improve isolation with the nearby owners before another deliberate trial.
   Do not automate a search through the fleet or signal several candidates at once.

The light sequence has a 10-second overall deadline. Hiding or leaving the page
interrupts an unfinished signal and leaves its physical outcome unknown. A disconnect or failed
write can prevent off/SDK-off cleanup; a hung write ends the connection rather
than starting overlapping commands. Record cleanup as unknown when it could
not complete. The sequence does not restore an arbitrary previous light or SDK
state. It is a bounded active observation, not a guarantee that the firmware
will display the requested color. The packet definitions come from the
[Anki SDK protocol](https://github.com/anki/drive-sdk/blob/410352617b8660338746a6bb2b2dd173afb1b91a/src/protocol.h);
compatibility with each Fast & Furious kit still needs physical observation.

## Save what happened

The evidence page records identification activity as **LIVE identification**,
separate from REPLAY fixture traffic. Keep the candidate browser ID/name,
physical label, host/browser/revision, phase times and counts, signal-strength
summary, incomplete stages, physical power/movement notes, light write outcomes
and your actual visible observation. Keep actual addresses in private inventory
or private evidence, not the public repository. A missing capability or an
inconclusive result is useful evidence; do not fill it in with a guessed identity.

Preserve the existing [battery and light evidence workflow](TONIGHT.md): save
the REPLAY 3700 mV baseline separately, disconnect/clear before live work, and
keep a live battery response distinct from capacity or runtime claims. Trace
limits and explicit cleanup recovery still apply. Before claiming this combined
workflow works on hardware, repeat it on the actual kit/browser and record all
three observations, including failures and alternative explanations.

Browser reference: [advertisement watching and events](https://bluetooth.spec.whatwg.org/#dom-bluetoothdevice-watchadvertisements).
Watching a selected device is separate from opening its GATT connection; neither
the permission nor the received signal strength authenticates a physical label.
