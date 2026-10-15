# First Atomis program walkthrough

> 2026-10-15 semantic follow-up: default `check` now rejects undefined value identifiers in both compilers before emission. The earlier unchecked success below is historical evidence. Runtime execution remains **unverified**: a fresh Docker probe with an empty local config still found no daemon pipe. See [semantic verification](SEMANTIC_EXECUTION_VERIFICATION.md) and [fresh evidence](audit/evidence/semantics-20261015/).

Verified 2026-10-15 on Node v22.22.2. Compilation and negative tests were executed. **The generated program was not executed: an OS sandbox could not be established.** No runtime output or runtime exit code is claimed. No compiler/specification changes or dependency installations were made; pre-existing user edits were preserved.

## A. Program source

File: [examples/first_program.ato](../examples/first_program.ato).

```ato
fn describe(total: number, threshold: number) -> string {
  guard total >= threshold else { return "Below target" }
  return "Target reached"
}

atom userName: string = "Ada"
atom first: number = 18
atom second: number = 24
atom total: number = first + second
atom threshold: number = 40
atom reached: boolean = total >= threshold
output(`Hello, ${userName}!`)
output(`Total: ${total}`)
output(`Reached target: ${reached}`)
output(describe(total, threshold))
```

This calculates 18 + 24, compares 42 against 40, and prepares a greeting and target result. It deliberately uses the supported parsed guard rather than inventing a conditional syntax. No input, imports, files, or network operations are requested by the program.

## B. What each line does

These explanations follow the current [language specification](LANGUAGE_SPEC.md). Emission and AST observations below were independently verified against the implementation. Runtime values are predictions from that generated code, not observed execution.

| Line | Explanation |
| --- | --- |
| 1 | Declares function **describe**. Parameters **total** and **threshold** are explicitly number; the return type is string. Parameters are local to each invocation and shadow the later top-level names. They are ordinary assignable TS parameters, not constants. This line produces a function declaration, not a result string yet. Atomis builds a FnDecl with two Param nodes and emits function describe(total: number, threshold: number): string. |
| 2 | Evaluates total >= threshold using the invocation's parameters. >= includes equality and produces boolean. The guard runs its else body only when that boolean is false. Its return produces the string Below target and immediately exits describe. Atomis parses GuardStmt, keeps the comparison as raw text, and emits if (!(total >= threshold)) { return "Below target" }. The return itself is TSPassthrough. Raising the threshold above the total selects this return. |
| 3 | If the guard did not return, returns the string Target reached. Equality therefore counts as success. Atomis preserves this raw TS return statement; strict target checking verifies its type. |
| 4 | Closes the function's parsed body and its local parameter scope. Emits a closing brace. |
| 5 | Blank separator for readability; introduces no binding or behavior. |
| 6 | Declares **userName**, explicit string, initialized to Ada. atom emits mutable let, with no reactive registration. The binding is in the top-level generated script scope after initialization. Changing it before the greeting changes the interpolated name. The string initializer is raw text in AtomDecl; the analyzer can check selected literal mismatches. |
| 7 | Declares top-level mutable **first: number**, initialized to 18. It contributes the first operand of the later sum. Changing its initializer changes total. AtomDecl becomes let first: number = 18. |
| 8 | Declares top-level mutable **second: number**, initialized to 24. It contributes the second operand; changing its initializer changes total. AtomDecl becomes let second: number = 24. |
| 9 | Declares top-level mutable **total: number**, initialized by first + second, predicted 42. + is numeric addition here because both operands are numbers. The parser stores first + second as a string, not an operator AST; TS checks the expression. Later reassignment of first or second does not recompute total: atom is not reactive. |
| 10 | Declares top-level mutable **threshold: number**, initialized to 40. This selects the boolean and description. Changing this initializer to 42 still predicts success; 43 predicts failure. It emits let with the same annotation and initializer. |
| 11 | Declares top-level mutable **reached: boolean**, initialized from total >= threshold, predicted true. Atomis stores the expression as raw text; target checking establishes boolean compatibility. This stores a snapshot: later total/threshold changes do not automatically update reached. |
| 12 | output evaluates the template string Hello, followed by userName and punctuation, predicted Hello, Ada!. Atomis makes OutputCall and emits console.log with the original argument. Output creates no binding; console.log's host return is undefined/void. |
| 13 | Interpolates total into Total: 42 and sends it to console.log. No new variable. Changing total before this statement changes the displayed number. |
| 14 | Interpolates reached into Reached target: true. A false value would display false. No new variable; emitted as console.log. |
| 15 | Calls describe with the current total and threshold, predicted Target reached, then logs its returned string. Arguments pass the numeric values into separate local parameters. Changing either argument can change the guard result. Atomis stores the call as the raw OutputCall argument; strict TS checks the call and return use. |

