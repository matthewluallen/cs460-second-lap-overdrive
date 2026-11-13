# Three simulator security investigations

> **Status: repaired.** `python -m lapreturn.cwe_lab` now reports `flaw_reproduced: false` for all three cases and exits non-zero if one returns. The token decides the team (CWE-863), a repeated nonce has one effect (CWE-837), and profiles need a publisher HMAC signature in addition to the checksum (CWE-345).
> The steps further down describe the original flawed baseline and are kept as
> a record of what was investigated; on this branch they now end in a refusal.
> See [SECURITY.md](../SECURITY.md) for the change list and the baseline commit.

These optional lessons turn three existing simulator weaknesses into repeatable
experiments. Finish the physical activity, save its evidence and disconnect the
car first. Every example below operates only on a new in-memory `Pilot` with
fixed synthetic inputs. There is no Bluetooth, network, file upload, firmware
installation or real credential. “Drive” and “distance” are simulation state.

The flawed course baseline is intentional. A demonstration that reproduces it
is **not a security pass**. The runner observes the actual methods in
[core.py](../lapreturn/core.py), rather than printing predetermined success.
Existing deliberate vulnerabilities and ordinary platform operations remain
available; the runner does not repair or replace them. No new weakness is added
to the live bench or simulator. Student repairs belong
on a separate branch with an untouched baseline for comparison.

## Run the experiments

Use Python 3.10+ from the repository root; no packages are needed:

```sh
python -m lapreturn.cwe_lab
```

The runner prints three JSON lines, one per case. For a single case:

```sh
python -m lapreturn.cwe_lab authorization
python -m lapreturn.cwe_lab repeat
python -m lapreturn.cwe_lab profile
```

Each line includes `source`, `case`, `intended_policy`, actual `observed` values,
`deliberate_flawed_baseline_observed`, and `security_pass: false`. The last field
stays false even if one probe is denied after your repair: a single probe cannot
establish security. Each case and each invocation gets fresh disposable state.
The absolute speed/profile envelope remains **500 simulation units**.

Save the baseline commit, command, output, intended policy and your explanation.
Keep these records labelled **SIMULATION** and separate from LIVE battery traces
and the worksheet's MOCK records. The implementation is
[cwe_lab.py](../lapreturn/cwe_lab.py); the check suite is
[test_cwe_lab.py](../tests/test_cwe_lab.py).

| Case | Baseline observation | Question to explain |
| --- | --- | --- |
| `authorization` | A red token requests team blue and changes `sim-blue` speed from 0 to 40. | Why does a valid identity not establish permission for the target? |
| `repeat` | The identical `advance 3` request runs twice: distance 3 then 6, two events, one nonce key. | What represents one logical action when delivery repeats? |
| `profile` | Modified data with the original digest is rejected; modified data with a replacement digest installs a 450 limit. A 501 limit remains rejected. | What does a matching checksum establish about who supplied the data? |

## Incorrect authorization

Assume each actor may change only their own team's vehicle. In
`Pilot.authorize()`, authentication resolves the token's team, but the check
compares the target's owner with the **requested** team. The `authorization` case
holds actor identity fixed as red while choosing blue as both requested team and
vehicle owner. The resulting simulated mutation violates that policy.

