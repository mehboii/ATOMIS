//! ghostvault — sealed-secret vault for ATOMIS.
//!
//! Public surface is deliberately narrow:
//!   * [`Vault::unlock`]      — open/unlock a vault with a passphrase
//!   * [`Vault::seal`]        — seal plaintext into a portable sealed blob
//!   * [`Vault::open_sealed`] — open a sealed blob back to plaintext
//!   * [`Vault::lock`]        — lock/free the vault (zeroizes its secret)
//!
//! On wasm the same surface is exposed through an opaque integer-handle table
//! (see the `wasmapi` module): callers hold handles only, vault key material
//! never crosses the wasm boundary.
//!
//! Crypto is supplied by vetted RustCrypto crates (AES-256-GCM via `aes-gcm`,
//! Argon2id via `argon2`) behind the private [`CryptoProvider`] trait, so a
//! future Rust `ghostnet-crypto` can be substituted without touching call sites.
//!
//! ## Sealed-blob format (self-describing, target-independent)
//! ```text
//! [ magic(4) | version(1) | kdf_id(1) | mem_cost(4 BE) | iterations(4 BE)
//!   | salt(16) | nonce(12) | ciphertext(..)  // ciphertext includes 16-byte GCM tag ]
//! ```
//! The whole 42-byte header is authenticated as AEAD associated data, so any
//! tampering with version/params/salt/nonce fails to open. Because every blob
//! carries its own KDF parameters, a blob sealed by the native (high-mem) build
//! opens on the wasm (low-mem) build and vice-versa — subject to the opening
//! host actually having enough memory for the recorded `mem_cost`.

#![forbid(unsafe_code)]

use aes_gcm::aead::{Aead, Payload};
use aes_gcm::{Aes256Gcm, KeyInit, Nonce};
use argon2::{Algorithm, Argon2, Params, Version};
use std::sync::Once;
use zeroize::{Zeroizing, ZeroizeOnDrop};

/* ── format constants ────────────────────────────────────────────────────── */

const MAGIC: [u8; 4] = *b"GVLT";
const VERSION: u8 = 1;
const KDF_ARGON2ID: u8 = 1;

const SALT_LEN: usize = 16;
const NONCE_LEN: usize = 12;
const TAG_LEN: usize = 16;
const KEY_LEN: usize = 32;
const HEADER_LEN: usize = 4 + 1 + 1 + 4 + 4 + SALT_LEN + NONCE_LEN; // = 42

/* ── policy limits (validate-before-crypto; reject, never truncate) ───────── */

/// Documented Argon2id memory floor. Opening a blob whose recorded `mem_cost`
/// is below this is rejected (anti-downgrade). 8 MiB; the `kdf-portable` profile
/// sits safely above it at 12 MiB (an OWASP m=12288,t=3 profile).
const MEM_FLOOR_KIB: u32 = 8 * 1024;
/// Upper bound on accepted `mem_cost` (DoS / accidental-OOM guard).
const MEM_CAP_KIB: u32 = 1024 * 1024; // 1 GiB
const ITERS_MIN: u32 = 1;
const ITERS_MAX: u32 = 16;
/// Argon2 parallelism is fixed (not negotiable per-blob) for cross-target
/// determinism and wasm safety.
const PARALLELISM: u32 = 1;

const MAX_PASSPHRASE: usize = 1024;
const MAX_PLAINTEXT: usize = 64 * 1024 * 1024; // 64 MiB
const MAX_BLOB: usize = HEADER_LEN + MAX_PLAINTEXT + TAG_LEN;

/// Default sealing parameters, chosen by the enabled KDF feature. Opening is
/// unaffected — it always uses the parameters from the blob header.
#[cfg(feature = "kdf-strong")]
const DEFAULT_MEM_KIB: u32 = 64 * 1024; // 64 MiB
#[cfg(feature = "kdf-strong")]
const DEFAULT_ITERS: u32 = 3;

#[cfg(all(feature = "kdf-portable", not(feature = "kdf-strong")))]
const DEFAULT_MEM_KIB: u32 = 12 * 1024; // 12 MiB (OWASP m=12288,t=3)
#[cfg(all(feature = "kdf-portable", not(feature = "kdf-strong")))]
const DEFAULT_ITERS: u32 = 3;

#[cfg(not(any(feature = "kdf-strong", feature = "kdf-portable")))]
compile_error!("ghostvault: enable exactly one of `kdf-strong` or `kdf-portable`");

/* ── single generic error (no oracle: bad-MAC == bad-KDF == bad-header) ──── */