Top-level here means the emitted script's lexical environment, not an Atomis module export. No declaration is exported. Primitive type semantics belong to TS/JS: number is host binary64, string is host string, boolean has true/false. None of the atom bindings is immutable. A separate checked fixture successfully assigns first = 20; it was not executed. A raw TS const assignment was rejected by target checking, not by an independent Atomis mutability system.

## C. Compilation and execution

All commands have repository root as working directory. The standard shell helper could not start (helper_unknown_error), so existing Node child_process.spawnSync invoked commands with argument arrays, 30-second timeouts and captured output. No elevation was used.

The existing compiler was rebuilt with the package's build command equivalent:

```powershell
node node_modules/typescript/bin/tsc -p tsconfig.json
node dist/cli.js build examples/first_program.ato --target-check --out .first-program-GazRM5/normal
```

Both exited 0. Compiler build stdout/stderr were empty. Atomis stdout was:

```text
✓ examples/first_program.ato → .first-program-GazRM5\normal\first_program.ts
```

Atomis stderr was empty. Original generated paths are **.first-program-GazRM5/normal/first_program.ts** and **first_program.ts.ato.map**. Artifacts were generated in a uniquely created repository-local temporary directory. Persistent byte copies are [generated TypeScript](first-program-evidence/first_program.generated.ts) and [map](first-program-evidence/first_program.generated.ts.ato.map). The copied TS still references the original map basename; these copies are evidence, not a repackaged runnable distribution.

Generated TypeScript, copied directly from the compiler:

```typescript
function describe(total: number, threshold: number): string {
  if (!(total >= threshold)) { return "Below target" }
  return "Target reached"
}
let userName: string = "Ada"
let first: number = 18
let second: number = 24
let total: number = first + second
let threshold: number = 40
let reached: boolean = total >= threshold
console.log(`Hello, ${userName}!`)
console.log(`Total: ${total}`)
console.log(`Reached target: ${reached}`)
console.log(describe(total, threshold))
//# sourceMappingURL=first_program.ts.ato.map
```

Isolation discovery found Docker's existing executable. This read-only probe exited 1:

```powershell
& 'C:/Program Files/Docker/Docker/resources/bin/docker.exe' image ls --format '{{.Repository}}:{{.Tag}}'
```

Its daemon pipe was absent; the client also reported access denied reading its default config. No credentials were read, Docker was not started, and no image was pulled. Node exposes a permission model, but that is not an OS hostile-code sandbox; a temporary folder or node:vm alone also does not establish isolation. The project explicitly says run executes with normal caller privileges. Consequently **no execution command was issued**, execution success is unverified, runtime exit code is N/A, and actual stdout/stderr are unavailable.

The documented command for a future appropriately isolated environment is node dist/cli.js run examples/first_program.ato --target-check. This is a proposal, not a command executed in this exercise. It compiles afresh and uses installed ts-node/Node; TypeScript is not a standalone Atomis runtime.

[commands.json](first-program-evidence/commands.json) preserves exact argument arrays, stdout, stderr and exits for every exercise compiler invocation. Boundary/negative fixtures are separate from the final example. No generated source was executed by target validation.

| Test | Actual result |
| --- | --- |
| Normal 18 + 24, threshold 40 | Checked build exit 0; runtime not run. |
| Boundary threshold 42 | Checked build exit 0; runtime equality behavior not tested. |
| Alternative threshold 43 | Checked build exit 0; runtime false branch not tested. |
| Unterminated string | Exit 1, [2:10] Unterminated string, no success stdout. |
| Undefined missingValue | Checked build exit 1, line 9 column 1, TS2304: Cannot find name 'missingValue'. |
| Duplicate first | Exit 1, line 16 column 1, 'first' is already declared in this scope. |
| Mutable atom assignment | Checked build exit 0. |
| const reassignment | Checked build exit 1, TS2588: Cannot assign to 'fixed' because it is a constant. |
| Raw TS for loop | Checked build exit 0; runtime not run. |
| Undefined name without --target-check | check exit 0 and misleading-to-a-beginner no errors message; only partial Atomis validation was requested. |

