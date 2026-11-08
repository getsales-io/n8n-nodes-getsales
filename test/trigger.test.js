const test = require('node:test');
const assert = require('node:assert/strict');
const { createHmac } = require('node:crypto');

const { GetSalesTrigger } = require('../dist/nodes/GetSalesTrigger/GetSalesTrigger.node');
const { CATALOG_EVENT_TYPES, resolveEvents } = require('../dist/nodes/GetSalesTrigger/GetSalesEvents');
const { apiRefusal, hookContext, webhookContext } = require('./helpers');

const trigger = new GetSalesTrigger();
const lifecycle = trigger.webhookMethods.default;
const SECRET = '00112233445566778899aabbccddeeff';
const TARGET = 'https://n8n.example.com/webhook/6f1c2d3e-4b5a-4c7d-8e9f-0a1b2c3d4e5f/webhook';

function signedDelivery(envelope, { secret = SECRET, t = Math.floor(Date.now() / 1000) } = {}) {
	const rawBody = Buffer.from(JSON.stringify(envelope), 'utf8');
	const v1 = createHmac('sha256', secret).update(`${t}.`).update(rawBody).digest('hex');
	return { rawBody, headers: { 'x-webhook-signature': `t=${t},v1=${v1}`, 'x-webhook-event': envelope.type } };
}

const envelope = {
	webhook_log_sid: 'in_wl_Q8rT2vW4xY6z',
	type: 'messages.received',
	emitted_at: '2026-11-01T09:12:44+00:00',
	team_sid: 'ts_tm_Hx7kQ3mN2pL4',
	trace_id: '0198f2ab-7c11-7e32-9a41-d2b64f2a91c3',
	payload: { sid: 'ub_ms_Jk2mP9nR4qW1' },
};

test('the catalog is the 33 events of the create_webhook enum', () => {
	assert.equal(CATALOG_EVENT_TYPES.length, 33);
	assert.equal(new Set(CATALOG_EVENT_TYPES).size, 33);
});

test('named triggers resolve to their events; the picker keeps catalog events only', () => {
	assert.deepEqual(resolveEvents('leadFinishedOrLeftWorkflow', []), [
		'workflow-records.completed',
		'workflow-records.exited',
	]);
	assert.deepEqual(resolveEvents('importOrSearchFinished', []), ['data-sources.completed', 'playtable-runs.finished']);
	assert.deepEqual(resolveEvents('anyEvents', ['tasks.created', 'messages.*', 'tasks.created', 'agents.mode-changed']), [
		'agents.mode-changed',
		'tasks.created',
	]);
	assert.deepEqual(resolveEvents('senderProfileHealthChanged', []), []);
});

test('a signed delivery of a subscribed event starts the workflow with the whole envelope', async () => {
	const { rawBody, headers } = signedDelivery(envelope);
	const ctx = webhookContext({ params: { triggerOn: 'replyReceived' }, staticData: { webhookSid: 'wh_hk_A1b2C3d4E5f6', webhookSecret: SECRET }, rawBody, headers });
	const result = await trigger.webhook.call(ctx);
	assert.equal(ctx.sent.status, undefined);
	assert.deepEqual(result.workflowData, [[{ json: envelope }]]);
});

test('a bad signature is refused with 401 and starts nothing', async () => {
	const { rawBody, headers } = signedDelivery(envelope, { secret: 'ffeeddccbbaa99887766554433221100' });
	const ctx = webhookContext({ params: { triggerOn: 'replyReceived' }, staticData: { webhookSecret: SECRET }, rawBody, headers });
	const result = await trigger.webhook.call(ctx);
	assert.equal(result.noWebhookResponse, true);
	assert.equal(result.workflowData, undefined);
	assert.equal(ctx.sent.status, 401);
	assert.deepEqual(ctx.sent.body, { error: 'invalid_signature', reason: 'bad_signature' });
	assert.ok(ctx.logger.lines.some((line) => line.level === 'warn'));
});

test('a stale signature is refused with 401', async () => {
	const { rawBody, headers } = signedDelivery(envelope, { t: Math.floor(Date.now() / 1000) - 3600 });
	const ctx = webhookContext({ params: { triggerOn: 'replyReceived' }, staticData: { webhookSecret: SECRET }, rawBody, headers });
	const result = await trigger.webhook.call(ctx);
	assert.equal(ctx.sent.status, 401);
	assert.equal(ctx.sent.body.reason, 'stale_signature');
	assert.equal(result.workflowData, undefined);
});

