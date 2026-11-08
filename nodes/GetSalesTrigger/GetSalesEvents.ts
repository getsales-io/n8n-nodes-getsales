import type { INodePropertyOptions } from 'n8n-workflow';

/**
 * The full event catalog: the events enum of create_webhook in the integrations
 * OpenAPI document, in the order the document lists them.
 */
export const EVENT_CATALOG: INodePropertyOptions[] = [
	{
		name: 'data-sources.completed',
		value: 'data-sources.completed',
		description: 'A data source finished collecting, with its counts',
	},
	{ name: 'data-sources.failed', value: 'data-sources.failed', description: 'A data source failed' },
	{ name: 'data-sources.paused', value: 'data-sources.paused', description: 'A data source was paused' },
	{
		name: 'data-sources.deleted',
		value: 'data-sources.deleted',
		description: 'A data source was deleted',
	},
	{
		name: 'playtable-runs.finished',
		value: 'playtable-runs.finished',
		description: 'An enrich, import, export or bulk run in a table ended',
	},
	{
		name: 'playtable-runs.cancelled',
		value: 'playtable-runs.cancelled',
		description: 'A run in a table was cancelled',
	},
	{
		name: 'workflows.published',
		value: 'workflows.published',
		description: 'A version of a GetSales workflow was published',
	},
	{
		name: 'workflow-records.entered',
		value: 'workflow-records.entered',
		description: 'A person entered a GetSales workflow',
	},
	{
		name: 'workflow-records.completed',
		value: 'workflow-records.completed',
		description: 'A person finished a GetSales workflow',
	},
	{
		name: 'workflow-records.failed',
		value: 'workflow-records.failed',
		description: "A person's run through a GetSales workflow failed",
	},
	{
		name: 'workflow-records.exited',
		value: 'workflow-records.exited',
		description: 'A person left a GetSales workflow',
	},
	{
		name: 'workflow-records.paused',
		value: 'workflow-records.paused',
		description: "A person's run was paused, for example on a reply",
	},
	{
		name: 'workflow-records.resumed',
		value: 'workflow-records.resumed',
		description: "A paused person's run went on",
	},
	{
		name: 'messages.sent',
		value: 'messages.sent',
		description: 'A message from one of your sender profiles went out',
	},
	{
		name: 'messages.received',
		value: 'messages.received',
		description: 'A new inbound message arrived in the inbox',
	},
	{ name: 'messages.bounced', value: 'messages.bounced', description: 'An email bounced' },
	{
		name: 'conversations.created',
		value: 'conversations.created',
		description: 'A new conversation started',
	},
	{
		name: 'conversations.state-changed',
		value: 'conversations.state-changed',
		description: 'A conversation changed state, for example to needs you or done',
	},
	{
		name: 'conversations.scenario-changed',
		value: 'conversations.scenario-changed',
		description: 'Your AI SDR read a conversation as a new scenario',
	},
	{
		name: 'conversations.merged',
		value: 'conversations.merged',
		description: 'Two conversations were merged',
	},
	{
		name: 'conversations.person-linked',
		value: 'conversations.person-linked',
		description: 'A participant of a conversation was linked to a person',
	},
	{
		name: 'conversations.person-unlinked',
		value: 'conversations.person-unlinked',
		description: 'The link between a participant and a person was removed',
	},
	{
		name: 'conversations.signals-changed',
		value: 'conversations.signals-changed',
		description: 'The named signals of a conversation changed',
	},
	{
		name: 'tasks.created',
		value: 'tasks.created',
		description: "A task was created, your AI SDR's hand-offs included",
	},
	{ name: 'tasks.completed', value: 'tasks.completed', description: 'A task was completed' },
	{
		name: 'sender-profiles.created',
		value: 'sender-profiles.created',
		description: 'A sender profile was created',
	},
	{
		name: 'sender-profiles.deleted',
		value: 'sender-profiles.deleted',
		description: 'A sender profile was deleted',
	},
	{
		name: 'sender-profiles.health-changed',
		value: 'sender-profiles.health-changed',
		description: 'The channel status of a sender profile changed',
	},
	{
		name: 'agents.mode-changed',
		value: 'agents.mode-changed',
		description: 'Your AI SDR switched its mode',
	},
	{
		name: 'signals.website-visited',
		value: 'signals.website-visited',
		description: 'A website visit was matched to a person or a company',
	},
	{
		name: 'website-sites.broken',
		value: 'website-sites.broken',
		description: "A site's tracking script stopped reporting",
	},
	{
		name: 'website-sites.recovered',
		value: 'website-sites.recovered',
		description: "A site's tracking script reports again",
	},
	{
		name: 'webhooks.failed',
		value: 'webhooks.failed',
		description: 'A subscription was switched off after its deliveries failed',
	},
];

export const CATALOG_EVENT_TYPES: string[] = EVENT_CATALOG.map((option) => String(option.value));

/** The value of the Trigger On option that opens the multi-select over the whole catalog. */
export const ANY_EVENTS = 'anyEvents';

/** The named triggers and the catalog events each one subscribes to. */
const EVENT_SHORTCUTS: Record<string, string[]> = {
	conversationStateChanged: ['conversations.state-changed'],
	importOrSearchFinished: ['playtable-runs.finished', 'data-sources.completed'],
	leadFinishedOrLeftWorkflow: ['workflow-records.completed', 'workflow-records.exited'],
	replyReceived: ['messages.received'],
	taskCreated: ['tasks.created'],
	websiteVisitIdentified: ['signals.website-visited'],
};

/**
 * The catalog events a trigger subscribes to, sorted and unique: the events of a named
 * trigger, or the ones picked under Any of These Events. Anything outside the catalog
 * is dropped, since the API refuses the whole subscription for one unknown name.
 */
export function resolveEvents(triggerOn: string, picked: unknown): string[] {
	const wanted =
		triggerOn === ANY_EVENTS
			? (Array.isArray(picked) ? picked : []).map((value) => String(value))
			: (EVENT_SHORTCUTS[triggerOn] ?? []);
	return [...new Set(wanted.filter((event) => CATALOG_EVENT_TYPES.includes(event)))].sort();
}

/** Whether two event lists hold the same events, whatever their order. */
export function sameEvents(left: unknown, right: string[]): boolean {
	if (!Array.isArray(left)) return false;
	const a = [...new Set(left.map((value) => String(value)))].sort();
	return a.length === right.length && a.every((event, index) => event === right[index]);
}
