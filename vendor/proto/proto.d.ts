/* tslint:disable */
/* eslint-disable */

/**
 * Decode CBOR bytes back into a message object.
 */
export function decode(bytes: Uint8Array): any;

/**
 * Encode a message object to CBOR bytes.
 */
export function encode(message: any): Uint8Array;
