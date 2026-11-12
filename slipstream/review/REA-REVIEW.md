# REA applicability review — 12 November 2026

Inspected [morluto/rea at a8527d4](https://github.com/morluto/rea/tree/a8527d43b8439476f5c9d1497315dfe7dd5e1f38), whose package declares version 6.9.0. This is a source/documentation review, not a completed REA runtime acceptance test. No REA MCP registration, setup script, or runtime dependency was added to Slipstream.

## Useful capabilities for this investigation

| Capability | Concrete use here | Boundary |
|---|---|---|
| Android class/method inspection and reference tracing | Trace VehicleController → LeService → GATT and native callbacks | Static references miss reflection and dynamic dispatch; JADX failures remain partial |
| Android JNI binding inventory | Join Java native declarations with exact ARM library exports | A candidate binding does not prove a runtime call |
| Persistent Ghidra provider | Import libDriveEngine once, inspect serializers, constructors and callers by address | Ghidra/Java must be installed separately; macOS needs native Ghidra components built |
| Artifact-bound evidence and retained views | Record APK/OBB/library digests and reuse a finding without re-running the producer | A digest identifies bytes; it is not signature verification or proof of behavior |
| Frida instrumentation | Future capture of app-side GATT requests and callbacks on a designated Android test device | Requires compatible device/server; injected code can affect timing and behavior |
| Firmware inventory/extraction | Identify containers and retain extraction failures rather than guessing | Does not establish firmware decryption, execution or host-loss safety |

Source paths inspected include `src/android/AndroidJniLibraries.ts`, `JadxFailure.ts`, `JadxRelease.ts`, `src/firmware/FirmwareReports.ts`, the Android/Ghidra/Frida guides and the evidence-composition verification report.

## Ideas adopted in this review

- Keep immutable artifact identities, tool versions and repository revisions in `source-identities.json`.
- Separate observed bytes, decompiler interpretation, reconstructed semantics and physical acceptance.
- Retain failed/partial analyses and do not equate an empty search with absence.
- Cross-check decompiler output against another source: compiled official SDK vectors, independently extracted tables and external recorded telemetry.
- Keep third-party app binaries and decompiled source outside the distributable repository. Publish original test harnesses, concise findings and artifact identities.

## Adoption recommendation

Use REA as an optional workstation analysis layer for repeated investigation, especially retained Ghidra sessions and JNI traversal. Keep the browser game independent of it. For this first reproducibility pass, direct JADX and Ghidra commands provide a smaller, inspectable chain and are already running.

The current REA Android provider expects a separately supplied, digest-pinned `jadx-headless-mcp` 0.7.1 JAR; an ordinary JADX CLI installation alone is not that provider. The repository's main branch and installed npm package may expose different tools. Discover actual capabilities before selecting operations.

REA's security policy says it runs with the host account's permissions and is not a general-purpose sandbox. Static inspection does not authorize running an APK or attaching to a physical car. Its local evidence can contain target data and must be reviewed before publication. Those are concrete deployment constraints, not reasons to reject its useful analysis tools.

## Evidence links

- [Android/JNI guide](https://github.com/morluto/rea/blob/a8527d43b8439476f5c9d1497315dfe7dd5e1f38/docs/guides/android/android-analysis.md)
- [Ghidra provider contracts](https://github.com/morluto/rea/blob/a8527d43b8439476f5c9d1497315dfe7dd5e1f38/docs/providers/ghidra-provider.md)
- [Frida lifecycle](https://github.com/morluto/rea/blob/a8527d43b8439476f5c9d1497315dfe7dd5e1f38/docs/guides/runtime/frida-instrumentation.md)
- [Security boundary](https://github.com/morluto/rea/blob/a8527d43b8439476f5c9d1497315dfe7dd5e1f38/SECURITY.md)
