import { createHmac, timingSafeEqual } from 'node:crypto';

/** A delivery older or newer than this, by its signed timestamp, is refused. */
export const SIGNATURE_TOLERANCE_SECONDS = 300;

export type SignatureFailure =
	| 'missing_secret'
	| 'missing_signature'
	| 'malformed_signature'
	| 'stale_signature'
	| 'missing_body'
	| 'bad_signature';

export type SignatureVerdict = { valid: true } | { valid: false; reason: SignatureFailure };

export interface SignatureInput {
	/**
	 * The request body exactly as it arrived, before any JSON parsing. A missing or empty
	 * body is refused, even when a parsed copy of it exists elsewhere.
	 */
	rawBody: Buffer | string | null | undefined;
	/** The X-Webhook-Signature header: t={unix_seconds},v1={hex_hmac}. */
	header: string | string[] | undefined;
	/** The subscription's secret, returned once when it was created. */
	secret: string | undefined;
	/** Now, in unix seconds. */
	nowSeconds: number;
	toleranceSeconds?: number;
}

/** Splits t=...,v1=... into its timestamp and every v1 value it carries. */
export function parseSignatureHeader(header: string): { t?: string; v1: string[] } {
	const parsed: { t?: string; v1: string[] } = { v1: [] };
	for (const part of header.split(',')) {
		const separator = part.indexOf('=');
		if (separator === -1) continue;
		const key = part.slice(0, separator).trim();
		const value = part.slice(separator + 1).trim();
		if (key === 't' && parsed.t === undefined) parsed.t = value;
		if (key === 'v1' && value !== '') parsed.v1.push(value);
	}
	return parsed;
}

/** HMAC-SHA256 of "{t}.{raw_body}" with the secret, as the platform signs it. */
function computeSignature(secret: string, timestamp: string, rawBody: Buffer | string): Buffer {
	return createHmac('sha256', secret).update(`${timestamp}.`).update(rawBody).digest();
}

/**
 * Checks a delivery's X-Webhook-Signature: the timestamp must sit inside the tolerance
 * window (it blocks replays) and one v1 value must equal the HMAC computed over the raw
 * bytes received, compared in constant time.
 */
export function verifySignature(input: SignatureInput): SignatureVerdict {
	const tolerance = input.toleranceSeconds ?? SIGNATURE_TOLERANCE_SECONDS;
	if (!input.secret) return { valid: false, reason: 'missing_secret' };

	const header = Array.isArray(input.header) ? input.header[0] : input.header;
	if (!header) return { valid: false, reason: 'missing_signature' };

	const parsed = parseSignatureHeader(header);
	if (parsed.t === undefined || !/^\d{1,12}$/.test(parsed.t) || parsed.v1.length === 0) {
		return { valid: false, reason: 'malformed_signature' };
	}
	if (Math.abs(input.nowSeconds - Number(parsed.t)) > tolerance) {
		return { valid: false, reason: 'stale_signature' };
	}
	if (input.rawBody === undefined || input.rawBody === null || input.rawBody.length === 0) {
		return { valid: false, reason: 'missing_body' };
	}

	const expected = computeSignature(input.secret, parsed.t, input.rawBody);
	for (const candidate of parsed.v1) {
		if (!/^[0-9a-f]{64}$/i.test(candidate)) continue;
		const received = Buffer.from(candidate, 'hex');
		if (received.length === expected.length && timingSafeEqual(received, expected)) {
			return { valid: true };
		}
	}
	return { valid: false, reason: 'bad_signature' };
}
