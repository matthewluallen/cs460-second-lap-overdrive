> Correction, 13 November 2026: this is a steering hypothesis, not an established firmware root cause. The latest spin-offs sent neither 0x25 nor 0x2c. SDK reference-tool pairing does not prove a universal firmware precondition; the stored lateral value is a printed-code-derived estimate (initially zero), not an independently measured current offset. The causal claim below that the firmware rejected the command *because* the reference was undeclared is unproven. See SYSTEM-RECOVERY-PLAN.md before any hardware trial.

# Groundshock steering root cause

Firmware: Anki Groundshock **11866**. Symptom: the car scans and drives, accepts
a left-lane command, but the command is cancelled almost immediately and no
lateral movement is observed. This document records the diagnosis, the evidence
behind it, what is **confirmed** versus **hypothesised**, and the fix shipped on
`slipstream-and-security-hardening`.

## Summary

The SDK steering path emitted `CHANGE_LANE` (0x25) **without** first declaring the
offset reference with `SET_OFFSET_FROM_ROAD_CENTER` (0x2c). On firmware 11866 the
bare 0x25 is answered with a cancellation and the command never registers. The fix
restores the 0x2c→0x25 pairing that the open-source drive-sdk performs, declaring
the car's current measured offset (not a blind zero) so our tracked absolute frame
is preserved.

## Evidence chain

1. **Authoritative SDK behaviour.** `drive-sdk` `vehicle-tool`
   (`cmd_anki_vehicle_change_lane`, `examples/vehicle-tool/vehicle_cmd.c:607-635`)
   writes `set_offset_from_road_center(0.0)` immediately before `change_lane` on the
   same characteristic. The pairing is the contract, not an optional nicety.

2. **The committed trace omits 0x2c.** `fixtures/groundshock-numbered-steering-cancelled.json`
   (schema `[ms, carIndex, dir, hex]`): at **32780 ms** a lone `CHANGE_LANE` (0x25)
   goes out with no preceding `SET_OFFSET_FROM_ROAD_CENTER` (0x2c) on the stream.

3. **The car reports a cancellation.** At **32821 ms** the car returns a `0x41`
   lane-change update whose id byte has the high bit set (0x80) with current==target
   and horizontal speed 0. The cancel semantics are confirmed from the decompiled
   F&F app `Localization::ProcessLaneChangeUpdate` (see `re-out/steer.c`): the 0x80
   id bit and zero horizontal speed denote a cancelled/again-dropped command.

4. **Firmware never registered the command.** `CheckForDroppedCommand` treats
   `recvID == 0xFF` as "no lane-change command currently registered". The trace shows
   recvID stuck at 0xFF across the window — the firmware did not take ownership of the
   0x25 because its offset reference was undeclared.

## Confirmed vs hypothesis

**Confirmed (from artifacts in-repo and decompilation I ran):**
- 0x41 high-bit id + zero horizontal speed = cancellation (decompiled `ProcessLaneChangeUpdate`).
- `recvID == 0xFF` = no command registered (decompiled `CheckForDroppedCommand`).
- Our SDK path omitted 0x2c before 0x25 (source + committed trace).
- The drive-sdk reference pairs 0x2c then 0x25 (SDK source).

**Hypothesis (strong, NOT hardware-verified):**
- Adding the 0x2c precondition causes firmware 11866 to register the 0x25 and
  produce real lateral movement. An SDK ACK/registration is evidence of command
  *processing*, never proof of physical lane completion on this firmware. This must
  be confirmed on the car (see "Next hardware test").

## Fix

`slipstream/car.mjs` `steerTo()`:
- On the `sdk` initialization profile only, send `SET_OFFSET_FROM_ROAD_CENTER` with
  the car's **current measured offset** (`offsetSign * this.lateral`, with `-0`
  normalised to `0` so we never write `0x80000000` on the wire) immediately before
  `CHANGE_LANE`. We declare the real reference rather than a blind zero so the
  absolute target still resolves to the intended destination and Slipstream's tracked
  frame is not silently shifted. (The handoff warned explicitly against inserting zero
  resets into absolute steering without handling the frame; this honours that.)
- Non-SDK profiles (F&F, simulator, undefined) keep the bare `CHANGE_LANE` — their
  reference-frame handling is unchanged and their regression coverage is preserved.
- The lane-offset write is a keyed send (`'lane-offset'`), so dedup, latest-wins
  ordering, cancellation and STOP all clear it as a pair with `'lane'`.

Regression tests: `slipstream/steering-offset.test.mjs` (6 tests) — SDK writes
0x2c then 0x25 in order; non-SDK profiles stay bare; reference tracks current offset;
dedup sends neither and consumes no id; STOP clears the pair; cancellation drops both.

## Safety invariants preserved

Command ordering, STOP priority, safety latches, neutral-input arming, watchdogs and
shared-pit behaviour are unchanged; the full suite (563 tests) passes. The lane-offset
send participates in the same keyed-queue discipline as every other command, so STOP
and cancellation remain authoritative.

## Build-environment note

The declared dependency `three@0.187.0` was absent from this workspace's
`node_modules`, which made four `platform/*` suites fail at import with
`Cannot find module 'three'`. This was an install gap, not a code defect; installing
the declared version restores all four (42 tests) and the full suite to green.

## Next hardware test (single variable)

Change exactly one variable from the last physical trial: enable the 0x2c precondition
on the SDK path. With fresh supervised readiness and the car on the track:
1. Confirm STOP and the pit exit behave normally (unchanged paths).
2. Issue **one** left nudge.
3. Capture the BLE stream and check: (a) 0x2c precedes 0x25; (b) the 0x41 reply's id
   byte high bit is **clear** (not a cancel); (c) `recvID != 0xFF` (command registered);
   (d) observed lateral movement.

A cancel (0x80 set) or `recvID == 0xFF` after the fix would falsify the hypothesis and
point to a deeper firmware-11866 difference in offset/ACK semantics. Do not repeat the
prior unchanged trial, and change only this one variable.
