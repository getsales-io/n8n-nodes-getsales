import type {
	IAuthenticateGeneric,
	Icon,
	ICredentialTestRequest,
	ICredentialType,
	INodeProperties,
} from 'n8n-workflow';

import { apiUrl } from '../shared/host';

export class GetSalesApi implements ICredentialType {
	name = 'getSalesApi';

	// n8n's lint asks for the { light, dark } form. The red GetSales mark shows up on both
	// canvases, so the two files hold the same drawing.
	icon: Icon = { light: 'file:getsales.svg', dark: 'file:getsales.dark.svg' };

	displayName = 'GetSales API';

	documentationUrl = 'https://docs.getsales.io/authentication';

	properties: INodeProperties[] = [
		{
			displayName: 'API Key',
			name: 'apiKey',
			type: 'string',
			typeOptions: { password: true },
			required: true,
			default: '',
			description:
				'Create a key in GetSales under Settings, API keys, with the Automation platform preset. The secret starts with gs_live_ and is shown once.',
		},
	];

	authenticate: IAuthenticateGeneric = {
		type: 'generic',
		properties: {
			headers: {
				Authorization: '=Bearer {{$credentials.apiKey}}',
			},
		},
	};

	// The Test button runs a table search with page_size 0. GetSales answers it with counts
	// and no rows, so the check reads nothing from the workspace beyond proving the key.
	test: ICredentialTestRequest = {
		request: {
			url: apiUrl('playtables', '/api/playtables/search'),
			method: 'POST',
			body: { page_size: 0 },
		},
	};
}
