import { directoryService, readDirectoryAction, DirectoryInputError } from "@/src/server";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
	try {
		const url = new URL(request.url);
		if (url.searchParams.get("archived") === "true" || url.searchParams.get("view") === "archived") {
			return Response.json(directoryService.readArchived());
		}
		const includeArchived = url.searchParams.get("includeArchived") === "true";
		return Response.json(directoryService.read({ includeArchived }));
	} catch (error) {
		return Response.json({ error: (error as Error).message }, { status: 500 });
	}
}

export async function POST(request: Request) {
	try {
		const action = await readDirectoryAction(request);
		const result = directoryService.change(action);
		return Response.json(result);
	} catch (error) {
		if (error instanceof DirectoryInputError) {
			return Response.json({ error: error.message }, { status: 400 });
		}
		return Response.json({ error: (error as Error).message }, { status: 500 });
	}
}
