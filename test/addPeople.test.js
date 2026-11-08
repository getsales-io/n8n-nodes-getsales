const test = require('node:test');
const assert = require('node:assert/strict');

const {
	ADD_PEOPLE_BATCH_SIZE,
	addPeopleToWorkflow,
	chunk,
	sumResults,
} = require('../dist/nodes/GetSales/WorkflowPeople');
const { GetSales } = require('../dist/nodes/GetSales/GetSales.node');
const { apiRefusal, executeContext, personSid } = require('./helpers');

const WORKFLOW = 'wf_wf_Q7mN2pL4xR8t';
const SOURCE = 'wf_sr_Mn3Bv7Cx1Zq9';

/**
 * A fake playtables service answering POST /api/workflows/{sid}/add-people the way the
 * API does: the people the workflow holds already are left as they are and counted,
 * the rest enter, and the first call on a workflow with no manual source makes one.
 */
function fakePlaytables({ enrolled = new Set(), hasSource = true } = {}) {
	const calls = [];
	const added = [];
	let sourceMade = hasSource;
	const call = async (method, service, path, body) => {
		calls.push({ method, service, path, body });
		assert.equal(service, 'playtables');
		if (method === 'POST' && path === `/api/workflows/${WORKFLOW}/add-people`) {
			assert.ok(body.people_sids.length >= 1 && body.people_sids.length <= ADD_PEOPLE_BATCH_SIZE);
			assert.deepEqual(Object.keys(body), ['people_sids'], 'sends the people and nothing else');
			const already = body.people_sids.filter((sid) => enrolled.has(sid));
			const fresh = body.people_sids.filter((sid) => !enrolled.has(sid));
			added.push(...fresh);
			for (const sid of fresh) enrolled.add(sid);
			const created = !sourceMade;
			sourceMade = true;
			return {
				success: true,
				operation: 'action',
				action: 'add-people',
				item: { sid: SOURCE, type: 'manual', name: 'Hand-picked' },
				result: {
					source_created: created,
					entered_count: fresh.length,
					skipped_enrolled_count: already.length,
					blocked_stoplisted_count: 0,
					blocked_limit_count: 0,
					blocked_other_count: 0,
				},
			};
		}
		throw new Error(`unexpected ${method} ${path}`);
	};
	return { call, calls, added };
}

