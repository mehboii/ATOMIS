# Test plan and execution

> Prior audit snapshot. Current follow-up verification and changed duplicate/scope
> behavior are documented in [../ATOMIS_AUDIT.md](../ATOMIS_AUDIT.md),
> [../LANGUAGE_SPEC.md](../LANGUAGE_SPEC.md) and [../TESTING.md](../TESTING.md).

Audit date: 2026-10-11. Run commands from the repository root unless stated otherwise. There is no root Cargo workspace.

## Setup and checks

```powershell
npm ci --ignore-scripts
npm test
cargo fmt --manifest-path atomis-rs/Cargo.toml --all -- --check
cargo check --manifest-path atomis-rs/Cargo.toml --all-targets --locked
cargo test --manifest-path atomis-rs/Cargo.toml --all-targets --locked
cargo clippy --manifest-path atomis-rs/Cargo.toml --all-targets --all-features --locked -- -D warnings
```

`npm test` builds fresh TS, runs the original lexer/parser unit suites, runtime fixtures, then builds the Rust CLI and runs `test/audit-tests.mjs`. Cargo and Node are required for this complete repository suite. Individual suites: `npm run test:unit`, `npm run test:runtime`, `npm run test:audit`. `test:unit` and runtime tests require a fresh `npm run build` first.

Independent libraries:

```powershell
cargo test --manifest-path ghostnet-proto/Cargo.toml --all-targets --locked
cargo test --manifest-path ghostvault/Cargo.toml --all-targets --locked -- --test-threads=1
# From ghostvault/ (requires wasm-pack, wasm32-unknown-unknown, Node):
wasm-pack test --node --no-default-features --features kdf-portable
```

Repeat fmt/check/clippy against each library manifest. Both vault KDF features may be enabled by Cargo all-features; strong takes precedence. To select portable, disable defaults explicitly. Native `ghostvault/tests/wasm.rs` reports zero tests because it is target-gated; that is not evidence of WASM execution.

## Coverage and expectations

| Category | Existing tests | Added verification |
| --- | --- | --- |
| Lexer | 14 tests in each implementation: keywords, operators, token categories, simple spans/comments/templates/numbers | EOF and arbitrary bounded input, Unicode scalar versus UTF-16 spans, CRLF, malformed termination, interpolation quoting/comments, nesting limits |
| Parser/AST | 15 tests in each implementation; selected node fields asserted | Mandatory fields/separators, unexpected braces, empty/missing-EOF streams, adjacent closing braces, malformed render/config, import escaping, nested await |
| Analyzer | No baseline unit suite | Semantic emission gate, duplicate-name warnings, GhostNet duplicate IDs/transports, generated-name collisions, scope/purity observations, expression-prefix false positives |
| Transformer/emitter/compiler | No baseline Rust assertions | Nested Result calls/types, protected literals/comments, union grouping, deterministic output, exact golden examples, map JSON/source contents; public Rust library integration tests |
| CLI | Four npm runtime fixtures, including the user's untracked proto_demo fixture | Help/version/errors/flags, missing files, extension rejection, spaces/metacharacters, preserved predictable-temp sentinel, output directory creation, real watcher add/change events |
| Target | Runtime fixtures | TS parser checks and trusted arithmetic executed with Node; strict TypeScript checker probes in `audit-probes.mjs` |
| Crypto/protocol | 9 native vault tests, 2 WASM vault tests, 7 native proto tests | Unsupported version/trailing bytes; WASM handle rollover; tests also assert the rebuilt vendored packages |

Rust golden comparison normalizes only CRLF to LF; it does not trim or remove comments. The two `features.ts` type annotations were manually changed to parenthesized unions because `Result<T,E>[]` otherwise applies `[]` only to the second union branch. No blanket snapshot regeneration occurred. Existing `.expected` runtime comparisons still trim whitespace; this does conceal edge whitespace differences and is not an exact output conformance test.

`test/audit-probes.mjs` records remaining defects with the real TypeScript checker. It does not execute generated source and does not turn known bugs into expected-success assertions. Re-run with `node test/audit-probes.mjs` after a fresh TS build. Results: `evidence/remaining-probes.json`.

## Resource tests, fuzzing, and execution boundary

Rust integration tests generate 1,000 deterministic inputs of at most 95 Unicode scalars, assert EOF/span invariants, and invoke the public compiler. This is a bounded property smoke test, not coverage-guided fuzzing. CLI invalid-input tests run in subprocesses with five-second timeouts; watch tests have ten-second deadlines. Only inspected, fixed runtime fixtures and arithmetic source are executed. They run with normal user permissions; there is no OS sandbox in Atomis.

`cargo fuzz` and `cargo llvm-cov` were unavailable. No coverage-guided fuzz campaign or Rust coverage measurement was performed, and no coverage percentage is claimed. A suitable future fuzz target is `compile(valid UTF-8 <= 64 KiB)` in an isolated subprocess, with malformed token-stream testing separate from the normal lexer-to-parser contract. Add cargo-fuzz only with a justified maintenance workflow. Low-level transform APIs accept trusted AST/text and are not the supported untrusted-source boundary.

Remaining coverage needs: regex/JSX ambiguity, complete TypeScript grammar, generic/default/type edge cases, import aliases/resolution, match exhaustiveness and evaluation semantics, GhostNet lexical visibility, purity/effects, path permissions and symlink/junction loops, watcher removal/mtime races, concurrent run failures, reproducible WASM/native release builds, and Linux/macOS execution. Updated CI adds Rust and the npm audit suite to its OS matrix; the remote workflow was not run in this session.

## Available JavaScript coverage measurement

V8 function execution observations are in `evidence/v8-function-coverage.json`,
aggregated by `test/audit-coverage.mjs` from NODE_V8_COVERAGE output under
`.parity-tmp/audit-final-coverage`. Only this project's immediate dist modules
are counted; dependencies and ts-node are excluded. This is not line/branch
coverage, and killed watchers do not necessarily flush profiles. Two trusted
run fixtures exceeded their unchanged five-second deadline while profiling;
that failed run is retained as `evidence/v8-profiled-suite.txt`. The normal suite
was rerun without profiling. No assertions or deadlines were weakened.