/// The one and only error surfaced by ghostvault. It carries no detail on
/// purpose — callers cannot distinguish a bad MAC from a bad KDF from a corrupt
/// header, and no secret material ever appears in its message.
#[derive(Debug)]
pub struct VaultError;

impl VaultError {
    #[inline]
    fn e() -> VaultError {
        VaultError
    }
}

impl core::fmt::Display for VaultError {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        f.write_str("ghostvault: operation failed")
    }
}

impl std::error::Error for VaultError {}

type VResult<T> = Result<T, VaultError>;

/* ── secret types (all ZeroizeOnDrop) ────────────────────────────────────── */

/// The vault's passphrase, held only as long as the vault is unlocked.
#[derive(ZeroizeOnDrop)]
struct Secret(Vec<u8>);

/// A derived AEAD key. Ephemeral: derived per operation, zeroized on drop.
#[derive(ZeroizeOnDrop)]
struct DerivedKey([u8; KEY_LEN]);

/* ── entropy: startup self-test that fails loudly ─────────────────────────── */

fn ensure_entropy() {
    static ONCE: Once = Once::new();
    ONCE.call_once(|| {
        let mut a = [0u8; 32];
        let mut b = [0u8; 32];
        if getrandom::getrandom(&mut a).is_err() || getrandom::getrandom(&mut b).is_err() {
            // panic = "abort" turns this into an immediate, loud failure.
            panic!("ghostvault: entropy source unavailable");
        }
        if a == [0u8; 32] || a == b {
            panic!("ghostvault: entropy self-test failed");
        }
    });
}

/// Fill a buffer with fresh CSPRNG bytes. The only randomness path; nonces and
/// salts are produced here and never accepted from a caller.
fn fill_random(buf: &mut [u8]) -> VResult<()> {
    getrandom::getrandom(buf).map_err(|_| VaultError::e())
}

/* ── crypto provider boundary (swap point for a future Rust ghostnet-crypto)  */

trait CryptoProvider {
    fn kdf_derive(&self, passphrase: &[u8], salt: &[u8], mem_kib: u32, iters: u32)
        -> VResult<DerivedKey>;
    fn aead_seal(&self, key: &[u8; KEY_LEN], nonce: &[u8; NONCE_LEN], pt: &[u8], aad: &[u8])
        -> VResult<Vec<u8>>;
    fn aead_open(&self, key: &[u8; KEY_LEN], nonce: &[u8; NONCE_LEN], ct: &[u8], aad: &[u8])
        -> VResult<Vec<u8>>;
}

/// Default provider: Argon2id (RustCrypto `argon2`) + AES-256-GCM (`aes-gcm`).
struct RustCryptoProvider;

impl CryptoProvider for RustCryptoProvider {
    fn kdf_derive(
        &self,
        passphrase: &[u8],
        salt: &[u8],
        mem_kib: u32,
        iters: u32,
    ) -> VResult<DerivedKey> {
        let params =
            Params::new(mem_kib, iters, PARALLELISM, Some(KEY_LEN)).map_err(|_| VaultError::e())?;
        let argon = Argon2::new(Algorithm::Argon2id, Version::V0x13, params);
        let mut key = [0u8; KEY_LEN];
        argon
            .hash_password_into(passphrase, salt, &mut key)
            .map_err(|_| VaultError::e())?;
        Ok(DerivedKey(key))
    }

    fn aead_seal(
        &self,
        key: &[u8; KEY_LEN],
        nonce: &[u8; NONCE_LEN],
        pt: &[u8],
        aad: &[u8],
    ) -> VResult<Vec<u8>> {
        let cipher = Aes256Gcm::new_from_slice(key).map_err(|_| VaultError::e())?;
        cipher
            .encrypt(Nonce::from_slice(nonce), Payload { msg: pt, aad })
            .map_err(|_| VaultError::e())
    }

    fn aead_open(
        &self,
        key: &[u8; KEY_LEN],
        nonce: &[u8; NONCE_LEN],
        ct: &[u8],
        aad: &[u8],
    ) -> VResult<Vec<u8>> {
        let cipher = Aes256Gcm::new_from_slice(key).map_err(|_| VaultError::e())?;
        cipher
            .decrypt(Nonce::from_slice(nonce), Payload { msg: ct, aad })
            .map_err(|_| VaultError::e())
    }
}

const PROVIDER: RustCryptoProvider = RustCryptoProvider;

/* ── header build / parse ─────────────────────────────────────────────────── */

