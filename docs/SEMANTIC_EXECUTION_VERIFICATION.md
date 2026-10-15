# Atomis semantic checking and execution verification

2026-10-15, Windows, Node v22.22.2. This report distinguishes compilation evidence
from runtime evidence. **No generated program was executed.**

## 1. Undefined-name consistency

The issue was reproduced before compiler edits. The complete source and initial
Git status are in [baseline.json](audit/evidence/semantics-20261015/baseline.json).
The source was the earlier first-program fixture with its sum changed to
first + missingValue. Commands from repository root:

~~~powershell
node dist/cli.js check docs/first-program-evidence/undefined.ato
node dist/cli.js check docs/first-program-evidence/undefined.ato --target-check
~~~

Initially normal check exited 0 and printed “no errors”; target check exited 1
with TS2304 at 9:1. Neither check command has a write path. The minimal permanent
regression is:

~~~ato
output(missing)
~~~

The original [analyzer](../src/analyzer.ts) / [Rust analyzer](../atomis-rs/src/analyzer.rs)
registered parsed names and validated selected literal/GhostNet/purity rules,
but never resolved references in raw expressions. The [CLI](../src/cli.ts) passed
targetCheck only when the flag was present. Only the downstream strict
[target validator](../src/target-check.ts) caught this undefined identifier.

The fix adds an independent lexical value-reference pass in
[name-check.ts](../src/name-check.ts) and [name_check.rs](../atomis-rs/src/name_check.rs).
Each [TS compiler](../src/compiler.ts) / [Rust compiler](../atomis-rs/src/compiler.rs)
runs it on the lowered statement buffer before emitter/file writes. This uses
the actual Atomis lexer, its own binding scopes and existing line mappings; it does not ask TypeScript's
type checker to supply name diagnostics or execute source. Lowered text covers
raw TS expression contexts as well as parsed Atomis constructs without adding
an expression AST or changing emitted bytes.

Both modes now reject the original example with **Undefined identifier
'missingValue'**, at source 9:1, exit 1, empty success stdout. Rust gives the same
core diagnostic. The pass distinguishes bindings, reference expressions,
property names, literal/regex/comment text, annotations and interpolation.
It checks enclosing visibility, parameters, ordinary nested blocks, loop headers,
catch variables, imports/aliases, callbacks and direct constant rebinding.
Core semantic failures return empty code/no map before target validation.

This is a documented bounded lexical resolver, **not a complete TypeScript binder**.
Full TS/JSX syntax, advanced type/value namespaces, overloads, labels, initialization
order and more exotic raw binding syntax remain conformance work. Calls/types/
return paths/modules remain the additional target stage. The two modes agree
on the tested Atomis name rules; their type-level verdicts intentionally differ.

Both implementations are actively maintained: the current specification requires
tested core diagnostic/emission/map parity, and the shared tests and Rust golden
fixtures enforce it. Rust intentionally remains Node-independent and does not
expose --target-check. A fresh invocation rejects that flag with exit 1 and Invalid or incomplete option (see rust-target-flag.json). Its accepted TS can use the standalone Node target validator.

## 2. Runtime execution

The source [first_program.ato](../examples/first_program.ato) remains unchanged.
Its output should still be:

~~~text
Hello, Ada!
Total: 42
Reached target: true
Target reached
~~~

**Actual program stdout/stderr: not observed. Runtime exit code: N/A.**
The example is trusted and the generated TS was inspected: it only declares a
function/variables, calculates/comparisons/interpolations, and calls console.log.
No import, filesystem, process, environment or network access appears in it.
Nevertheless ordinary ts-node/Node has host capabilities; inspection alone
does not supply the isolation required by this task.

Actual successful commands (exit 0, empty stderr):

~~~powershell
node dist/cli.js build examples/first_program.ato --target-check --out .parity-tmp/execution-Crjqut
node dist/target-check.js .parity-tmp/execution-Crjqut/first_program.ts
~~~

The generated first_program.ts exactly matches the earlier evidence, including
its sourceMappingURL. Existing TypeScript and ts-node dependencies were found;
no installation was needed. [execution.json](audit/evidence/semantics-20261015/execution.json)
records resolved tools, complete output, generated TS and the dedicated artifact directory.

