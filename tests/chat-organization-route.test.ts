import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { after, it } from "node:test";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "lh-chat-organization-"));
process.env.LH_DATA_DIR = root;
process.env.LH_AUTH_FILE = path.join(root, "auth.json");
fs.writeFileSync(process.env.LH_AUTH_FILE, "{}\n");
after(() => fs.rmSync(root, { recursive: true, force: true }));

const { GET: getOrg, POST: postOrg } = await import("../app/api/chats/organization/route.ts");
const { GET: getArchive } = await import("../app/api/chats/organization/archive/route.ts");
const { GET: getChats } = await import("../app/api/chats/route.ts");
const { stores } = await import("../src/server/stores.ts");
const { CHAT_ORGANIZATION_FILE } = await import("../config.ts");
const { subscribe } = await import("../src/core/events.ts");

const change = (action: unknown) =>
	postOrg(
		new Request("http://localhost/api/chats/organization", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(action),
		}),
	);

const hashFile = (file: string) => {
	if (!fs.existsSync(file)) return null;
	return createHash("sha256").update(fs.readFileSync(file)).digest("hex");
};

it("GET /api/chats/organization is a non-writing read and inventories legacy chats in Unorganized", async () => {
	const before = await getOrg(new Request("http://localhost/api/chats/organization"));
	assert.equal(before.status, 200);
	const data = await before.json();
	assert.deepEqual(data.chats, []);
	assert.deepEqual(data.organization.folders, []);
	assert.equal(fs.existsSync(CHAT_ORGANIZATION_FILE), false, "GET must not write to disk");

	// Create legacy chats with no metadata
	const chat1 = stores.chatStore.createChat("Legacy 1");
	const chat2 = stores.chatStore.createChat("Legacy 2");

	const res = await getOrg(new Request("http://localhost/api/chats/organization"));
	const body = await res.json();
	assert.equal(body.chats.length, 2);
	const c1 = body.chats.find((c: { id: string }) => c.id === chat1.id);
	const c2 = body.chats.find((c: { id: string }) => c.id === chat2.id);
	assert.equal(c1.folderId, null, "legacy chat has folderId null (Unorganized)");
	assert.equal(c2.folderId, null, "legacy chat has folderId null (Unorganized)");
	assert.equal(c1.archivedAt, null);
	assert.equal(c2.archivedAt, null);
	assert.equal(fs.existsSync(CHAT_ORGANIZATION_FILE), false, "remains non-writing read");
});

it("folder creation, sibling ordering, and moving chats persist without modifying ChatRecords or graph files", async () => {
	const chat1 = stores.chatStore.createChat("Physics Chat");
	const chat2 = stores.chatStore.createChat("Math Chat");

	// Record file hashes before organization mutation
	const chat1Path = path.join(root, "chats", `${chat1.id}.json`);
	const chat2Path = path.join(root, "chats", `${chat2.id}.json`);
	const chat1HashBefore = hashFile(chat1Path);
	const chat2HashBefore = hashFile(chat2Path);

	// Track event emissions
	const events: string[] = [];
	const unsub = subscribe((e) => events.push(e.type));

	// Create folder
	const createdRes = await change({ action: "create-folder", name: "Science", parentId: null });
	assert.equal(createdRes.status, 200);
	const createdData = await createdRes.json();
	assert.ok(createdData.createdFolderId, "creation returns createdFolderId");
	const folderId = createdData.createdFolderId;

	// Verify events emitted
	assert.ok(events.includes("chat-organization-changed"));
	assert.ok(events.includes("chats-changed"));
	unsub();

	// Move chats into folder with sibling ordering
	assert.equal((await change({ action: "move", kind: "chat", id: chat1.id, parentId: folderId, targetOrder: 0 })).status, 200);
	assert.equal((await change({ action: "move", kind: "chat", id: chat2.id, parentId: folderId, targetOrder: 1 })).status, 200);

	// Verify ChatRecord files are 100% untouched
	assert.equal(hashFile(chat1Path), chat1HashBefore, "chat1 ChatRecord file MUST NOT be modified");
	assert.equal(hashFile(chat2Path), chat2HashBefore, "chat2 ChatRecord file MUST NOT be modified");

	// Verify metadata file exists and contains placements
	assert.ok(fs.existsSync(CHAT_ORGANIZATION_FILE));
	const orgData = await (await getOrg(new Request("http://localhost/api/chats/organization"))).json();
	assert.equal(orgData.organization.placements[chat1.id].folderId, folderId);
	assert.equal(orgData.organization.placements[chat2.id].folderId, folderId);
});

