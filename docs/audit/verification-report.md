# Verification report

> Prior audit snapshot. Current follow-up verification and changed duplicate/scope
> behavior are documented in [../ATOMIS_AUDIT.md](../ATOMIS_AUDIT.md),
> [../LANGUAGE_SPEC.md](../LANGUAGE_SPEC.md) and [../TESTING.md](../TESTING.md).

Audit: 2026-10-11, Windows x86_64. Toolchains observed: Rust/Cargo 1.96.0,
Node 22.22.2, npm 10.9.7, wasm-pack 0.15.0; wasm32-unknown-unknown installed.
Source discovery and baseline were recorded before implementation edits.
The default sandbox process helper failed to initialize; authorized commands
ran through the reviewed execution path. No package publication, release,
remote deployment or Git commit was performed.

## Before and after

| Check | Baseline | Final |
| --- | --- | --- |
| Compiler cargo fmt --check | failed | passed |
| Compiler cargo check --all-targets | passed, 21 binary warnings | passed, no warnings |
| Compiler cargo test --all-targets | 29 passed, none ignored | 50 passed: 29 original, 1 CLI config, 20 integration tests |
| Compiler strict Clippy all-targets/all-features | failed, 27 binary errors | passed without lint suppression |
| TS build/unit suites | passed / 29 tests | passed / original 29 retained |
| npm runtime fixtures | 4 passed, including user's untracked proto_demo | 4 passed |
| New cross-engine audit suite | 18 passed, 34 failed before fixes | 69 checks passed |
| Paired corpus verification | historical 3-example report only | 12 paired checks: code, map bytes, diagnostics and exit codes; debug and fresh release |
| Native protocol tests | 7 passed; 2 new regressions failed | 9 passed |
| Native vault tests | 9 passed | 9 passed |
| WASM vault tests | 2 passed; rollover regression failed | 3 passed |
| Auxiliary crate fmt/check/strict Clippy | initial native tests recorded; initial lint baseline not captured | all passed after formatting |
| npm dependency audit | 2 high entries via vulnerable braces/chokidar | zero reported vulnerabilities after Chokidar 4.0.3 |

Final Rust commands and exit codes are recorded in `evidence/final-checks.json`
and `final-{compiler,proto,vault}-{fmt,check,test,clippy}.txt`. Baseline logs
are retained under `evidence/baseline-*`. An npm advisory result is a point-in-time
dependency database check, not proof of application security.

## Fixes and test scope

Fixed parser stalls, bounded nesting/source/config parsing, explicit malformed
literal/comment diagnostics, mandatory syntax fields, atom brace/semicolon
termination, semantic emission gating, tested Result/literal/type grouping,
import escaping, nested cell await, type-prefix false positives, generated
GhostNet name collisions, Rust line maps, CLI options/version/file preservation,
shell-free execution, sorted/link-skipping builds, npm entry-point/runtime
dependency packaging and CI coverage. No tests were removed or weakened.

The public Rust library exposes existing pipeline stages for integration tests;
the CLI remains. The npm entry point now exports the real compiler. Result union
parentheses intentionally change generated text to preserve array type grouping;
two golden lines were manually updated with that reason. Error results retain
the result interface but now contain empty code and no map. Operational limits
are 8 MiB source and 64 parsed nesting levels. Previously malformed sugar and
colliding generated names now fail. No full type system, optimization pass,
native backend, interpreter or runtime was added. Ambiguous match/scope design
was left unresolved rather than changed silently.

Protocol decoding now rejects unsupported envelope versions and trailing bytes;
unknown crypto schemes still decode. Vault handle slots retire instead of
wrapping. Both fixes were reproduced before editing, verified on their actual
targets, rebuilt into local vendored WASM, and asserted through Node packages.
Cryptographic algorithms, format bytes and KDF defaults were not redesigned.

Dependencies: no new Rust crates; existing ts-node/TypeScript versions moved
from dev-only to runtime dependencies, and existing vendored WASM packages are
bundled in npm artifacts. Chokidar changed from 3.x to 4.0.3 after the user asked
to continue following the concrete compatibility/approval request. The initial
automatic review rejection was resolved before applying this upgrade. Version 4
supports CommonJS and Node14+, removes glob matching, and matches the CLI's
documented directory-watch interface. Real add/change tests passed afterward.
[Upstream release details](https://github.com/paulmillr/chokidar/releases/tag/4.0.0).

## Execution, coverage, packaging and limits

Tests execute only inspected fixed fixtures or arithmetic source, with bounded
subprocess deadlines. Generated arithmetic emits and executes `42` through Node;
real CLI run is verified with spaces and shell metacharacters. Neither Atomis
nor these tests provide an OS execution sandbox. build/check do not intentionally
execute supplied source.

Golden comparisons normalize only checkout line endings. The parity harness
uses isolated temporary directories and checks exit codes as well as bytes.
It does not overwrite historical PARITY.md. The original runtime harness still
trims output whitespace, which can hide whitespace-only regressions.

1,000 deterministic bounded inputs tested lexer span/EOF and compiler progress
invariants. V8 function execution was measured for Atomis's own dist modules;
`evidence/v8-function-coverage.json` lists observed/unexecuted functions. This is
not line or branch coverage, and forcibly stopped watcher processes may not flush
coverage. Two runtime startup tests timed out under V8 profiling at the unchanged
five-second deadline; `v8-profiled-suite.txt` retains that failed measurement run.
The normal suite was rerun without profiling; no assertions or deadlines were
weakened. Rust coverage and coverage-guided fuzzing were not run: cargo-llvm-cov
and cargo-fuzz were absent. No arbitrary coverage target is claimed.

The npm tarball was built locally and installed with dev dependencies omitted.
Verification checks its entry point, local dependency resolution and trusted
run. The first installation exposed file dependencies resolving into the checkout;
bundling proto/ghostvault corrected that. Final file lists/hashes are in
`evidence/final-package.json` and `artifact-hashes.json`. Source WASM was rebuilt
locally, without publishing. Reproducibility across clean hosts/toolchain versions
and Linux/macOS runtime behavior were not demonstrated. Updated CI was not run
remotely. Native vault tests report zero WASM tests by target gating; the separate
WASM test command actually executes the three tests.

## Remaining concerns

See findings.md for evidence, impact, recommendation, risks and required tests.
Highest remaining issues are regex passthrough/rewrite corruption (A012), match
evaluation/value/wildcard semantics and invalid features example (A009), missing
JSX/network runtime integration (A010), and global-versus-lexical GhostNet scope
validation (A011). General TypeScript syntax/types/imports, whitespace/template
Result sugar, malformed numeric/escape forms and full source spans remain partial.
The strict target probes in `evidence/remaining-probes.json` confirm that a
successful Atomis check/build does not imply valid target code.

Vault KDF/header quotas and protocol allocation limits still require host policy;
execution receives user privileges. Low-level AST/transform APIs require trusted
inputs; the bounded compiler entry point is the intended source boundary.
Directory permission/depth, watcher deletion/races, config JSON standards parity,
dependency/release provenance and full cryptographic review need further work.
This audit improves verified paths; it does not establish production readiness or
complete conformance for untested language behavior.