A read-only Docker image-list probe used an empty **repository-local** config,
so private Docker configuration/credentials were not consulted:

~~~powershell
& 'C:/Program Files/Docker/Docker/resources/bin/docker.exe' --config .parity-tmp/execution-Crjqut/docker-config image ls --format '{{.Repository}}:{{.Tag}}'
~~~

It exited 1: the docker_engine named pipe does not exist. No images were pulled
and Docker was not started. No alternative OS sandbox is configured by this
repository; its runtime harnesses use host Node/ts-node or node:vm.
Node permissions, a temporary folder and a separate process are not adequate
hostile-code isolation. Therefore no execution command was issued.

A future approved environment needs an existing isolated runtime/image, no
network/secrets/unrelated mounts, a read-only program/dependency mount, temporary
writable artifacts, a nonprivileged user and memory/CPU/wall-time limits.
Only there should the documented run command be used. Normal/boundary/alternative
runtime values, division-by-zero behavior and runtime-failure exit propagation
remain unverified. The implementation distinguishes compile errors before launch
from child runtime exit status, but that latter behavior was not exercised here.

## 3. Function tests

[Source cases](../test/name-cases.json) and the
[feature harness](../test/name-feature-regressions.mjs) cover:

- No, one and multiple parameters; correct calls, too few/many arguments, defaults,
  correct/incorrect argument types.
- Explicit number/string returns, compatible returns, wrong returns, empty returns
  and a missing value-returning body.
- Guard early returns and nested functions capturing outer parameters.
- Ordinary arrow callbacks, named function expressions, object methods and one
  simple class field/method example; parameter escapes and undefined method-body
  references are rejected.

Function syntax is still fn name(parameters) -> ReturnType { ... }; return and
call expressions are raw TS. Plain checking establishes tested binding visibility,
not argument compatibility or return-path completeness. Target checking rejects
the invalid signature/return cases. Missing returns, wrong operands and call
arity/type mismatches accepted by plain mode are explicitly recorded as such,
not counted as full Atomis type safety. Advanced generics/overloads and complete
raw method/type syntax were not established.

## 4. Scope tests

The corpus verifies top-level, function, parameter, nested-function, guard, ordinary
block, callback, catch and loop-header bindings. Enclosing capture and shadowing
pass; same-scope duplicates and inaccessible inner bindings fail. Identifier reuse
after a block is accepted. var's enclosing-function visibility is tested separately
from let/const block scoping.

Additional regression cases prevent an arrow parameter escaping after its call,
a for-header binding surviving immediately after a closing brace, and a named
function expression leaking its internal name. Property names/object keys are
not treated as lexical variables; shorthand and computed keys are checked.

Direct const assignment/compound updates/increment/decrement fail in both core
pipelines. Property mutation through a const object remains valid. Destructuring
declarations are exercised; destructuring assignment and exotic TS bindings are
not claimed covered. This is visibility checking rather than temporal-dead-zone,
liveness, initialization-order or complete type/value namespace analysis.

The [native Rust corpus](../atomis-rs/tests/names.rs) checks the same sources.
Both normal CLIs must agree byte-for-byte on core stderr; each TS checking mode
is also compared for core-invalid programs.

## 5. Control flow and types

Loops are **raw TypeScript passthrough**, not a new Atomis loop construct.
Inside raw loop/if bodies these tests use TS statements, because nested Atomis
sugar is not recursively parsed there.

Compilation cases cover for (zero/one/many and inclusive boundaries), nested for,
for-of, for-in, while, do/while, break/continue, header visibility, missing condition
identifiers and an invalid typed comparison. while(0) is target-valid under JS
truthiness; no stricter Boolean-only rule was invented. No intentionally infinite
program was executed. These are checked source cases, not observed iteration counts.

Types/operations cover +, -, *, /, %, **, comparisons/equality, Boolean operators,
strings/interpolation, assignment, Number/String conversions and missing conversion
functions. Target checks reject Boolean-plus-number, string subtraction, incompatible
comparison, wrong assignment/call/return types. Selected literal annotation mismatches
are already rejected by Atomis's original analyzer.

