const test = require('node:test');
const assert = require('node:assert/strict');

const {
	SIGNATURE_TOLERANCE_SECONDS,
	parseSignatureHeader,
	verifySignature,
} = require('../dist/nodes/GetSalesTrigger/GetSalesSignature');

// The vector the platform's own signer test pins:
// hash_hmac('sha256', "1700000000.{payload}", 'topsecret'). The digest was computed with
// Python's hmac module, a second implementation and not the one under test.
const PINNED = {
	payload: '{"event":"x","data":{"k":"v"}}',
	secret: 'topsecret',
	t: 1700000000,
	v1: '638461faafbaa51140cf04f113427aad135559769316d4fdf3b94ac5828e2c9b',
};

// A delivery envelope with a non-ASCII payload, signed with a made-up fixture secret.
const FIXTURE_SECRET = '00112233445566778899aabbccddeeff';
const DELIVERY = Buffer.from(
	'{"webhook_log_sid":"in_wl_Q8rT2vW4xY6z","type":"messages.received","emitted_at":"2026-11-01T09:12:44+00:00","team_sid":"ts_tm_Hx7kQ3mN2pL4","trace_id":"0198f2ab-7c11-7e32-9a41-d2b64f2a91c3","payload":{"sid":"ub_ms_Jk2mP9nR4qW1","note":"Grüße, Maya"}}',
	'utf8',
);
const DELIVERY_T = 1793524364;
const DELIVERY_V1 = 'eec85b6d1c10bd07628333b406cec1264804445ee83d34387acbc3e4f6698047';

// A body as the platform writes it: PHP's json_encode with JSON_UNESCAPED_SLASHES keeps the
// slashes and escapes every non-ASCII character (ü below). JSON.stringify of the parsed
// value writes the same JSON with other bytes (a literal ü), 411 bytes instead of 415.
// Both digests were computed with Python's hmac module and FIXTURE_SECRET.
const PHP_BODY =
	'{"webhook_log_sid":"wh_lg_T5kW8nQ2rL7v","type":"tasks.created","emitted_at":"2026-11-02T14:03:10+00:00","team_sid":"ts_tm_Hx7kQ3mN2pL4","trace_id":"0198f3c4-2d10-7a55-8b21-c4e7f1a2b3d4","payload":{"sid":"ub_tk_Lm4nB8vC2xZ6","team_sid":"ts_tm_Hx7kQ3mN2pL4","conversation_sid":"ub_cv_Bv9nK4xP1sD7","person_sid":"cr_pp_8Hq2LmZ4tR7w","title":"Call J\\u00fcrgen about the pilot, https://example.com/pilot","due_at":null}}';
const PHP_T = 1793628190;
const PHP_V1 = '3bec811a690a8d69d683ed05cad1c1f4281da426a9e4bd35bf90f3737630d29e';
const REENCODED_V1 = 'db6259d372bb7edf5d44278def758f44fe0de27d9bb167c5c2fd6229b8b163b4';

/** The hex v1 with the byte at `index` (0 to 31) changed and every other byte kept. */
function flipByte(v1, index) {
	const bytes = Buffer.from(v1, 'hex');
	bytes[index] ^= 0x01;
	return bytes.toString('hex');
}

/** The hex v1 with one hex character, at `position` (0 to 63), replaced by another. */
function swapHexCharacter(v1, position) {
	const replacement = v1[position] === '0' ? '1' : '0';
	return v1.slice(0, position) + replacement + v1.slice(position + 1);
}

test('accepts the vector the platform signer pins', () => {
	const verdict = verifySignature({
		rawBody: PINNED.payload,
		header: `t=${PINNED.t},v1=${PINNED.v1}`,
		secret: PINNED.secret,
		nowSeconds: PINNED.t + 10,
	});
	assert.deepEqual(verdict, { valid: true });
});

test('accepts a delivery signed over its raw UTF-8 bytes', () => {
	const verdict = verifySignature({
		rawBody: DELIVERY,
		header: `t=${DELIVERY_T},v1=${DELIVERY_V1}`,
		secret: FIXTURE_SECRET,
		nowSeconds: DELIVERY_T,
	});
	assert.deepEqual(verdict, { valid: true });
});

test('accepts upper-case hex, spaces around parts and a second v1 value', () => {
	const header = ` t=${DELIVERY_T} , v1=${'0'.repeat(64)}, v1=${DELIVERY_V1.toUpperCase()} `;
	const verdict = verifySignature({ rawBody: DELIVERY, header, secret: FIXTURE_SECRET, nowSeconds: DELIVERY_T });
	assert.deepEqual(verdict, { valid: true });
});

