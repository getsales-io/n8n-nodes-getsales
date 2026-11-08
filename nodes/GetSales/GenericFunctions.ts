import type {
	IDataObject,
	IExecuteFunctions,
	IHookFunctions,
	IHttpRequestMethods,
	IHttpRequestOptions,
	ILoadOptionsFunctions,
	INodePropertyOptions,
	JsonObject,
} from 'n8n-workflow';
import { NodeApiError } from 'n8n-workflow';

import { apiUrl, type GetSalesService } from '../../shared/host';

const CREDENTIAL_NAME = 'getSalesApi';

/** The most rows one search call returns (the API's page_size ceiling). */
export const MAX_PAGE_SIZE = 500;

type RequestContext = IExecuteFunctions | IHookFunctions | ILoadOptionsFunctions;

/** One API call, as the helpers below and the unit tests see it. */
export type ApiCall = (
	method: IHttpRequestMethods,
	service: GetSalesService,
	path: string,
	body?: IDataObject,
	qs?: IDataObject,
) => Promise<IDataObject>;

/** One row of a search answer: { item, included }. */
export interface SearchRow {
	item: IDataObject;
	included?: IDataObject;
}

/** What the GetSales error envelope says about a failed call. */
interface ApiErrorInfo {
	httpCode?: string;
	code?: string;
	message?: string;
	suggestion?: string;
	/** The record that holds the value a duplicate_rejected refusal was about. */
	existingSid?: string;
}

function asObject(value: unknown): IDataObject | undefined {
	return value !== null && typeof value === 'object' ? (value as IDataObject) : undefined;
}

function parseBody(value: unknown): IDataObject | undefined {
	if (typeof value === 'string') {
		try {
			return asObject(JSON.parse(value));
		} catch {
			return undefined;
		}
	}
	return asObject(value);
}

/**
 * Reads the status and the { success: false, error: { code, message, suggestion } }
 * envelope out of whatever shape the n8n request helper threw. n8n wraps the HTTP
 * error in a NodeApiError: the envelope then sits in its context.data, and the raw
 * error in its cause (an Error) or its errorResponse (a plain object).
 */
function readApiError(error: unknown): ApiErrorInfo {
	const info: ApiErrorInfo = {};
	const seen = new Set<unknown>();
	const queue: unknown[] = [error];
	while (queue.length > 0) {
		const current = queue.shift();
		const node = asObject(current);
		if (!node || seen.has(node)) continue;
		seen.add(node);

		const response = asObject(node.response);
		const status = node.httpCode ?? node.statusCode ?? response?.status ?? response?.statusCode;
		if (info.httpCode === undefined && status !== undefined && status !== null && status !== '') {
			info.httpCode = String(status);
		}

		const context = asObject(node.context);
		const candidates = [response?.data, response?.body, context?.data, node.error, node];
		for (const candidate of candidates) {
			const envelope = asObject(parseBody(candidate)?.error);
			if (envelope && info.code === undefined && typeof envelope.code === 'string') {
				info.code = envelope.code;
				if (typeof envelope.message === 'string') info.message = envelope.message;
				if (typeof envelope.suggestion === 'string') info.suggestion = envelope.suggestion;
				const existingSid = asObject(envelope.context)?.existing_sid;
				if (typeof existingSid === 'string' && existingSid !== '') info.existingSid = existingSid;
			}
		}

		queue.push(node.cause, node.errorResponse);
	}
	return info;
}

/** The GetSales error code a NodeApiError from getSalesApiRequest carries, if any. */
export function apiErrorCode(error: unknown): string | undefined {
	const context = asObject(asObject(error)?.context);
	return typeof context?.getSalesCode === 'string' ? context.getSalesCode : readApiError(error).code;
}

/** The HTTP status a failed call answered, if any. */
export function apiErrorStatus(error: unknown): string | undefined {
	const context = asObject(asObject(error)?.context);
	return typeof context?.httpStatus === 'string' ? context.httpStatus : readApiError(error).httpCode;
}

/** The sid a duplicate_rejected refusal names as the holder of the value, if any. */
export function apiErrorExistingSid(error: unknown): string | undefined {
	const context = asObject(asObject(error)?.context);
	return typeof context?.getSalesExistingSid === 'string' ? context.getSalesExistingSid : readApiError(error).existingSid;
}

