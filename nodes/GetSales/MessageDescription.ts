import type { INodeProperties } from 'n8n-workflow';

export const messageOperations: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: ['message'] } },
		options: [
			{
				name: 'Get',
				value: 'get',
				action: 'Get a message',
				description:
					'Read a message and its conversation by the message SID, for example right after a Reply Received trigger',
			},
		],
		default: 'get',
	},
];

const get = { resource: ['message'], operation: ['get'] };

export const messageFields: INodeProperties[] = [
	{
		displayName: 'Message SID',
		name: 'messageSid',
		type: 'string',
		required: true,
		displayOptions: { show: get },
		default: '',
		placeholder: 'ub_ms_Jk2mP9nR4qW1',
		description:
			'The message to read (ub_ms_...). After a GetSales Trigger, the event carries it as payload.sid.',
	},
	{
		displayName: 'Options',
		name: 'options',
		type: 'collection',
		placeholder: 'Add Option',
		displayOptions: { show: get },
		default: {},
		options: [
			{
				displayName: 'Include Participants',
				name: 'includeParticipants',
				type: 'boolean',
				default: true,
				description: 'Whether to attach the people in the conversation under included.participants',
			},
			{
				displayName: 'Include Recent Messages',
				name: 'includeRecentMessages',
				type: 'boolean',
				default: false,
				description:
					'Whether to attach the 30 newest messages of the conversation under included.messages_tail',
			},
		],
	},
];
