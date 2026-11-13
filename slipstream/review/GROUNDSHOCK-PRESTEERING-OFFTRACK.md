# Groundshock pre-steering spin-off — 2026-11-13

Build tested: 5b3816d. Profile: SDK. Firmware: 11866. Operator identified Groundshock and reported that it spun off the track. No subsequent motion is authorized by this report.

Capture: `slipstream/fixtures/groundshock-sdk-presteering-offtrack.json`
SHA-256: `802779a40ad7789e09171827d17a27a077601d3d8d4ecf8e09e7369fc72137de`

## Recorded sequence

Times are capture-relative milliseconds, not firmware execution timestamps.

| Time | Direction | Evidence |
| --- | --- | --- |
| 192112 | TX | `06 24 f0 00 e8 03 00`: requested speed 240 mm/s, acceleration 1000 mm/s² |
| 192157 | RX | `07 36 f0 00 e8 03 00 00`: desired 240, acceleration 1000, final speed field 0 under current decoder |
| 193986 | RX | `01 43`: currently unknown packet; retain without inventing meaning |
| 194267 | RX | `01 2b`: delocalized/off-road |
| 194268 | TX | `06 24 00 00 c4 09 00`: STOP, acceleration 2500 |
| 194315 | RX | `07 36 00 00 e8 03 0a 07`: desired zero, acceleration 1000, final speed field 1802 |
| 199744 | TX | STOP reasserted |

Only one nonzero speed command exists. No 0x25 CHANGE_LANE, 0x2c SET_OFFSET, 0x27 position, or 0x29 transition exists anywhere in this capture. The off-road signal follows the drive command by 2155 ms. The trace records STOP 1 ms after the signal; this does not establish Bluetooth delivery latency or physical stopping time.

## Interpretation and limits

The new offset-before-steering sequence was never exercised. This capture neither validates nor falsifies that steering hypothesis. It does establish a separate pre-localization driving failure.

The 1802 value is present in the raw final signed 16-bit field, not a UI arithmetic error. Local F&F native export `CarMsgSpeedUpdate` constructor/unpacker/GetBytes (006b3264/006b32d4 in native-control.c) supports an eight-byte packet containing three signed 16-bit values. That structural agreement does not prove accurate wheel-speed measurement or firmware-11866 field semantics. Do not infer physical speed from this packet alone.

Battery response was 3664 mV. Status frames changed before movement, including `05 3f 00 00 01 00`; the current decoder labels this lowBattery=true, onCharger=false. Treat as a diagnostic concern, not a demonstrated cause of the spin-off. The capture contains no subsequent battery reading.

Next work: verify status and speed field semantics against native consumers; investigate absence of all optical track telemetry, track placement, wheel/tire condition and charge before another supervised run. Do not change SDK flags, thresholds or steering based on an unproven cause. Keep the shared pit latched until physical recovery is confirmed.