test('chunk splits into slices of the given size', () => {
	assert.deepEqual(chunk([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
	assert.deepEqual(chunk([], 500), []);
});

test('sumResults adds every counter key by key', () => {
	assert.deepEqual(sumResults([{ entered_count: 2, re_entered_count: 1 }, { entered_count: 3, note: 'x' }]), {
		entered_count: 5,
		re_entered_count: 1,
	});
});

test('1,203 people with 4 enrolled and 2 repeated go out in batches of 500, 500 and 201, in one call each', async () => {
	const people = Array.from({ length: 1201 }, (_, n) => personSid(n + 1));
	const input = [...people, personSid(7), personSid(1201)];
	const enrolled = new Set([personSid(2), personSid(4), personSid(600), personSid(1200)]);
	const fake = fakePlaytables({ enrolled });

	const summary = await addPeopleToWorkflow(fake.call, WORKFLOW, input);

	assert.deepEqual(fake.calls.map((call) => call.body.people_sids.length), [500, 500, 201]);
	assert.ok(fake.calls.every((call) => call.path === `/api/workflows/${WORKFLOW}/add-people`), 'no source lookup, no records read');
	assert.equal(fake.added.length, 1197);
	for (const sid of [personSid(2), personSid(4), personSid(600), personSid(1200)]) {
		assert.ok(!fake.added.includes(sid), `${sid} was enrolled and stays as it is`);
	}

	assert.deepEqual(summary, {
		workflow_sid: WORKFLOW,
		workflow_source_sid: SOURCE,
		workflow_source_created: false,
		people_requested: 1201,
		people_already_enrolled: 4,
		batches: 3,
		result: {
			entered_count: 1197,
			skipped_enrolled_count: 4,
			blocked_stoplisted_count: 0,
			blocked_limit_count: 0,
			blocked_other_count: 0,
		},
	});
});

test('a repeated run re-runs nobody: the second answers every person as enrolled', async () => {
	const people = [personSid(1), personSid(2)];
	const fake = fakePlaytables();
	await addPeopleToWorkflow(fake.call, WORKFLOW, people);
	const repeat = await addPeopleToWorkflow(fake.call, WORKFLOW, people);
	assert.equal(repeat.people_already_enrolled, 2);
	assert.equal(repeat.result.entered_count, 0);
	assert.deepEqual(fake.added, people);
});

test('the first run on a workflow without a manual source says GetSales made one', async () => {
	const fake = fakePlaytables({ hasSource: false });
	const summary = await addPeopleToWorkflow(fake.call, WORKFLOW, [personSid(1)]);
	assert.equal(summary.workflow_source_created, true);
	assert.equal((await addPeopleToWorkflow(fake.call, WORKFLOW, [personSid(2)])).workflow_source_created, false);
});

test('exactly 500 people make one batch, 501 make two', async () => {
	for (const [count, batches] of [
		[500, [500]],
		[501, [500, 1]],
	]) {
		const fake = fakePlaytables();
		await addPeopleToWorkflow(fake.call, WORKFLOW, Array.from({ length: count }, (_, n) => personSid(n)));
		assert.deepEqual(
			fake.calls.map((call) => call.body.people_sids.length),
			batches,
		);
	}
});

// ----- through the node's execute(), with the n8n request helper mocked -----

function nodeRun({ items, sids, handler, continueOnFail = false }) {
	return executeContext({
		items,
		continueOnFail,
		params: (name, itemIndex) =>
			({ resource: 'workflow', operation: 'addPeople', workflowSid: WORKFLOW, personSid: sids[itemIndex] })[name],
		handler,
	});
}

test('execute sends every input item in one batch and pairs the summary with all of them', async () => {
	const fake = fakePlaytables({ enrolled: new Set([personSid(2)]) });
	const ctx = nodeRun({
		items: [{ json: {} }, { json: {} }, { json: {} }],
		sids: [personSid(1), `${personSid(2)}, ${personSid(3)}`, personSid(1)],
		handler: async (call) => await fake.call(call.method, call.service, call.path, call.body),
	});
	const [out] = await new GetSales().execute.call(ctx);
	assert.equal(out.length, 1);
	assert.deepEqual(out[0].pairedItem, [{ item: 0 }, { item: 1 }, { item: 2 }]);
	assert.equal(out[0].json.people_requested, 3);
	assert.equal(out[0].json.people_already_enrolled, 1);
	assert.deepEqual(fake.added, [personSid(1), personSid(3)]);
	assert.ok(ctx.calls.every((call) => call.credentialName === 'getSalesApi'));
});

test('execute refuses a malformed person SID before calling the API', async () => {
	const ctx = nodeRun({
		items: [{ json: {} }],
		sids: ['maya@example.com'],
		handler: async () => {
			throw new Error('no call expected');
		},
	});
	await assert.rejects(new GetSales().execute.call(ctx), /is not a person SID/);
	assert.equal(ctx.calls.length, 0);
});

test('execute shows the API refusal, or returns it as data under Continue On Fail', async () => {
	const handler = async () => {
		throw apiRefusal(422, 'invalid_transition', 'The workflow has no published version', {
			suggestion: 'Publish the workflow, then add people.',
		});
	};
	const failing = nodeRun({ items: [{ json: {} }], sids: [personSid(1)], handler });
	await assert.rejects(new GetSales().execute.call(failing), (error) => {
		assert.equal(error.message, 'GetSales: The workflow has no published version');
		assert.match(error.description, /Publish the workflow, then add people\. Error code: invalid_transition\./);
		assert.equal(error.httpCode, '422');
		return true;
	});

	const tolerant = nodeRun({ items: [{ json: {} }], sids: [personSid(1)], handler, continueOnFail: true });
	const [out] = await new GetSales().execute.call(tolerant);
	assert.deepEqual(out, [
		{ json: { error: 'GetSales: The workflow has no published version', workflow_sid: WORKFLOW }, pairedItem: [{ item: 0 }] },
	]);
});