Number.MAX_SAFE_INTEGER+1, Number.MAX_VALUE*2, 1/0, 0/0 and 1n/0n all compile.
The spec delegates binary64 precision, Infinity/NaN and BigInt exceptions to the
host. No numeric-boundary/overflow/runtime-error observation is claimed. Recognition
of a built-in/global name does not guarantee every member/call is valid or safe.

## 6. Final verification

See the exact results and commands in
[audit/evidence/semantics-20261015](audit/evidence/semantics-20261015/).
The original shell helper was unavailable, so authorized commands used direct
Node child_process calls with explicit cwd/timeouts. The final matrix process
also has a 1024 MiB V8 heap cap; each test subprocess has a 20-second timeout.
Those compilation-test limits are not a generated-code execution sandbox.

The new npm run test:semantics script runs only the new static matrix and
output-preservation suites. No runtime assertion was disabled.

| Check | Result |
| --- | --- |
| TS build and existing lexer/parser units | Exit 0; 29 unit cases pass. |
| Rust all-target compiler tests | Exit 0; 59 tests pass, including native name corpus, golden/conformance and bounded generated-input tests. |
| Existing TS/Rust parity | Exit 0; 14 paired checks pass. |
| Existing optional target suite | Exit 0; 26 pass, 0 fail. |
| New cross-engine/mode matrix | Exit 0; **101 pass, 0 fail** across API/CLI modes and both core implementations. |
| Failed check/build output preservation | Exit 0; **30 checks pass**, with TS and map byte preservation. |
| Strict Rust Clippy | Exit 0. |
| Repository-wide rustfmt check | Exit 1 for two pre-existing formatting differences: parser.rs and the existing awaited-match cell test in audit.rs. Own changed sections/new files were formatted. |
| Runtime suites / full npm test | Not run: suitable OS sandbox unavailable. |
| Resource suite | Automatic approval review blocked it because it includes run paths without OS isolation. It was not retried through another route. |
| First-program execution | Unverified; no execution command, output or exit code. |

Early exploratory Rust runs found false object-key/import-keyword classifications
in the new pass and legacy compile fixtures that used undeclared placeholders.
The property/import classifications were fixed. Existing structural match fixtures
now declare real callbacks; the 10,000-line preservation fixture uses unique names
while retaining its size/line-count assertions. The historical network golden
still checks exact lowering bytes, while compilation additionally must reject
its undeclared channel value. The standalone Rust target test uses a core-valid,
target-type-invalid source. These updates reflect the intended new checking
contract; expected output bytes, type-error checks and runtime assertions were
not weakened to hide failures.

An inspection-tool CommonJS module cache initially returned stale compiler code;
fresh CLI processes were used to verify behavior. A long tool invocation later
timed out/reset and interrupted preliminary background suites; their partial logs
are not passed runs. Only recorded completed reruns count toward final results.

Pre-existing user changes were retained; Git's overall diff includes work from
before this task. No commit, release, dependency installation, compiler rewrite,
native backend or external service access was introduced.

## 7. Remaining priorities

1. Expand paired raw-TS binding conformance (advanced type/value namespaces,
   typed callbacks, labels, var redeclaration/hoisting edges and class forms),
   with explicit accepted grammar and tests before claiming complete resolution.
2. Establish an approved OS isolation runner and execute the first program,
   threshold variants and existing runtime/error/loop suites under quotas.
3. Add trusted, pre-write strict target validation to the Rust CLI; core name
   parity does not provide the TS-only signature/operator/module checks.
4. Bound semantic/import-graph resource work and implement atomic TS/map output
   recovery, beyond the tested ordinary failed-compilation preservation.
5. Carry expression spans through the AST/lowering and add initialization and
   control-flow diagnostics, instead of reporting lowered failures at column 1.

## Complete compilation matrix

The table below records the observed plain/target verdicts, asserted against the expected verdict for every case; per-case
diagnostics, CLI output and assertions are in name-feature-results.json.
“Accept” here means compilation/checking only. No row is a runtime pass.