For each of syntax, undefined and duplicate failures, first compiled the valid program into a separate output directory, then built an invalid source with the same basename into that directory. Each invalid build exited 1; **both existing TS and map remained byte-identical**. Separately named invalid builds did not emit successful output. This verifies failed compilation preservation, not atomic recovery from disk failure during valid writes.

## D. Expected versus actual output

Predicted normal output:

```text
Hello, Ada!
Total: 42
Reached target: true
Target reached
```

Actual program output: **not observed; execution withheld**. Compiler progress text is not program output. Therefore expected/actual runtime equality cannot be asserted.

For threshold 42 the prediction is the same four lines. For threshold 43 the last two lines are predicted Reached target: false and Below target. Compilation of both variants succeeded; neither prediction is a passed runtime test.

## E. Compiler internals

1. **CLI and source read:** package.json maps atomis to dist/cli.js, built from [src/cli.ts](../src/cli.ts). main/dispatch routes build to cmdBuild/buildFile. [src/source-file.ts](../src/source-file.ts) handles bounded valid UTF-8 reads; compile also checks source size. The Rust port was not used or tested in this exercise.
2. **Lexer:** [src/lexer.ts](../src/lexer.ts), tokenize, emits positioned tokens. Actual line 9 sequence, with positions: KEYWORD atom (9:1), IDENT total (9:6), PUNCTUATION : (9:11), IDENT number (9:13), OPERATOR = (9:20), IDENT first (9:22), OPERATOR + (9:28), IDENT second (9:30), NEWLINE (9:36). Complete actual tokens are saved in [tokens.json](first-program-evidence/tokens.json).
3. **Parser/AST:** [src/parser.ts](../src/parser.ts), parse/parseAtom/parseFnLike/parseGuard/parseOutput, uses the statement interfaces in [src/ast.ts](../src/ast.ts). The actual root has one FnDecl, six AtomDecl nodes and four OutputCall nodes. Its function contains GuardStmt and TSPassthrough return text. The line 9 node is reproduced verbatim below. [ast.json](first-program-evidence/ast.json) contains the complete actual tree. There is no binary-expression tree or independently parsed TS expression precedence.
4. **Semantic analysis:** [src/analyzer.ts](../src/analyzer.ts), analyze, preregisters parsed bindings, tracks function/parameter/guard scopes, rejects duplicates, and checks selected whole-literal annotation mismatches. It does not resolve the missingValue expression in the unchecked fixture. No purity/effect guarantee is involved.
5. **Transformation:** [src/transformer.ts](../src/transformer.ts), transform/emitAtom/emitFn/emitGuard/emitOutput, directly produces TS text and line mappings. atom becomes let, fn becomes function, guard negates its condition, output becomes console.log. This is direct statement AST-to-text lowering; no optimizer, native backend or extra intermediate representation is used.
6. **Emission:** [src/emitter.ts](../src/emitter.ts), emit/buildSourceMap, adds the sourceMappingURL comment and Source Map v3 line mappings with embedded source. It does not compile TypeScript to machine code or JavaScript. Columns and full spans are unavailable.
7. **Optional target validation:** [src/compiler.ts](../src/compiler.ts), compile, calls [src/target-check.ts](../src/target-check.ts), validateTarget, only because --target-check was requested. The installed TypeScript compiler checks an in-memory .ato.ts using strict ES2020, Node16 module/resolution, Node declarations and noEmit. It does not load project tsconfig/plugins or execute the example. Primary diagnostic columns map to 1. Errors withhold code/map before CLI writes.
8. **Runtime:** cmdRun in src/cli.ts would compile to an exclusive randomly named sibling TS file, invoke the installed ts-node CLI with Node, propagate the child exit status, and delete the temporary file in finally. That stage was not reached. No standalone Atomis interpreter exists.

Actual AST fragment:

