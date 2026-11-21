import { keyValue } from "@/src/server/keys.ts";
import { checkAntigravityAvailable, checkCodexAvailable } from "@/src/server";

export const runtime = "nodejs";

export async function GET() {
	const deepgram = !!keyValue("DEEPGRAM_API_KEY");
	const [codex, antigravity] = await Promise.all([
		checkCodexAvailable(),
		checkAntigravityAvailable(),
	]);

	return Response.json(
		{ deepgram, codex, antigravity },
		{ headers: { "Cache-Control": "no-store" } },
	);
}
