import { isPluginHostError } from "./plugin-host.ts";
import { apiRequestRefusal } from "./desktop-access.ts";
import type { PluginFrontendContext, PluginInfo, PluginModeMetadata } from "../core/plugins.ts";
import type { WorkspaceRecord } from "../core/workspaces.ts";

/** Thin HTTP adapter, separately injectable so its tests never boot plugins. */
export interface PluginTransportHost {
	list(): PluginInfo[];
	modes(): PluginModeMetadata[];
	createWorkspace(input: { pluginId: string; modeId: string; title?: string }): Promise<WorkspaceRecord>;
	workspaceState(id: string, key: string, operation: "get" | "set" | "delete", value?: unknown): { found: boolean; value?: unknown };
	renameWorkspace(id: string, title: string): WorkspaceRecord;
	deleteWorkspace(id: string): Promise<void>;
	conflicts(): { id: string; error: string }[];
	refresh(): Promise<void>;
	setEnabled(id: string, enabled: boolean): Promise<void>;
	call(id: string, operation: string, input: unknown): Promise<unknown>;
	convertDocument(id: string, request: Request): ReturnType<PluginFrontendContext["documents"]["toMarkdown"]>;
	asset(id: string, segments: string[]): { bytes: Uint8Array; contentType: string };
}
class InputError extends Error {}
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
async function objectBody(request: Request, maxBytes = 1_048_576): Promise<Record<string, unknown>> {
	let body: unknown;
	try {
		const text = await request.text();
		if (new TextEncoder().encode(text).byteLength > maxBytes) throw new InputError("Request body is too large");
		body = JSON.parse(text);
	} catch (error) { if (error instanceof InputError) throw error; throw new InputError("Expected a JSON object"); }
	if (!body || typeof body !== "object" || Array.isArray(body)) throw new InputError("Expected a JSON object");
	return body as Record<string, unknown>;
}
export function createPluginTransport(deps: { getHost(): Promise<PluginTransportHost>; directory: string }) {
	const guarded = async (handle: () => Promise<Response>) => {
		try { return await handle(); }
		catch (error) {
			const status = error instanceof InputError ? 400 : isPluginHostError(error) ? error.status : 500;
			return json({ error: error instanceof Error || isPluginHostError(error) ? error.message : "Plugin request failed" }, status);
		}
	};
	const catalog = (host: PluginTransportHost) => ({ plugins: host.list(), directory: deps.directory, conflicts: host.conflicts() });
	return {
		list: () => guarded(async () => json(catalog(await deps.getHost()))),
		modes: () => guarded(async () => json({ modes: (await deps.getHost()).modes() })),
		createWorkspace: (request: Request) => guarded(async () => {
			const body = await objectBody(request);
			if (Object.keys(body).some(key => !["pluginId", "modeId", "title"].includes(key)) || typeof body.pluginId !== "string" || typeof body.modeId !== "string" || (body.title !== undefined && typeof body.title !== "string")) throw new InputError("Invalid workspace creation request");
			return json({ workspace: await (await deps.getHost()).createWorkspace({ pluginId: body.pluginId, modeId: body.modeId, ...(body.title === undefined ? {} : { title: body.title }) }) });
		}),
		workspaceTitle: (id: string, request: Request) => guarded(async () => {
			const body = await objectBody(request);
			if (Object.keys(body).length !== 1 || typeof body.title !== "string") throw new InputError("Expected a workspace title");
			return json({ workspace: (await deps.getHost()).renameWorkspace(id, body.title) });
		}),
		deleteWorkspace: (id: string, _request: Request) => guarded(async () => {
			await (await deps.getHost()).deleteWorkspace(id);
			return json({ ok: true });
		}),
		workspaceState: (id: string, key: string, request: Request, operation: "get" | "set" | "delete") => guarded(async () => {
			const host = await deps.getHost();
			if (operation === "get" || operation === "delete") return json(host.workspaceState(id, key, operation));
			const body = await objectBody(request, 2_097_152);
			if (Object.keys(body).length !== 1 || !Object.hasOwn(body, "value")) throw new InputError("Expected a value field");
			return json(host.workspaceState(id, key, operation, body.value));
		}),
		refresh: (request: Request) => guarded(async () => {
			const body = await objectBody(request);
			if (body.action !== "refresh") throw new InputError("Expected action: refresh");
			const host = await deps.getHost();
			await host.refresh();
			return json(catalog(host));
		}),
		setEnabled: (id: string, request: Request) => guarded(async () => {
			const body = await objectBody(request);
			if (typeof body.enabled !== "boolean") throw new InputError("enabled must be a boolean");
			const host = await deps.getHost();
			await host.setEnabled(id, body.enabled);
			return json(catalog(host));
		}),
		call: (id: string, request: Request) => guarded(async () => {
			const body = await objectBody(request);
			if (typeof body.operation !== "string" || !body.operation.trim()) throw new InputError("operation must be a nonempty string");
			const host = await deps.getHost();
			return json({ result: (await host.call(id, body.operation, body.input)) ?? null });
		}),
		convertDocument: (id: string, request: Request) => guarded(async () => json(await (await deps.getHost()).convertDocument(id, request))),
		asset: (id: string, segments: string[]) => guarded(async () => {
			const { bytes, contentType } = (await deps.getHost()).asset(id, segments);
			return new Response(new Uint8Array(bytes), { headers: { "Content-Type": contentType, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
		}),
	};
}

/** This one streamed route must avoid Proxy's silently truncated body clone.
 * Preserve the identical mode-aware API policy before ANY params/body/host
 * work, including unsupported methods and framework-style OPTIONS responses. */
export function createPluginDocumentRoute(transport: Pick<ReturnType<typeof createPluginTransport>, "convertDocument">) {
	const refusal = (request: Request) => {
		const error = apiRequestRefusal(request);
		return error ? json({ error }, 403) : undefined;
	};
	const unsupported = (request: Request) => refusal(request) ?? new Response(null, { status: 405 });
	return {
		async POST(request: Request, context: { params: Promise<{ id: string }> }) {
			const denied = refusal(request);
			if (denied) return denied;
			return transport.convertDocument((await context.params).id, request);
		},
		OPTIONS: (request: Request) => refusal(request) ?? new Response(null, { status: 204, headers: { Allow: "OPTIONS, POST" } }),
		GET: unsupported, HEAD: unsupported, PUT: unsupported, PATCH: unsupported, DELETE: unsupported,
	};
}