struct Header {
    mem_kib: u32,
    iters: u32,
    salt: [u8; SALT_LEN],
    nonce: [u8; NONCE_LEN],
}

fn build_header(mem_kib: u32, iters: u32, salt: &[u8; SALT_LEN], nonce: &[u8; NONCE_LEN]) -> Vec<u8> {
    let mut h = Vec::with_capacity(HEADER_LEN);
    h.extend_from_slice(&MAGIC);
    h.push(VERSION);
    h.push(KDF_ARGON2ID);
    h.extend_from_slice(&mem_kib.to_be_bytes());
    h.extend_from_slice(&iters.to_be_bytes());
    h.extend_from_slice(salt);
    h.extend_from_slice(nonce);
    debug_assert_eq!(h.len(), HEADER_LEN);
    h
}

/// Validate every field (lengths, magic, version, kdf id, param bounds, size
/// caps) BEFORE any crypto runs. Any failure → the single generic error.
fn parse_header(blob: &[u8]) -> VResult<Header> {
    // Size caps first: reject, never truncate.
    if blob.len() < HEADER_LEN + TAG_LEN || blob.len() > MAX_BLOB {
        return Err(VaultError::e());
    }
    if blob[0..4] != MAGIC {
        return Err(VaultError::e());
    }
    if blob[4] != VERSION {
        return Err(VaultError::e());
    }
    if blob[5] != KDF_ARGON2ID {
        return Err(VaultError::e());
    }
    let mem_kib = u32::from_be_bytes([blob[6], blob[7], blob[8], blob[9]]);
    let iters = u32::from_be_bytes([blob[10], blob[11], blob[12], blob[13]]);
    if !(MEM_FLOOR_KIB..=MEM_CAP_KIB).contains(&mem_kib) {
        return Err(VaultError::e());
    }
    if !(ITERS_MIN..=ITERS_MAX).contains(&iters) {
        return Err(VaultError::e());
    }
    let mut salt = [0u8; SALT_LEN];
    salt.copy_from_slice(&blob[14..14 + SALT_LEN]);
    let mut nonce = [0u8; NONCE_LEN];
    nonce.copy_from_slice(&blob[14 + SALT_LEN..14 + SALT_LEN + NONCE_LEN]);
    Ok(Header {
        mem_kib,
        iters,
        salt,
        nonce,
    })
}

/* ── Vault (native API) ───────────────────────────────────────────────────── */

/// An unlocked vault. Holds the passphrase as a zeroize-on-drop secret and
/// derives a fresh key per seal/open from the salt recorded in each blob.
pub struct Vault {
    secret: Secret,
}

impl Vault {
    /// Open/unlock a vault with a passphrase. Runs the entropy self-test on
    /// first use. Rejects an empty or oversized passphrase.
    pub fn unlock(passphrase: &[u8]) -> VResult<Vault> {
        ensure_entropy();
        if passphrase.is_empty() || passphrase.len() > MAX_PASSPHRASE {
            return Err(VaultError::e());
        }
        Ok(Vault {
            secret: Secret(passphrase.to_vec()),
        })
    }

    /// Seal plaintext into a portable sealed blob using the build's default KDF
    /// parameters. The nonce and salt are generated internally.
    pub fn seal(&self, plaintext: &[u8]) -> VResult<Vec<u8>> {
        self.seal_with_params(plaintext, DEFAULT_MEM_KIB, DEFAULT_ITERS)
    }

    /// Open a sealed blob, returning the plaintext in a zeroize-on-drop buffer.
    pub fn open_sealed(&self, blob: &[u8]) -> VResult<Zeroizing<Vec<u8>>> {
        let header = parse_header(blob)?;
        let key = PROVIDER.kdf_derive(&self.secret.0, &header.salt, header.mem_kib, header.iters)?;
        let aad = &blob[..HEADER_LEN];
        let ct = &blob[HEADER_LEN..];
        let pt = PROVIDER.aead_open(&key.0, &header.nonce, ct, aad)?;
        Ok(Zeroizing::new(pt))
    }

    /// Lock/free the vault. Consumes it; the passphrase is zeroized on drop.
    pub fn lock(self) {
        // drop(self) → Secret::drop zeroizes.
    }

