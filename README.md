# Second Lap Labs OVERDRIVE capstone

Four teams; four 170-minute classes: introduction, two investigation and build
sessions, and comprehensive team presentations. Every student investigates and
presents. See [the student brief](docs/student-brief.txt) for the current scope;
older assignments in the scenario history are superseded.

Casey and Matt are considering a fictional investment in reviving discontinued
robot racing kits. Rowan Veyl has offered a controller prototype, a project
history and a set of commercialization claims. Your team is the technical
diligence group. Establish what works, what is trustworthy and what must change.

The company maintains a [public website and journal](https://second-lap-labs.genie123.chatgpt.site/)
with a founder profile, development entries and project records.

Read SIMULATION_NOTICE.txt before testing. This repository is a course scenario.
There are two runnable paths. The Python simulator models drive/stop in memory.
The **Chrome bench** can replay fixtures or ask one selected OVERDRIVE car
for ping, firmware version and battery telemetry, and request engine LED or
legacy headlight changes. A November 5 user trace confirms live communication
on one car; the new engine LED sequence and classroom fleet reconnection still
require physical validation.
All motion commands remain simulation-only.

**Class starts here:** [tonight: charge, connect, light](bench/TONIGHT.md) ·
[30-car enrollment and reconnection](bench/FLEET.md) ·
[capstone assignment](docs/CS_460_FA_26_Semester_Project.docx) ·
[founder video](media/second-lap-pitch.mp4) ·
[Chrome laptop setup and first battery check](bench/LAPTOPS.md) ·
[bench launch and protocol references](bench/BENCH.md).

The fleet and engine LED controls are available on `main` through
[PR #1](https://github.com/matthewluallen/cs460-second-lap-overdrive/pull/1).
Existing Codespaces must pull the updated `main` and reload the bench; opening a
Codespace does not automatically update its checkout. Look for `identify-v1`.

The optional [power-cycle, near/far and visual identification trial](bench/IDENTIFY.md)
is available on `main` through
[PR #2](https://github.com/matthewluallen/cs460-second-lap-overdrive/pull/2).
It listens for one selected candidate while the student powers their own car
off/on, then moves it near/far three times. A separate bounded lights-only
signal is available before enrollment; ordinary light/SDK controls still require
confirmation. Neither result confirms or saves a car automatically. Advertisement
monitoring is experimental and may be unavailable; all physical behavior remains
hardware-unverified.

For the Node platform, use Node 22 or 24. Run this from the repo root,
then open the private forwarded port in a separate tab in desktop Google Chrome,
or open http://localhost:8000 locally:

```sh
npm ci --ignore-scripts
npm start
```

This installs deliberately old Express and Lodash runtime dependencies for the
[dependency investigation](bench/DEPENDENCY-LAB.md). Express serves the bench and
shared MOCK support API on `127.0.0.1:8000`; Lodash sorts and groups records.
For the car activity without Node dependencies, use this static fallback instead:

```sh
python -m http.server 8000 --bind 127.0.0.1 --directory bench
```

The remote Codespace serves the page; the laptop owns the Bluetooth radio.
Each student enrolls only their own pair in their own Chrome profile and private
Codespace page. Use the same Codespace and forwarded port 8000 at home and in
class; bookmark its HTTPS address. The saved car labels live in that browser for
that site, not in GitHub or a shared classroom roster. Initial enrollment needs
an unambiguous physical match. Later reconnects check the saved browser ID even
when Chrome needs its chooser again. See [FLEET.md](bench/FLEET.md) for duplicate
model names, crowded classrooms and what happens after permissions change.
The main page is a compact quick activity. For saved classroom evidence, open
`http://localhost:8000/evidence.html` (or `evidence.html` on the forwarded HTTPS
origin) **before starting**. That page includes LED observations and trace
Save/Clear controls. Finish and disconnect before switching pages: sessions and
traces do not transfer. The optional synthetic worksheet is on `worksheet.html`.
It defaults to disposable tab-local records. With the Node server, explicitly
open `worksheet.html?store=server` for shared process-local MOCK records; restart
the server to reset those records. A page reload only resets the default local
store. Keep real kit evidence out of either worksheet store.

On the evidence page, start in replay, then compare a live off-charger reading.
Confirm the assigned physical car before enabling its light controls, and record the visible
result separately from the write. Trace entries identify their source. The Python
simulator requires Python 3.10+ and no extra packages:

```sh
python -m lapreturn demo
python -m unittest discover -s tests -v
python -m lapreturn shell
```

The shell accepts one JSON object per line. State lasts until you exit. Example:

```json
{"op":"command","token":"pilot-red","team":"red","vehicle":"sim-red","action":"drive","value":80,"nonce":"r1"}
{"op":"status","token":"pilot-red"}
{"op":"command","token":"pilot-red","team":"red","vehicle":"sim-red","action":"stop","value":0,"nonce":"r2"}
```

These public pilot tokens only address disposable local simulation state.
The protocol and units are teaching abstractions, not an Anki wire protocol.
Real driving requires an independently validated adapter and safety gate.

After the hardware activity, save your evidence and disconnect before the
optional [worksheet authorization exercise](bench/CWE-LAB.md) or
[simulator CWE investigations](bench/SIMULATOR-CWE-LAB.md). The simulator
investigations cover authorization, repeated requests and profile integrity
using disposable local state; their outputs are not car telemetry. Run the
reproductions from the repo root:

```sh
python -m lapreturn.cwe_lab
```

The separate [dependency investigation](bench/DEPENDENCY-LAB.md) provides
`npm run dependency-lab` and source-pinned advisory review. Its fixed-input
demonstrations use installed libraries without external requests or car control.
`npm audit` failures are expected for this baseline; preserve them as evidence
and make repairs on a separate student branch rather than using `npm audit fix`.

Start with docs/student-brief.txt and docs/protocol.txt. Review the supplied
business materials and history as evidence, not as verified documentation.
The scenario development history is available in this branch's normal Git log.
See [history instructions](history/README.md) to inspect commits and dates.

For Codespaces, choose **Code → Codespaces → Create codespace on main**, then
run the commands above in its terminal. The default Codespaces image includes
Python. No server starts automatically. Choose the Node platform or the static
fallback above; run only one on port 8000.
Create a branch or fork for your changes; see [contribution guidance](CONTRIBUTING.md).


## Instructor-only motion research preview

A separate [single-car proof of concept](instructor-drive/README.md) implements
real legacy Anki speed/STOP packets behind an explicit server opt-in. Its page
starts in SIMULATION; LIVE requires a freshly observed physical car match and
one explicit bounded pulse. Ordinary `npm start`, the static bench fallback,
and the existing course exercises remain stationary. Do not enable or publish
LIVE for students until review and [hardware acceptance](instructor-drive/README.md#hardware-acceptance-record--all-items-initially-pending).
See [source/license research](instructor-drive/SOURCES.md) and
[the audit/test record](instructor-drive/VALIDATION.md). This does not change the
course's battery-first activity or make driving a student requirement.
