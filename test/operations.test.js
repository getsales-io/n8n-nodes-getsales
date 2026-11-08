const test = require('node:test');
const assert = require('node:assert/strict');

const { GetSales } = require('../dist/nodes/GetSales/GetSales.node');
const { GetSalesApi } = require('../dist/credentials/GetSalesApi.credentials');
const { GETSALES_API_HOST, executeContext, searchPage } = require('./helpers');

const TABLE = 'pt_tb_K8vR2nX5qL1m';

function run(params, handler, items = [{ json: {} }]) {
	const ctx = executeContext({ items, params: (name, i) => params(i)[name], handler });
	return { ctx, promise: new GetSales().execute.call(ctx) };
}

test('the credential sends a bearer key and tests it with a counts-only table search', () => {
	const credential = new GetSalesApi();
	assert.equal(credential.name, 'getSalesApi');
	assert.equal(credential.displayName, 'GetSales API');
	assert.equal(credential.authenticate.properties.headers.Authorization, '=Bearer {{$credentials.apiKey}}');
	assert.deepEqual(credential.test.request, {
		url: `${GETSALES_API_HOST}/playtables/v1/api/playtables/search`,
		method: 'POST',
		body: { page_size: 0 },
	});
});

test('Person: Add to Table sends the identity fields with on_duplicate skip', async () => {
	const { ctx, promise } = run(
		() => ({
			resource: 'person',
			operation: 'addToTable',
			playtableSid: TABLE,
			fullName: ' Maya Lindqvist ',
			workEmail: 'maya@northwind-outdoor.example',
			lnMemberId: 784512309,
			lnNickname: 'maya-lindqvist-4b2a1',
			additionalFields: { companyName: 'Northwind Outdoor', snId: '' },
		}),
		async (call) => {
			assert.equal(call.method, 'POST');
			assert.equal(call.service, 'playtables');
			assert.equal(call.path, '/api/people');
			return { success: true, operation: 'create', item: { sid: 'cr_pp_8Hq2LmZ4tR7w', playtable_sid: TABLE }, already_exists: true };
		},
	);
	const [out] = await promise;
	assert.deepEqual(ctx.calls[0].body, {
		playtable_sid: TABLE,
		on_duplicate: 'skip',
		full_name: 'Maya Lindqvist',
		work_email: 'maya@northwind-outdoor.example',
		ln_member_id: '784512309',
		ln_nickname: 'maya-lindqvist-4b2a1',
		company_name: 'Northwind Outdoor',
	});
	assert.deepEqual(out, [{ json: { sid: 'cr_pp_8Hq2LmZ4tR7w', playtable_sid: TABLE, already_exists: true }, pairedItem: { item: 0 } }]);
});

test('Person: Find by public ID filters on ln_nickname and pages to Max Results', async () => {
	const pages = [];
	const { promise } = run(
		() => ({
			resource: 'person',
			operation: 'find',
			findBy: 'lnNickname',
			lnNickname: 'Maya-Lindqvist-4B2A1',
			playtableSid: TABLE,
			maxResults: 3,
			options: { includeCompany: true },
		}),
		async (call) => {
			assert.equal(call.path, '/api/people/search');
			pages.push(call.body);
			if (!call.body.cursor) return searchPage([{ sid: 'cr_pp_000000000001' }, { sid: 'cr_pp_000000000002' }], 'c2');
			return searchPage([{ sid: 'cr_pp_000000000003' }, { sid: 'cr_pp_000000000004' }], 'c3');
		},
	);
	const [out] = await promise;
	assert.deepEqual(pages[0], {
		filter: { ln_nickname: { eq: 'maya-lindqvist-4b2a1' }, playtable_sid: { eq: TABLE } },
		include: ['company'],
		page_size: 3,
	});
	assert.equal(pages[1].cursor, 'c2');
	assert.equal(pages[1].page_size, 1);
	assert.deepEqual(out.map((item) => item.json.sid), ['cr_pp_000000000001', 'cr_pp_000000000002', 'cr_pp_000000000003']);
	assert.ok(out.every((item) => item.pairedItem.item === 0));
});

test('Person: Find by work email trims and lowercases it; free text goes to q', async () => {
	const bodies = [];
	const handler = async (call) => {
		bodies.push(call.body);
		return searchPage([]);
	};
	await run(() => ({ resource: 'person', operation: 'find', findBy: 'workEmail', workEmail: '  Maya@Northwind-Outdoor.example \t', maxResults: 50 }), handler).promise;
	await run(() => ({ resource: 'person', operation: 'find', findBy: 'query', query: 'Lindqvist', maxResults: 50 }), handler).promise;
	assert.deepEqual(bodies[0].filter, { work_email: { eq: 'maya@northwind-outdoor.example' } });
	assert.deepEqual(bodies[1].filter, { q: 'Lindqvist' });
});