[CWE-863: Incorrect Authorization](https://cwe.mitre.org/data/definitions/863.html)
fits because a check exists but uses the wrong relationship. This is a broad
class, so explain the concrete actor/request/target mistake rather than treating
the number as the finding. The public token models an actor; this does not
demonstrate theft of a credential or Bluetooth authorization bypass. Compare the
constructed history change `519e664` and [E02](../evidence/E02-team-chat.txt).

For a repair, derive the actor from trusted authentication and compare that actor's
team with the target owner inside the operation. Treat a caller-supplied team as
untrusted context, not authority. Apply the policy to commands **and** profile
installation. In a real shared service, this enforcement must be outside the
untrusted client; the local public tokens are not production authentication.

Acceptance: test every ordered pair of different teams for denial, verify no
state/event/nonce mutation on failure, and retain legitimate drive, advance,
stop and profile operations for every team. Calling the method directly must not
bypass the check. Changing UI visibility alone is insufficient.

## One logical action applied twice

Assume a nonce identifies one logical command within an authenticated team's
session. `Pilot.command()` builds and stores `(team, nonce)` but does not reject
or deduplicate an already-seen key. The repeated `advance` operation makes the
effect visible; setting an absolute speed twice would hide this distinction.

[CWE-837: Improper Enforcement of a Single, Unique Action](https://cwe.mitre.org/data/definitions/837.html)
describes the missing once-only constraint under that policy. This case repeats
an already authenticated command; it does not replay an authentication exchange,
so “authentication bypass by capture-replay” is not the claim. The constructed
history `519e664` and [E03](../evidence/E03-release-notes.txt) document the removed
duplicate check and the demonstration rationale.

A repair can reject duplicate logical actions or return the original outcome
without applying the effect again. Define the nonce scope and lifetime, bind it
to the command payload, and reject reuse with a different payload. In a concurrent
service, checking the key and recording the effect must be atomic. An in-memory
check alone does not promise exactly-once effects after a crash or restart.

Acceptance: the first `advance 3` produces distance 3; an identical redelivery
leaves it at 3. A new nonce still permits the next legitimate advance. Reusing a
nonce with a different vehicle/action/value is rejected, teams do not interfere
with each other's valid keys, and rejected attempts change no state. Define and
test restart behavior instead of implying persistence the simulator lacks.

## A checksum without a trusted publisher

Assume the fictional “signed updates” claim means only an approved publisher can
authorize profiles. `Pilot.install_profile()` compares SHA-256 of a data object
with a checksum supplied by the same caller. The `profile` case uses red's own
vehicle, isolating this issue from the cross-team authorization defect.

Changing `max_speed` from 120 to 450 while keeping the original digest is rejected.
Recomputing and submitting a matching digest makes the replacement install. This
does **not** break SHA-256, find a collision or bypass the absolute envelope.
It shows that an integrity comparison against an untrusted expected value does
not authenticate a publisher. See `digest_profile()`, `install_profile()` and
the explicit fictional disagreement in [E07](../evidence/E07-maintainer-thread.txt).

[CWE-345: Insufficient Verification of Data Authenticity](https://cwe.mitre.org/data/definitions/345.html)
is used here as an educational concept. MITRE marks this broad class
**discouraged for real-world vulnerability mapping**; a real report should select
a supported more specific cause. Do not claim defective signature verification:
this implementation has no signature verifier. The mismatch is between the
fictional authenticity claim and the implemented checksum-only trust model.

A repair needs independently trusted approval: for example, an instructor-owned
allowlist of approved profile digests outside the requester-controlled input, or
a vetted signature design with a separately trusted public key. Define publisher,
target, version and rollback policy, and preserve the data schema and envelope.
Do not invent cryptography or accept an uploader's new public key as proof.

Acceptance: an approved profile installs, altered content with old proof fails,
and attacker-chosen content with a newly computed checksum is denied. An unknown
publisher, wrong target and disallowed rollback fail without mutation. A 501 limit
is rejected even with otherwise valid approval; lowering a valid limit still
clamps current simulated speed. Treat this as configuration data, never firmware.

## Record a repair and retest

```sh
python -m unittest discover -s tests -p 'test_cwe_lab.py' -v
python -m unittest discover -s tests -v
```

The lesson and adversarial suites deliberately characterize the flawed baseline.
On a repair branch, replace the relevant success-of-defect expectations with
denial/idempotence expectations and add legitimate-use tests. Preserve the shell's
malformed-input recovery and bounds. Have a peer rerun your baseline and repaired
commands; record actual outcomes, uncertainty and why the chosen CWE applies.
Unrelated findings do not become fixed merely because a demonstration changes.

MITRE definitions and mapping notes were checked against the linked CWE 5.0
entries. Constructed scenario dates are not evidence of when review occurred.
The lessons used AI assistance; independently verify the mappings and results.
