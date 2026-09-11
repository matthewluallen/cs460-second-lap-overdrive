# Investigating the platform's real dependencies

The optional Node platform uses two real, deliberately old dependencies during
normal operation: Express serves the bench and shared support-record API;
Lodash sorts and groups synthetic support records. These are installed runtime
dependencies, not renamed copies of course code. Their known weaknesses are
part of the investigation baseline. Use disposable MOCK notes, save hardware
evidence separately, and disconnect the car before this exercise.

## Start the platform

Use Node 22 or 24. From the repository root:

```sh
npm ci --ignore-scripts
npm start
```

Installation fetches official GitHub source archives pinned by commit and
transitive packages from the package registry; no GitHub SSH key is required.
The server listens on `127.0.0.1:8000`. Open `http://localhost:8000` in desktop
Chrome, or keep the Codespaces forwarded port private and open its HTTPS URL on
the physical laptop. Only `bench/` is served as static content; the repository
root and `.git` are outside that static root. The server has no Bluetooth radio
control: the laptop browser still owns the unchanged Anki connection workflow.
Stop the server with Ctrl+C when finished. Docker is not required.

If tonight's car activity is all you need, the static fallback still works
without these dependencies. Stop any other server using port 8000, then run:

```sh
python -m http.server 8000 --bind 127.0.0.1 --directory bench
```

That fallback supports the quick activity, evidence page and default local
worksheet. It does not provide the shared support API or dependency runner.

## Choose a worksheet store explicitly

| URL | State and reset | Server needed |
| --- | --- | --- |
| `worksheet.html` | Disposable records in this browser tab; reload resets that tab. | Either server above. |
| `worksheet.html?store=server` | Shared MOCK records for all clients of this Node process; reload does **not** reset them. Restart the Node server to reset. | `npm start`. |

Both stores preserve the intentional cross-team read and creation defects from
the [worksheet investigation](CWE-LAB.md). Public `pilot-*` tokens are teaching
roles, not real authentication. In shared mode, another tab can see your changes;
coordinate resets and record the initial state instead of assuming record 103
is available. Nothing is copied between the local and server stores. Enter only
disposable scenario notes: never upload LIVE traces, real kit records, personal
data or credentials to the support API.

## Record the exact dependency baseline

