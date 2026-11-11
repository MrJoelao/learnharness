import {
	chatDirectory,
	readChatOrganizationAction,
	ChatOrganizationInputError,
} from "@/src/server";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
	try {
		const url = new URL(request.url);
		const archived = url.searchParams.get("archived") === "true" || url.searchParams.get("view") === "archived";
		if (archived) {
			return Response.json(chatDirectory.readArchived());
		}
		const includeArchived = url.searchParams.get("includeArchived") === "true";
		return Response.json(chatDirectory.read({ includeArchived }));
	} catch (error) {
		return Response.json({ error: (error as Error).message }, { status: 500 });
	}
}

export async function POST(request: Request) {
	try {
		const action = await readChatOrganizationAction(request);
		const result = chatDirectory.change(action);
		return Response.json(result);
	} catch (error) {
		if (error instanceof ChatOrganizationInputError) {
			return Response.json({ error: error.message }, { status: 400 });
		}
		return Response.json({ error: (error as Error).message }, { status: 500 });
	}
}
