// Shared fakes for the unit tests. Nothing here talks to the network: every request goes to
// a handler the test supplies, and errors are shaped the way n8n's request helper throws them.
const { NodeApiError } = require('n8n-workflow');
const { GETSALES_API_HOST } = require('../dist/shared/host');

const fakeNode = {
	id: 'node-1',
	name: 'GetSales',
	type: '@getsales/n8n-nodes-getsales.getSales',
	typeVersion: 1,
	position: [0, 0],
	parameters: {},
};

// n8n's helper recognizes axios errors by constructor name, so the fake carries that name.
class AxiosError extends Error {
	constructor(status, data) {
		super(`Request failed with status code ${status}`);
		this.response = { status, data };
	}
}

/** A refusal as httpRequestWithAuthentication throws it: a NodeApiError around the HTTP error. */
function apiRefusal(status, code, message, extra = {}) {
	const body = { success: false, error: { code, message, recoverable: false, ...extra }, meta: { trace_id: 't' } };
	return new NodeApiError(fakeNode, new AxiosError(status, body));
}

/** Splits a request URL into the service and the route, checking the host on the way. */
function route(url) {
	if (!url.startsWith(`${GETSALES_API_HOST}/`)) throw new Error(`unexpected host in ${url}`);
	const rest = url.slice(GETSALES_API_HOST.length + 1);
	const [service, version, ...path] = rest.split('/');
	if (version !== 'v1') throw new Error(`unexpected version in ${url}`);
	return { service, path: `/${path.join('/')}` };
}

function makeHelpers(handler, calls) {
	return {
		async httpRequestWithAuthentication(credentialName, options) {
			const { service, path } = route(options.url);
			const call = { credentialName, method: options.method, service, path, body: options.body, qs: options.qs };
			calls.push(call);
			return await handler(call);
		},
		returnJsonArray(data) {
			return (Array.isArray(data) ? data : [data]).map((json) => ({ json }));
		},
	};
}

function makeLogger() {
	const lines = [];
	const log = (level) => (message) => lines.push({ level, message });
	return { lines, debug: log('debug'), info: log('info'), warn: log('warn'), error: log('error') };
}

/** An IExecuteFunctions stand-in. `params(name, itemIndex)` answers getNodeParameter. */
function executeContext({ items, params, handler, continueOnFail = false }) {
	const calls = [];
	const context = {
		calls,
		getInputData: () => items,
		getNode: () => fakeNode,
		continueOnFail: () => continueOnFail,
		getNodeParameter(name, itemIndex, fallback) {
			const value = params(name, itemIndex);
			if (value === undefined) {
				if (fallback !== undefined) return fallback;
				throw new Error(`Could not get parameter "${name}"`);
			}
			return value;
		},
		helpers: makeHelpers(handler, calls),
		logger: makeLogger(),
	};
	return context;
}

/** An IHookFunctions stand-in for the trigger's checkExists, create and delete. */
function hookContext({ params, handler, staticData = {}, webhookUrl, workflow = { id: 'wf1', name: 'Replies to CRM', active: true } }) {
	const calls = [];
	return {
		calls,
		staticData,
		getNode: () => fakeNode,
		getWorkflow: () => workflow,
		getWorkflowStaticData: () => staticData,
		getNodeWebhookUrl: () => webhookUrl,
		getNodeParameter(name, fallback) {
			const value = params[name];
			return value === undefined ? fallback : value;
		},
		helpers: makeHelpers(handler, calls),
		logger: makeLogger(),
	};
}

/**
 * An IWebhookFunctions stand-in that records what the trigger answers on the response.
 * `body` is what n8n's parser handed over. It defaults to the parsed raw body, and a test
 * passes it on its own to model a request whose raw bytes went missing.
 */
function webhookContext({ params, staticData, rawBody, headers, body }) {
	const sent = { status: undefined, body: undefined };
	const response = {
		status(code) {
			sent.status = code;
			return this;
		},
		json(body) {
			sent.body = body;
			return this;
		},
	};
	return {
		sent,
		getNode: () => fakeNode,
		getRequestObject: () => ({ rawBody, headers }),
		getResponseObject: () => response,
		getHeaderData: () => headers,
		getBodyData: () => body ?? JSON.parse(rawBody.toString('utf8')),
		getWorkflowStaticData: () => staticData,
		getNodeParameter(name, fallback) {
			const value = params[name];
			return value === undefined ? fallback : value;
		},
		helpers: makeHelpers(async () => {
			throw new Error('the webhook handler must not call the API');
		}, []),
		logger: makeLogger(),
	};
}

/** A search answer in the API's envelope. */
function searchPage(rows, nextCursor = null) {
	return {
		success: true,
		operation: 'search',
		items: rows.map((item) => ({ item, included: {} })),
		pagination: { next_cursor: nextCursor, has_more: nextCursor !== null, total_count: null },
		meta: { trace_id: 't' },
	};
}

function personSid(n) {
	return `cr_pp_${String(n).padStart(12, '0')}`;
}

module.exports = {
	GETSALES_API_HOST,
	AxiosError,
	apiRefusal,
	executeContext,
	fakeNode,
	hookContext,
	personSid,
	searchPage,
	webhookContext,
};
