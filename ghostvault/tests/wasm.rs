//! WASM tests (run with `wasm-pack test --node --no-default-features --features kdf-portable`).
//!
//! Proves, on the wasm32 target:
//!   * a full unlock → seal → open round-trip through the opaque-handle API,
//!   * stale handles fail after `vault_free` (generation counter),
//!   * a blob sealed by the NATIVE build (committed vector) opens here — the
//!     real cross-target guarantee.

#![cfg(target_arch = "wasm32")]

use ghostvault::wasmapi::*;
use wasm_bindgen_test::*;

/// A blob produced by the native build via `examples/gen_vector.rs`
/// (passphrase "cross-target-pass", plaintext "sealed-on-native-opened-on-wasm").
const NATIVE_BLOB: &[u8] = include_bytes!("vectors/native.blob");

#[wasm_bindgen_test]
fn wasm_roundtrip_and_stale_handle() {
    let h = vault_unlock(b"pw").expect("unlock");
    let blob = vault_seal(h, b"secret msg").expect("seal");
    let pt = vault_open_sealed(h, &blob).expect("open");
    assert_eq!(pt, b"secret msg");

    // Wrong passphrase → generic failure.
    let h2 = vault_unlock(b"other").expect("unlock2");
    assert!(vault_open_sealed(h2, &blob).is_err());

    // After free, the handle is stale and must fail.
    vault_free(h);
    assert!(vault_open_sealed(h, &blob).is_err());
}

#[wasm_bindgen_test]
fn opens_native_sealed_blob() {
    let h = vault_unlock(b"cross-target-pass").expect("unlock");
    let pt = vault_open_sealed(h, NATIVE_BLOB).expect("open native blob");
    assert_eq!(pt, b"sealed-on-native-opened-on-wasm");
    vault_free(h);
}
