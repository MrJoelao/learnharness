/**
 * POST /api/graph/topics/refresh — trigger the LLM topic-assign pass.
 *
 * Runs synchronously (waits for the LLM to finish) since the UI shows a
 * loading spinner during the call. For large graphs with many chunks this
 * could take 10–30s, which is acceptable for a user-initiated action.
 *
 * Returns { topics: number } on success, or { error } on failure.
 */
import { refreshGraphTopics } from "@/src/server";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
	let mode: "full" | "delta" = "full";
	try {
		const body: unknown = await req.json();
		if (typeof body === "object" && body !== null && "mode" in body && body.mode === "delta") {
			mode = "delta";
		}
	} catch {
		// Empty body or non-JSON request: defaults to full re-organization
	}

	const result = await refreshGraphTopics({ mode });
	if ("error" in result) {
		const status = result.status ?? 500;
		return Response.json(
			{ error: result.error, ...(result.code ? { code: result.code } : {}) },
			{ status },
		);
	}
	return Response.json(result);
}