    /// Seal with explicit Argon2id parameters. Internal: used by `seal` and by
    /// the cross-profile parity tests. `mem_kib`/`iters` must satisfy the same
    /// policy bounds enforced on open.
    fn seal_with_params(&self, plaintext: &[u8], mem_kib: u32, iters: u32) -> VResult<Vec<u8>> {
        if plaintext.len() > MAX_PLAINTEXT {
            return Err(VaultError::e());
        }
        if !(MEM_FLOOR_KIB..=MEM_CAP_KIB).contains(&mem_kib)
            || !(ITERS_MIN..=ITERS_MAX).contains(&iters)
        {
            return Err(VaultError::e());
        }
        let mut salt = [0u8; SALT_LEN];
        fill_random(&mut salt)?;
        let mut nonce = [0u8; NONCE_LEN];
        fill_random(&mut nonce)?;

        let header = build_header(mem_kib, iters, &salt, &nonce);
        let key = PROVIDER.kdf_derive(&self.secret.0, &salt, mem_kib, iters)?;
        let ct = PROVIDER.aead_seal(&key.0, &nonce, plaintext, &header)?;

        let mut out = header;
        out.extend_from_slice(&ct);
        Ok(out)
    }
}

/* ── wasm opaque-handle API ───────────────────────────────────────────────── */

/// On wasm, `.ato`/JS holds only integer handles into a generation-tagged
/// table; vault secrets never cross out. Stale handles (after `vault_free`)
/// fail with the generic error.
#[cfg(target_arch = "wasm32")]
pub mod wasmapi {
    use super::*;
    use std::cell::RefCell;
    use wasm_bindgen::prelude::*;

    const MAX_SLOTS: usize = 0x1_0000; // index is 16 bits

    struct Slot {
        generation: u16,
        vault: Option<Vault>,
    }

    thread_local! {
        static TABLE: RefCell<Vec<Slot>> = const { RefCell::new(Vec::new()) };
    }

    /// Module start hook: run the entropy self-test loudly at load time.
    #[wasm_bindgen(start)]
    pub fn _start() {
        ensure_entropy();
    }

    #[inline]
    fn err() -> JsValue {
        JsValue::from_str("ghostvault: operation failed")
    }

    fn pack(index: usize, generation: u16) -> u32 {
        ((generation as u32) << 16) | (index as u32)
    }
    fn unpack(handle: u32) -> (usize, u16) {
        ((handle & 0xFFFF) as usize, ((handle >> 16) & 0xFFFF) as u16)
    }

    /// Unlock a vault; returns an opaque handle.
    #[wasm_bindgen]
    pub fn vault_unlock(passphrase: &[u8]) -> Result<u32, JsValue> {
        let v = Vault::unlock(passphrase).map_err(|_| err())?;
        TABLE.with(|t| {
            let mut t = t.borrow_mut();
            let idx = (0..t.len()).find(|&i| t[i].vault.is_none());
            let i = match idx {
                Some(i) => i,
                None => {
                    if t.len() >= MAX_SLOTS {
                        return Err(err());
                    }
                    t.push(Slot {
                        generation: 0,
                        vault: None,
                    });
                    t.len() - 1
                }
            };
            t[i].vault = Some(v);
            Ok(pack(i, t[i].generation))
        })
    }

    /// Seal plaintext under the vault referenced by `handle`. Returns the sealed
    /// blob (non-secret ciphertext) — the only bytes that cross out.
    #[wasm_bindgen]
    pub fn vault_seal(handle: u32, plaintext: &[u8]) -> Result<Vec<u8>, JsValue> {
        with_vault(handle, |v| v.seal(plaintext))
    }

    /// Open a sealed blob under the vault referenced by `handle`. Returns the
    /// caller's recovered plaintext (a copy; the internal buffer is zeroized).
    #[wasm_bindgen]
    pub fn vault_open_sealed(handle: u32, blob: &[u8]) -> Result<Vec<u8>, JsValue> {
        with_vault(handle, |v| v.open_sealed(blob).map(|z| z.to_vec()))
    }

    /// Free/zeroize the vault and invalidate its handle (generation bump).
    #[wasm_bindgen]
    pub fn vault_free(handle: u32) {
        let (idx, generation) = unpack(handle);
        TABLE.with(|t| {
            let mut t = t.borrow_mut();
            if let Some(slot) = t.get_mut(idx) {
                if slot.generation == generation && slot.vault.is_some() {
                    slot.vault = None; // Vault drop → Secret zeroized
                    slot.generation = slot.generation.wrapping_add(1);
                }
            }
        });
    }

