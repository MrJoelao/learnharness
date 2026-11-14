import { pluginTransport, workspaceService } from "@/src/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(request: Request) {
	const url = new URL(request.url);
	if (url.searchParams.get("inspect") === "true") {
		return pluginTransport.inspectWorkspaces();
	}
	return Response.json(workspaceService.list());
}

export function POST(request: Request) {
	return pluginTransport.createWorkspace(request);
}
