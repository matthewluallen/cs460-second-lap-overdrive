# Security updates

Updated 12 November 2026. This repository began as a course scenario that
shipped deliberate weaknesses for students to find. This document records the
change that repaired them, how each repair is verified, and what is still out
of scope.

**Original flawed baseline:** commit `ab809451fc99564474b2b83baca0f63b78c24034`
on `main`. Check that commit out (or tag it) to reproduce the original
exercises; the lab guides under `bench/` still describe its behavior.

## Summary

| # | Weakness | Where | Status |
|---|---|---|---|
| 1 | CWE-863 incorrect authorization: caller-chosen team accepted | `lapreturn/core.py` | Fixed |
| 2 | CWE-837 repeated request applied twice | `lapreturn/core.py` | Fixed |
| 3 | CWE-345 profile "authenticated" by the uploader's own checksum | `lapreturn/core.py` | Fixed |
| 4 | CWE-200 telemetry exposed every team's events | `lapreturn/core.py` | Fixed |
| 5 | CWE-770 unbounded event and nonce stores | `lapreturn/core.py` | Fixed |
| 6 | CWE-639 record readable by changing its ID | `bench/records.mjs` | Fixed |
| 7 | CWE-862 record could be added to another team's workgroup | `bench/records.mjs` | Fixed |
| 8 | CWE-20 loose record-ID coercion (`''`, `'1e2'`, `' 101 '`) | `bench/records.mjs` | Fixed |
| 9 | CWE-1395 vulnerable dependencies (8 advisories, 5 high) | `package.json`, lockfile | Fixed |
| 10 | Missing browser security headers | `platform/server.mjs` | Fixed |
| 11 | Test files and validation logs served to browsers | `platform/server.mjs` | Fixed |
| 12 | No request timeouts on the local server | `platform/server.mjs` | Fixed |

## Simulator (`lapreturn/`)

1. **Authorization (CWE-863).** `authorize` compared the vehicle's team with the
   team named in the request, so `pilot-red` could drive `sim-blue` by sending
   `"team":"blue"`. The token now decides the team. The vehicle must belong to
   that team and the `team` field must match it. Unknown vehicles and other
   teams' vehicles get the same refusal, so the reply does not reveal which
   vehicles exist.
2. **Repeated requests (CWE-837).** Nonces were recorded but never checked, so a
   redelivered `advance` moved the car twice. A repeated `(team, nonce)` with
   the same request now returns the first result with no second effect. The
   same nonce with a different request is refused. `stop` is always applied,
   whatever its nonce, so replay handling can never suppress a stop.
3. **Profile authenticity (CWE-345).** The only check was a SHA-256 the uploader
   computed themselves. Installation now also needs `signature`, an HMAC-SHA256
   over the canonical profile made with a publisher key of at least 32 bytes.
   The key is given to `Pilot(publisher_key=...)` or, for the shell, in
   `LAPRETURN_PUBLISHER_KEY`. With no key configured, installation is disabled.
   Digest and signature comparisons are constant-time. `sign_profile` is the
   publisher-side helper.
4. **Telemetry (CWE-200).** `telemetry` returned all teams' events. It now
   returns only the caller's team.
5. **Bounded state (CWE-770).** The event log and nonce store are capped at
   10,000 entries each; the oldest entry is dropped. A nonce older than the
   last 10,000 accepted commands is therefore no longer recognized as a repeat.
6. **Shell input.** A request without `op` now gets a readable error instead of
   `'op'`. Non-string tokens are refused as unknown.
7. **Tokens.** `Pilot(tokens=...)` and `LAPRETURN_TOKENS` (a JSON object of
   token to team) replace the built-in demo tokens. See the limits below.

## Support worksheet (`bench/records.mjs`, used by the tab store and the server)

6. **Record read (CWE-639).** Any recognized operator could open any record by
   ID. `read` now returns a record only to its own team, and answers
   `No such record` for both missing and other-team records.
7. **Record add (CWE-862).** An operator could file a record under another
   workgroup. `add` now refuses a workgroup other than the operator's team,
   before an ID is consumed.
8. **ID parsing (CWE-20).** IDs must be a positive integer or an exact decimal
   string. Notes must be strings.

## Platform server (`platform/server.mjs`) and dependencies

9. **Dependencies.** Express 4.17.1 and Lodash 4.17.15 were pinned to old GitHub
   source archives on purpose. `npm audit` reported 8 advisories (5 high) across
   express, body-parser, qs, path-to-regexp, send, serve-static, cookie and
   lodash, including prototype pollution, ReDoS, open redirect and command
   injection.
   - Express is now `5.3.0`, an exact version from the npm registry.
   - Lodash is removed. The server needed one sort and one count, now done with
     built-in JavaScript.
   - Every lockfile entry resolves to `registry.npmjs.org` with a sha512
     integrity hash. Installation no longer needs `codeload.github.com`.
   - `.npmrc` still disables lifecycle scripts.
   - `npm audit` reports 0 vulnerabilities as of the date above, and CI runs
     `npm audit --audit-level=low` on every push and pull request.
   - Node 18 is end-of-life; `engines` and CI now require Node 22 or 24.
