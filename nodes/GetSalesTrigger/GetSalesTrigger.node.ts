import type {
	IDataObject,
	IHookFunctions,
	INodeType,
	INodeTypeDescription,
	IWebhookFunctions,
	IWebhookResponseData,
	JsonObject,
} from 'n8n-workflow';
import { NodeApiError, NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';

import { apiErrorCode, apiErrorExistingSid, apiErrorStatus, getSalesApiRequest } from '../GetSales/GenericFunctions';
import { ANY_EVENTS, EVENT_CATALOG, resolveEvents, sameEvents } from './GetSalesEvents';
import { verifySignature } from './GetSalesSignature';

const TRIGGER_LABELS: Record<string, string> = {
	anyEvents: 'Any of These Events',
	conversationStateChanged: 'Conversation State Changed',
	importOrSearchFinished: 'Import or Search Finished',
	leadFinishedOrLeftWorkflow: 'Lead Finished or Left a Workflow',
	replyReceived: 'Reply Received',
	taskCreated: 'Task Created',
	websiteVisitIdentified: 'Website Visit Identified',
};

type TriggerContext = IHookFunctions | IWebhookFunctions;

function subscribedEvents(ctx: TriggerContext): string[] {
	const triggerOn = ctx.getNodeParameter('triggerOn', 'replyReceived') as string;
	const picked = triggerOn === ANY_EVENTS ? ctx.getNodeParameter('events', []) : [];
	return resolveEvents(triggerOn, picked);
}

/** Compares two target URLs the way the API does: case-blind, default port dropped. */
function sameTarget(left: unknown, right: string): boolean {
	const normalize = (value: string) => {
		try {
			const url = new URL(value);
			return `${url.protocol}//${url.host}${url.pathname}${url.search}`.toLowerCase();
		} catch {
			return value.toLowerCase();
		}
	};
	return typeof left === 'string' && normalize(left) === normalize(right);
}

function subscriptionName(ctx: IHookFunctions): string {
	const triggerOn = ctx.getNodeParameter('triggerOn', 'replyReceived') as string;
	const workflow = ctx.getWorkflow();
	const label = TRIGGER_LABELS[triggerOn] ?? triggerOn;
	const name = `n8n: ${workflow.name ?? workflow.id ?? 'workflow'} (${label})`;
	return name.slice(0, 255);
}

function forget(ctx: IHookFunctions): void {
	const data = ctx.getWorkflowStaticData('node');
	delete data.webhookSid;
	delete data.webhookSecret;
}

async function unsubscribe(ctx: IHookFunctions, sid: string): Promise<void> {
	await getSalesApiRequest.call(ctx, 'DELETE', 'integrations', `/api/webhooks/${encodeURIComponent(sid)}`);
}

async function subscribe(ctx: IHookFunctions, body: IDataObject): Promise<{ sid: string; secret: string }> {
	for (let attempt = 1; attempt <= 2; attempt++) {
		let answer: IDataObject;
		try {
			answer = await getSalesApiRequest.call(ctx, 'POST', 'integrations', '/api/webhooks', body);
		} catch (error) {
			// GetSales keeps one subscription per target URL in a workspace, and its 409 names
			// the one holding this URL: a subscription that outlived the node's own record of it.
			const holder = apiErrorCode(error) === 'duplicate_rejected' ? apiErrorExistingSid(error) : undefined;
			if (attempt === 1 && holder) {
				ctx.logger.info(`GetSales Trigger: this URL is subscribed already, replacing subscription ${holder}`);
				await unsubscribe(ctx, holder);
				continue;
			}
			throw new NodeApiError(ctx.getNode(), error as JsonObject);
		}
		const item = (answer.item as IDataObject | undefined) ?? {};
		if (typeof item.sid === 'string' && typeof item.secret === 'string' && item.secret !== '') {
			return { sid: item.sid, secret: item.secret };
		}
		// Without the secret no delivery can be verified, so this subscription is no use.
		if (typeof item.sid === 'string') await unsubscribe(ctx, item.sid);
	}
	throw new NodeOperationError(
		ctx.getNode(),
		'GetSales did not return the secret of the new subscription, so its deliveries could not be verified',
	);
}

export class GetSalesTrigger implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'GetSales Trigger',
		name: 'getSalesTrigger',
		icon: { light: 'file:getsales.svg', dark: 'file:getsales.dark.svg' },
		group: ['trigger'],
		version: 1,
		subtitle: '={{$parameter["triggerOn"]}}',
		description: 'Starts the workflow on GetSales events: replies, tasks, website visits and more',
		defaults: { name: 'GetSales Trigger' },
		inputs: [],
		outputs: [NodeConnectionTypes.Main],
		credentials: [{ name: 'getSalesApi', required: true }],
		webhooks: [
			{
				name: 'default',
				httpMethod: 'POST',
				responseMode: 'onReceived',
				path: 'webhook',
			},
		],
		properties: [
			{
				displayName: 'Trigger On',
				name: 'triggerOn',
				type: 'options',
				noDataExpression: true,
				options: [
					{
						name: 'Any of These Events',
						value: 'anyEvents',
						description: 'Pick any events of the GetSales catalog',
					},
					{
						name: 'Conversation State Changed',
						value: 'conversationStateChanged',
						description: 'A conversation moved to another state, for example to needs you or done',
					},
					{
						name: 'Import or Search Finished',
						value: 'importOrSearchFinished',
						description: 'A run in a table ended, or a data source finished collecting',
					},
					{
						name: 'Lead Finished or Left a Workflow',
						value: 'leadFinishedOrLeftWorkflow',
						description: 'A person finished a GetSales workflow or left it',
					},
					{
						name: 'Reply Received',
						value: 'replyReceived',
						description: 'A new inbound message arrived. Read its text with the Message: Get action.',
					},
					{
						name: 'Task Created',
						value: 'taskCreated',
						description: "A task was created for your team, your AI SDR's hand-offs included",
					},
					{
						name: 'Website Visit Identified',
						value: 'websiteVisitIdentified',
						description: 'A website visit was matched to a person or a company',
					},
				],
				default: 'replyReceived',
			},
			{
				displayName: 'Events',
				name: 'events',
				type: 'multiOptions',
				required: true,
				displayOptions: { show: { triggerOn: ['anyEvents'] } },
				options: [...EVENT_CATALOG].sort((a, b) => a.name.localeCompare(b.name)),
				default: [],
				description: 'The GetSales events that start this workflow',
			},
		],
	};

	webhookMethods = {
		default: {
			async checkExists(this: IHookFunctions): Promise<boolean> {
				const data = this.getWorkflowStaticData('node');
				const sid = typeof data.webhookSid === 'string' ? data.webhookSid : '';
				if (sid === '') return false;

				let item: IDataObject;
				try {
					const answer = await getSalesApiRequest.call(
						this,
						'GET',
						'integrations',
						`/api/webhooks/${encodeURIComponent(sid)}`,
					);
					item = (answer.item as IDataObject | undefined) ?? {};
				} catch (error) {
					if (apiErrorStatus(error) === '404' || apiErrorCode(error) === 'not_found') {
						this.logger.info(`GetSales Trigger: subscription ${sid} is gone, a new one will be made`);
						forget(this);
						return false;
					}
					throw new NodeApiError(this.getNode(), error as JsonObject);
				}

				const targetUrl = this.getNodeWebhookUrl('default') ?? '';
				const current =
					item.status === 'on' &&
					!item.deleted_at &&
					sameTarget(item.target_url, targetUrl) &&
					sameEvents(item.events, subscribedEvents(this)) &&
					typeof data.webhookSecret === 'string' &&
					data.webhookSecret !== '';
				if (current) return true;

				// Another URL, other events, switched off or failed: replace it with a fresh one.
				this.logger.info(`GetSales Trigger: subscription ${sid} is out of date, replacing it`);
				await unsubscribe(this, sid);
				forget(this);
				return false;
			},

			async create(this: IHookFunctions): Promise<boolean> {
				const targetUrl = this.getNodeWebhookUrl('default');
				if (!targetUrl) {
					throw new NodeOperationError(this.getNode(), 'n8n gave this trigger no webhook URL');
				}
				const events = subscribedEvents(this);
				if (events.length === 0) {
					throw new NodeOperationError(this.getNode(), 'Pick at least one event');
				}
				const { sid, secret } = await subscribe(this, {
					name: subscriptionName(this),
					target_url: targetUrl,
					events,
				});
				const data = this.getWorkflowStaticData('node');
				data.webhookSid = sid;
				data.webhookSecret = secret;
				return true;
			},

			async delete(this: IHookFunctions): Promise<boolean> {
				const data = this.getWorkflowStaticData('node');
				const sid = typeof data.webhookSid === 'string' ? data.webhookSid : '';
				if (sid !== '') {
					try {
						await unsubscribe(this, sid);
					} catch (error) {
						// Deactivation goes ahead whatever GetSales answers. The common cause is a
						// subscription someone already removed in the app, and the warning keeps
						// any other cause visible in the n8n log.
						this.logger.warn(
							`GetSales Trigger: deactivated, but subscription ${sid} was not removed (${(error as Error).message})`,
						);
					}
					forget(this);
				}
				return true;
			},
		},
	};

	async webhook(this: IWebhookFunctions): Promise<IWebhookResponseData> {
		const request = this.getRequestObject();
		const response = this.getResponseObject();
		const data = this.getWorkflowStaticData('node');

		const verdict = verifySignature({
			rawBody: request.rawBody,
			header: this.getHeaderData()['x-webhook-signature'],
			secret: typeof data.webhookSecret === 'string' ? data.webhookSecret : undefined,
			nowSeconds: Math.floor(Date.now() / 1000),
		});
		if (!verdict.valid) {
			this.logger.warn(`GetSales Trigger: refused a delivery (${verdict.reason})`);
			response.status(401).json({ error: 'invalid_signature', reason: verdict.reason });
			return { noWebhookResponse: true };
		}

		const body = this.getBodyData();
		const type = typeof body.type === 'string' ? body.type : '';
		if (!subscribedEvents(this).includes(type)) {
			// A test delivery (webhooks.test) or an event this trigger no longer listens to.
			response.status(200).json({ received: true, ignored: type || 'unknown' });
			return { noWebhookResponse: true };
		}

		return { workflowData: [this.helpers.returnJsonArray(body)] };
	}
}
