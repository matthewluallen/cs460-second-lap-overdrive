# Optional worksheet investigation: two authorization weaknesses

Complete the charging, connection and light activity first. Save its traces and
disconnect the car before this exercise. Use only the **Support worksheet** and
disposable scenario notes in your own tab. Reloading resets its records. The
public `pilot-*` operator tokens model roles; they are not real authentication.

The worksheet deliberately preserves two authorization defects for students to
reproduce and repair on a separate team branch. The tests below characterize
that flawed baseline. A passing test is **not** a security pass or a claim that
the defects have been fixed.

## Intended policy and evidence

Assume a support operator may list, read and create records only for their own
workgroup. `Records.list()` applies the team filter. Compare that behavior with
`read()` and `add()` in [records.mjs](records.mjs). Keep operator identity fixed
while changing just the target record or workgroup.

| Reproduction | Observed baseline behavior | Supported mapping |
| --- | --- | --- |
| Red operator opens record 102, absent from red's list | Blue's seeded note is returned | [CWE-639: Authorization Bypass Through User-Controlled Key](https://cwe.mitre.org/data/definitions/639.html): the caller controls the lookup key, and the read lacks a matching ownership check. |
| Red operator adds a note with workgroup blue | A blue-owned record is created and appears in blue's list | [CWE-862: Missing Authorization](https://cwe.mitre.org/data/definitions/862.html): the operation checks that the operator and workgroup exist, but never checks permission to create in that workgroup. |

These are mappings to the fictional application policy, not findings about a
real multi-user service or the car's Bluetooth security. CWE-862 is a broad
class; explain why the missing action-level check fits, and consider a more
specific mapping when your evidence supports one. Two labels do not by
themselves establish two unrelated root causes.

## Reproduce in the page

1. Reload the disconnected bench. Under **Support worksheet**, choose operator
   **red**, then **My records**. Record that only seeded record **101** appears.
2. Keep operator **red**, set **Record ID** to **102**, and click **Open record**.
   Record that the returned record belongs to **blue**. Compare with a normal
   read of red's **101**; do not change operators to obtain the result.
3. Keep operator **red**, select workgroup **blue**, enter
   `Synthetic cross-team entry`, and click **Add record**. Record the new ID
   (**103** on a fresh page). Select operator **blue → My records** to see it;
   red's list omits it.
4. Save the reproduction steps and worksheet output in your investigation notes,
   labelled **MOCK / synthetic worksheet**. These outputs are not live battery
   evidence and are not added to the hardware trace. Reload to reset.

You can also reproduce without a browser, car or network from the repo root:

```sh
node --test bench/records.test.mjs
```

The suite covers ordinary same-team use, both intentional failures, rejection
of unknown operators/workgroups and invalid form input, returned-copy isolation,
reset behavior, and operation when browser/Bluetooth and fetch APIs are absent.
It imports only `Records`, never `CarLink`, and sends no hardware commands.

## Student repair and acceptance criteria

Preserve an untouched baseline commit. On your team branch, enforce the policy
inside the record operations, not just by hiding controls. Use the operator's
resolved team for authorization: reject reads of another team's record and
reject a requested workgroup that differs from the actor's team before changing
state. Do not consider less predictable record IDs a substitute for a check.

Replace the two tests that expect the defects with tests that expect denial,
then prove legitimate use still works:

- Each valid operator can list, read and create their own records. Empty team
  lists remain valid and created notes retain the existing length/trim rules.
- Every ordered pair of different teams is denied cross-team read and creation,
  even when calling `Records` directly rather than using the page.
- Failed requests create no row and do not consume an ID. Unknown operators,
  nonexistent record IDs, unknown workgroups and invalid notes remain rejected.
- The worksheet remains disposable and isolated. Keep its data out of real kit
  logs, and keep record actions disconnected from `CarLink`, BLE and any backend.
- Run the full bench and Python suites. Retest replay Battery → **3700 mV** and
  the unchanged connection/confirmation gates with mocks. A worksheet repair
  must not introduce motor commands or relax assigned-car checks.

Because this is a local teaching fixture with public tokens and mutable client
state, these repairs illustrate object-level checks; they do not turn it into a
secure production service. A real shared system would need trusted identity and
server-side enforcement as a separate design exercise.

## Review record

Record baseline/final commits, actor and target, expected policy, observed output,
method, proposed root cause, alternative explanations, test results and reviewer.
Explain impact as disclosure or cross-team record contamination **within the
synthetic fixture**. Do not infer hardware access from a worksheet result.

The teaching notes and characterization tests used AI assistance. Independently
check the cited definitions against the code, reproduce both cases, inspect the
repair diff, and have a peer repeat the legitimate and denied cases. Record
mistakes found and unresolved assumptions rather than treating generated text
or passing baseline tests as assurance.

Definitions checked against the official MITRE pages for CWE-639 and CWE-862,
CWE 5.0 (retrieved 4 November 2026). These source-review dates are separate from
the repository's constructed scenario development dates.
