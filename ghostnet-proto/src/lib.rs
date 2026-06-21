//! # ghostnet-proto — the shared GhostNet wire format
//!
//! Everything in GhostNet speaks this format. The whole spec is **these Rust
//! types** plus [`SCHEMA.md`](../SCHEMA.md) — there is no separate schema
//! language and no codegen step. If you can read this file, you understand the
//! wire format.
//!
//! ## The model in one paragraph
//! Every message on the wire is an [`Envelope`]. The envelope has a `version`
//! (so the format can evolve), an `id` (so a message can be acknowledged), and a
//! `body` which is one of four [`Message`] variants: [`Hello`],
//! [`PeerAnnounce`], [`Secure`], [`Ack`]. You turn an envelope into bytes with
//! [`encode`] and bytes back into an envelope with [`decode`].
//!
//! ## Encoding: canonical / deterministic CBOR
//! We use **CBOR** (via the `ciborium` crate — we never hand-roll it). Encoding
//! is **deterministic**: the same message always produces the same bytes. That
//! holds because every type here is a `struct`/`enum`/`Vec` (no `HashMap`), so
//! serde always visits fields in declaration order, and ciborium emits
//! definite-length items with shortest-form integers. Determinism is verified by
//! a test (`encodes_deterministically`).
//!
//! ## No crypto lives here
//! This crate does pure encoding. Encrypted data rides as the opaque
//! [`Secure::ciphertext`] byte field that *some other crate* produced; proto
//! never inspects or decrypts it. [`Secure::scheme`] is a self-describing
//! numeric tag (like the vault header's `kdf_id`) so a payload always says which
//! crypto scheme made it — see the `SCHEME_*` constants.

#![forbid(unsafe_code)]

use serde::{Deserialize, Serialize};

/// Current wire-format version. Stamped into every [`Envelope`] by
/// [`Envelope::new`]. Bump this when the format changes incompatibly.
pub const PROTO_VERSION: u16 = 1;

/* ── crypto-scheme registry (numeric, self-describing) ────────────────────── */
//
// `Secure.scheme` is a u16 so unknown future schemes still DECODE (you are never
// locked out); the receiver decides whether it can handle the number. Add new
// schemes here as they are defined.

/// Scheme not specified / unknown. Reserved.
pub const SCHEME_UNSPECIFIED: u16 = 0;
/// X25519 key agreement + AES-256-GCM (the current GhostNet/ghostvault stack).
pub const SCHEME_X25519_AES256GCM: u16 = 1;

/* ── the envelope ─────────────────────────────────────────────────────────── */

/// The outer wrapper around every message sent on GhostNet.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Envelope {
    /// Wire-format version. A decoder checks this first; see [`PROTO_VERSION`].
    pub version: u16,
    /// Sender-assigned unique id for this message, referenced by [`Ack::ack_of`].
    pub id: u64,
    /// The actual message.
    pub body: Message,
}

impl Envelope {
    /// Wrap a message body with the current [`PROTO_VERSION`] and the given id.
    pub fn new(id: u64, body: Message) -> Self {
        Envelope {
            version: PROTO_VERSION,
            id,
            body,
        }
    }
}

/// The set of messages GhostNet understands. On the wire this is a single-key
/// CBOR map, e.g. `{"Hello": {...}}`, so the type is self-evident.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub enum Message {
    /// Handshake / identity announcement. See [`Hello`].
    Hello(Hello),
    /// "This peer is reachable here." See [`PeerAnnounce`].
    PeerAnnounce(PeerAnnounce),
    /// Carries an opaque encrypted payload. See [`Secure`].
    Secure(Secure),
    /// Acknowledges a previously received message. See [`Ack`].
    Ack(Ack),
}

/* ── 1. Hello ─────────────────────────────────────────────────────────────── */

/// First thing a node sends: who it is and what it can do.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Hello {
    /// Who I am. Opaque id string; proto does not interpret it.
    pub node_id: String,
    /// Highest proto version I speak (for negotiation).
    pub proto_version: u16,
    /// Feature flags I support, e.g. `["relay", "store"]`.
    pub capabilities: Vec<String>,
    /// When I sent this, Unix time in milliseconds.
    pub sent_at: u64,
}

/* ── 2. PeerAnnounce ──────────────────────────────────────────────────────── */

