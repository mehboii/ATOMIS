# ghostvault

A sealed-secret vault for ATOMIS. Unlock a vault with a passphrase, seal a
secret into a self-describing blob, open it back. Builds for **native Rust** and
**wasm32** from one source; blobs are portable between the two.

> Status: **library crate, standalone.** The `.ato` import wiring is deliberately
> deferred ("build crate first, wire later"). See *ATOMIS integration* below for
> why that step is non-trivial in this repo.

## Public surface (intentionally narrow)

Native ([`Vault`]):

```rust
let v = Vault::unlock(b"correct horse battery staple")?; // open/unlock
let blob = v.seal(b"attack at dawn")?;                    // -> portable sealed blob
let plain = v.open_sealed(&blob)?;                        // -> Zeroizing<Vec<u8>>
v.lock();                                                 // lock/free (zeroizes)
```

WASM (`wasmapi`, opaque integer handles — secrets never cross out):

```text
vault_unlock(passphrase) -> handle
vault_seal(handle, plaintext) -> sealed blob
vault_open_sealed(handle, blob) -> plaintext
vault_free(handle)            // zeroizes; handle becomes stale
```

## Sealed-blob format (self-describing, target-independent)

```
[ magic("GVLT",4) | version(1) | kdf_id(1) | mem_cost(4 BE) | iterations(4 BE)
  | salt(16) | nonce(12) | ciphertext(..)   // ciphertext includes the 16-byte GCM tag ]
```

The full 42-byte header is authenticated as AEAD associated data. Every blob
carries its own KDF parameters, so a blob sealed by the native (high-mem) build
opens on the wasm (low-mem) build and vice-versa — provided the opening host has
enough memory for the recorded `mem_cost`.

## Crypto

- **AEAD:** AES-256-GCM (`aes-gcm`) — matches the existing ghostnet stack's cipher.
- **KDF:** Argon2id (`argon2`), parallelism fixed at 1.
- Provided by vetted RustCrypto crates behind the private `CryptoProvider` trait.
  A future Rust `ghostnet-crypto` can be dropped in by implementing that trait
  with **no call-site changes**. (The current `ghostnet-crypto` is TypeScript,
  built on `@noble/*`; it is not a Rust crate and cannot be a Rust dependency,
  so it could not be used directly here.)

### KDF profiles & memory floor

| Feature | Default seal params | Use |
|---|---|---|
| `kdf-strong` (default) | m = 64 MiB, t = 3 | native |
| `kdf-portable` | m = 12 MiB, t = 3 (OWASP m=12288,t=3) | wasm |

**Documented memory floor: 8 MiB.** Opening rejects any blob whose recorded
`mem_cost` is below 8 MiB (anti-downgrade) or above 1 GiB (DoS/OOM guard).
The feature only chooses *sealing* defaults; opening always honours the header.

## Security properties

- **Self-describing header** so native- and wasm-sealed blobs interoperate.
- **Nonces & salts are generated internally only** — there is no API that accepts
  a nonce from the caller.
- **`ZeroizeOnDrop`** on every secret type (passphrase, derived key); opened
  plaintext is returned in a `Zeroizing` buffer (native).
- **Single generic error.** Bad MAC, bad KDF params, and corrupt/forged headers
  all surface as the same `ghostvault: operation failed` — no padding/oracle
  distinction, and no secret ever appears in a message.
- **Validate-before-crypto.** Lengths, magic, version, kdf id, param bounds, and
  size caps are all checked and *rejected* (never truncated) before any KDF or
  AEAD work runs. Plaintext is capped at 64 MiB; passphrase at 1 KiB.
- **Entropy self-test** runs at startup (native: first vault use; wasm: module
  `start`) and **fails loudly** (panic → abort) if the CSPRNG is unavailable or
  returns degenerate output.
- **`panic = "abort"`** in release: no unwinding through secret state.
- **WASM opaque-handle model:** callers hold integer handles only; the handle
  table uses a **generation counter** so a freed/reused handle fails; `vault_free`
  zeroizes the vault.
- `getrandom` is built with the `js` feature on wasm for a real browser/Node
  entropy source.

## ⚠️ WASM / browser honesty — not as hardened as native

**On wasm, zeroization cannot be guaranteed.** WebAssembly linear memory is an
ordinary `ArrayBuffer` that the host JS (and anything with a debugger or memory
snapshot) can read. `ZeroizeOnDrop` still runs and overwrites the bytes *inside*
linear memory, but:

- The JS engine / GC may have **copied** values (e.g. the `Uint8Array` you passed
  in, or the plaintext returned out) into memory ghostvault does not control and
  cannot wipe.
- There is no `mlock`/guard-page/secure-allocator equivalent; secrets are not
  protected from same-process inspection.
- Recovered plaintext is **copied out** to the caller across the wasm boundary;
  that copy is the caller's responsibility.

**Callers must zero their own input and output buffers.** Treat the wasm build as
convenience-grade confidentiality, **not** the hardened guarantees of the native
build. Do not imply otherwise to end users.

## Build & test

```sh
# native
cargo build --release
cargo test                       # 9 tests: round-trip, cross-profile, tamper, caps, downgrade

# wasm
wasm-pack build  --target web --release      -- --no-default-features --features kdf-portable
wasm-pack test   --node                       --no-default-features --features kdf-portable
```

The wasm test suite includes `opens_native_sealed_blob`, which opens a blob
sealed by the native build (`tests/vectors/native.blob`, produced by
`examples/gen_vector.rs`) — the cross-target round-trip.

## ATOMIS integration (deferred, by decision)

ATOMIS is a **transpiler**: `atomis run foo.ato` compiles `.ato` → TypeScript and
shells out to `ts-node`/Node (proof: `cmdRun` in `src/cli.ts`). It has no
binary-embedded runtime or builtin table, and `@import { x } from "vault"` is
emitted verbatim as a Node `import` resolved at runtime. So "shipped inside the
atomis binary" is not achievable under the current architecture without changing
the execution model. This crate is therefore delivered standalone; the chosen
wiring path (e.g. vendoring the wasm `pkg` as a Node-resolvable module the
generated TS imports) is a separate, follow-up step.
