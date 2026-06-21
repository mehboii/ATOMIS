/* tslint:disable */
/* eslint-disable */

/**
 * Module start hook: run the entropy self-test loudly at load time.
 */
export function _start(): void;

/**
 * Free/zeroize the vault and invalidate its handle (generation bump).
 */
export function vault_free(handle: number): void;

/**
 * Open a sealed blob under the vault referenced by `handle`. Returns the
 * caller's recovered plaintext (a copy; the internal buffer is zeroized).
 */
export function vault_open_sealed(handle: number, blob: Uint8Array): Uint8Array;

/**
 * Seal plaintext under the vault referenced by `handle`. Returns the sealed
 * blob (non-secret ciphertext) — the only bytes that cross out.
 */
export function vault_seal(handle: number, plaintext: Uint8Array): Uint8Array;

/**
 * Unlock a vault; returns an opaque handle.
 */
export function vault_unlock(passphrase: Uint8Array): number;