it("archive folder subtree and browse archived items, then restore retains hierarchy", async () => {
	const parentFolder = (await (await change({ action: "create-folder", name: "University", parentId: null })).json()).createdFolderId;
	const childFolder = (await (await change({ action: "create-folder", name: "Semester 1", parentId: parentFolder })).json()).createdFolderId;

	const chatUni = stores.chatStore.createChat("Campus Orientation");
	const chatSem = stores.chatStore.createChat("Linear Algebra");

	await change({ action: "move", kind: "chat", id: chatUni.id, parentId: parentFolder });
	await change({ action: "move", kind: "chat", id: chatSem.id, parentId: childFolder });

	// Archive the entire University folder subtree
	const archiveRes = await change({ action: "archive", kind: "folder", id: parentFolder });
	assert.equal(archiveRes.status, 200);

	// Verify active GET hides archived chats
	const activeList = await (await getOrg(new Request("http://localhost/api/chats/organization"))).json();
	assert.ok(!activeList.chats.some((c: { id: string }) => c.id === chatUni.id));
	assert.ok(!activeList.chats.some((c: { id: string }) => c.id === chatSem.id));

	// Browse archived items via ?archived=true
	const archiveQuery = await (await getOrg(new Request("http://localhost/api/chats/organization?archived=true"))).json();
	assert.ok(archiveQuery.folders.some((f: { id: string }) => f.id === parentFolder));
	assert.ok(archiveQuery.folders.some((f: { id: string }) => f.id === childFolder));
	assert.ok(archiveQuery.chats.some((c: { id: string }) => c.id === chatUni.id));
	assert.ok(archiveQuery.chats.some((c: { id: string }) => c.id === chatSem.id));

	// Browse archived items via dedicated /api/chats/organization/archive
	const archiveRouteRes = await (await getArchive()).json();
	assert.ok(archiveRouteRes.folders.some((f: { id: string }) => f.id === parentFolder));
	assert.ok(archiveRouteRes.chats.some((c: { id: string }) => c.id === chatSem.id));

	// Restore the University folder subtree
	const restoreRes = await change({ action: "restore", kind: "folder", id: parentFolder });
	assert.equal(restoreRes.status, 200);

	// Verify restored active list retains hierarchy
	const restoredData = await (await getOrg(new Request("http://localhost/api/chats/organization"))).json();
	const fChild = restoredData.organization.folders.find((f: { id: string }) => f.id === childFolder);
	assert.equal(fChild.parentId, parentFolder);
	assert.equal(fChild.archivedAt, null);

	const restoredUniChat = restoredData.chats.find((c: { id: string }) => c.id === chatUni.id);
	const restoredSemChat = restoredData.chats.find((c: { id: string }) => c.id === chatSem.id);
	assert.equal(restoredUniChat.folderId, parentFolder);
	assert.equal(restoredSemChat.folderId, childFolder);
	assert.equal(restoredUniChat.archivedAt, null);
	assert.equal(restoredSemChat.archivedAt, null);
});

it("missing-parent restore places chat in Unorganized if original folder no longer exists", async () => {
	const tempFolder = (await (await change({ action: "create-folder", name: "Temp Folder", parentId: null })).json()).createdFolderId;
	const chat = stores.chatStore.createChat("Solo Session");

	await change({ action: "move", kind: "chat", id: chat.id, parentId: tempFolder });
	await change({ action: "archive", kind: "chat", id: chat.id });

	// Delete the folder now that chat is archived (or force delete in metadata)
	const org = stores.chatOrganizationStore.read();
	org.folders = org.folders.filter((f) => f.id !== tempFolder);
	stores.chatOrganizationStore.write(org);

	// Restore chat
	const res = await change({ action: "restore", kind: "chat", id: chat.id });
	assert.equal(res.status, 200);

	const after = await (await getOrg(new Request("http://localhost/api/chats/organization"))).json();
	const restoredChat = after.chats.find((c: { id: string }) => c.id === chat.id);
	assert.equal(restoredChat.folderId, null, "must restore to Unorganized (folderId null)");
	assert.equal(restoredChat.archivedAt, null);
});

