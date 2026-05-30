# Atomis

A transpiled language that compiles to **TypeScript**, with first-class
**GhostNet** network primitives. File extension: `.ato`.

Atomis has three syntax layers:

1. **Layer 1 — Passthrough:** all valid TypeScript is valid Atomis.
2. **Layer 2 — Sugar:** `fn`, `atom`, `match`, `guard`, `pure`, `Result` / `Ok` / `Err`.
3. **Layer 3 — GhostNet:** `node`, `channel`, `mesh`, `connect`, `encrypt`.

## Install

```bash
npm install
npm run build      # compiles src/*.ts -> dist/
```

## CLI

```bash
node dist/cli.js build <file.ato>          # transpile a single file
node dist/cli.js build <dir> --out <dir>   # transpile a project
node dist/cli.js watch <dir>               # watch + hot transpile
node dist/cli.js run <file.ato>            # transpile + execute via ts-node
node dist/cli.js check <file.ato>          # semantic check only
node dist/cli.js repl                      # interactive shell
```

Or link the `atomis` binary globally with `npm link`, then use `atomis <cmd>`.

## Example

```
@import { mesh, GhostChannel } from "ghostnet/core"

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

## Architecture

| File | Role |
|------|------|
| `src/lexer.ts` | Hand-written tokenizer |
| `src/parser.ts` | Recursive-descent parser → Atomis AST |
| `src/ast.ts` | AST node type definitions |
| `src/analyzer.ts` | Scope/atom tracking, GhostNet & purity validation |
| `src/transformer.ts` | Atomis AST → TypeScript source |
| `src/emitter.ts` | Final emission + Source Map v3 |
| `src/cli.ts` | Command-line interface |

## Tests

```bash
npm test
```

## License

MIT
