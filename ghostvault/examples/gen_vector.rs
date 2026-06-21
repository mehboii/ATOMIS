//! Generate a cross-target test vector: a blob sealed by the NATIVE build,
//! later opened by the WASM build (see tests/wasm.rs).
//!
//! Run with the portable profile so the recorded mem_cost is wasm-friendly:
//!   cargo run --example gen_vector --no-default-features --features kdf-portable

use ghostvault::Vault;
use std::fs;

fn main() {
    let v = Vault::unlock(b"cross-target-pass").expect("unlock");
    let blob = v
        .seal(b"sealed-on-native-opened-on-wasm")
        .expect("seal");
    fs::create_dir_all("tests/vectors").expect("mkdir");
    fs::write("tests/vectors/native.blob", &blob).expect("write");
    eprintln!("wrote tests/vectors/native.blob ({} bytes)", blob.len());
}
