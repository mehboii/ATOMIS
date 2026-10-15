# Atomis continuation roadmap

2026-10-11. Prioritize demonstrated correctness before syntax/ecosystem expansion.
Current batch fixed tracked declaration conflicts and parsed GhostNet lexical
visibility in both engines, repaired features with explicit returns, added shared
strict-target/parity regressions and local measurements. No P0 validated in this
batch; this is not a guarantee that no P0 exists. Detailed older findings remain
in audit/findings.md; current status is in ATOMIS_AUDIT.md.

## Current next three tasks

1. **P1 target checking in Rust before writes.** Optional strict checking works in
   TS and as a standalone emitted-file checker. Define distribution/trusted-tool
   discovery and diagnostics before adding a Rust CLI equivalent; avoid loading
   arbitrary checker scripts from source directories. Test missing tool/runtime,
   module resolution, errors with no writes and both-engine target parity.
2. **P1/P2 remaining lexical and target integration.** Regex/match fixes pass the
   documented corpus, but slash after braces explicitly requires disambiguation;
   JSX/.tsx and recursive sugar in raw blocks remain partial. Add context/conformance
   cases before expanding grammar. Do not promise all TS passthrough, d/v flags,
   value-match or a general expression AST without justified implementation/tests.
3. **P2 bounded hosted compilation and real GhostNet contract.** Source/regex limits
   now work, but target imports can expand work; outputs are not atomic pairs and
   shared directories remain a trust boundary. Add isolated time/memory/import/file
   limits, atomic output policy and failure/race tests. Loopback Node+proto is real
   host integration; a GhostNet constructor/TLS/runtime needs an actual dependency
   contract and authenticated service tests.

Phase two completed regex preservation under a specified lexical contract, single
match evaluation/final wildcards, import alias fixes, opt-in strict target semantics,
a bounded loopback use case and CLI source-read hardening. See ATOMIS_AUDIT.md
and phase-two evidence for test results and limitations.

## Follow-up work

| Priority / finding | Evidence and expected change | Verification / dependency |
| --- | --- | --- |
| P2 A013 Result contexts | Whitespace/interpolation/guard/standalone-object forms remain partial. | Establish lexical protection first (A012 remaining grammar), then strict target/runtime corpus and both-engine maps. |
| P2 A020 literal/name validation | Default Atomis-only checking remains partial; optional target validation now rejects tested literal/name failures. | Minimal lexer validation or target checker; avoid invented inference rules. |
| P2 A024 filesystem/config | Rust discovery suppresses some errors; config JSON differs; TS lacks matching caps. | Explicit read failure/depth/link/junction tests, config standards/parity corpus, atomic output policy. |
| P2 A022 host crypto/proto quotas | Large pre-auth KDF costs, unbounded decoded vectors, JS u64 precision boundary. | Specify deployment budgets, framing and checked conversion; isolated native/WASM regressions without OOM attacks. |
| P2 runtime readiness | Node loopback/codec/timeout integration verified; GhostNet helper/TLS integration absent. | After dependable target validation, smallest Node-library loopback application with bytes, timeout/failure and cleanup assertions. Keep it a library, not new syntax. |
| P2 distribution | Windows build works; clean npm/WASM and cross-host reproducibility need fresh proof. | Repair permitted tool runner environment, locked clean install, package artifact checks, platform CI evidence; no publication without authorization. |
| P2 test infrastructure | Bounded smoke properties, not exhaustive grammar/runtime coverage. | Isolated fuzz/coverage tooling when available, exact output fixtures, fault paths, deep/pathological resources. Do not weaken existing tests. |
| P3 measured performance | Local flat compile/startup timings only. | Add realistic runtime/network workloads after runtime exists; optimize only measured hotspots with semantic tests. |
| P3 tooling/ecosystem | Formatter/LSP/package manager/native backend absent. | Defer until stable grammar, modules and diagnostics. No speculative compiler rewrite. |

Migration for current errors: rename/remove same-scope duplicate tracked names;
move connects or declarations into a same/enclosing lexical scope. Raw TS/import
conflicts and initialization order still require target/runtime checks. No public
compile result shape, CLI commands or wire/crypto formats changed in this batch.

## 2026-10-15 follow-up priorities

Default value-name checking is now shared by both compilers for the verified corpus; full raw TS binding compatibility remains partial. See SEMANTIC_EXECUTION_VERIFICATION.md for evidence. Prioritize paired binding conformance, an approved OS execution sandbox, trusted pre-write Rust target validation, semantic/import quotas plus atomic output pairs, and expression spans/initialization diagnostics. Runtime verification remains blocked by the absent Docker daemon, and no full npm runtime-suite pass is claimed.
