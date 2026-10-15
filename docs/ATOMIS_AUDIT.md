# Atomis engineering audit

> Current follow-up: see the phase-two section below. Earlier baseline/results are
> retained as history; current language rules are in LANGUAGE_SPEC.md.

Current verification: 2026-10-11, Windows x64, Node 22.22.2, Cargo 1.96.0.
This is a coherent continuation batch, not a claim that the entire language is production-ready.
The existing detailed audit is retained under [audit/](audit/architecture.md):
[findings](audit/findings.md), [capabilities](audit/language-capabilities.md),
[prior verification](audit/verification-report.md). Earlier logs describe earlier
repository states; fresh evidence for this batch is under
[audit/evidence/mission-20261011/](audit/evidence/mission-20261011/).

## Discovery and baseline

TypeScript src/ is the maintained reference; atomis-rs/ is a maintained Rust port.
Both have lexer, parser, statement AST, analyzer, transformer, emitter, compiler
and CLI modules. Neither has an interpreter, native backend or expression IR.
The verified path is UTF-8 source -> tokens -> statement AST with raw expression
strings -> selected semantic checks -> TypeScript text -> line source map.
CLI run additionally invokes ts-node/Node. check calls the compiler but writes
nothing; success does not establish complete target validity.

Root package.json/package-lock.json and tsconfig.json define npm builds.
atomis-rs, ghostvault and ghostnet-proto have separate Cargo manifests/locks;
there is no root Cargo workspace. The compiler has no third-party Rust crates.
The auxiliary crates supply vault crypto and a CBOR wire codec, not a socket
runtime. vendor/ contains maintained distribution copies of generated WASM
bindings; regenerate these from Rust when changing those libraries. dist/,
target/ and .parity-tmp/ are build/test artifacts, not handwritten sources.
CI declares Windows/Linux/macOS checks; remote runs were not observed here.

At entry, Git reported untracked Untitled-1.ts and the proto_demo source/expected
pair. They were preserved. A later status also reported .claude/; it was not
edited. Existing audit documents and their evidence were inspected before edits.
No tracked user edits were present. No destructive Git operation, commit,
publication, dependency upgrade or generated WASM edit was performed.

Fresh baseline npm test passed: 29 TS unit tests, four runtime fixtures,
69 audit checks, 12 paired checks. Cargo all-targets passed 50 compiler tests.
The new semantic corpus reproduced nine failures; six valid cases passed.
The initial version of that harness also had ambient Node type-resolution and
diagnostic-format mistakes, recorded separately and corrected without changing
compiler expectations. Baseline CLI evidence independently shows Rust accepting
both duplicate bindings and an inaccessible GhostNet node.

## Capability status

| Area | Status and evidence |
| --- | --- |
| Lexer and parser | Partially implemented. Keywords, strings, comments, nested parsed bodies, coordinates, malformed termination and bounded input tested in both unit/audit suites. Regex, malformed radix/escape forms and full TS grammar remain incomplete. |
| AST and transforms | Verified for tested sugar corpus and exact golden examples; raw expressions have no precedence/type AST. No optimization or extra IR is needed for these fixes. |
| Semantic analysis | Partial. Literal mismatches, tracked declaration conflicts, ID collisions, transports and parsed lexical connect visibility tested. General undefined names, assignments, call arity, return paths, import resolution and full type checking are missing. |
| Emission and execution | Both emit TS and line maps; selected trusted programs execute through Node. Hello and features pass strict target checks. Network fails target checks. No native compilation. |
| Runtime safety | No Atomis ownership/effect/overflow guarantee. Runtime is JS/TS/Node plus imported packages; run has caller privileges. Source size/nesting limits are tested, not a complete resource bound. |
| CLI | Help/version/build/check/run/watch/repl tested. Failed semantic builds preserve existing output. REPL prints transformed text. Formatter, LSP and debugger integration missing. |
| Networking | Syntax present; constructor/helper runtime absent. No verified socket, timeout, TLS, cancellation or transport state machine. proto byte roundtrips work; this is serialization, not networking. |
| Standard library/modules | External npm/Node imports, Uint8Array and host TS/JS collections. proto and ghostvault runtime fixtures pass. No independent Atomis module resolver or package manager. |
| Build/distribution | Fresh isolated debug build and release build pass on Windows. npm package and vendored artifact evidence exists from earlier audit; no fresh clean npm installation or cross-host reproducibility established in this batch. |
| Security | Practical source review and npm advisory check performed; no reported npm advisories at this check. Formal soundness, exhaustive dependency/crypto review and sandboxing absent. |
| Performance | Local compile/startup benchmark recorded; runtime/network throughput not measured. No optimization or language-speed claim. |
| Native ownership/borrow checking | Not applicable to current TS target design; no native memory model to verify. |

