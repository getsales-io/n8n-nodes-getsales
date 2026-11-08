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
		displayName: 'Workflow',
		name: 'workflowSid',
		type: 'resourceLocator',
		required: true,
		displayOptions: { show: addPeople },
		default: { mode: 'list', value: '' },
		description: 'An active, published GetSales workflow',
		modes: [
			{
				displayName: 'From List',
				name: 'list',
				type: 'list',
				placeholder: 'Select a workflow...',
				typeOptions: { searchListMethod: 'searchWorkflows', searchable: true },
			},
			{
				displayName: 'By ID',
				name: 'id',
				type: 'string',
				placeholder: 'e.g. wf_wf_Q7mN2pL4xR8t',
				validation: [
					{
						type: 'regex',
						properties: {
							regex: '^wf_wf_[A-Za-z0-9]{12}$',
							errorMessage: 'A GetSales workflow ID starts with wf_wf_ and has 18 characters',
						},
					},
				],
			},
		],
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
