import { pluginTransport } from "@/src/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function PUT(request: Request, context: { params: Promise<{ id: string }> }) {
	return pluginTransport.workspaceTitle((await context.params).id, request);
}
export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
	return pluginTransport.deleteWorkspace((await context.params).id, request);
}