## Findings and remediation in this batch

| ID / priority / status | Component, observation and expected behavior | Fix and regression evidence |
| --- | --- | --- |
| M001 P1 fixed | src/analyzer.ts and atomis-rs/src/analyzer.rs: duplicate atoms/functions/parameters and parameter-local conflicts were warnings and emitted conflicting TS bindings. Expect located errors and no output. | Promote tracked same-scope duplicates to errors; nested shadowing remains valid. Rust audit.rs and shared semantic-regressions.mjs verify severity, no code/map, CLI parity and preserved output. Rename/remove the duplicate to migrate. |
| A011 P1 fixed for parsed visibility | Both analyzers globally accepted a node declared inside setup() from an outside connect. Emitted __n is inaccessible. Expect same/enclosing lexical scope visibility. | Validate connect by parsed function/guard/cell scope after collection, retaining global ID uniqueness. Four invalid and five valid scope cases plus shadowing are paired and strict-target checked. Move the connect inside the scope or move declarations to an enclosing scope to migrate. Initialization order and raw TS scopes remain partial. |
| A009 P1 partial fix | examples/features.ato declared a string return but its match arms discarded strings; prior target check reported TS2355. | Use existing explicit return statements in arms, regenerate only features golden using compiler. Shared test checks strict target validity and six actual results. Core match repeated evaluation/wildcard behavior remains unresolved. |
| M002 P2 fixed | No structured language/security/roadmap entry documents at requested paths. | Add linked draft spec, threat boundaries, reproducible testing and evidence-based continuation tasks. Preserve historical evidence. |

No P0 was validated in this batch. Remaining high-priority issues are A012
regex corruption, A009 match evaluation/order, A010 TSX/runtime integration,
and broad semantic validation A020. See ROADMAP.md for concrete next tests.
Do not treat remaining issues as passing conformance expectations.

## Final verification and measurements

npm test passes 29 TS units, four runtime fixtures, 69 audit checks, 14 paired
checks (including failed-build parity), and 16 new semantic/example checks.
Rust passes 52 tests (29 unit, one CLI, 22 integration/golden/property tests).
Formatting and strict Clippy pass. Debug and release parity/semantic checks pass.
Native proto: nine tests passed. Native vault: nine tests passed; target-gated
WASM suite runs zero natively. Fresh wasm-pack Node testing failed before test
execution because its wasm-bindgen installer could not create a temp directory
(access denied); the installed test runner is unavailable on PATH. Vendored
WASM runtime fixtures and rollover/protocol checks still pass through npm.

New benchmark test/benchmark.mjs measures 100/1,000/10,000 flat atom declarations,
20 warmed TS API samples and five check subprocesses per engine/workload.
At 10,000 declarations (177,779 source bytes, 167,780 output bytes), median TS
API time was 40.28 ms; CLI median TS 182.35 ms, release Rust 77.32 ms. Sampled
Node RSS reached 147,148,800 bytes; it includes the harness/V8 and is not peak
compiler allocation accounting. One host/run cannot establish general speed,
complexity or memory bounds. Networking workload is unavailable until a real
runtime exists. No comparative benchmarks against other languages were run.

