import { pluginTransport } from "@/src/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type RouteContext = { params: Promise<{ id: string; key: string }> };
export async function GET(request: Request, context: RouteContext) {
	const { id, key } = await context.params;
	return pluginTransport.workspaceState(id, key, request, "get");
}
export async function PUT(request: Request, context: RouteContext) {
	const { id, key } = await context.params;
	return pluginTransport.workspaceState(id, key, request, "set");
}
export async function DELETE(request: Request, context: RouteContext) {
	const { id, key } = await context.params;
	return pluginTransport.workspaceState(id, key, request, "delete");
}