/**
 * Calls a GetSales route with the node's credential. A refusal becomes a NodeApiError
 * that shows the API's own message and suggestion, and keeps the error code in its
 * context so a caller can branch on it (not_found, duplicate_rejected, ...).
 */
export async function getSalesApiRequest(
	this: RequestContext,
	method: IHttpRequestMethods,
	service: GetSalesService,
	path: string,
	body?: IDataObject,
	qs?: IDataObject,
): Promise<IDataObject> {
	const options: IHttpRequestOptions = {
		method,
		url: apiUrl(service, path),
		headers: { Accept: 'application/json' },
		json: true,
	};
	if (body !== undefined) options.body = body;
	if (qs !== undefined) options.qs = qs;

	try {
		const response = await this.helpers.httpRequestWithAuthentication.call(
			this,
			CREDENTIAL_NAME,
			options,
		);
		return (asObject(response) ?? {}) as IDataObject;
	} catch (error) {
		const info = readApiError(error);
		const message = info.message ? `GetSales: ${info.message}` : undefined;
		const description =
			[info.suggestion, info.code ? `Error code: ${info.code}.` : undefined]
				.filter((part) => part)
				.join(' ') || undefined;
		const apiError = new NodeApiError(this.getNode(), error as JsonObject, {
			message,
			description,
			httpCode: info.httpCode,
		});
		// The helper usually throws a NodeApiError already, and the constructor then hands
		// that same error back with the options unused, so the reading is written onto it.
		if (message) apiError.message = message;
		if (description) apiError.description = description;
		apiError.context.getSalesCode = info.code;
		apiError.context.httpStatus = info.httpCode;
		apiError.context.getSalesExistingSid = info.existingSid;
		throw apiError;
	}
}

/** Binds getSalesApiRequest to a node context, for code that takes an ApiCall. */
export function bindApiCall(context: RequestContext): ApiCall {
	return async (method, service, path, body, qs) =>
		await getSalesApiRequest.call(context, method, service, path, body, qs);
}

/**
 * Pages a search route with its forward cursor until `wanted` rows are in hand or
 * the result set ends.
 */
export async function searchRows(
	call: ApiCall,
	service: GetSalesService,
	path: string,
	body: IDataObject,
	wanted: number,
): Promise<SearchRow[]> {
	const rows: SearchRow[] = [];
	let cursor: string | undefined;
	do {
		const pageSize = Math.min(MAX_PAGE_SIZE, wanted - rows.length);
		const page = await call('POST', service, path, {
			...body,
			page_size: pageSize,
			...(cursor ? { cursor } : {}),
		});
		const items = Array.isArray(page.items) ? (page.items as unknown[]) : [];
		for (const entry of items) {
			const row = asObject(entry);
			const item = asObject(row?.item);
			if (item) rows.push({ item, included: asObject(row?.included) });
		}
		const pagination = asObject(page.pagination);
		const next = pagination?.next_cursor;
		cursor = typeof next === 'string' && next !== '' && items.length > 0 ? next : undefined;
	} while (cursor && rows.length < wanted);
	return rows.slice(0, wanted);
}

/** The tables of the workspace, archived ones left out, for a dropdown. */
export async function loadTables(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
	const rows = await searchRows(
		bindApiCall(this),
		'playtables',
		'/api/playtables/search',
		{ sort: { field: 'name', direction: 'asc' } },
		2000,
	);
	return rows.map(({ item }) => ({
		name: String(item.name ?? item.sid),
		value: String(item.sid),
		description: String(item.sid),
	}));
}

/** The GetSales workflows that can take people now: active and published. */
export async function loadWorkflows(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
	const rows = await searchRows(
		bindApiCall(this),
		'playtables',
		'/api/workflows/search',
		{
			filter: { status: { eq: 'active' }, published_version_sid: { is_null: false } },
			sort: { field: 'name', direction: 'asc' },
		},
		2000,
	);
	return rows.map(({ item }) => ({
		name: String(item.name ?? item.sid),
		value: String(item.sid),
		description: String(item.sid),
	}));
}
