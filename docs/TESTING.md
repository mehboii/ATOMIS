# Testing Atomis

Commands run from repository root. Node/npm and Rust/Cargo are required for the
full npm suite; no root Cargo workspace. This batch verified Node 22.22.2 and
Cargo 1.96.0 on Windows x64. CI declares Node 20/three OSes; those remote results
were not observed here. No separate TS formatter/linter is configured; tsc is
its existing static check. Rust uses rustfmt and strict Clippy.

~~~powershell
npm ci --ignore-scripts
npm test
cargo fmt --manifest-path atomis-rs/Cargo.toml --all -- --check
cargo check --manifest-path atomis-rs/Cargo.toml --all-targets --locked
cargo clippy --manifest-path atomis-rs/Cargo.toml --all-targets --all-features --locked -- -D warnings
cargo test --manifest-path atomis-rs/Cargo.toml --all-targets --locked
cargo build --manifest-path atomis-rs/Cargo.toml --release --locked
node test/audit-parity.mjs --release
node test/semantic-regressions.mjs --release
npm audit --json
~~~

npm test freshly builds TS, runs 29 original lexer/parser units, runtime fixtures,
builds Rust CLI, runs 69 audit checks, 14 paired corpus checks and 16 shared
semantic/example regressions. Four runtime fixtures passed in this checkout,
including the user's untracked proto_demo. That fixture is not part of a clean
checkout unless committed by its owner; do not claim four committed fixtures.
Cargo passes 52 tests: 29 units, one CLI config, 22 integration tests including
exact golden examples and 1,000 deterministic bounded source inputs. Rust golden
comparisons normalize only CRLF; existing runtime harness trims whitespace.

New shared corpus verifies duplicate atom/function/parameter errors, parameter
conflicts, nested shadowing, GhostNet declarations escaping parsed functions/
guards/cells/sibling scopes, valid same/enclosing captures, located CLI diagnostic
parity, exit codes, failed-output preservation and generated map/code equality.
Valid scope output is checked with the real strict TypeScript checker and only
ambient declarations for missing GhostNet/helper interfaces, not a mock networking
runtime. types: [] disables unrelated automatic Node ambient package loading in
those dependency-free target tests; it does not skip target type checking.
Features has strict checking and six asserted values from its inspected example.
Fixed example execution uses a timeout and no supplied host bindings; VM is not
an isolation guarantee for hostile programs.

~~~powershell
cargo test --manifest-path ghostnet-proto/Cargo.toml --all-targets --locked
cargo test --manifest-path ghostvault/Cargo.toml --all-targets --locked -- --test-threads=1
# Run inside ghostvault/; needs wasm32 target, wasm-pack and wasm-bindgen runner:
wasm-pack test --node --no-default-features --features kdf-portable
~~~

Fresh native proto nine tests and native vault nine tests pass. Native
WASM-gated tests report zero; they do not verify WASM. Fresh wasm-pack attempt
failed before execution at temp-directory creation for wasm-bindgen installation
(access denied), and the runner was absent on PATH. Vendored WASM fixtures in
npm test still pass. Do not install tools outside the workspace merely to hide
this limitation. cargo-audit/deny/fuzz/llvm-cov absent: no Rust advisory scan,
coverage-guided fuzzing or coverage measurement for this batch.

## Evidence and regression workflow

Fresh command arguments, exit codes and full output are JSON under
[audit/evidence/mission-20261011/](audit/evidence/mission-20261011/). Historical
baseline/final evidence elsewhere in audit/ describes the prior audit; do not
merge its test counts with this batch. Current baseline npm/cargo tests passed;
new corrected semantic corpus initially had six passes/nine reproduced defects.
Two initial harness defects (ambient undici type resolution and using syntax-error
format for semantic coordinates) are retained in logs; corrected assertions use
the actual declared semantic diagnostic format. Final available suites pass.

For a regression, first reproduce the source through public compile and both
CLI engines. Assert code/map withholding on errors and exact diagnostics where
stable, or observable results/strict target checking for accepted source. Add the
case to test/semantic-regressions.mjs and Rust audit.rs when applicable. Keep
valid controls and timeouts. Define changed semantics in LANGUAGE_SPEC.md before
adjusting old expectations. The duplicate warning expectation became error
because emitted same-scope bindings conflict; parity now also asserts failed
builds for invalid corpus entries. No tests were removed/disabled. Features golden
was regenerated from the changed example with explicit returns, not hand-edited.

