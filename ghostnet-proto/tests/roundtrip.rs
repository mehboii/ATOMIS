//! Worked examples / tutorial for ghostnet-proto.
//!
//! Every test follows the same three steps you'll use in real code:
//!   1. build a message (an `Envelope` wrapping a `Message`),
//!   2. `encode` it to bytes (we print the hex so you can see the wire form),
//!   3. `decode` the bytes back and assert you got the same thing.
//!
//! Run `cargo test -- --nocapture` to see the hex dumps.

use proto::*;

/// Tiny hex printer so the worked examples show the actual wire bytes.
fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

#[test]
fn hello_roundtrip() {
    // 1. Build: a node introduces itself.
    let msg = Envelope::new(
        1,
        Message::Hello(Hello {
            node_id: "node-A".to_string(),
            proto_version: PROTO_VERSION,
            capabilities: vec!["relay".to_string(), "store".to_string()],
            sent_at: 1_718_000_000_000,
        }),
    );

    // 2. Encode to bytes.
    let bytes = encode(&msg);
    println!("Hello  -> {} bytes: {}", bytes.len(), hex(&bytes));

    // 3. Decode and confirm it's identical.
    let back = decode(&bytes).expect("Hello should decode");
    assert_eq!(msg, back);
}

#[test]
fn peer_announce_roundtrip() {
    let msg = Envelope::new(
        2,
        Message::PeerAnnounce(PeerAnnounce {
            node_id: "node-B".to_string(),
            addresses: vec![
                "tcp://10.0.0.5:9000".to_string(),
                "ble://AA:BB:CC:DD".to_string(),
            ],
            sent_at: 1_718_000_000_001,
        }),
    );

    let bytes = encode(&msg);
    println!("PeerAnnounce -> {} bytes: {}", bytes.len(), hex(&bytes));

    let back = decode(&bytes).expect("PeerAnnounce should decode");
    assert_eq!(msg, back);
}

#[test]
fn secure_roundtrip() {
    // The ciphertext is just opaque bytes some crypto crate handed us.
    // proto neither produced nor understands them — it only carries them.
    let msg = Envelope::new(
        3,
        Message::Secure(Secure {
            to: "node-B".to_string(),
            from: "node-A".to_string(),
            scheme: SCHEME_X25519_AES256GCM,
            ciphertext: vec![0xDE, 0xAD, 0xBE, 0xEF],
            sent_at: 1_718_000_000_002,
        }),
    );

    let bytes = encode(&msg);
    println!("Secure -> {} bytes: {}", bytes.len(), hex(&bytes));

    let back = decode(&bytes).expect("Secure should decode");
    assert_eq!(msg, back);
}

#[test]
fn ack_roundtrip() {
    let msg = Envelope::new(
        4,
        Message::Ack(Ack {
            ack_of: 1, // acknowledging the Hello above (id = 1)
            status: AckStatus::Received,
            sent_at: 1_718_000_000_003,
        }),
    );

    let bytes = encode(&msg);
    println!("Ack    -> {} bytes: {}", bytes.len(), hex(&bytes));

    let back = decode(&bytes).expect("Ack should decode");
    assert_eq!(msg, back);
}

#[test]
fn encodes_deterministically() {
    // The core guarantee: the same message always produces the same bytes.
    let msg = Envelope::new(
        7,
        Message::Ack(Ack {
            ack_of: 7,
            status: AckStatus::Rejected,
            sent_at: 42,
        }),
    );
    assert_eq!(encode(&msg), encode(&msg));
    println!("golden Ack(id=7,Rejected,sent_at=42) -> {}", hex(&encode(&msg)));

    // Regression guard against an accidental field reorder: these exact bytes
    // are documented as a worked example in SCHEMA.md.
    assert_eq!(hex(&encode(&msg)), GOLDEN_ACK);
}

/// Golden wire bytes for `Envelope{version:1,id:7,body:Ack{ack_of:7,
/// status:Rejected,sent_at:42}}`. Also shown in SCHEMA.md.
const GOLDEN_ACK: &str =
    "a36776657273696f6e016269640764626f6479a16341636ba36661636b5f6f6607667374617475736852656a65637465646773656e745f6174182a";

#[test]
fn unknown_scheme_still_decodes() {
    // You are never locked out by a scheme you don't recognise: it's just a
    // number, so it round-trips fine and the receiver decides what to do.
    let msg = Envelope::new(
        9,
        Message::Secure(Secure {
            to: "x".to_string(),
            from: "y".to_string(),
            scheme: 999, // not in the registry yet
            ciphertext: vec![1, 2, 3],
            sent_at: 0,
        }),
    );
    let back = decode(&encode(&msg)).expect("unknown scheme must still decode");
    assert_eq!(msg, back);
}

#[test]
fn garbage_is_rejected() {
    // Not valid CBOR for an Envelope -> a clear error, not a panic.
    assert!(decode(&[0xff, 0x00, 0x13, 0x37]).is_err());
    assert!(decode(&[]).is_err());
}