it("server validates cycles, stale IDs, and non-empty folder deletions", async () => {
	const f1 = (await (await change({ action: "create-folder", name: "F1", parentId: null })).json()).createdFolderId;
	const f2 = (await (await change({ action: "create-folder", name: "F2", parentId: f1 })).json()).createdFolderId;

	// Cycle / descendant move rejected with 400
	assert.equal((await change({ action: "move", kind: "folder", id: f1, parentId: f2 })).status, 400);
	assert.equal((await change({ action: "move", kind: "folder", id: f1, parentId: f1 })).status, 400);

	// Stale / non-existent folder
	assert.equal((await change({ action: "move", kind: "folder", id: f1, parentId: "nonexistent" })).status, 400);
	assert.equal((await change({ action: "move", kind: "chat", id: "nonexistent", parentId: f1 })).status, 400);

	// Non-empty folder deletion rejected with 400
	assert.equal((await change({ action: "delete-folder", id: f1 })).status, 400);

	// Delete child folder, then parent can be deleted
	assert.equal((await change({ action: "delete-folder", id: f2 })).status, 200);
	assert.equal((await change({ action: "delete-folder", id: f1 })).status, 200);
});

it("malformed and oversized requests refuse with 400 before metadata writes", async () => {
	const beforeBytes = fs.readFileSync(CHAT_ORGANIZATION_FILE, "utf8");

	// Invalid JSON
	assert.equal(
		(await postOrg(new Request("http://localhost/api/chats/organization", { method: "POST", body: "{" }))).status,
		400,
	);

	// Oversized body (>64KB)
	assert.equal(
		(
			await postOrg(
				new Request("http://localhost/api/chats/organization", {
					method: "POST",
					headers: { "Content-Length": "70000" },
					body: "x".repeat(70000),
				}),
			)
		).status,
		400,
	);

	assert.equal(fs.readFileSync(CHAT_ORGANIZATION_FILE, "utf8"), beforeBytes);
});

it("newer/corrupt data refuses reads and writes with 500 without overwriting file", async () => {
	const beforeBytes = fs.readFileSync(CHAT_ORGANIZATION_FILE, "utf8");
	try {
		for (const corrupt of ["{", '{"version":99,"folders":[],"placements":{}}']) {
			fs.writeFileSync(CHAT_ORGANIZATION_FILE, corrupt);
			assert.equal((await getOrg(new Request("http://localhost/api/chats/organization"))).status, 500);
			assert.equal(
				(await change({ action: "create-folder", name: "Do Not Write", parentId: null })).status,
				500,
			);
			assert.equal(fs.readFileSync(CHAT_ORGANIZATION_FILE, "utf8"), corrupt);
		}
	} finally {
		fs.writeFileSync(CHAT_ORGANIZATION_FILE, beforeBytes);
	}
});

it("GET /api/chats filters out archived chats unless requested", async () => {
	const activeChat = stores.chatStore.createChat("Active Conversation");
	const archivedChat = stores.chatStore.createChat("Archived Conversation");

	await change({ action: "archive", kind: "chat", id: archivedChat.id });

	// Default GET /api/chats hides archivedChat
	const defaultRes = await (await getChats(new Request("http://localhost/api/chats"))).json();
	assert.ok(defaultRes.chats.some((c: { id: string }) => c.id === activeChat.id));
	assert.ok(!defaultRes.chats.some((c: { id: string }) => c.id === archivedChat.id));

	// GET /api/chats?archived=true returns only archivedChat
	const archivedRes = await (await getChats(new Request("http://localhost/api/chats?archived=true"))).json();
	assert.ok(!archivedRes.chats.some((c: { id: string }) => c.id === activeChat.id));
	assert.ok(archivedRes.chats.some((c: { id: string }) => c.id === archivedChat.id));
});
