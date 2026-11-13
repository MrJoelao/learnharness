/** Process-local cancellation registry for interactive topic organization. */
interface TopicAbortGlobal {
	__lhTopicOrganizationAborts?: Map<string, AbortController>;
}

function registry(): Map<string, AbortController> {
	const g = globalThis as typeof globalThis & TopicAbortGlobal;
	return (g.__lhTopicOrganizationAborts ??= new Map());
}

export function registerTopicOrganizationAbort(id: string, controller: AbortController): void {
	registry().set(id, controller);
}

export function unregisterTopicOrganizationAbort(id: string): void {
	registry().delete(id);
}

export function abortTopicOrganization(id: string): boolean {
	const controller = registry().get(id);
	if (!controller) return false;
	registry().delete(id);
	controller.abort();
	return true;
}