## Known failures and measurement

node test/audit-probes.mjs is observational, exits successfully while recording
known target failures; it is not a passing conformance suite. Fresh evidence
shows regex brace rejection/corruption, Result spacing/interpolation failure,
undefined raw names, malformed numeric/escape acceptance, unresolved GhostNet
runtime and match defects. Hello/features pass target checks. Network does not.

~~~powershell
npm run build
cargo build --manifest-path atomis-rs/Cargo.toml --release --locked
node test/benchmark.mjs --release
~~~

Benchmark executes no generated source. It measures warmed TS API compilation,
CLI check startup+compilation, output size and sampled Node RSS for flat atom
workloads; limitations/results in ATOMIS_AUDIT.md. Native memory peaks, runtime
and networking throughput remain unmeasured. No noisy timing threshold was
added to correctness CI. Clean Rust debug build was tested with a new target
folder; clean npm installation/cross-host reproducibility were not retested.

A second WASM attempt with --mode no-install also failed before execution:
wasm-bindgen-test-runner was not found. No external tool installation was performed.

## 2026-10-15: default semantic names and feature matrix

Use installed dependencies; this workflow does not install anything:

~~~powershell
node node_modules/typescript/bin/tsc -p tsconfig.json
cargo build --manifest-path atomis-rs/Cargo.toml --locked
node --expose-gc test/name-feature-regressions.mjs
node test/name-output-regressions.mjs
node test/target-regressions.mjs
node test/audit-parity.mjs
node dist/tests/lexer.test.js
node dist/tests/parser.test.js
cargo test --manifest-path atomis-rs/Cargo.toml --all-targets --locked
cargo clippy --manifest-path atomis-rs/Cargo.toml --all-targets --all-features --locked -- -D warnings
cargo fmt --manifest-path atomis-rs/Cargo.toml --all -- --check
~~~

`npm run test:semantics` runs both new static suites.

name-feature-regressions uses the public TS compile API in both modes, both
normal CLIs and the TS --target-check CLI. It asserts diagnostic parity for core
errors, positive locations, no code/map on rejected programs and no check writes.
Sources and intentional plain-versus-target type verdicts are in name-cases.json.
It tests names, defaults, parameters/calls/returns, closures, lexical scopes,
shadows, direct const updates, imports, template/regex/property contexts,
bounded loop source cases and valid/invalid operations. Tests **do not execute
generated programs**; zero/one/many loop labels refer to source conditions,
not observed iteration counts. Numeric infinity/NaN/BigInt failure predictions
likewise are not runtime tests.

name-output-regressions first builds a valid first_program.ts plus map, then
asserts both files remain byte-identical after five kinds of rejected source,
through check and build in TS normal, TS target and Rust normal modes (30 checks).
Its dedicated temporary directory prevents user-file replacement.
The native names.rs test separately exercises the name/scope corpus.

target-regressions retains strict type/operator/import/regex checks, pre-write
failure checks, and a no-execution marker. Its standalone Rust target test uses
a core-name-valid but target-type-invalid source, because an undeclared name
can no longer be emitted by Rust. The historical network golden still asserts
exact lowering bytes; compilation separately must reject the undeclared channel
value. Structural match tests now declare their callbacks. The 10,000-line
comment/preservation fixture uses unique binding names, retaining its size and
line-count assertions under duplicate-name checking. No runtime test assertion
was disabled.

Evidence is under docs/audit/evidence/semantics-20261015/. JSON records exact
commands/argument arrays, status, stdout/stderr and every feature verdict.
The shell launcher failed in this session; Node child_process spawned authorized
repository build/check commands directly with explicit working directory/timeouts.

The existing npm test invokes generated-code runtime/VM/network suites. A VM or
ordinary ts-node process is not an OS sandbox. Under this task's execution rule,
those suites must not run until a suitably isolated environment is available.
Report this as blocked coverage, not a passing full npm suite.

Final completed 2026-10-15 results: 101 feature cases, 30 output-preservation checks, 26 target regressions, 14 paired checks, 29 TS units and 59 Rust tests passed. Strict Clippy/build passed. Whole-repository rustfmt retains two pre-existing formatting differences; full npm/runtime/resource execution is not claimed.