10. **Headers.** Every response now carries a Content-Security-Policy
    (`default-src 'none'`, scripts from the same origin only, no framing, no
    form posts, no `<base>`), `X-Content-Type-Options: nosniff`,
    `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, same-origin
    opener and resource policies, and a Permissions-Policy that allows
    Bluetooth for the page itself and denies camera, microphone, location, USB
    and serial. Styles allow `'unsafe-inline'` because each page has one inline
    `<style>` block; scripts do not.
11. **Served files.** `*.test.mjs` files are no longer served from `bench/`.
    When the instructor page is enabled, only its page, modules and four linked
    documents are served; its tests and `validation/` logs are not.
12. **Timeouts.** Header, request and keep-alive timeouts bound stalled clients.
13. `/favicon.ico` answers 204 instead of a 404 console error.

Unchanged and still in force: the server binds `127.0.0.1` only, request bodies
are capped at 4,096 bytes, query strings use the flat parser, error messages are
bounded and never include stack traces, and the instructor drive page needs an
exact server-side environment value.

## Slipstream controller and relay (added after the repairs above)

`npm run slipstream` adds a page that drives real cars and a relay for remote players.
Neither exists under `npm start`; the option must be the boolean set by the
`--slipstream` argument, and no request can turn it on.

- **The server never commands a car.** Only the host browser holds Bluetooth links.
  The relay forwards player inputs to that browser.
- **Opening a room needs the host code** printed on the server console (or set with
  `SLIPSTREAM_HOST_CODE`, at least 8 characters). Wrong codes are limited to 10 per
  minute across all callers, so the room list cannot be filled by a stranger.
- **Nobody drives until the host lets them in.** A joiner's key does nothing until
  the host approves that player on the host page. Until then their inputs are
  refused and they receive no game state. A player cannot approve themselves.
- **Per-car codes are single-use in effect.** A car's seat key is replaced the moment
  a driver is approved for it. While an approved driver is connected, further
  requests for that car are refused; if they are offline, a newcomer may ask, but
  the original driver keeps the car until the host hands it over.
- **Secrets** come from `crypto.randomBytes`: host key and player keys 192 bits, join
  and seat keys 96 bits. Comparisons are constant-time.
- **Keys never appear in a URL the server sees.** They travel in `Authorization`
  headers, JSON bodies, or the first WebSocket message. QR links carry the join or
  seat key in the URL fragment, which browsers do not send.
- **WebSocket channel** (`ws` 8.22.2, exact pin): only the relay path is upgraded,
  the page's Origin must match the Host, the first message must authenticate within
  3 seconds, messages are capped at 4,096 bytes, and compression is off. The
  Content-Security-Policy names this exact host for `ws:`/`wss:`; the Host header is
  pattern-checked before it is used there.
- **Inputs are rebuilt, not forwarded.** The relay constructs each message from
  range-checked fields. The host clamps them again, and the protocol encoder clamps
  speed to 1400 mm/s regardless of what any input says. A player cannot publish
  state and a host cannot inject input.
- **Each player sees only their own car's state.** The player id comes from the key.
- **Limits:** 16 rooms, 8 players, 8 waiting and 16 seats per room, 40 inputs and 12
  state updates per second per sender, 16-character names stripped to letters,
  digits and `_ . -`. Rooms close 90 seconds after the host leaves or after 30 idle
  minutes.
- **Dead-man:** a player who stops sending for 0.7 seconds has their car stopped.
  STOP ALL holds every car at zero until the host resumes.
- **Dependencies:** `qrcode-generator` 2.0.4 and `ws` 8.22.2, both exact pins with no
  runtime dependencies of their own.
- Only the controller's own pages, modules and three data files are served; its
  tests, tools, fixtures and documents are not.

Known limits of the controller:

- **The host code is shared by everyone who may host.** Anyone who has it can open
  rooms; it does not let them touch another host's room.
- **If the host browser dies, nothing tells the cars to stop.** What a car does when
  its Bluetooth link drops has not been measured. A keep-alive is the next safety
  item and needs a real car to verify.
- **A public Codespaces port is public.** The pages are reachable by anyone with the
  address; driving still needs the host's approval.
- **Physical safety is the operator's job.** Software limits speed; it cannot see a
  hand on the track.
- Covered by `platform/slipstream-relay.test.mjs` and `slipstream/core.test.mjs`.

## How to verify

```sh
npm ci --ignore-scripts
npm audit                      # expect: found 0 vulnerabilities
npm test                       # bench, platform and instructor-drive suites
npm run dependency-lab         # expect: "regressionCheckPassed": true
python3 -m unittest discover -s tests -v
python3 -m lapreturn.cwe_lab   # expect: "flaw_reproduced": false three times, exit 0
```

Tests named `regression` in `tests/test_adversarial.py`,
`bench/records.test.mjs` and `platform/server.test.mjs` replay the requests the
original baseline accepted and require a refusal. `tests/test_cwe_lab.py` also
checks that the probes fail if a flaw is reintroduced.

## Known limits (not fixed by this change)

- **Tokens are identifiers, not authentication.** `pilot-red` and the other
  demo tokens are public, and the worksheet page lets anyone pick an operator
  from a list. Authorization is now correct *given* a token, but nothing proves
  who holds it. The server is loopback-only for this reason. Do not expose it
  beyond a private forwarded port, and do not store real data in it.
- **Operator tokens travel in the query string** of worksheet GET requests, so
  they appear in local logs and browser history.
- **No Host-header check.** A DNS-rebinding page in the same browser could
  reach the loopback API. It holds only synthetic MOCK notes.
- **No TLS on the local server.** Use the Codespaces HTTPS forwarded port, kept
  private, when not on localhost.
- **Instructor drive opt-in is a deployment switch, not access control.**
  Anyone who can reach an enabled server can load the page. Physical safety of
  a moving car is outside the scope of this document; see
  `instructor-drive/README.md`.
- **Scenario documents describe the old state.** The lab guides in `bench/`
  carry a status banner, and files under `evidence/`, `history/` and
  `instructor-drive/validation/` are historical records that were not edited.
- **Python 3.10** remains in the CI matrix as the documented minimum although
  it reached end-of-life in October 2026.

## Reporting

Report a suspected weakness privately to the instructors rather than opening a
public issue. Include the commit, the exact request and the observed result.