Not executed: Linux/macOS runtime checks, remote CI, clean-host/npm/WASM release
reproducibility, Rust advisory scan (cargo-audit/deny absent), coverage-guided
fuzzing/Rust coverage (tools absent), full crypto review, network service tests.
The normal process helper failed; authorized repository commands used a direct
Node child-process fallback. External memory/skill reads were rejected by
approval review and were not retried through alternate access.

A second WASM attempt with --mode no-install also failed before execution:
wasm-bindgen-test-runner was not found. No external tool installation was performed.

## Phase two: correctness and runtime hardening

Evidence is isolated under [audit/evidence/phase2-20261011/](audit/evidence/phase2-20261011/).
Starting Git status retains all phase-one modifications and untracked user files.
The existing npm/cargo suites passed again before edits. No Git reset, publication,
dependency upgrade or handwritten WASM modification occurred.

| Finding / status | Evidence, intended correction and implementation | Regression |
| --- | --- | --- |
| A012 P1 fixed within documented lexical contract | Regex contents were tokenized as code and rewritten by Result scanner. Both lexers now emit opaque regex tokens, preserve escapes/classes/groups/flags, distinguish tested division/control contexts and protect template interpolation. Ambiguous brace-following slash fails explicitly. | regex-match-regressions.mjs pairs code/maps and actual pattern source/flags/results; Rust audit.rs. Complete regex grammar uses optional target checker. |
| A009 P1 fixed statement behavior | Repeated discriminant and wildcard double execution violated a dependable ordered match. Spec was defined before changes. switch evaluates once, tests cases in order, uses separate blocks/break and a final-only wildcard. | Shared strict-target/runtime tests count discriminant/pattern side effects, overlap, unmatched cases, return, nesting and wildcard-only evaluation. Empty/bodiless/wildcard-shadowed matches fail with coordinates. Only features golden was regenerated through compiler. |
| P1 named import corruption fixed | Real networking exposed connect as openConnection emitted as three imports. Both parsers now preserve aliases and require names/commas/from; analyzers track imported local names. | import-regressions.mjs pairs output/maps/runtime and malformed/duplicate-local failures; Rust audit.rs. |
| A020 P1/P2 partial, target stage implemented | Atomis-only semantics remain partial. Optional strict ES2020/Node validation catches general names/calls/types/operators/const/returns/imports/literals and regex grammar without execution. | target-regressions.mjs checks no-code/map error results, CLI exit codes, locations, preserved TS/map outputs, and a must-not-execute marker. Rust can validate emitted files with standalone tool; pre-write Rust CLI integration missing. |
| Host networking P2 useful integration verified | GhostNet constructors/helpers remain absent; no architecture was invented. examples/loopback.ato uses existing node:net plus vendored proto for a real bounded TCP binary roundtrip. | network-regressions.mjs tests TS/Rust execution, exact output/maps, refusal, actual socket timeout, cleanup and missing GhostNet runtime failures. Local loopback only; no TLS/live GhostNet claim. |
| Source/resource P2 fixed tested boundary | Both CLIs read entire source before size rejection; TS decoded malformed UTF-8 with replacement. Reads now use one descriptor, bounded 8 MiB + sentinel byte, strict UTF-8 and regular-file checks. Regex pattern/group limits prevent unbounded opaque pattern nesting before target parsing. | resource-regressions.mjs verifies oversized/malformed/deep/long rejection, preserved output, exact accepted boundaries and empty files; Rust integration tests. File-growth protection reviewed, not race-stress-tested. |

Implementation retains direct AST-to-TS architecture and existing public compile
result shapes. Optional TS compile option and Diagnostic.fileName are additive.
No optimizer, ownership syntax, native backend or separate socket runtime was added.
Breaking corrections: wildcard must be final; match break now exits match; malformed
imports fail instead of dropping tokens; aliases retain one binding; slash after a
closing brace requires disambiguation; oversized regex and invalid UTF-8 reject.