test('an unsigned delivery, or one without a stored secret, is refused', async () => {
	const { rawBody, headers } = signedDelivery(envelope);
	const unsigned = webhookContext({ params: { triggerOn: 'replyReceived' }, staticData: { webhookSecret: SECRET }, rawBody, headers: {} });
	await trigger.webhook.call(unsigned);
	assert.equal(unsigned.sent.status, 401);
	assert.equal(unsigned.sent.body.reason, 'missing_signature');

	const noSecret = webhookContext({ params: { triggerOn: 'replyReceived' }, staticData: {}, rawBody, headers });
	await trigger.webhook.call(noSecret);
	assert.equal(noSecret.sent.status, 401);
	assert.equal(noSecret.sent.body.reason, 'missing_secret');
});

// The platform writes bodies with PHP's json_encode: slashes kept, non-ASCII escaped. Parsing
// this and writing it back with JSON.stringify gives the same value in other bytes.
const PHP_STYLE_TASK =
	'{"webhook_log_sid":"wh_lg_T5kW8nQ2rL7v","type":"tasks.created","emitted_at":"2026-11-02T14:03:10+00:00","team_sid":"ts_tm_Hx7kQ3mN2pL4","trace_id":"0198f3c4-2d10-7a55-8b21-c4e7f1a2b3d4","payload":{"sid":"ub_tk_Lm4nB8vC2xZ6","title":"Call J\\u00fcrgen about the pilot, https://example.com/pilot","due_at":null}}';

function signOver(bytes, t) {
	return createHmac('sha256', SECRET).update(`${t}.`).update(bytes).digest('hex');
}

test('the trigger checks the raw bytes it received, so a body written by PHP passes', async () => {
	const t = Math.floor(Date.now() / 1000);
	const rawBody = Buffer.from(PHP_STYLE_TASK, 'utf8');
	assert.notEqual(JSON.stringify(JSON.parse(PHP_STYLE_TASK)), PHP_STYLE_TASK);
	const ctx = webhookContext({
		params: { triggerOn: 'taskCreated' },
		staticData: { webhookSecret: SECRET },
		rawBody,
		headers: { 'x-webhook-signature': `t=${t},v1=${signOver(rawBody, t)}` },
	});
	const result = await trigger.webhook.call(ctx);
	assert.equal(ctx.sent.status, undefined);
	assert.equal(result.workflowData[0][0].json.payload.title, 'Call Jürgen about the pilot, https://example.com/pilot');
});

test('a signature made over a re-serialisation of the body is refused', async () => {
	const t = Math.floor(Date.now() / 1000);
	const reencoded = Buffer.from(JSON.stringify(JSON.parse(PHP_STYLE_TASK)), 'utf8');
	const ctx = webhookContext({
		params: { triggerOn: 'taskCreated' },
		staticData: { webhookSecret: SECRET },
		rawBody: Buffer.from(PHP_STYLE_TASK, 'utf8'),
		headers: { 'x-webhook-signature': `t=${t},v1=${signOver(reencoded, t)}` },
	});
	const result = await trigger.webhook.call(ctx);
	assert.equal(ctx.sent.status, 401);
	assert.equal(ctx.sent.body.reason, 'bad_signature');
	assert.equal(result.workflowData, undefined);
});

test('with a secret stored, a delivery whose raw body is missing or empty is refused', async () => {
	const { rawBody, headers } = signedDelivery(envelope);
	for (const missing of [undefined, Buffer.alloc(0)]) {
		// n8n parsed a body, but the bytes the signature covers are not there to check.
		const ctx = webhookContext({
			params: { triggerOn: 'replyReceived' },
			staticData: { webhookSid: 'wh_hk_A1b2C3d4E5f6', webhookSecret: SECRET },
			rawBody: missing,
			body: JSON.parse(rawBody.toString('utf8')),
			headers,
		});
		const result = await trigger.webhook.call(ctx);
		assert.equal(ctx.sent.status, 401);
		assert.equal(ctx.sent.body.reason, 'missing_body');
		assert.equal(result.workflowData, undefined);
	}
});

test('a signed test delivery is acknowledged without starting the workflow', async () => {
	const { rawBody, headers } = signedDelivery({ ...envelope, type: 'webhooks.test' });
	const ctx = webhookContext({ params: { triggerOn: 'replyReceived' }, staticData: { webhookSecret: SECRET }, rawBody, headers });
	const result = await trigger.webhook.call(ctx);
	assert.equal(result.workflowData, undefined);
	assert.equal(ctx.sent.status, 200);
	assert.deepEqual(ctx.sent.body, { received: true, ignored: 'webhooks.test' });
});

