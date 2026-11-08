import type { INodeProperties } from 'n8n-workflow';

export const workflowOperations: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: ['workflow'] } },
		options: [
			{
				name: 'Add People',
				value: 'addPeople',
				action: 'Add people to a workflow',
				description:
					'Enroll people in a published GetSales workflow, skipping the ones it already has',
			},
		],
		default: 'addPeople',
	},
];

const addPeople = { resource: ['workflow'], operation: ['addPeople'] };

export const workflowFields: INodeProperties[] = [
	{
		displayName:
			'All input items go out together: one summary item per GetSales workflow. Everyone the workflow holds already is left as they are, a finished journey too, so a retried or repeated run re-runs nobody.',
		name: 'addPeopleNotice',
		type: 'notice',
		displayOptions: { show: addPeople },
		default: '',
	},
	{
		displayName: 'Workflow Name or ID',
		name: 'workflowSid',
		type: 'options',
		typeOptions: { loadOptionsMethod: 'getWorkflows' },
		required: true,
		displayOptions: { show: addPeople },
		default: '',
		description:
			'An active, published GetSales workflow. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
	},
	{
		displayName: 'Person SID',
		name: 'personSid',
		type: 'string',
		required: true,
		displayOptions: { show: addPeople },
		default: '',
		placeholder: 'cr_pp_8Hq2LmZ4tR7w',
		description:
			'The GetSales person to add (cr_pp_...), usually the sid from a GetSales node before this one. Several SIDs may be given separated by commas.',
	},
];
