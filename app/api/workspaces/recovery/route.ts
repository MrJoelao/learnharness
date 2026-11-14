import { pluginTransport } from "@/src/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET() {
	return pluginTransport.inspectWorkspaces();
}

export function POST(request: Request) {
	return pluginTransport.recoverWorkspace(request);
}
