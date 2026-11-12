# Fast & Furious edition: independent static review

Reviewed 12 November 2026. This is the primary kit identified by the owner. The
review examines Android package `com.anki.foxtrot`, XAPK-listed version 3.4.0,
build 403. Decompiled BuildConfig independently confirms package and build; its
VERSION_NAME is empty, so the version name relies on the container metadata.
No APK or firmware was executed, and no physical cars were tested.

## Identity and provenance

The vendor's legacy download route was not usable during this review. The package
was obtained from the [APKPure listing](https://apkpure.net/anki-overdrive-fast-furious-edition/com.anki.foxtrot/download)
using its XAPK download endpoint. This is a third-party mirror, not an authenticated
vendor delivery. Do not treat static consistency as a safety endorsement of that APK.

| File | SHA-256 |
|---|---|
| com.anki.foxtrot.apk | `78c63be8ee611adf1894c4d32c1b70418d921fefa667ab3d0d8e645164b1b60b` |
| main.403.com.anki.foxtrot.obb | `24861aa707f06eeba958bdee4294ef4d2de63c04a26113b15a6cc9c9a1eb1991` |
| patch.403.com.anki.foxtrot.obb | `31bcf75ded1ee00d17bfd5cdaf2866cd75d21f9274856136834c7eed91e5d4e1` |
| armeabi-v7a/libDriveEngine.so | `0eef63a8135f4cfe7bb16b4effa1f720192cc2c1f340d0c8c8f0c2b9835f3d7f` |
| classes.dex | `b65c0286f8f0436f06f71f3f1d2bfecbe4872f138f7eedf3b5078a889e74528f` |

OpenSSL verified the GOOGPLAY.SF CMS signature against the included certificate;
all 172 checked manifest entry digests matched, as did the signed SHA-256 manifest
digest. Certificate SHA-256:
`5D9922C1A863FFC00FAD8FA1B10717FC406B65CF4512D18E308862922997A74F`.
This certificate differs from the previously reviewed OVERDRIVE APK's certificate.
These checks establish internal consistency, not a trusted signing identity or
independent authenticity of the OBBs. APKs, OBBs and decompiled proprietary code
remain outside the repository. No graphics, music or film branding were imported.

## Reproduced comparisons

- JADX 1.5.3 processed 1,597 classes, reporting two errors. Decompiled
  `com/anki/VehicleController.java`, `com/anki/bluetooth/le/LeService.java` and
  `GattAttributes.java` are byte-identical to the standard OVERDRIVE review's
  outputs. That supports a common Android Bluetooth transport; it does not prove
  every firmware version's behavior.
- Extracted 91 JSON configuration files and 21 track definitions from the main
  OBB's `assets/rams/foxtrot/basestation/config`. Running the existing
  `tools/extract_config.py` produced **byte-identical** committed `pieces.json`,
  `vehicles.json` and `weapons.json`: 21 piece IDs, 21 models and 38 weapons.
  This compares the extractor's selected fields, not every source setting.
- The native library differs from standard OVERDRIVE. It was separately imported
  and analyzed with Ghidra 12.2, then exported with the repository's
  `ExportControl.java` and `ExportSystems.java`. Analysis took 364 seconds and
  reported success, but also **3,028 WARN lines and two ArmAnalyzer context-register
  conflict errors**. All 443 selected control entries and 656 selected systems
  entries exported without a failed decompilation marker. Those counts include
  duplicate constructors and linkage stubs; they are not counts of manually
  verified behaviors. There are 20 and 155 decompiler warning comments respectively.

Selected real function addresses in this edition (not the standard app's addresses):

| Function | Address | Observed structure |
|---|---|---|
| SetVehicleSpeed::GetBytes | `006ab92c` | 7 bytes; two 16-bit values and a flag after header |
| ChangeLane::GetBytes | `006aba58` | 12 bytes; two 16-bit values, floating offset, two final flags |
| SetOffsetFromRoadCenter::GetBytes | `006aca98` | 6 bytes; floating offset after header |
| PingRequest::GetBytes | `006ad4bc` | 2-byte message; no car-side timeout established |
| CarMsgSupercode constructor | `006b647c` | Message ID `0x4f`, length byte 6, unsigned code and char |
| CarMsgZoneFxSupercodeDetected constructor | `006b67a4` | Message ID `0x53`, length byte 6, unsigned code and char |
| AIItemUseBrain::UpdatePowerZoneUsage | `007162ac` | Calls Power Zone conditions, affinity and item-role selection |

These selected serializers support the existing packet sizes; they do not prove
physical left/right, steering sign, braking distance, or notification timing.
Unknown packet handling remains conservative. Slipstream does **not** implement
Power Zone game effects or claim those supercode messages are ordinary position
notifications. A ping implementation alone would not solve host-loss stopping.

## What matters for the Fast & Furious kit

The raw `characterItemUseConds_powerZoneFF.json` contains Power Zone seek/avoid
conditions, target-relative separation conditions, and differing AI usage styles.
Together with the native Power Zone functions, this shows that the special track
is part of game logic beyond its geometric footprint. The extracted shared track
tables are insufficient to reproduce that behavior. Capture real notifications,
identify code-to-zone mapping and direction, then add replay fixtures before
implementing effects. Avoid awarding attacks from an unconfirmed zone location.

The vendor's [OVERDRIVE 2.6 FAQ](https://support.anki.bot/article/329-overdrive-2-6-frequently-asked-questions)
says the Fast & Furious cars appear as Mammoth and Dynamo in that app, while its
Power Zone track is unsupported and can crash its scan. That warning concerns
**OVERDRIVE 2.6**, not a demonstrated Slipstream failure. Neither that FAQ nor this
static review establishes Slipstream compatibility with every kit/firmware revision.
Record each real car's model and firmware during the first hardware session.

## Presentation and architecture implications

Use the shared protocol/data as the foundation, with explicit edition-specific
capability gaps. Do not recreate the original app's licensed film art or imply
its campaign has been ported. The new Three.js studio provides original 3D cars,
track, lighting, orbit and zoom; the phone controller stays lightweight. It is
not a Unity runtime or a physically validated digital twin. Elevation is not
measured by this map. See [deployment instructions](../DEPLOYMENT.md) for the
Codespaces relay / nearby Bluetooth laptop / phone controller arrangement.

Next physical validation priorities: vehicle identity and firmware, speed/stop,
lane sign, repeatable track scanning, mixed-edition multi-car operation, then
Power Zone code traces. All remain open. The broader independent review's
provenance/distribution limitations also apply to these derived tables.
