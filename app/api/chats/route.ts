import { chainsForSelection, formatChainLine } from "@/src/core";
import { newGraphContextMessage, type GraphContextPick } from "@/src/core";
import { MAX_IMPORT_BODY_BYTES, MAX_IMPORT_BYTES } from "@/lib/notes-import-limits";
import { compactionInFlight, createChat, FormBodyLimitError, isTurnRunning, listChats, readBoundedForm, readSettingsRecord, stageSessionDocuments, startDocumentExtraction, stores, titleFromPrompt, type StagedDocument } from "@/src/server";
import type { ChatListItem } from "@/src/core";

/** The session picker's list: record-derived summaries (phase, pending
 *  question) + live liveness — a running turn marks the session busy
 *  (contracts.ts ChatListItem; the store can't see liveness, the route is
 *  the merge point). Owner, minimal-color round: background jobs NO LONGER
 *  count — the sidebar's Background agents section is their channel now
 *  (a running spinner per row would double-signal them), so busy means
 *  exactly "a teach turn is in flight". */
	export async function GET(req?: Request) {
	const archivedOnly = req?.url ? new URL(req.url).searchParams.get("archived") === "true" : false;
	const includeArchived = req?.url ? new URL(req.url).searchParams.get("includeArchived") === "true" : false;
	let placements: ReturnType<typeof stores.chatOrganizationStore.read>["placements"];
	try {
		placements = stores.chatOrganizationStore.read().placements;
	} catch (error) {
		return Response.json({ error: (error as Error).message }, { status: 500 });
	}
	const chats: ChatListItem[] = listChats()
		.filter((chat) => archivedOnly ? Boolean(placements[chat.id]?.archivedAt) : includeArchived || !placements[chat.id]?.archivedAt)
		.map((c) => ({
		...c,
		busy: isTurnRunning(c.id),
		compacting: compactionInFlight(c.id),
		}));
	return Response.json({ chats });
}

export async function POST(req: Request) {
	let body: { title?: unknown; kind?: unknown; graphContext?: unknown; folderId?: unknown };
	let files: File[] = [];
	if ((req.headers.get("content-type") ?? "").includes("multipart/form-data")) {
		let form: FormData;
		try {
			form = await readBoundedForm(req, MAX_IMPORT_BODY_BYTES);
		} catch (error) {
			const oversized = error instanceof FormBodyLimitError;
			return Response.json({ error: oversized ? "Session documents are too large. Attach fewer or smaller files." : "Could not read the request. Try sending again." }, { status: oversized ? 413 : 400 });
		}
		try {
			body = typeof form.get("request") === "string" ? JSON.parse(form.get("request") as string) : {};
		} catch {
			return Response.json({ error: "Invalid session request." }, { status: 400 });
		}
		files = form.getAll("files").filter((file): file is File => file instanceof File);
		if (!files.length) return Response.json({ error: "no files" }, { status: 400 });
		if (files.reduce((total, file) => total + file.size, 0) > MAX_IMPORT_BYTES) return Response.json({ error: "Session documents are too large. Max 25 MB in total." }, { status: 413 });
	} else {
		body = (await req.json().catch(() => ({}))) as typeof body;
	}
	const title = typeof body.title === "string" ? body.title : "";
	if (body.folderId !== undefined && body.folderId !== null && typeof body.folderId !== "string") {
		return Response.json({ error: "Invalid folder ID." }, { status: 400 });
	}
	const folderId = typeof body.folderId === "string" && body.folderId.trim() ? body.folderId.trim() : null;
	let organization: ReturnType<typeof stores.chatOrganizationStore.read> | null = null;
	if (folderId) {
		try {
			organization = stores.chatOrganizationStore.read();
		} catch (error) {
			return Response.json({ error: (error as Error).message }, { status: 500 });
		}
		const folder = organization.folders.find((entry) => entry.id === folderId);
		if (!folder || folder.archivedAt) return Response.json({ error: "Destination folder no longer exists or is archived." }, { status: 400 });
	}
	// Practice sessions (owner, 2026-10-04): kind "practice" marks the
	// record — the practice agent + its tools from turn 1, no extraction.
	const kind = body.kind === "practice" ? ("practice" as const) : undefined;
	if (files.length && kind === "practice") return Response.json({ error: "Documents can only be attached to teaching sessions." }, { status: 400 });
	let documents: StagedDocument[] = [];
	if (files.length) {
		const staged = await stageSessionDocuments(files);
		if (!staged.ok) return Response.json({ error: staged.error }, { status: 400 });
		documents = staged.documents;
	}
	const chat = createChat(titleFromPrompt(title || "Untitled session"), kind, documents.map(({ text: _text, notice: _notice, ...ref }) => ref));
	// PER-SESSION MODELS (owner, 2026-09-28): a session owns its model +
	// thinking level from birth — stamped verbatim from the STRONG slot,
	// the new-session default. From here the strong slot never reaches
	// this session again: in-session picks write the session's own record
	// (PUT /api/chats/:id/settings). No strong slot configured (fresh BYOK
	// boot) → no stamp; the turn gate's 503 models_not_configured envelope
	// refuses honestly until the setup flow fills the slot.
	const strong = readSettingsRecord()?.models?.strong;
	if (strong?.model) {
		stores.chatStore.saveSettings(chat.id, {
			model: { provider: strong.model.provider, id: strong.model.id },
			thinkingLevel: strong.thinkingLevel,
		});
	}
	// The session's map context (owner, 2026-10-04): the picked
	// propositions ride the CREATION — message[0] is a graph-context
	// marker (a separate custom message BEFORE the learner's first user
	// message), carrying the picks plus the reasoning chains among them.
	// The picks carry their own name/statement (what the learner saw at
	// pick time); the chains derive from the CURRENT graph snapshot.
	const rawPicks = (body.graphContext as { propositions?: unknown } | undefined)?.propositions;
	const picks: GraphContextPick[] = Array.isArray(rawPicks)
		? rawPicks
				.filter(
						(p): p is GraphContextPick =>
							typeof p === "object" &&
							p !== null &&
							typeof (p as GraphContextPick).id === "string" &&
							typeof (p as GraphContextPick).name === "string" &&
							typeof (p as GraphContextPick).statement === "string",
					)
					.slice(0, 64)
			: [];
	if (picks.length > 0) {
		const byId = new Map(stores.graphStore.readNodes().map((n) => [n.id, n]));
		const pickedNodes = picks.map((p) => byId.get(p.id)).filter((n) => n !== undefined);
		const chainLines = chainsForSelection(pickedNodes, stores.graphStore.readChains()).map((c) =>
			formatChainLine(c, Object.fromEntries(byId)),
		);
		stores.chatStore.saveMessages(chat.id, [newGraphContextMessage(picks, chainLines)]);
	}
	if (folderId && organization) {
		organization.placements = { ...organization.placements, [chat.id]: { folderId } };
		try {
			stores.chatOrganizationStore.write(organization);
		} catch (error) {
			console.error(`[chat ${chat.id}] initial folder placement failed:`, error);
			return Response.json({ error: "Session created, but could not place it in the selected folder." }, { status: 500 });
		}
	}
	if (documents.length) startDocumentExtraction(documents);
	return Response.json({ id: chat.id, title: chat.title });
}
