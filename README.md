# Atomis

Atomis is an experimental language in the **Kryptos** ecosystem that compiles
to **TypeScript**. It adds language sugar and network primitives to `.ato`
source files, with a TypeScript reference compiler and a Rust port.

Atomis has three syntax layers:

1. **Layer 1 — Passthrough:** unrecognized statements are preserved as TypeScript text. Compatibility is partial; regex literals and other lexical ambiguities are not reliably supported.
2. **Layer 2 — Sugar:** `fn`, `atom`, `match`, `guard`, `pure`, `Result` / `Ok` / `Err`.
3. **Layer 3 — Kryptos:** `node`, `channel`, `mesh`, `connect`, `encrypt`.

## Install

```bash
npm ci --ignore-scripts
npm run build      # compiles src/*.ts -> dist/
```

Run a standalone example after building:

```bash
node dist/cli.js run test/cases/hello.ato
# hello atomis
```

## CLI

```bash
node dist/cli.js build <file.ato>          # transpile a single file
node dist/cli.js build <dir> --out <dir>   # transpile a project
node dist/cli.js watch <dir>               # watch + hot transpile
node dist/cli.js run <file.ato>            # transpile + execute via ts-node
node dist/cli.js check <file.ato>          # semantic check only
node dist/cli.js check <file.ato> --target-check # also validate TypeScript
node dist/cli.js repl                      # interactive shell
```

Or link the `atomis` binary globally with `npm link`, then use `atomis <cmd>`.

## Example

```
@import { mesh, GhostChannel } from "kryptos/core"

atom activeNodes: Node[] = []

node relay "node-01" {
  type: esp32
  transport: [bluetooth, tcp]
  encrypt: aes256
}

channel "ghostchat" {
  peers: ["node-01"]
  e2e: true
  persist: false
}

connect "ghostchat" -> "node-01" via bluetooth

@cell #scan
activeNodes = await mesh.scan()
output(`Found ${activeNodes.length} peers`)

fn sendMsg(text: string) -> void {
  guard text.length > 0 else { return }
  channel.send("ghostchat", text)
}
```

Transpiles to clean TypeScript (`new GhostNode(...)`, `new GhostChannel(...)`,
`__atomis_cell(...)`, `if (!(...)) { ... }`, etc.) plus a `.ato.map` source map.

The networking example demonstrates emitted syntax, not a runnable standalone
program. Kryptos constructors and notebook helpers require external bindings
that this repository does not provide. `atom` currently emits plain `let`;
reactivity is not implemented. `pure` produces heuristic warnings and a comment,
not an enforced effect system. `match` emits statement branches and requires explicit
`return` in function arms. The features example is target checked; repeated match
discriminant evaluation and wildcard ordering remain unresolved.

`check` validates selected Atomis rules. Add `--target-check` to the TypeScript
CLI's `build`, `check` or `run` command to also validate emitted TypeScript
against the ES2020/Node target, including imports and types. The Rust CLI can
use the standalone checker described in the [testing guide](docs/TESTING.md).
`run` executes trusted source through ts-node with normal user permissions.
The REPL displays transpiled text. Compilation accepts at most 8 MiB of UTF-8
source and 64 levels of parsed bracket/Result/template nesting. Errors carry
1-based coordinates; source maps currently map lines only.

## Kryptos configuration and libraries

The CLI reads `atomis.config.json`. The network target is `kryptos`, and SDK
settings use the `kryptos` key:

```json
{
  "target": "kryptos",
  "outDir": "./dist",
  "srcDir": "./src",
  "kryptos": {
    "sdkPath": "./kryptos-sdk",
    "platform": "node"
  }
}
```

These settings do not install an SDK or supply runtime bindings. Networking
imports use `kryptos/core`; the SDK is an external dependency.

Two independent Rust libraries have vendored Node/WASM packages installed with
the root npm dependencies:

| Library | Atomis import | Purpose |
|---------|---------------|---------|
| [kryptos-proto](kryptos-proto/README.md) | `@import { encode, decode } from "proto"` | CBOR wire format for Kryptos messages |
| [ghostvault](ghostvault/README.md) | `@import * as vault from "ghostvault"` | Passphrase-protected sealed secrets |

Try their standalone examples:

```bash
node dist/cli.js run test/cases/proto.ato
node dist/cli.js run test/cases/vault.ato
```

## Architecture

| File | Role |
|------|------|
| `src/lexer.ts` | Hand-written tokenizer |
| `src/parser.ts` | Recursive-descent parser → Atomis AST |
| `src/ast.ts` | AST node type definitions |
| `src/analyzer.ts` | Scope/atom tracking, Kryptos & purity validation |
| `src/transformer.ts` | Atomis AST → TypeScript source |
| `src/emitter.ts` | Final emission + Source Map v3 |
| `src/cli.ts` | Command-line interface |

## Tests

```bash
npm test
```

## Rust and library API

The complete `npm test` suite requires Node, npm and Rust/Cargo. It rebuilds TS,
runs unit/runtime tests, then exercises both compilers. The Rust crate is separate:

```bash
cargo build --manifest-path atomis-rs/Cargo.toml
cargo test --manifest-path atomis-rs/Cargo.toml --all-targets
```

The npm entry point exposes `compile`; Rust exposes `atomis::compiler::compile`.
Both return diagnostics and omit code on semantic errors. Tracked duplicate
declarations are errors; Kryptos connects must reference declarations in a
same/enclosing parsed lexical scope. Initialization order is not checked. They produce TypeScript,
not native executables. See [verification](docs/audit/verification-report.md),
[capabilities](docs/audit/language-capabilities.md) and [tests](docs/audit/test-plan.md).

## License

MIT

See the current [audit](docs/ATOMIS_AUDIT.md), [draft language spec](docs/LANGUAGE_SPEC.md),
[security model](docs/SECURITY.md), [testing guide](docs/TESTING.md) and
[continuation roadmap](docs/ROADMAP.md).