test('Person: Find refuses a profile link where the public ID belongs', async () => {
	const { ctx, promise } = run(
		() => ({ resource: 'person', operation: 'find', findBy: 'lnNickname', lnNickname: 'https://example.com/in/maya', maxResults: 50 }),
		async () => {
			throw new Error('no call expected');
		},
	);
	await assert.rejects(promise, /not a profile link/);
	assert.equal(ctx.calls.length, 0);
});

test('Message: Get reads the message by sid, then its conversation with participants', async () => {
	const { ctx, promise } = run(
		() => ({ resource: 'message', operation: 'get', messageSid: 'ub_ms_Jk2mP9nR4qW1', options: { includeRecentMessages: true } }),
		async (call) => {
			if (call.path === '/api/messages/search') {
				return searchPage([{ sid: 'ub_ms_Jk2mP9nR4qW1', conversation_sid: 'ub_cv_Bv9nK4xP1sD7', body_text: 'Sounds good, send the deck.' }]);
			}
			return {
				success: true,
				operation: 'get',
				item: { sid: 'ub_cv_Bv9nK4xP1sD7', state: 'needs_you' },
				included: { participants: [{ sid: 'ub_pt_000000000001' }] },
			};
		},
	);
	const [out] = await promise;
	assert.deepEqual(
		ctx.calls.map((call) => `${call.method} ${call.service} ${call.path}`),
		[
			'POST unibox /api/messages/search',
			'GET unibox /api/conversations/ub_cv_Bv9nK4xP1sD7?include%5B%5D=participants&include%5B%5D=messages_tail',
		],
	);
	assert.deepEqual(ctx.calls[0].body, { filter: { sid: { eq: 'ub_ms_Jk2mP9nR4qW1' } }, page_size: 1 });
	assert.equal(out[0].json.message.body_text, 'Sounds good, send the deck.');
	assert.equal(out[0].json.conversation.state, 'needs_you');
	assert.deepEqual(out[0].json.included, { participants: [{ sid: 'ub_pt_000000000001' }] });
});

test('Message: Get says so when the message is not in the workspace', async () => {
	const { promise } = run(
		() => ({ resource: 'message', operation: 'get', messageSid: 'ub_ms_Jk2mP9nR4qW1' }),
		async () => searchPage([]),
	);
	await assert.rejects(promise, /No message ub_ms_Jk2mP9nR4qW1 in this workspace/);
});

test('the pickers list unarchived tables and active, published workflows', async () => {
	const node = new GetSales();
	const bodies = [];
	const ctx = executeContext({
		items: [],
		params: () => undefined,
		handler: async (call) => {
			bodies.push({ path: call.path, body: call.body });
			return searchPage([{ sid: call.path.includes('workflows') ? 'wf_wf_Q7mN2pL4xR8t' : TABLE, name: 'Berlin agencies' }]);
		},
	});
	const tables = await node.methods.listSearch.searchTables.call(ctx);
	const workflows = await node.methods.listSearch.searchWorkflows.call(ctx);
	assert.deepEqual(tables, { results: [{ name: 'Berlin agencies', value: TABLE }] });
	assert.equal(workflows.results[0].value, 'wf_wf_Q7mN2pL4xR8t');
	assert.deepEqual(bodies[0], { path: '/api/playtables/search', body: { sort: { field: 'name', direction: 'asc' }, page_size: 500 } });
	assert.deepEqual(bodies[1].body.filter, { status: { eq: 'active' }, published_version_sid: { is_null: false } });
});

test('a picker keeps the entries whose name holds the typed text, or whose ID it is', async () => {
	const node = new GetSales();
	const ctx = executeContext({
		items: [],
		params: () => undefined,
		handler: async () =>
			searchPage([
				{ sid: TABLE, name: 'Berlin agencies' },
				{ sid: 'pt_tb_Z9yX8wV7uT6s', name: 'Lisbon founders' },
			]),
	});
	assert.deepEqual((await node.methods.listSearch.searchTables.call(ctx, 'berlin')).results.map((r) => r.value), [TABLE]);
	assert.deepEqual((await node.methods.listSearch.searchTables.call(ctx, 'PT_TB_Z9YX8WV7UT6S')).results.map((r) => r.name), ['Lisbon founders']);
	assert.equal((await node.methods.listSearch.searchTables.call(ctx, '  ')).results.length, 2);
});

test('the table and workflow pickers are resource locators that read their list when opened', () => {
	const { properties } = new GetSales().description;
	for (const name of ['playtableSid', 'workflowSid']) {
		for (const property of properties.filter((p) => p.name === name)) {
			assert.equal(property.type, 'resourceLocator', name);
			assert.deepEqual(property.default, { mode: 'list', value: '' }, name);
			const list = property.modes.find((mode) => mode.name === 'list');
			assert.ok(list.typeOptions.searchListMethod in new GetSales().methods.listSearch, name);
		}
	}
});
