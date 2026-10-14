# Second Lap Labs OVERDRIVE capstone

Four teams; four 170-minute classes: introduction, two investigation and build
sessions, and comprehensive team presentations. Every student investigates and
presents. See [the student brief](docs/student-brief.txt) for the current scope;
older assignments in the scenario history are superseded.

Casey and Matt are considering a fictional investment in reviving discontinued
robot racing kits. Rowan Veyl has offered a controller prototype, a project
history and a set of commercialization claims. Your team is the technical
diligence group. Establish what works, what is trustworthy and what must change.

Read SIMULATION_NOTICE.txt before testing. This repository is a course scenario.
It runs a **local simulator**, not real Anki hardware. No external packages,
accounts, API keys, internet access or installation are required for the demo.
Use Python 3.10 or newer. No claim of physical kit compatibility is made here.

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
Physical integration must use an independently validated adapter and safety gate.

Start with docs/student-brief.txt and docs/protocol.txt. Review the supplied
business materials and history as evidence, not as verified documentation.
The original 13-commit scenario history is preserved in
[history/student-history.bundle](history/student-history.bundle). See the
[history instructions](history/README.md) to inspect commits and dates. The
GitHub publication history is separate from this fictional historical record.

For Codespaces, choose **Code → Codespaces → Create codespace on main**, then
run the commands above in its terminal. The default Codespaces image includes
Python. This starter does not launch a web server or connect to Bluetooth.
Create a branch or fork for your changes; see [contribution guidance](CONTRIBUTING.md).