test('Any of These Events passes every picked event', async () => {
	const { rawBody, headers } = signedDelivery({ ...envelope, type: 'tasks.created' });
	const ctx = webhookContext({
		params: { triggerOn: 'anyEvents', events: ['tasks.created', 'signals.website-visited'] },
		staticData: { webhookSecret: SECRET },
		rawBody,
		headers,
	});
	const result = await trigger.webhook.call(ctx);
	assert.equal(result.workflowData[0][0].json.type, 'tasks.created');
});

test('create subscribes the n8n URL to the events and keeps the sid and the secret', async () => {
	const ctx = hookContext({
		params: { triggerOn: 'leadFinishedOrLeftWorkflow' },
		webhookUrl: TARGET,
		handler: async (call) => {
			assert.equal(call.credentialName, 'getSalesApi');
			return { success: true, operation: 'create', item: { sid: 'wh_hk_A1b2C3d4E5f6', secret: SECRET, status: 'on' }, already_exists: false };
		},
	});
	assert.equal(await lifecycle.create.call(ctx), true);
	assert.equal(ctx.calls.length, 1);
	assert.deepEqual(
		{ method: ctx.calls[0].method, service: ctx.calls[0].service, path: ctx.calls[0].path },
		{ method: 'POST', service: 'integrations', path: '/api/webhooks' },
	);
	assert.deepEqual(ctx.calls[0].body, {
		name: 'n8n: Replies to CRM (Lead Finished or Left a Workflow)',
		target_url: TARGET,
		events: ['workflow-records.completed', 'workflow-records.exited'],
	});
	assert.deepEqual(ctx.staticData, { webhookSid: 'wh_hk_A1b2C3d4E5f6', webhookSecret: SECRET });
});

test('create replaces the subscription a 409 names as holding the same URL', async () => {
	let creates = 0;
	const ctx = hookContext({
		params: { triggerOn: 'replyReceived' },
		webhookUrl: TARGET,
		handler: async (call) => {
			if (call.path === '/api/webhooks' && call.method === 'POST') {
				creates += 1;
				if (creates === 1) {
					throw apiRefusal(409, 'duplicate_rejected', 'target_url is already subscribed', {
						context: { field: 'webhook', value: 'target_url_already_subscribed', existing_sid: 'wh_hk_Older0000001' },
					});
				}
				return { success: true, item: { sid: 'wh_hk_Newer0000001', secret: SECRET } };
			}
			if (call.method === 'DELETE') return { success: true, operation: 'delete', already_deleted: false };
			throw new Error(`unexpected ${call.method} ${call.path}`);
		},
	});
	assert.equal(await lifecycle.create.call(ctx), true);
	assert.deepEqual(
		ctx.calls.map((call) => `${call.method} ${call.path}`),
		['POST /api/webhooks', 'DELETE /api/webhooks/wh_hk_Older0000001', 'POST /api/webhooks'],
	);
	assert.equal(ctx.staticData.webhookSid, 'wh_hk_Newer0000001');
});

test('create surfaces a 409 that names no holder, and a second 409, without deleting anything', async () => {
	for (const extra of [{}, { context: { existing_sid: 'wh_hk_Older0000001' } }]) {
		const named = 'context' in extra;
		const ctx = hookContext({
			params: { triggerOn: 'replyReceived' },
			webhookUrl: TARGET,
			handler: async (call) => {
				if (call.method === 'POST') throw apiRefusal(409, 'duplicate_rejected', 'target_url is already subscribed', extra);
				if (call.method === 'DELETE') return { success: true, operation: 'delete', already_deleted: false };
				throw new Error(`unexpected ${call.method} ${call.path}`);
			},
		});
		await assert.rejects(lifecycle.create.call(ctx), /already subscribed/);
		assert.deepEqual(
			ctx.calls.map((call) => call.method),
			named ? ['POST', 'DELETE', 'POST'] : ['POST'],
		);
		assert.deepEqual(ctx.staticData, {});
	}
});

test('create surfaces any other refusal with the API message', async () => {
	const ctx = hookContext({
		params: { triggerOn: 'replyReceived' },
		webhookUrl: 'https://localhost:5678/webhook/x/webhook',
		handler: async () => {
			throw apiRefusal(422, 'validation_failed', 'target_url must be https on a public host');
		},
	});
	await assert.rejects(lifecycle.create.call(ctx), (error) => {
		assert.equal(error.message, 'GetSales: target_url must be https on a public host');
		assert.equal(error.context.getSalesCode, 'validation_failed');
		return true;
	});
	assert.deepEqual(ctx.staticData, {});
});

