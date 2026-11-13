# Live scan diagnostics — 12 November 2026

## Changes

- Optional measured starting-lane calibration precedes the scanner's lane-change
  and movement commands. It is bounded to ±68 mm, only accepted while stopped and
  ready, and requires a separate UI measurement confirmation. The UI snapshots the
  value for the countdown, then clears it so another attempt needs a fresh choice.
  Blank preserves previous behavior. The existing offset-sign convention is still
  hardware-unverified; the record explicitly labels this as operator calibration,
  not an observed position. Calibration cannot refresh the telemetry watchdog.
- Native 15-byte 0x41 lane-change diagnostics now expose current/target offsets.
  The captured 654321 sentinel is marked unknown. It cannot update localization,
  reported movement, or watchdog freshness. Unknown offset samples also cannot
  contaminate learned steering-sign comparisons.
- Live car checks distinguish requested speed from the latest reported speed and
  its age; show firmware/profile, connection/stop status, battery, position and
  transition counts, notification age, malformed/unsupported packets and lateral
  offset status. Write attempts, failures and durations are retained in exports.
  A successful browser write is not firmware semantic acceptance.
- Raw trace format remains replay-compatible. Exports add firmware/profile/driver
  identity, scan-start markers and settings, bounded event annotations, safety
  limits, live counters, operator observations and build identifier. Counts keyed
  by message ID/frame length help distinguish unsupported compact formats.
- Save trace works during recording. A scan automatically starts capture if it was
  stopped; connection startup already auto-records. The UI displays capture drops.
  Byte events remain capped at 200,000, annotations at 1,000, diagnostic frame keys
  at 128, notes at 2,000 characters, and last raw notification at 64 bytes. Raw
  captured events retain their complete bytes within the existing event budget.

## Next supervised experiment

1. Start with one charged car and a known ordinary closed circuit, including its
   start/finish piece. For this comparison omit special/unverified pieces. Record
   the physical layout in **Physical observations**.
2. Connect using the intended kit profile. Check firmware, startup result, battery
   and notification age. Save an initial trace if initialization fails; do not
   repeatedly start scans to disguise that failure.
3. For a baseline leave calibration blank. For the comparison, place the stopped
   car on a straight piece, measure its centre relative to track centre in the
   intended driving direction, enter signed millimetres and confirm measurement.
   Use the same car, direction, lane and circuit in both attempts.
4. Confirm the track is clear, then Scan track. The three-second countdown, F&F
   300 mm/s ceiling, five-second first-telemetry timeout, two-second gap and scan
   budgets remain in force. Observe physical movement and stop behavior directly.
5. Record what physically happened, then **Save trace** during or after the attempt.
   This saves locally; it does not upload diagnostics or request more movement.
6. Compare unknown-offset reports, first valid position time, frame lengths/counts,
   write failures, stop reason, and physical observations. Change one variable per
   attempt. Lane feedback alone is not a successful scan; the map needs valid codes
   and closure. A requested-speed display cannot confirm motion or stopping.

## Verification and limits

508 Node tests passed after the functional changes; additional metadata/style-only
changes were checked with the targeted diagnostics/host/trace suite. The new tests
replay Groundshock's actual lane report, reject malformed/nonfinite lane messages,
verify no watchdog refresh from diagnostics/calibration, check calibration bounds
and stopped-state restrictions, command order, UI confirmation and snapshotting,
annotation bounds, live export and existing replay compatibility.

The UI was inspected in a separate local browser tab using a simulated car. No
physical car commands were issued. No physical scan success is claimed. Link loss
or a hung browser can still prevent a stop/reset reaching firmware. The host and
firmware protections described in the earlier review remain necessary.
