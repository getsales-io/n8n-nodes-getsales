import type {
	IDataObject,
	IExecuteFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
	JsonObject,
} from 'n8n-workflow';
import { NodeApiError, NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';

import type { ApiCall } from './GenericFunctions';
import { bindApiCall, searchRows, searchTables, searchWorkflows } from './GenericFunctions';
import { messageFields, messageOperations } from './MessageDescription';
import { personFields, personOperations } from './PersonDescription';
import { workflowFields, workflowOperations } from './WorkflowDescription';
import { addPeopleToWorkflow } from './WorkflowPeople';

const SID_LENGTH = 18;

function text(value: unknown): string {
	if (typeof value === 'string') return value.trim();
	if (typeof value === 'number' && Number.isFinite(value)) return String(value);
	return '';
}

function firstItem(page: IDataObject): IDataObject | undefined {
	const items = Array.isArray(page.items) ? (page.items as unknown[]) : [];
	const item = (items[0] as IDataObject | undefined)?.item;
	return item !== null && typeof item === 'object' ? (item as IDataObject) : undefined;
}

/** The person SIDs one input item names: a single SID, several separated by commas, or a list. */
function parsePersonSids(value: unknown): string[] {
	const parts = Array.isArray(value) ? value : String(value ?? '').split(',');
	return parts.map((part) => text(part)).filter((part) => part !== '');
}

function isSid(value: string, prefix: string): boolean {
	return value.length === SID_LENGTH && value.startsWith(prefix);
}

async function addPersonToTable(
	ctx: IExecuteFunctions,
	call: ApiCall,
	itemIndex: number,
): Promise<IDataObject> {
	const playtableSid = text(ctx.getNodeParameter('playtableSid', itemIndex, '', { extractValue: true }));
	if (!isSid(playtableSid, 'pt_tb_')) {
		throw new NodeOperationError(ctx.getNode(), 'Pick a table: a table ID starts with pt_tb_', {
			itemIndex,
		});
	}
	const body: IDataObject = { playtable_sid: playtableSid, on_duplicate: 'skip' };
	const put = (key: string, value: unknown) => {
		const clean = text(value);
		if (clean !== '') body[key] = clean;
	};
	put('full_name', ctx.getNodeParameter('fullName', itemIndex, ''));
	put('work_email', ctx.getNodeParameter('workEmail', itemIndex, ''));
	put('ln_member_id', ctx.getNodeParameter('lnMemberId', itemIndex, ''));
	put('ln_nickname', ctx.getNodeParameter('lnNickname', itemIndex, ''));
	const extra = ctx.getNodeParameter('additionalFields', itemIndex, {}) as IDataObject;
	put('company_name', extra.companyName);
	put('ln_id', extra.lnId);
	put('personal_email', extra.personalEmail);
	put('sn_id', extra.snId);
	put('work_phone_number', extra.workPhoneNumber);

	const answer = await call('POST', 'playtables', '/api/people', body);
	return { ...((answer.item as IDataObject | undefined) ?? {}), already_exists: answer.already_exists };
}

async function findPeople(
	ctx: IExecuteFunctions,
	call: ApiCall,
	itemIndex: number,
): Promise<IDataObject[]> {
	const findBy = ctx.getNodeParameter('findBy', itemIndex) as string;
	const filter: IDataObject = {};
	if (findBy === 'workEmail') {
		const email = text(ctx.getNodeParameter('workEmail', itemIndex)).toLowerCase();
		if (email === '') throw new NodeOperationError(ctx.getNode(), 'Enter a work email', { itemIndex });
		filter.work_email = { eq: email };
	} else if (findBy === 'lnMemberId') {
		const memberId = text(ctx.getNodeParameter('lnMemberId', itemIndex));
		if (memberId === '') {
			throw new NodeOperationError(ctx.getNode(), 'Enter a LinkedIn member ID', { itemIndex });
		}
		filter.ln_member_id = { eq: memberId };
	} else if (findBy === 'lnNickname') {
		const publicId = text(ctx.getNodeParameter('lnNickname', itemIndex)).toLowerCase();
		if (publicId === '') {
			throw new NodeOperationError(ctx.getNode(), 'Enter a LinkedIn public ID', { itemIndex });
		}
		if (publicId.includes('/')) {
			throw new NodeOperationError(
				ctx.getNode(),
				'Enter the LinkedIn public ID itself, not a profile link',
				{ itemIndex },
			);
		}
		filter.ln_nickname = { eq: publicId };
	} else {
		const query = text(ctx.getNodeParameter('query', itemIndex));
		if (query === '') throw new NodeOperationError(ctx.getNode(), 'Enter a search text', { itemIndex });
		if (query.length > 128) {
			throw new NodeOperationError(ctx.getNode(), 'The search text takes up to 128 characters', {
				itemIndex,
			});
		}
		filter.q = query;
	}

	const playtableSid = text(ctx.getNodeParameter('playtableSid', itemIndex, '', { extractValue: true }));
	if (playtableSid !== '') filter.playtable_sid = { eq: playtableSid };

	const options = ctx.getNodeParameter('options', itemIndex, {}) as IDataObject;
	const include: string[] = [];
	if (options.includeCompany === true) include.push('company');
	if (options.includeFieldValues === true) include.push('field_values');

	const body: IDataObject = { filter };
	if (include.length > 0) body.include = include;

	const maxResults = Math.max(1, Math.floor(Number(ctx.getNodeParameter('maxResults', itemIndex, 50))));
	const rows = await searchRows(call, 'playtables', '/api/people/search', body, maxResults);
	return rows.map(({ item, included }) =>
		include.length > 0 && included ? { ...item, included } : item,
	);
}

async function getMessage(
	ctx: IExecuteFunctions,
	call: ApiCall,
	itemIndex: number,
): Promise<IDataObject> {
	const messageSid = text(ctx.getNodeParameter('messageSid', itemIndex));
	if (!isSid(messageSid, 'ub_ms_')) {
		throw new NodeOperationError(ctx.getNode(), 'A message SID starts with ub_ms_', { itemIndex });
	}
	const page = await call('POST', 'unibox', '/api/messages/search', {
		filter: { sid: { eq: messageSid } },
		page_size: 1,
	});
	const message = firstItem(page);
	if (!message) {
		throw new NodeOperationError(ctx.getNode(), `No message ${messageSid} in this workspace`, {
			itemIndex,
		});
	}
	const conversationSid = text(message.conversation_sid);
	if (conversationSid === '') return { message, conversation: null, included: {} };

	const options = ctx.getNodeParameter('options', itemIndex, {}) as IDataObject;
	const include: string[] = [];
	if (options.includeParticipants !== false) include.push('participants');
	if (options.includeRecentMessages === true) include.push('messages_tail');
	const query = include.map((name) => `include%5B%5D=${encodeURIComponent(name)}`).join('&');
	const path = `/api/conversations/${encodeURIComponent(conversationSid)}${query ? `?${query}` : ''}`;
	const conversation = await call('GET', 'unibox', path);
	return {
		message,
		conversation: (conversation.item as IDataObject | undefined) ?? null,
		included: (conversation.included as IDataObject | undefined) ?? {},
	};
}

export class GetSales implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'GetSales',
		name: 'getSales',
		icon: { light: 'file:getsales.svg', dark: 'file:getsales.dark.svg' },
		group: ['transform'],
		version: 1,
		subtitle: '={{$parameter["operation"] + ": " + $parameter["resource"]}}',
		description: 'Add people to GetSales tables and workflows, find people and read messages',
		defaults: { name: 'GetSales' },
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
		usableAsTool: true,
		credentials: [{ name: 'getSalesApi', required: true }],
		properties: [
			{
				displayName: 'Resource',
				name: 'resource',
				type: 'options',
				noDataExpression: true,
				options: [
					{ name: 'Message', value: 'message' },
					{ name: 'Person', value: 'person' },
					{ name: 'Workflow', value: 'workflow' },
				],
				default: 'person',
			},
			...personOperations,
			...personFields,
			...workflowOperations,
			...workflowFields,
			...messageOperations,
			...messageFields,
		],
	};

	methods = {
		listSearch: {
			searchTables,
			searchWorkflows,
		},
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const resource = this.getNodeParameter('resource', 0) as string;
		const operation = this.getNodeParameter('operation', 0) as string;
		const call = bindApiCall(this);
		const returnData: INodeExecutionData[] = [];

		if (resource === 'workflow' && operation === 'addPeople') {
			// One call per GetSales workflow for every input item together, not one per item.
			const groups = new Map<string, { sids: string[]; itemIndexes: number[] }>();
			for (let i = 0; i < items.length; i++) {
				try {
					const workflowSid = text(this.getNodeParameter('workflowSid', i, '', { extractValue: true }));
					if (!isSid(workflowSid, 'wf_wf_')) {
						throw new NodeOperationError(this.getNode(), 'Pick a workflow: its ID starts with wf_wf_', {
							itemIndex: i,
						});
					}
					const sids = parsePersonSids(this.getNodeParameter('personSid', i));
					if (sids.length === 0) {
						throw new NodeOperationError(this.getNode(), 'Enter a person SID', { itemIndex: i });
					}
					const invalid = sids.find((sid) => !isSid(sid, 'cr_pp_'));
					if (invalid !== undefined) {
						throw new NodeOperationError(
							this.getNode(),
							`"${invalid}" is not a person SID: it starts with cr_pp_ and has 18 characters`,
							{ itemIndex: i },
						);
					}
					const group = groups.get(workflowSid) ?? { sids: [], itemIndexes: [] };
					group.sids.push(...sids);
					group.itemIndexes.push(i);
					groups.set(workflowSid, group);
				} catch (error) {
					if (this.continueOnFail()) {
						returnData.push({ json: { error: (error as Error).message }, pairedItem: { item: i } });
						continue;
					}
					throw new NodeOperationError(this.getNode(), error as Error, { itemIndex: i });
				}
			}

			for (const [workflowSid, group] of groups) {
				const pairedItem = group.itemIndexes.map((item) => ({ item }));
				try {
					const summary = await addPeopleToWorkflow(call, workflowSid, group.sids);
					returnData.push({ json: summary, pairedItem });
				} catch (error) {
					if (this.continueOnFail()) {
						returnData.push({
							json: { error: (error as Error).message, workflow_sid: workflowSid },
							pairedItem,
						});
						continue;
					}
					if (error instanceof NodeApiError) {
						const apiError = new NodeApiError(this.getNode(), error as unknown as JsonObject, {
							itemIndex: group.itemIndexes[0],
						});
						apiError.context.itemIndex = group.itemIndexes[0];
						throw apiError;
					}
					throw new NodeOperationError(this.getNode(), error as Error, {
						itemIndex: group.itemIndexes[0],
					});
				}
			}
			return [returnData];
		}

		for (let i = 0; i < items.length; i++) {
			try {
				if (resource === 'person' && operation === 'addToTable') {
					const person = await addPersonToTable(this, call, i);
					returnData.push({ json: person, pairedItem: { item: i } });
				} else if (resource === 'person' && operation === 'find') {
					const people = await findPeople(this, call, i);
					for (const person of people) {
						returnData.push({ json: person, pairedItem: { item: i } });
					}
				} else if (resource === 'message' && operation === 'get') {
					const message = await getMessage(this, call, i);
					returnData.push({ json: message, pairedItem: { item: i } });
				} else {
					throw new NodeOperationError(
						this.getNode(),
						`The operation "${operation}" is not known for "${resource}"`,
						{ itemIndex: i },
					);
				}
			} catch (error) {
				if (this.continueOnFail()) {
					returnData.push({ json: { error: (error as Error).message }, pairedItem: { item: i } });
					continue;
				}
				if (error instanceof NodeApiError) {
					const apiError = new NodeApiError(this.getNode(), error as unknown as JsonObject, {
						itemIndex: i,
					});
					apiError.context.itemIndex = i;
					throw apiError;
				}
				throw new NodeOperationError(this.getNode(), error as Error, { itemIndex: i });
			}
		}
		return [returnData];
	}
}