    fn with_vault<T>(handle: u32, f: impl FnOnce(&Vault) -> VResult<T>) -> Result<T, JsValue> {
        let (idx, generation) = unpack(handle);
        TABLE.with(|t| {
            let t = t.borrow();
            let slot = t.get(idx).ok_or_else(err)?;
            if slot.generation != generation {
                return Err(err());
            }
            match &slot.vault {
                Some(v) => f(v).map_err(|_| err()),
                None => Err(err()),
            }
        })
    }
}

/* ── tests ────────────────────────────────────────────────────────────────── */

#[cfg(all(test, not(target_arch = "wasm32")))]
mod tests {
    use super::*;

    #[test]
    fn roundtrip() {
        let v = Vault::unlock(b"correct horse battery staple").unwrap();
        let blob = v.seal(b"attack at dawn").unwrap();
        let pt = v.open_sealed(&blob).unwrap();
        assert_eq!(&pt[..], b"attack at dawn");
    }

    #[test]
    fn header_layout_is_stable() {
        let v = Vault::unlock(b"pw").unwrap();
        let blob = v.seal(b"x").unwrap();
        assert_eq!(&blob[0..4], b"GVLT");
        assert_eq!(blob[4], VERSION);
        assert_eq!(blob[5], KDF_ARGON2ID);
        assert!(blob.len() >= HEADER_LEN + TAG_LEN);
    }

    #[test]
    fn wrong_passphrase_fails_generically() {
        let a = Vault::unlock(b"pw-a").unwrap();
        let b = Vault::unlock(b"pw-b").unwrap();
        let blob = a.seal(b"secret").unwrap();
        assert!(b.open_sealed(&blob).is_err());
    }

    #[test]
    fn cross_profile_blobs_open_either_way() {
        // A blob sealed with portable (low-mem) params and one sealed with
        // strong (high-mem) params must BOTH open on the same build, because
        // open is driven entirely by the header — this is the cross-target
        // guarantee exercised without needing two separate builds.
        let v = Vault::unlock(b"shared-pass").unwrap();
        let portable = v.seal_with_params(b"hello", 12 * 1024, 3).unwrap();
        let strong = v.seal_with_params(b"hello", 64 * 1024, 3).unwrap();
        assert_eq!(&v.open_sealed(&portable).unwrap()[..], b"hello");
        assert_eq!(&v.open_sealed(&strong).unwrap()[..], b"hello");
        // Headers really do record different mem_cost.
        assert_ne!(portable[6..10], strong[6..10]);
    }

    #[test]
    fn tamper_is_rejected() {
        let v = Vault::unlock(b"pw").unwrap();
        let good = v.seal(b"data").unwrap();

        // Flip a ciphertext byte → bad MAC.
        let mut ct_tamper = good.clone();
        let last = ct_tamper.len() - 1;
        ct_tamper[last] ^= 0x01;
        assert!(v.open_sealed(&ct_tamper).is_err());

        // Flip a header byte (mem_cost) → AAD mismatch / param change.
        let mut hdr_tamper = good.clone();
        hdr_tamper[6] ^= 0x01;
        assert!(v.open_sealed(&hdr_tamper).is_err());

        // Bad magic.
        let mut magic_tamper = good.clone();
        magic_tamper[0] = b'X';
        assert!(v.open_sealed(&magic_tamper).is_err());

        // Bad version.
        let mut ver_tamper = good.clone();
        ver_tamper[4] = 0xFF;
        assert!(v.open_sealed(&ver_tamper).is_err());
    }

    #[test]
    fn oversize_and_truncated_rejected() {
        let v = Vault::unlock(b"pw").unwrap();
        // Too short to even hold a header+tag.
        assert!(v.open_sealed(&[0u8; HEADER_LEN]).is_err());
        assert!(v.open_sealed(b"GVLT").is_err());
        assert!(v.open_sealed(&[]).is_err());
    }

    #[test]
    fn empty_plaintext_roundtrips() {
        let v = Vault::unlock(b"pw").unwrap();
        let blob = v.seal(b"").unwrap();
        assert_eq!(&v.open_sealed(&blob).unwrap()[..], b"");
    }

    #[test]
    fn empty_passphrase_rejected() {
        assert!(Vault::unlock(b"").is_err());
    }

    #[test]
    fn downgraded_mem_cost_rejected() {
        // Forge a header whose mem_cost is below the floor; must be rejected
        // before any KDF work.
        let v = Vault::unlock(b"pw").unwrap();
        let mut blob = v.seal(b"data").unwrap();
        let low = (MEM_FLOOR_KIB - 1).to_be_bytes();
        blob[6..10].copy_from_slice(&low);
        assert!(v.open_sealed(&blob).is_err());
    }
}
