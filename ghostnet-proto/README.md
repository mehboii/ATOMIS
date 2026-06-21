# ghostnet-proto (`proto`)

The shared **wire format** for GhostNet: how messages are turned into bytes and
back. Everything in GhostNet uses it.

- **Encoding:** canonical/deterministic **CBOR** (via `ciborium`). Same message
  → same bytes, every time.
- **The Rust types ARE the spec.** Plain `serde` structs/enums; no schema
  language, no codegen. Read [`src/lib.rs`](src/lib.rs) and
  [`SCHEMA.md`](SCHEMA.md) and you know the whole format.
- **No crypto.** Encrypted data rides as opaque bytes in `Secure.ciphertext`;
  `Secure.scheme` (a `u16` registry) says which crypto scheme produced them.
- **Dual target:** builds for native Rust and wasm32.

## The whole API

```rust
let env = Envelope::new(1, Message::Hello(Hello { /* ... */ }));
let bytes: Vec<u8>           = encode(&env);   // -> canonical CBOR
let back:  Envelope          = decode(&bytes)?; // -> Result<Envelope, ProtoError>
```

Messages: `Hello`, `PeerAnnounce`, `Secure`, `Ack` — all documented field-by-field
in [`SCHEMA.md`](SCHEMA.md).

## Build & test

```sh
cargo test -- --nocapture        # round-trip tutorials; prints the wire hex
wasm-pack build --target nodejs --release --out-dir ../vendor/proto --out-name proto
```

## From ATOMIS (`.ato`)

Wired as a vendored Node package exactly like ghostvault (`vendor/proto`, a
`file:` dependency in the repo `package.json`):

```
@import { encode, decode } from "proto"
```

See [`test/cases/proto.ato`](../test/cases/proto.ato) for a runnable round-trip.
Note: under ATOMIS the code runs as wasm in Node.