| Case | Plain | Target |
| --- | --- | --- |
| undefined-variable | Reject | Reject |
| undefined-function | Reject | Reject |
| local | Accept | Accept |
| parameter | Accept | Accept |
| outer | Accept | Accept |
| guard-escape | Reject | Reject |
| raw-block-escape | Reject | Reject |
| duplicate-atom | Reject | Reject |
| duplicate-raw | Reject | Reject |
| duplicate-parameter | Reject | Reject |
| parameter-local-duplicate | Reject | Reject |
| const-assign | Reject | Reject |
| const-update | Reject | Reject |
| const-prefix | Reject | Reject |
| const-property | Accept | Accept |
| mutable | Accept | Accept |
| undefined-initializer | Reject | Reject |
| undefined-return | Reject | Reject |
| undefined-default | Reject | Reject |
| undefined-guard | Reject | Reject |
| undefined-discriminant | Reject | Reject |
| undefined-pattern | Reject | Reject |
| undefined-arm | Reject | Reject |
| undefined-template | Reject | Reject |
| nested-template | Reject | Reject |
| escaped-template | Accept | Accept |
| property | Accept | Accept |
| computed-property | Reject | Reject |
| object-shorthand | Reject | Reject |
| object-key | Accept | Accept |
| object-value | Reject | Reject |
| ternary | Reject | Reject |
| condition | Reject | Reject |
| assignment-target | Reject | Reject |
| array | Reject | Reject |
| arguments | Reject | Reject |
| regex-opaque | Accept | Accept |
| comment-opaque | Accept | Accept |
| import-alias | Accept | Accept |
| import-alias-original | Reject | Reject |
| destructure | Accept | Accept |
| array-destructure | Accept | Accept |
| catch | Accept | Accept |
| catch-escape | Reject | Reject |
| no-parameters | Accept | Accept |
| multi-parameters | Accept | Accept |
| too-few | Accept | Reject |
| too-many | Accept | Reject |
| wrong-argument | Accept | Reject |
| default-argument | Accept | Accept |
| wrong-return | Accept | Reject |
| missing-return | Accept | Reject |
| empty-return | Accept | Reject |
| guard-return | Accept | Accept |
| nested-function | Accept | Accept |
| nested-function-escape | Reject | Reject |
| shadow | Accept | Accept |
| block-shadow | Accept | Accept |
| scope-reuse | Accept | Accept |
| sibling-escape | Reject | Reject |
| var-function | Accept | Accept |
| for-zero | Accept | Accept |
| for-one | Accept | Accept |
| for-many | Accept | Accept |
| for-nested | Accept | Accept |
| for-break-continue | Accept | Accept |
| for-escape | Reject | Reject |
| for-single | Reject | Reject |
| for-missing | Reject | Reject |
| for-of | Accept | Accept |
| for-in | Accept | Accept |
| while | Accept | Accept |
| do-while | Accept | Accept |
| loop-nonboolean | Accept | Accept |
| loop-type-error | Accept | Reject |
| arithmetic | Accept | Accept |
| compare | Accept | Accept |
| string | Accept | Accept |
| invalid-add | Accept | Reject |
| invalid-arithmetic | Accept | Reject |
| invalid-compare | Accept | Reject |
| assignment-type | Accept | Reject |
| literal-type | Reject | Reject |
| conversion | Accept | Accept |
| missing-conversion | Reject | Reject |
| number-boundary | Accept | Accept |
| bigint-zero | Accept | Accept |
| assertion-reference | Reject | Reject |
| arrow | Accept | Accept |
| arrow-escape | Reject | Reject |
| single-arrow | Accept | Accept |
| block-arrow | Accept | Accept |
| return-result | Accept | Accept |
| loop-immediate-escape | Reject | Reject |
| arrow-expression-escape | Reject | Reject |
| named-function | Accept | Accept |
| named-function-escape | Reject | Reject |
| method | Accept | Accept |
| class | Accept | Accept |
| method-undefined | Reject | Reject |
| method-escape | Reject | Reject |

