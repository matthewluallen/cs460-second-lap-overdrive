# Scenario Git history

`student-history.bundle` preserves the original 13-commit teaching repository,
including fictional contributors and author/committer dates. It is self-contained.
The GitHub publication history is separate. Scenario records are educational
fiction, as disclosed in `SIMULATION_NOTICE.txt`.

From the repository root, inspect the archive without replacing your work:

```sh
git bundle verify history/student-history.bundle
git fetch ./history/student-history.bundle refs/heads/main:refs/heads/scenario-history
git log scenario-history --format=fuller
git show scenario-history:docs/protocol.txt
```

Inspect changes using `git show <commit>` and `git diff <older> <newer>`.
Course assignment instructions on the current `main` branch supersede the older
briefs in the archive. Do not use archived timing or presentation requirements.
