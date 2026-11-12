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