Current partial/missing areas: full TS/JSX lexical compatibility (including brace
slash ambiguity and newer regex flags), recursive sugar inside raw TS blocks,
Rust integrated pre-write target checking, precise diagnostic spans/columns,
Atomis module graph/.ato imports, GhostNet/helper runtime and TLS/authentication,
target-check quotas for imported graphs, atomic output pairs and exhaustive crypto
review. Optional target checking is not a security sandbox and does not prove
production readiness. Final command/test details are recorded in phase-two logs.

## 2026-10-15: default name semantics and safe-execution follow-up

The undefined-name inconsistency was freshly reproduced: normal check accepted
the first-program missingValue fixture (exit 0), while --target-check rejected it
with TS2304 (exit 1). Baseline source, commands, output and Git status are retained
in [semantics evidence](audit/evidence/semantics-20261015/baseline.json).
The structural analyzers registered parsed declarations but did not traverse
value references; the CLI only requested TypeScript validation behind the flag.

Both compilers now run independent value-name validation before emission:
src/name-check.ts and atomis-rs/src/name_check.rs, wired through their compiler
modules. This pass uses the Atomis lexer plus lexical binding tables on lowered
text, not downstream TypeScript name diagnostics. Both modes now reject the
fixture with the same Atomis Undefined identifier diagnostic at 9:1; code/map
are withheld. Rust remains Node-independent. No lexer/parser/emitter rewrite,
dependency installation or native runtime was added.

The verified core corpus covers variable/function/parameter references, enclosing
capture, nested functions/blocks/guards, imports/aliases, callbacks, catches,
loop scopes, template interpolation, property/key distinctions, match fields,
direct constant rebinding and duplicate bindings. Additional type/call/return/
operator/module checks still belong to optional strict target checking.
Full raw TS binding/type/value namespace compatibility, initialization analysis,
advanced classes/types/labels and precise expression spans remain partial.
Recognition of external GhostNet/notebook helper names does not provide runtimes.

Fresh completed checks: TS build and 29 lexer/parser units; 59 Rust compiler
tests including golden/conformance/native name cases; 14 paired parity checks;
26 optional-target regressions; strict Clippy; 30 failed-check/build preservation
checks. The final cross-engine feature matrix passed all 101 cases (0 failures, exit 0); exact completion exit/status
are retained in name-feature-results.json / feature-final-exit.json.
See [the full report](SEMANTIC_EXECUTION_VERIFICATION.md) for every source/verdict,
exact commands, exploratory failures and remaining priorities.

Legacy structural fixtures that referenced nonexistent callbacks now declare
them. The 10,000-line preservation fixture uses unique names with unchanged size
and line-count assertions. The network example now correctly fails core checking
for its undefined channel value; its original golden lowering bytes are still
asserted separately. Target regression expectations distinguish new core errors
from downstream TS errors; the standalone Rust target test still verifies a
target-only type error. Runtime assertions were not removed or weakened.

The unchanged first program compiles with --target-check and its emitted TS
passes the standalone strict validator (both exit 0). Generated bytes match
earlier evidence. **Execution remains unverified.** Docker's daemon pipe is
absent, including with a fresh empty local config that avoids private Docker
configuration. No code was executed in host Node/VM as a substitute for isolation.
No actual stdout/stderr/runtime exit code is claimed. Full npm/runtime/network/VM
suites were not run under the task's isolation requirement. Automatic approval
review also blocked the resource suite because it contains run paths without
OS isolation; it was not retried through a workaround.

Repository-wide rustfmt --check still fails on two pre-existing formatting
differences in parser.rs and the awaited-match cell test in audit.rs; they were
preserved. Own new/changed sections were formatted. Early incomplete runs were
interrupted by an inspection-tool timeout; partial logs do not count as passes.
Existing user changes were retained; no commit or release was performed.