test('checkExists keeps a live subscription that matches', async () => {
	const ctx = hookContext({
		params: { triggerOn: 'importOrSearchFinished' },
		webhookUrl: TARGET,
		staticData: { webhookSid: 'wh_hk_A1b2C3d4E5f6', webhookSecret: SECRET },
		handler: async (call) => {
			assert.equal(call.method, 'GET');
			assert.equal(call.path, '/api/webhooks/wh_hk_A1b2C3d4E5f6');
			return {
				success: true,
				item: { sid: 'wh_hk_A1b2C3d4E5f6', status: 'on', deleted_at: null, target_url: TARGET, events: ['playtable-runs.finished', 'data-sources.completed'] },
			};
		},
	});
	assert.equal(await lifecycle.checkExists.call(ctx), true);
	assert.equal(ctx.calls.length, 1);
});

test('checkExists replaces a subscription with other events, or a failed one', async () => {
	for (const item of [
		{ status: 'on', target_url: TARGET, events: ['messages.received'] },
		{ status: 'failed', target_url: TARGET, events: ['tasks.created'] },
	]) {
		const ctx = hookContext({
			params: { triggerOn: 'taskCreated' },
			webhookUrl: TARGET,
			staticData: { webhookSid: 'wh_hk_A1b2C3d4E5f6', webhookSecret: SECRET },
			handler: async (call) => {
				if (call.method === 'GET') return { success: true, item: { sid: 'wh_hk_A1b2C3d4E5f6', deleted_at: null, ...item } };
				if (call.method === 'DELETE') return { success: true, already_deleted: false };
				throw new Error('unexpected call');
			},
		});
		assert.equal(await lifecycle.checkExists.call(ctx), false);
		assert.deepEqual(ctx.calls.map((call) => call.method), ['GET', 'DELETE']);
		assert.deepEqual(ctx.staticData, {});
	}
});

test('checkExists forgets a subscription the API no longer has', async () => {
	const ctx = hookContext({
		params: { triggerOn: 'replyReceived' },
		webhookUrl: TARGET,
		staticData: { webhookSid: 'wh_hk_A1b2C3d4E5f6', webhookSecret: SECRET },
		handler: async () => {
			throw apiRefusal(404, 'not_found', 'Webhook not found');
		},
	});
	assert.equal(await lifecycle.checkExists.call(ctx), false);
	assert.deepEqual(ctx.staticData, {});
});

test('checkExists fails loudly on a refused key instead of re-subscribing', async () => {
	const ctx = hookContext({
		params: { triggerOn: 'replyReceived' },
		webhookUrl: TARGET,
		staticData: { webhookSid: 'wh_hk_A1b2C3d4E5f6', webhookSecret: SECRET },
		handler: async () => {
			throw apiRefusal(401, 'unauthorized', 'The API key is not valid');
		},
	});
	await assert.rejects(lifecycle.checkExists.call(ctx), /GetSales: The API key is not valid/);
	assert.equal(ctx.staticData.webhookSid, 'wh_hk_A1b2C3d4E5f6');
});

test('delete removes the subscription and forgets it, even when the call fails', async () => {
	const ok = hookContext({
		params: {},
		webhookUrl: TARGET,
		staticData: { webhookSid: 'wh_hk_A1b2C3d4E5f6', webhookSecret: SECRET },
		handler: async (call) => {
			assert.equal(call.method, 'DELETE');
			assert.equal(call.path, '/api/webhooks/wh_hk_A1b2C3d4E5f6');
			return { success: true, operation: 'delete', already_deleted: false, soft_deleted: true, retained: [] };
		},
	});
	assert.equal(await lifecycle.delete.call(ok), true);
	assert.deepEqual(ok.staticData, {});

	const failing = hookContext({
		params: {},
		webhookUrl: TARGET,
		staticData: { webhookSid: 'wh_hk_A1b2C3d4E5f6', webhookSecret: SECRET },
		handler: async () => {
			throw apiRefusal(503, 'service_unavailable', 'Try again shortly');
		},
	});
	assert.equal(await lifecycle.delete.call(failing), true);
	assert.deepEqual(failing.staticData, {});
	assert.ok(failing.logger.lines.some((line) => line.level === 'warn' && line.message.includes('wh_hk_A1b2C3d4E5f6')));
});