/// Gossip/discovery: advertises that a peer is reachable at some addresses.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PeerAnnounce {
    /// The peer being announced.
    pub node_id: String,
    /// Transport addresses, e.g. `["tcp://1.2.3.4:9000", "ble://AA:BB:.."]`.
    pub addresses: Vec<String>,
    /// When I sent this, Unix time in milliseconds.
    pub sent_at: u64,
}

/* ── 3. Secure ────────────────────────────────────────────────────────────── */

/// Carries an opaque encrypted payload produced by another crate. proto never
/// inspects, encrypts, or decrypts the bytes — it only routes them.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Secure {
    /// Recipient node id.
    pub to: String,
    /// Sender node id.
    pub from: String,
    /// Which crypto scheme produced `ciphertext`. Self-describing numeric tag;
    /// see the `SCHEME_*` constants. Unknown values still decode.
    pub scheme: u16,
    /// The opaque encrypted bytes. Encoded as a CBOR byte string.
    #[serde(with = "serde_bytes")]
    pub ciphertext: Vec<u8>,
    /// When I sent this, Unix time in milliseconds.
    pub sent_at: u64,
}

/* ── 4. Ack ───────────────────────────────────────────────────────────────── */

/// Outcome of receiving a message.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub enum AckStatus {
    /// The referenced message was received and accepted.
    Received,
    /// The referenced message was rejected.
    Rejected,
}

/// Acknowledges a previously received message by its envelope id.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Ack {
    /// The [`Envelope::id`] this acknowledges.
    pub ack_of: u64,
    /// Whether it was accepted or rejected.
    pub status: AckStatus,
    /// When I sent this, Unix time in milliseconds.
    pub sent_at: u64,
}

/* ── error ────────────────────────────────────────────────────────────────── */

/// Returned by [`decode`] when bytes are not a valid proto message. Carries a
/// human-readable reason (this crate handles no secrets, so detail is safe).
#[derive(Debug, Clone)]
pub struct ProtoError(pub String);

impl core::fmt::Display for ProtoError {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        write!(f, "proto: {}", self.0)
    }
}

impl std::error::Error for ProtoError {}

/* ── the only two functions you need ──────────────────────────────────────── */

/// Encode an envelope to canonical CBOR bytes. Infallible for these types
/// (writing to a `Vec` cannot fail and every field is CBOR-representable).
pub fn encode(envelope: &Envelope) -> Vec<u8> {
    let mut buf = Vec::new();
    ciborium::ser::into_writer(envelope, &mut buf)
        .expect("encoding ghostnet-proto types to a Vec is infallible");
    buf
}

/// Decode CBOR bytes back into an envelope, or report why they were invalid.
pub fn decode(bytes: &[u8]) -> Result<Envelope, ProtoError> {
    ciborium::de::from_reader(bytes).map_err(|e| ProtoError(e.to_string()))
}

/* ── wasm / JS boundary (mirrors the ghostvault wiring pattern) ───────────── */

/// On wasm, `.ato`/JS works with plain objects: `encode(obj) -> Uint8Array` and
/// `decode(Uint8Array) -> obj`. The object shape matches the types above, e.g.
/// `{ version: 1, id: 7, body: { Hello: { node_id, proto_version, capabilities,
/// sent_at } } }`.
#[cfg(target_arch = "wasm32")]
pub mod wasm_api {
    use super::*;
    use wasm_bindgen::prelude::*;

    fn js_err(e: impl core::fmt::Display) -> JsValue {
        JsValue::from_str(&format!("proto: {e}"))
    }

    /// Encode a message object to CBOR bytes.
    #[wasm_bindgen]
    pub fn encode(message: JsValue) -> Result<Vec<u8>, JsValue> {
        let env: Envelope = serde_wasm_bindgen::from_value(message).map_err(js_err)?;
        Ok(super::encode(&env))
    }

    /// Decode CBOR bytes back into a message object.
    #[wasm_bindgen]
    pub fn decode(bytes: &[u8]) -> Result<JsValue, JsValue> {
        let env = super::decode(bytes).map_err(js_err)?;
        // Default serializer: 64-bit ints become plain JS numbers, structs/enums
        // become plain objects — so `obj.body.Hello.node_id` just works.
        serde_wasm_bindgen::to_value(&env).map_err(js_err)
    }
}
