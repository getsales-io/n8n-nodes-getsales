import type { IDataObject } from 'n8n-workflow';

import type { ApiCall } from './GenericFunctions';

/** add-people takes at most this many people in one call. */
export const ADD_PEOPLE_BATCH_SIZE = 500;

/** What one Add people run did for one GetSales workflow. */
export interface AddPeopleSummary extends IDataObject {
	workflow_sid: string;
	workflow_source_sid: string;
	workflow_source_created: boolean;
	people_requested: number;
	people_already_enrolled: number;
	batches: number;
	result: IDataObject;
}

export function chunk<T>(values: T[], size: number): T[][] {
	const chunks: T[][] = [];
	for (let start = 0; start < values.length; start += size) {
		chunks.push(values.slice(start, start + size));
	}
	return chunks;
}

/** Adds every numeric counter of the add-people results, key by key. */
export function sumResults(results: IDataObject[]): IDataObject {
	const total: IDataObject = {};
	for (const result of results) {
		for (const [key, value] of Object.entries(result)) {
			if (typeof value === 'number') total[key] = ((total[key] as number | undefined) ?? 0) + value;
		}
	}
	return total;
}

/**
 * Adds people to a published GetSales workflow by its sid, in batches of at most 500.
 * GetSales takes them through the workflow's manual source (it makes one, named
 * Hand-picked, when there is none) and leaves everyone the workflow holds already as
 * they are, a finished journey too, so a retried or repeated run re-runs nobody. The
 * key needs to add people to workflows, nothing more.
 */
export async function addPeopleToWorkflow(
	call: ApiCall,
	workflowSid: string,
	peopleSids: string[],
): Promise<AddPeopleSummary> {
	const requested = [...new Set(peopleSids)];
	const results: IDataObject[] = [];
	let sourceSid = '';
	let sourceCreated = false;
	for (const batch of chunk(requested, ADD_PEOPLE_BATCH_SIZE)) {
		const answer = await call(
			'POST',
			'playtables',
			`/api/workflows/${encodeURIComponent(workflowSid)}/add-people`,
			{ people_sids: batch },
		);
		const result = (answer.result as IDataObject | undefined) ?? {};
		const item = (answer.item as IDataObject | undefined) ?? {};
		if (typeof item.sid === 'string') sourceSid = item.sid;
		if (result.source_created === true) sourceCreated = true;
		results.push(result);
	}
	const total = sumResults(results);

	return {
		workflow_sid: workflowSid,
		workflow_source_sid: sourceSid,
		workflow_source_created: sourceCreated,
		people_requested: requested.length,
		people_already_enrolled: (total.skipped_enrolled_count as number | undefined) ?? 0,
		batches: results.length,
		result: total,
	};
}
