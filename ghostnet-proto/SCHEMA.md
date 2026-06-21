# ghostnet-proto — wire format SCHEMA

This is the one document you read to learn the entire GhostNet wire format.
The authoritative spec is the Rust types in [`src/lib.rs`](src/lib.rs); this file
explains them in prose with worked byte-level examples.

## TL;DR
- Every message is an **`Envelope`** = `{ version, id, body }`.
- `body` is one of four messages: **Hello**, **PeerAnnounce**, **Secure**, **Ack**.
- Bytes are **CBOR** (RFC 8949), produced with `ciborium`.
- Encoding is **deterministic**: the same message always yields the same bytes.
- **No crypto here.** Encrypted data travels as opaque bytes in `Secure.ciphertext`.

## Encoding rules (how the bytes are made)
- **Codec:** CBOR via the `ciborium` crate (never hand-rolled).
- **Structs** encode as a CBOR map whose keys are the field names (as text
  strings), in **declaration order**.
- **Enums** (`Message`, `AckStatus`) encode "externally tagged": a non-unit
  variant like `Hello` becomes a single-key map `{"Hello": {...}}`; a unit
  variant like `Received` becomes the text string `"Received"`.
- **`Vec<String>`** → CBOR array of text strings. **`Vec<u8>` byte fields**
  (`ciphertext`) → a CBOR **byte string** (via `serde_bytes`), not an array.
- **Integers** use CBOR shortest-form; lengths are definite.
- **Determinism:** because every type is a struct/enum/Vec (no `HashMap`), serde
  always visits fields in the same order, so `encode(x)` is byte-stable. Verified
  by the `encodes_deterministically` test.

## Versioning
`Envelope.version` is the first thing to check when decoding. It is currently
`1` (`PROTO_VERSION`). Add fields/messages in a backward-compatible way where
possible; bump `version` for incompatible changes so old decoders can refuse
cleanly.

---

## Envelope
The wrapper around every message.

| Field | Type | Purpose |
|-------|------|---------|
| `version` | `u16` | Wire-format version. Check this first. Currently `1`. |
| `id` | `u64` | Sender-assigned unique id for this message; referenced by `Ack.ack_of`. |
| `body` | `Message` | The message itself (one of the four below). |

## Message: `Hello`
First thing a node sends — who it is and what it can do.

| Field | Type | Purpose |
|-------|------|---------|
| `node_id` | `String` | Who I am. Opaque id; proto does not interpret it. |
| `proto_version` | `u16` | Highest proto version I speak (negotiation). |
| `capabilities` | `[String]` | Feature flags, e.g. `["relay","store"]`. |
| `sent_at` | `u64` | Unix time in milliseconds. |

## Message: `PeerAnnounce`
Discovery/gossip — advertises that a peer is reachable.

| Field | Type | Purpose |
|-------|------|---------|
| `node_id` | `String` | The peer being announced. |
| `addresses` | `[String]` | Transport addresses, e.g. `["tcp://1.2.3.4:9000","ble://AA:BB"]`. |
| `sent_at` | `u64` | Unix time in milliseconds. |

## Message: `Secure`
Carries an opaque encrypted payload produced by **another** crate. proto routes
the bytes; it never inspects, encrypts, or decrypts them.

| Field | Type | Purpose |
|-------|------|---------|
| `to` | `String` | Recipient node id. |
| `from` | `String` | Sender node id. |
| `scheme` | `u16` | Which crypto scheme produced `ciphertext` (self-describing; see registry). Unknown values still decode. |
| `ciphertext` | `bytes` | Opaque encrypted bytes. CBOR byte string. |
| `sent_at` | `u64` | Unix time in milliseconds. |

### Crypto-scheme registry (`scheme`)
A numeric tag (like the vault header's `kdf_id`) so a payload always says which
scheme made it, and you are never locked out by an unknown one.

| Value | Constant | Meaning |
|------:|----------|---------|
| `0` | `SCHEME_UNSPECIFIED` | Unspecified / reserved. |
| `1` | `SCHEME_X25519_AES256GCM` | X25519 key agreement + AES-256-GCM (current GhostNet stack). |

## Message: `Ack`
Acknowledges a previously received message.

| Field | Type | Purpose |
|-------|------|---------|
| `ack_of` | `u64` | The `Envelope.id` this acknowledges. |
| `status` | `AckStatus` | `Received` or `Rejected`. |
| `sent_at` | `u64` | Unix time in milliseconds. |

`AckStatus` is `Received` | `Rejected` (encoded as the text string `"Received"`
or `"Rejected"`).

---

## Worked examples (real bytes from the test suite)
Hex below is the exact output of `encode(...)`. Reproduce with
`cargo test -- --nocapture`. Notice the CBOR map keys are literally the field
names — the format is self-describing on the wire.

```
Hello         id=1  -> 100 bytes
  a36776657273696f6e016269640164626f6479a16548656c6c6fa4676e6f64655f6964
  666e6f64652d416d70726f746f5f76657273696f6e016c6361706162696c6974696573
  826572656c61796573746f72656773656e745f61741b0000019000c79c00

PeerAnnounce  id=2  -> 115 bytes
  a36776657273696f6e016269640264626f6479a16c50656572416e6e6f756e6365a367
  6e6f64655f6964666e6f64652d426961646472657373657382737463703a2f2f31302e
  302e302e353a3930303071626c653a2f2f41413a42423a43433a44446773656e745f61
  741b0000019000c79c01

Secure        id=3  -> 91 bytes   (ciphertext 0xDEADBEEF as CBOR byte string 44deadbeef)
  a36776657273696f6e016269640364626f6479a166536563757265a562746f666e6f64
  652d426466726f6d666e6f64652d4166736368656d65016a6369706865727465787444
  deadbeef6773656e745f61741b0000019000c79c02

Ack           id=4  -> 66 bytes
  a36776657273696f6e016269640464626f6479a16341636ba36661636b5f6f6601667374
  617475736852656365697665646773656e745f61741b0000019000c79c03
```

**Golden regression vector** — `Envelope{version:1, id:7, body:Ack{ack_of:7,
status:Rejected, sent_at:42}}`:
```
a36776657273696f6e016269640764626f6479a16341636ba36661636b5f6f6607
667374617475736852656a65637465646773656e745f6174182a
```
The `garbage_is_rejected` and `unknown_scheme_still_decodes` tests show the
decode behaviour for bad input and forward-compatible schemes.

## Using it from `.ato` (via the vendored `proto` package)
```
@import { encode, decode } from "proto"
const bytes = encode({ version: 1, id: 1,
  body: { Hello: { node_id: "me", proto_version: 1, capabilities: [], sent_at: 0 } } })
const msg = decode(bytes)   // -> { version, id, body: { Hello: {...} } }
```
The JS/`.ato` object shape mirrors the types above one-to-one.
