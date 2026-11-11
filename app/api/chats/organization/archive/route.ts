import {
	chatDirectory,
	readChatOrganizationAction,
	ChatOrganizationInputError,
} from "@/src/server";

export const dynamic = "force-dynamic";

export async function GET() {
	try {
		return Response.json(chatDirectory.readArchived());
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
