import { pluginTransport } from "@/src/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(_request: Request, context: { params: Promise<{ id: string; file: string[] }> }) {
	const { id, file } = await context.params;
	const res = await pluginTransport.asset(id, file);
	if (res.status === 404 && file.length > 0 && file[0] !== "assets") {
		try {
			const fallbackRes = await pluginTransport.asset(id, ["assets", ...file]);
			if (fallbackRes.status === 200) return fallbackRes;
		} catch {
			// Return original 404 response
		}
	}
	return res;
}
