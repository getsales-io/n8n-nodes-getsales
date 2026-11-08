/**
 * The GetSales API host, written once. The credential test, the GetSales node
 * and the GetSales Trigger build every request from this constant, so moving
 * the nodes to another host is a one-line edit here.
 */
export const GETSALES_API_HOST = 'https://api2.getsales.io';

/** The services the nodes call. Each one serves its routes under /{service}/v1. */
export type GetSalesService = 'playtables' | 'unibox' | 'integrations';

/** Full URL of a route, for example apiUrl('playtables', '/api/people'). */
export function apiUrl(service: GetSalesService, path: string): string {
	return `${GETSALES_API_HOST}/${service}/v1${path}`;
}