| Runtime package | Pinned upstream source | Role | License |
| --- | --- | --- | --- |
| Express 4.17.1 | [`e1b45ebd050b6f06aa38cda5aaf0c21708b0c71e`](https://github.com/expressjs/express/tree/e1b45ebd050b6f06aa38cda5aaf0c21708b0c71e) | Static bench files and shared support API. | [MIT](https://github.com/expressjs/express/blob/e1b45ebd050b6f06aa38cda5aaf0c21708b0c71e/LICENSE) |
| Lodash 4.17.15, upstream npm distribution tree | [`f9cd8f552b7c8dc4aaa6be48eb9adf026ce4cd30`](https://github.com/lodash/lodash/tree/f9cd8f552b7c8dc4aaa6be48eb9adf026ce4cd30) | Sort and group shared MOCK records. | [MIT; documentation samples CC0](https://github.com/lodash/lodash/blob/f9cd8f552b7c8dc4aaa6be48eb9adf026ce4cd30/LICENSE) |

Inspect [`package.json`](../package.json) and
[`package-lock.json`](../package-lock.json), then run:

```sh
npm ls express lodash
npm audit
```

`npm audit` is expected to report vulnerabilities and exit unsuccessfully for
this intentional baseline. Preserve its output; do not run `npm audit fix`
against the exercise baseline. An audit result is a dependency advisory match,
not evidence that every reported path is reachable through this application.
The direct dependencies use `codeload.github.com` archive URLs with the exact
source commits above. The lockfile records archive integrity hashes as well as
the resolved transitive packages. Check source-pinned direct dependencies
against their manifest versions and
upstream advisories as well; do not treat a tool's omissions as a clean bill of
health. A commit pin and lockfile improve reproducibility, not trustworthiness.
`--ignore-scripts` skips install lifecycle scripts; it neither removes vulnerable
code nor prevents the application from executing its runtime dependencies.
Review transitive packages and their licenses alongside the two direct pins.

## Run the bounded demonstrations

After installation, from the repository root:

```sh
npm run dependency-lab
```

The [runner](../platform/dependency-lab.mjs) uses fixed synthetic inputs in a
separate process limited to five seconds and 16 KiB of output. It makes no
external requests or car connection; its report labels the result
`LOCAL DEPENDENCY EXPERIMENT` with `hardwareEvidence: false`. Its guard against
accidental network use is not a general sandbox. Read the runner and its output alongside
the referenced advisory; distinguish an observed library behavior from a
complete exploit through a reachable application route.

| Dependency observation | Advisory and affected baseline | What the observation establishes |
| --- | --- | --- |
| Lodash `zipObjectDeep` adds a harmless prototype marker. | [CVE-2020-8203 / GHSA-p6mc-m468-83gw](https://github.com/advisories/GHSA-p6mc-m468-83gw): npm `lodash` 3.7.0 through versions below 4.17.19 are affected. | A fresh object inherits the marker, which is removed before exit. This direct prototype modification fits [CWE-1321](https://cwe.mitre.org/data/definitions/1321.html). Sorting and grouping records alone do not demonstrate this path is exposed by the support API. |
| Express `response.location` encodes a fixed URL; Node's legacy URL parser identifies different hosts before and after encoding. | [CVE-2024-29041 / GHSA-rv95-896h-c2vc](https://github.com/expressjs/express/security/advisories/GHSA-rv95-896h-c2vc): Express 4.x below 4.19.2 is affected. | The library-level host mismatch is reproduced. An application open-redirect finding additionally needs a reachable user-controlled redirect and a relevant validation bypass; this runner does not establish that route exists in the platform. |

The Express fixture adapts the domain names from the upstream
[4.19.2 regression case](https://github.com/expressjs/express/blob/04bc62787be974874bc1467b23606c36bc9779ba/test/res.location.js).
Its `.example` names are parsed as text, never contacted. Preserve the report's
input, Location value and parsed hosts; for Lodash, preserve the marker's
before/during/after values. `reproduced: true` confirms the deliberately
vulnerable baseline behavior, not successful remediation.

Two further examples illustrate why inventory and reachability must be separated:

- [CVE-2021-23337](https://github.com/advisories/GHSA-35jh-r3h4-6jhm)
  concerns Lodash's template function before 4.17.21. This platform has no
  template-execution route, and the exercise does not execute injected code.
- Express's dependency tree includes an affected historical `qs` version.
  [CVE-2022-24999](https://github.com/advisories/GHSA-hrpp-h998-j3pp)
  describes crafted nested-query parsing that can hang a Node process.
  This server selects the simple query parser, leaving that nested-query path
  unused; this configuration does not patch the installed library. The exercise
  does not run a denial-of-service payload.

This is a selected advisory set, not an exhaustive security assessment or a
claim about the Bluetooth protocol. Keep the course server local or privately
forwarded; it is an intentionally vulnerable teaching application.

## Student investigation and repair evidence

Record the course commit, Node/npm versions, direct Git pins, lockfile,
advisory identifiers, exact command/output and the function reached. Trace
which inputs an ordinary user actually controls. Explain whether your evidence
shows version exposure, a direct-library reproduction or an application-level
failure. Have a peer reproduce the bounded result from the untouched baseline.

On a separate team branch, choose maintained replacements or upgrades, review
their licenses and dependency changes, and update the lockfile. Replace
characterization expectations with tests for the repaired behavior while
preserving normal sorted/grouped records, worksheet modes and static delivery.
Retest `npm test`, the Python suite and the replay battery checkpoint; keep
hardware qualification separate. Dependency upgrades do not by themselves
repair the worksheet's intentional CWE-639/CWE-862 authorization defects.

These notes used AI assistance. Validate each mapping and application
reachability claim against source and independent observations, and retain
unresolved limitations in your investigation record.