test('takes the first value when the header arrives as a list', () => {
	const verdict = verifySignature({
		rawBody: DELIVERY,
		header: [`t=${DELIVERY_T},v1=${DELIVERY_V1}`, 't=1,v1=00'],
		secret: FIXTURE_SECRET,
		nowSeconds: DELIVERY_T,
	});
	assert.deepEqual(verdict, { valid: true });
});

test('refuses a body changed after signing', () => {
	const tampered = Buffer.from(DELIVERY.toString('utf8').replace('Maya', 'Mallory'), 'utf8');
	const verdict = verifySignature({
		rawBody: tampered,
		header: `t=${DELIVERY_T},v1=${DELIVERY_V1}`,
		secret: FIXTURE_SECRET,
		nowSeconds: DELIVERY_T,
	});
	assert.deepEqual(verdict, { valid: false, reason: 'bad_signature' });
});

test('refuses a body that was parsed and serialized again', () => {
	// Same JSON value, other bytes: the platform signs bytes, so this must not pass.
	const reencoded = JSON.stringify(JSON.parse(DELIVERY.toString('utf8')), null, 1);
	const verdict = verifySignature({
		rawBody: reencoded,
		header: `t=${DELIVERY_T},v1=${DELIVERY_V1}`,
		secret: FIXTURE_SECRET,
		nowSeconds: DELIVERY_T,
	});
	assert.deepEqual(verdict, { valid: false, reason: 'bad_signature' });
});

test('refuses a v1 one byte away from the valid one, at every byte position', () => {
	const cases = [
		{ rawBody: DELIVERY, t: DELIVERY_T, v1: DELIVERY_V1, secret: FIXTURE_SECRET },
		{ rawBody: PINNED.payload, t: PINNED.t, v1: PINNED.v1, secret: PINNED.secret },
	];
	for (const { rawBody, t, v1, secret } of cases) {
		assert.deepEqual(verifySignature({ rawBody, header: `t=${t},v1=${v1}`, secret, nowSeconds: t }), { valid: true });
		for (let index = 0; index < 32; index++) {
			const changed = flipByte(v1, index);
			const verdict = verifySignature({ rawBody, header: `t=${t},v1=${changed}`, secret, nowSeconds: t });
			assert.deepEqual(verdict, { valid: false, reason: 'bad_signature' }, `byte ${index} of ${v1}`);
		}
	}
});

test('refuses a v1 whose first or last hex character was changed', () => {
	for (const position of [0, 63]) {
		const changed = swapHexCharacter(DELIVERY_V1, position);
		assert.notEqual(changed, DELIVERY_V1);
		const verdict = verifySignature({
			rawBody: DELIVERY,
			header: `t=${DELIVERY_T},v1=${changed}`,
			secret: FIXTURE_SECRET,
			nowSeconds: DELIVERY_T,
		});
		assert.deepEqual(verdict, { valid: false, reason: 'bad_signature' }, `hex character ${position}`);
	}
});

test('verifies the bytes as sent, never a re-serialisation of the same JSON', () => {
	const reencoded = JSON.stringify(JSON.parse(PHP_BODY));
	assert.deepEqual(JSON.parse(reencoded), JSON.parse(PHP_BODY));
	assert.notEqual(Buffer.byteLength(reencoded), Buffer.byteLength(PHP_BODY));
	const check = (rawBody, v1) =>
		verifySignature({ rawBody, header: `t=${PHP_T},v1=${v1}`, secret: FIXTURE_SECRET, nowSeconds: PHP_T });

	// The bytes the platform signed pass, as a string and as a Buffer.
	assert.deepEqual(check(PHP_BODY, PHP_V1), { valid: true });
	assert.deepEqual(check(Buffer.from(PHP_BODY, 'utf8'), PHP_V1), { valid: true });
	// The same JSON written again by JavaScript is other bytes, so the platform's v1 fails on it.
	assert.deepEqual(check(reencoded, PHP_V1), { valid: false, reason: 'bad_signature' });
	// A v1 made over the re-serialised text fails on the bytes that actually arrived.
	assert.deepEqual(check(PHP_BODY, REENCODED_V1), { valid: false, reason: 'bad_signature' });
});

