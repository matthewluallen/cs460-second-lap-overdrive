# Second Lap Labs pilot evaluation

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
Use full Git history; a source ZIP alone does not preserve past versions.