```json
{
  "type": "AtomDecl",
  "line": 9,
  "col": 1,
  "name": "total",
  "typeAnnotation": "number",
  "initializer": "first + second"
}
```

The current specification and code agree on these constructs. Some README prose is stale: it still calls repaired match/regex behavior unresolved. Current LANGUAGE_SPEC.md and inspected phase-two implementation take precedence over those historical descriptions. Runtime numbers and scope behavior beyond checked emission are host-semantics predictions, explicitly unverified here.

## F. Supported language features demonstrated

Verified at compilation level: typed mutable atom declarations; string/number/boolean annotations; numeric literal initialization and addition; inclusive comparison; template interpolation; typed fn parameters and return annotation; parsed guard with early return; raw TS return; function call inside output; output-to-console.log emission; strict target validation; located error diagnostics; failed-output preservation. All are visible in actual emitted code or diagnostics. Runtime behavior is not claimed verified.

Separate fixtures also compile-check mutable reassignment and a raw TS for loop, and verify target rejection of const assignment. They are not additional features exercised by the final minimal example.

## G. Unsupported or unverified features

No native code, standalone runtime, built-in sandbox, reactive atom updates, ownership/borrow checking, or independent comprehensive Atomis type system. Ordinary TS const/let, if/else, arithmetic/comparison operators and loops are passthrough/target semantics, not special Atomis expression constructs. Only + and >= were exercised in the final example; do not infer all operator combinations passed. Arrays, bigint, objects and external types are described by the spec but not exercised here. Atomis sugar is not recursively parsed inside raw TS loop/try/match-arm blocks.

match, Result/Ok/Err, async, pure, imports and notebook/render features were not exercised. GhostNet network.ato is an emission example with missing runtime helpers, not a standalone networking app. No services, private credentials, packages, network application, Rust CLI, full repository suite or unrelated library tests were used. All actual program runtime behavior, including boundary branches and printing, remains unverified because isolation was unavailable.

## H. Bugs and limitations discovered

- Plain check reports no errors for an undefined identifier; the exact control is preserved. This reproduces the documented limited default checking contract, rather than establishing a new regression. Use --target-check for developer-facing validation.
- TypeScript diagnostics map to column 1. The undefined name is farther along line 9; source maps cannot give its exact column.
- Syntax-error formatting ([2:10]) differs from semantic diagnostic path:line:column formatting and omits the input path in this case.
- Historical README/testing descriptions include stale findings; current spec and audit follow-up must be read together.
- The generated arithmetic, guard and output look semantically faithful, but no runtime proof is available. Docker discovery failed; normal run has caller privileges. No compiler crash or incorrect emission was found in these cases.
- A tooling-only attempt to dynamically import CommonJS dist code in the Node inspection tool failed with exports is not defined; using createRequire loaded the real existing modules for token/AST capture. This was not an Atomis compilation failure, and the .ato program was not changed to hide it.

All failing language fixtures are retained in first-program-evidence. No compiler repair was attempted. The main example was compiled unchanged on its first attempt.

## I. Recommended next program

In a working OS sandbox, first execute this program and both threshold variants, asserting exact output and exit 0. Then write a small score-labeling function using match and explicit returns, test exact/wildcard cases and a side-effect-counted discriminant. This extends the already demonstrated typed function and output path while testing ordered single evaluation without external runtime dependencies.

## Follow-up compilation and execution status (2026-10-15)

The unchanged example was rebuilt with `node dist/cli.js build examples/first_program.ato --target-check --out .parity-tmp/execution-Crjqut` (exit 0). `node dist/target-check.js .parity-tmp/execution-Crjqut/first_program.ts` also exited 0, with empty stderr. Generated TypeScript was inspected and is identical to the earlier saved output. Both checking modes now reject the earlier undefined-name fixture at the Atomis reference stage, rather than waiting for TS2304.

No execution command was issued. Actual runtime stdout/stderr and exit code remain unavailable. The four expected lines above remain predictions. Missing isolation includes restrictions on user files/environment, network, child processes and resource use; a suitably configured OS container/sandbox with no network, no secrets, read-only program mounts and time/memory limits is needed before executing. Ordinary Node, ts-node, a temporary directory and node:vm do not meet that requirement. No package/image download or privilege elevation was attempted.
