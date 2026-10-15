# Atomis security model and practical review

2026-10-11. This is a scoped practical review, not a security certification,
formal proof or exhaustive dependency/cryptographic audit. See ATOMIS_AUDIT.md
and audit/findings.md for evidence/status and historical remediations.

## Trust boundaries

compile/build/check read source and generate TS; they do not intentionally execute
supplied source. Low-level lexer/parser/transformer APIs accept trusted token/AST
inputs; the bounded compile API is the intended source boundary. TypeScript
passthrough is executable host code. run invokes Node/ts-node with user filesystem,
network, environment and subprocess permissions. REPL only prints compilation.
Never use run as an untrusted-code service without an OS sandbox, quotas and
separate credentials. Node VM used for fixed fixture assertions is not a security
sandbox. CLI run inherits environment; no secrets are printed deliberately, but
an executed program can access them and target/runtime diagnostics may include
paths/source. Use synthetic source and no credentials in external audit logs.

Compiler-authored Rust does not confer safety on generated Node programs. No
handwritten unsafe block/FFI implementation was found in the three crates; vault
and proto forbid unsafe_code. Dependencies, generated bindings and host runtime
are separate trust surfaces and were not exhaustively reviewed.

## Verified fixes and retained controls

Source length/nesting, malformed-termination, semantic emission gating, source
extension validation, exclusive adjacent run temp files and direct process argv
have regression coverage. Current duplicates and lexical connect failures are
now errors and preserve existing build output. These are correctness controls,
not complete target type safety. Previous vault stale-handle rollover and proto
version/trailing-byte fixes are retested through vendored runtime checks.

The new duplicate/scope fixes do not execute generated code, add dependencies,
write arbitrary paths or change cryptographic primitives. IDs remain globally
unique with normalized-name collision checking. Public code/map gating remains.

## Remaining risks and precautions

| Surface | Evidence and limitation | Required control / continuation |
| --- | --- | --- |
| Malformed source/resources | Compiler cap is 8 MiB; CLI reads the full file first. Token/AST allocations, recursive directory scanning and algorithmic worst cases are not fully bounded. | Bound upload/file sizes before invocation; isolate time/memory for hostile input; add depth/allocation and subprocess fuzz tests. |
| Target corruption | Lexer does not identify regex literals; Result rewriting can mutate /Ok(1)/ while target syntax still passes. Match can evaluate a side-effecting expression repeatedly. | Resolve A012/A009 with differential runtime regressions before depending on these forms. A successful tsc syntax check alone will not detect semantic corruption. |
| Output filesystem | Normal build intentionally overwrites .ts/map outputs; writes are not atomic as a pair and can follow output links. Run temps are exclusive, but adjacent parent directory/cleanup races remain. | Use a private owned output directory, avoid attacker-controlled links and shared source directories; design atomic output policy before a hosted build service. |
| Directory/watch | Sorted discovery/link skipping exists, but unreadable-directory/depth/junction behavior and removal/races are partial. Rust config parser differs from JSON.parse and only Rust enforces config byte/depth caps. | Fail explicitly on traversal errors; test platform links and align config contract. |
| Imports/toolchain | run loads host/npm dependencies and config; dependencies/build tooling can execute installation/build code. | Use reviewed locked sources, npm ci --ignore-scripts where appropriate, trusted project configuration and artifact provenance; avoid running untrusted projects with credentials. |
| proto | CBOR decoding validates version/trailing bytes but caller data/vector allocation has no transport quota; messages are not authenticated and unknown scheme IDs decode. WASM u64 conversion to JS numbers needs range policy. | Require framing/size caps and authentication/replay policy in real transport; validate numeric precision before a network integration. |
| ghostvault | Header allows up to 1 GiB KDF memory/16 iterations before authentication, plaintext 64 MiB; this is not a safe service concurrency budget. | Add host pre-auth KDF/message quotas and isolated resource budgets. No costly/OOM attack was executed here. |
| WASM secrets | Internal zeroization cannot erase host JS copies/debug snapshots; plaintext is copied out. | Limit copies, wipe caller buffers, restrict same-process access and state confidentiality claims accurately. |
| Error/system failure | Panic/stack/entropy/OS errors and Node crashes are not a complete recovery model. Vault release abort policy does not ensure cleanup after every external termination. | Test isolated fault paths and treat abnormal execution as failure; do not claim guaranteed cleanup. |

## Dependency evidence and exclusions

Fresh npm audit --json returned zero reported advisories. This is a point-in-time
registry check, not absence of application vulnerabilities. Compiler Cargo has no
third-party dependencies; proto/vault do. cargo-audit and cargo-deny are not
installed, so Rust advisory review was not performed. No custom crypto was added.
No plugin/macro/build.rs implementation was found among handwritten crate files;
third-party dependency build scripts/toolchain provenance remain outside reviewed
source. No TLS/socket state machine or live GhostNet authentication was available
to test. Generated bindings were consumed through fixtures, not exhaustively audited.

Native proto/vault tests and vendored WASM fixtures passed. Fresh wasm-pack Node
tests could not start: wasm-bindgen installer temp-directory access was denied;
no installed runner was found on PATH. Earlier audit evidence is retained but
is not represented as fresh execution. See TESTING.md for reproduction commands.

A second WASM attempt with --mode no-install also failed before execution:
wasm-bindgen-test-runner was not found. No external tool installation was performed.

## Phase-two controls and limitations

Both CLI source readers now bound reads before tokenization, reject malformed UTF-8
and close file descriptors on all paths. Core regex scanning has 32768-character
and 64-group-depth caps, structural/flag errors and opaque transform protection.
Source growth after stat remains bounded by the same descriptor/read cap. These
limits are tested at/rejecting the boundary; they are not a global CPU/memory bound.
Target checking may follow arbitrary import graphs and parses/type-checks third-party
source; use subprocess quotas for hostile sources. It loads the trusted installed
TypeScript/Node declarations, not source-controlled tsconfig plugins/checker scripts.
It validates regex by construction, never matching supplied text.

Successful check/build does not run programs; a sentinel test verifies this for
--target-check. Checked TS CLI builds/runs withhold code/map/temp writes on target
errors. Rust core remains partial; standalone target checking happens after emission
and is not equivalent to pre-write validation. Normal output writes still overwrite
requested targets non-atomically and can follow links in shared output directories.
Host execution permissions, target-type any, compiler imported-graph exhaustion,
WASM secret copies, vault pre-auth KDF quotas and protocol allocation/numeric precision
remain limitations. No custom cryptography or security certification was introduced.

The loopback example uses 127.0.0.1 on an ephemeral port, EOF framing for exactly
one <=64 KiB message, 2-second socket deadlines and cleanup. It is a demonstration,
not a public authenticated server; no TLS, replay protection or GhostNet constructor
binding is supplied. Actual roundtrip/refusal/client timeout/missing-runtime tests
pass. Oversized/malformed network payload branches are code-reviewed but not yet
black-box fault-injected; the network test is not a protocol security audit.

Fresh npm audit reports zero advisories. cargo-audit/deny remain unavailable.
wasm-bindgen and wasm-bindgen-test-runner were absent on PATH, so WASM tests were
not reattempted in phase two. No package install, cross-platform execution or
exhaustive crypto/dependency review is claimed. Evidence: phase2-20261011/.
