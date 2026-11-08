import type { INodeProperties } from 'n8n-workflow';

export const personOperations: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: ['person'] } },
		options: [
			{
				name: 'Add to Table',
				value: 'addToTable',
				action: 'Add a person to a table',
				description:
					'Add a person to one of your tables. A person GetSales already has is returned as it is, not changed.',
			},
			{
				name: 'Find',
				value: 'find',
				action: 'Find people',
				description: 'Look people up in your workspace by work email, LinkedIn IDs or free text',
			},
		],
		default: 'addToTable',
	},
];

const addToTable = { resource: ['person'], operation: ['addToTable'] };
const find = { resource: ['person'], operation: ['find'] };

export const personFields: INodeProperties[] = [
	// ----- Person: Add to Table -----
	{
		displayName: 'Table Name or ID',
		name: 'playtableSid',
		type: 'options',
		typeOptions: { loadOptionsMethod: 'getTables' },
		required: true,
		displayOptions: { show: addToTable },
		default: '',
		description:
			'The table the person joins. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
	},
	{
		displayName: 'Full Name',
		name: 'fullName',
		type: 'string',
		displayOptions: { show: addToTable },
		default: '',
		placeholder: 'Maya Lindqvist',
	},
	{
		displayName: 'Work Email',
		name: 'workEmail',
		type: 'string',
		displayOptions: { show: addToTable },
		default: '',
		placeholder: 'name@email.com',
	},
	{
		displayName: 'LinkedIn Member ID',
		name: 'lnMemberId',
		type: 'string',
		displayOptions: { show: addToTable },
		default: '',
		placeholder: '784512309',
		description: 'The numeric member ID, the strongest key GetSales matches a person on',
	},
	{
		displayName: 'LinkedIn Public ID',
		name: 'lnNickname',
		type: 'string',
		displayOptions: { show: addToTable },
		default: '',
		placeholder: 'maya-lindqvist-4b2a1',
		description:
			'The public ID of the profile. GetSales also takes a full profile link here, keeps only the ID and never stores the link.',
	},
	{
		displayName: 'Additional Fields',
		name: 'additionalFields',
		type: 'collection',
		placeholder: 'Add Field',
		displayOptions: { show: addToTable },
		default: {},
		options: [
			{
				displayName: 'Company Name',
				name: 'companyName',
				type: 'string',
				default: '',
			},
			{
				displayName: 'LinkedIn Profile URN',
				name: 'lnId',
				type: 'string',
				default: '',
				placeholder: 'ACoAAB4kq3EBc2Xh7Lw9pRtYv5sNmQe8uZo1aKd',
				description: 'The profile URN that starts with ACoAA',
			},
			{
				displayName: 'Personal Email',
				name: 'personalEmail',
				type: 'string',
				default: '',
				placeholder: 'name@email.com',
			},
			{
				displayName: 'Sales Navigator Profile URN',
				name: 'snId',
				type: 'string',
				default: '',
				placeholder: 'ACwAAB4kq3EBc2Xh7Lw9pRtYv5sNmQe8uZo1aKd',
				description: 'The profile URN that starts with ACwAA',
			},
			{
				displayName: 'Work Phone',
				name: 'workPhoneNumber',
				type: 'string',
				default: '',
				placeholder: '+4915112345678',
				description: 'A phone number, E.164 preferred',
			},
		],
	},

	// ----- Person: Find -----
	{
		displayName: 'Find By',
		name: 'findBy',
		type: 'options',
		displayOptions: { show: find },
		options: [
			{
				name: 'Free Text',
				value: 'query',
				description: 'Search names, company names, emails and public IDs',
			},
			{
				name: 'LinkedIn Member ID',
				value: 'lnMemberId',
			},
			{
				name: 'LinkedIn Public ID',
				value: 'lnNickname',
			},
			{
				name: 'Work Email',
				value: 'workEmail',
			},
		],
		default: 'workEmail',
	},
	{
		displayName: 'Work Email',
		name: 'workEmail',
		type: 'string',
		required: true,
		displayOptions: { show: { ...find, findBy: ['workEmail'] } },
		default: '',
		placeholder: 'name@email.com',
	},
	{
		displayName: 'LinkedIn Member ID',
		name: 'lnMemberId',
		type: 'string',
		required: true,
		displayOptions: { show: { ...find, findBy: ['lnMemberId'] } },
		default: '',
		placeholder: '784512309',
	},
	{
		displayName: 'LinkedIn Public ID',
		name: 'lnNickname',
		type: 'string',
		required: true,
		displayOptions: { show: { ...find, findBy: ['lnNickname'] } },
		default: '',
		placeholder: 'maya-lindqvist-4b2a1',
		description: 'The public ID of the profile, matched exactly. Enter the ID itself, not a link.',
	},
	{
		displayName: 'Search Text',
		name: 'query',
		type: 'string',
		required: true,
		displayOptions: { show: { ...find, findBy: ['query'] } },
		default: '',
		placeholder: 'Lindqvist',
		description: 'Up to 128 characters',
	},
	{
		displayName: 'Table Name or ID',
		name: 'playtableSid',
		type: 'options',
		typeOptions: { loadOptionsMethod: 'getTables' },
		displayOptions: { show: find },
		default: '',
		description:
			'Look only in this table, or leave empty for every table. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
	},
	{
		displayName: 'Max Results',
		name: 'maxResults',
		type: 'number',
		typeOptions: { minValue: 1 },
		displayOptions: { show: find },
		default: 50,
		description: 'Max number of people to return',
	},
	{
		displayName: 'Options',
		name: 'options',
		type: 'collection',
		placeholder: 'Add Option',
		displayOptions: { show: find },
		default: {},
		options: [
			{
				displayName: 'Include Company',
				name: 'includeCompany',
				type: 'boolean',
				default: false,
				description: 'Whether to attach the company of each person under included.company',
			},
			{
				displayName: 'Include Table Columns',
				name: 'includeFieldValues',
				type: 'boolean',
				default: false,
				description:
					"Whether to attach the person's cells in the custom columns of their table under included.field_values",
			},
		],
	},
];