test('refuses a signature made with another secret', () => {
	const verdict = verifySignature({
		rawBody: DELIVERY,
		header: `t=${DELIVERY_T},v1=${DELIVERY_V1}`,
		secret: 'ffeeddccbbaa99887766554433221100',
		nowSeconds: DELIVERY_T,
	});
	assert.deepEqual(verdict, { valid: false, reason: 'bad_signature' });
});

test('refuses a signature whose timestamp was swapped', () => {
	// A replay with a fresh t: the HMAC covers t, so the old v1 no longer matches.
	const verdict = verifySignature({
		rawBody: DELIVERY,
		header: `t=${DELIVERY_T + 60},v1=${DELIVERY_V1}`,
		secret: FIXTURE_SECRET,
		nowSeconds: DELIVERY_T + 60,
	});
	assert.deepEqual(verdict, { valid: false, reason: 'bad_signature' });
});

test('refuses a stale or far-future timestamp, and keeps the edge of the window', () => {
	const base = { rawBody: DELIVERY, header: `t=${DELIVERY_T},v1=${DELIVERY_V1}`, secret: FIXTURE_SECRET };
	assert.deepEqual(verifySignature({ ...base, nowSeconds: DELIVERY_T + SIGNATURE_TOLERANCE_SECONDS }), {
		valid: true,
	});
	assert.deepEqual(verifySignature({ ...base, nowSeconds: DELIVERY_T + SIGNATURE_TOLERANCE_SECONDS + 1 }), {
		valid: false,
		reason: 'stale_signature',
	});
	assert.deepEqual(verifySignature({ ...base, nowSeconds: DELIVERY_T - SIGNATURE_TOLERANCE_SECONDS - 1 }), {
		valid: false,
		reason: 'stale_signature',
	});
});

test('refuses a missing secret, header or body', () => {
	const header = `t=${DELIVERY_T},v1=${DELIVERY_V1}`;
	assert.deepEqual(verifySignature({ rawBody: DELIVERY, header, secret: undefined, nowSeconds: DELIVERY_T }), {
		valid: false,
		reason: 'missing_secret',
	});
	assert.deepEqual(verifySignature({ rawBody: DELIVERY, header: undefined, secret: FIXTURE_SECRET, nowSeconds: DELIVERY_T }), {
		valid: false,
		reason: 'missing_signature',
	});
	assert.deepEqual(verifySignature({ rawBody: undefined, header, secret: FIXTURE_SECRET, nowSeconds: DELIVERY_T }), {
		valid: false,
		reason: 'missing_body',
	});
});

test('with a secret stored, an empty body, a null body or an empty header still fails closed', () => {
	const header = `t=${DELIVERY_T},v1=${DELIVERY_V1}`;
	for (const rawBody of [null, '', Buffer.alloc(0)]) {
		const verdict = verifySignature({ rawBody, header, secret: FIXTURE_SECRET, nowSeconds: DELIVERY_T });
		assert.deepEqual(verdict, { valid: false, reason: 'missing_body' }, `body ${JSON.stringify(rawBody)}`);
	}
	for (const emptyHeader of ['', []]) {
		const verdict = verifySignature({ rawBody: DELIVERY, header: emptyHeader, secret: FIXTURE_SECRET, nowSeconds: DELIVERY_T });
		assert.deepEqual(verdict, { valid: false, reason: 'missing_signature' }, `header ${JSON.stringify(emptyHeader)}`);
	}
});

test('refuses malformed headers', () => {
	for (const header of [
		`v1=${DELIVERY_V1}`,
		`t=${DELIVERY_T}`,
		`t=soon,v1=${DELIVERY_V1}`,
		`t=-5,v1=${DELIVERY_V1}`,
		'garbage',
		`t=${DELIVERY_T},v1=`,
	]) {
		const verdict = verifySignature({ rawBody: DELIVERY, header, secret: FIXTURE_SECRET, nowSeconds: DELIVERY_T });
		assert.deepEqual(verdict, { valid: false, reason: 'malformed_signature' }, header);
	}
	const shortHex = verifySignature({
		rawBody: DELIVERY,
		header: `t=${DELIVERY_T},v1=${DELIVERY_V1.slice(0, 40)}`,
		secret: FIXTURE_SECRET,
		nowSeconds: DELIVERY_T,
	});
	assert.deepEqual(shortHex, { valid: false, reason: 'bad_signature' });
});

test('parses the header parts', () => {
	assert.deepEqual(parseSignatureHeader('t=1,v1=aa,v1=bb,x=1'), { t: '1', v1: ['aa', 'bb'] });
	assert.deepEqual(parseSignatureHeader(''), { v1: [] });
});
