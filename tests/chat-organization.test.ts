import assert from "node:assert/strict";
import { it } from "node:test";
import {
	applyChatOrganizationAction,
	canMoveChatFolder,
	chatFolderIsEmpty,
	emptyChatOrganization,
	parseChatOrganization,
	parseChatOrganizationAction,
	chatPlacementOf,
	type ChatOrganization,
} from "../src/core/chat-organization.ts";

let sequence = 0;
const fresh = () => ({ id: `folder_${++sequence}`, createdAt: "2026-11-06T00:00:00.000Z" });

const apply = (
	state: ChatOrganization,
	raw: unknown,
	chatIds = ["c1", "c2", "c3"],
): ChatOrganization => {
	const action = parseChatOrganizationAction(raw);
	return applyChatOrganizationAction(state, action, new Set(chatIds), fresh());
};

it("empty organization has version 1, empty folders, and empty placements", () => {
	const empty = emptyChatOrganization();
	assert.equal(empty.version, 1);
	assert.deepEqual(empty.folders, []);
	assert.deepEqual(empty.placements, {});
	assert.deepEqual(parseChatOrganization(empty), empty);
});

it("action validation rejects invalid shapes and trims non-empty names", () => {
	for (const raw of [
		null,
		[],
		{},
		{ action: "create-folder", name: "", parentId: null },
		{ action: "create-folder", name: "   ", parentId: null },
		{ action: "rename-folder", id: "", name: "Valid" },
		{ action: "move", kind: "unknown", id: "x", parentId: null },
		{ action: "move", kind: "chat", id: "", parentId: null },
		{ action: "archive", kind: "invalid", id: "x" },
		{ action: "restore", kind: "invalid", id: "x" },
	]) {
		assert.throws(() => parseChatOrganizationAction(raw));
	}

	assert.deepEqual(
		parseChatOrganizationAction({ action: "create-folder", name: "  Projects  ", parentId: null }),
		{ action: "create-folder", name: "Projects", parentId: null },
	);
	assert.deepEqual(
		parseChatOrganizationAction({ action: "rename-folder", id: "f1", name: "  Renamed  " }),
		{ action: "rename-folder", id: "f1", name: "Renamed" },
	);
});

it("corrupt or newer version organization refuses to load", () => {
	for (const raw of [
		{ version: 2, folders: [], placements: {} },
		{ version: 1, folders: [{ id: "f1", name: "F", parentId: "f1", createdAt: "x" }], placements: {} },
		{ version: 1, folders: [{ id: "f1", name: "F", parentId: "missing", createdAt: "x" }], placements: {} },
		{ version: 1, folders: [{ id: "f1", name: "F", parentId: null, createdAt: "x" }], placements: { c1: { folderId: 123 } } },
		{ version: 1, folders: [{ id: "f1", name: "F", parentId: null, createdAt: "x" }], placements: { c1: "invalid" } },
		{ version: 1, folders: [{ id: "", name: "F", parentId: null, createdAt: "x" }], placements: {} },
	]) {
		assert.throws(() => parseChatOrganization(raw), /invalid or newer/);
	}
});

it("arbitrary nested folders can be created, renamed, and ordered", () => {
	let state = emptyChatOrganization();
	state = apply(state, { action: "create-folder", name: "Root 1", parentId: null });
	const root1 = state.folders[0]!.id;
	state = apply(state, { action: "create-folder", name: "Root 2", parentId: null });
	const root2 = state.folders[1]!.id;
	state = apply(state, { action: "create-folder", name: "Sub 1", parentId: root1 });
	const sub1 = state.folders[2]!.id;
	state = apply(state, { action: "create-folder", name: "Sub 2", parentId: sub1 });
	const sub2 = state.folders[3]!.id;

	assert.equal(state.folders.length, 4);
	assert.equal(state.folders[2]!.parentId, root1);
	assert.equal(state.folders[3]!.parentId, sub1);

	// Renaming
	state = apply(state, { action: "rename-folder", id: sub2, name: "Deepest Sub" });
	assert.equal(state.folders.find((f) => f.id === sub2)?.name, "Deepest Sub");

	// Sibling reordering
	state = apply(state, { action: "reorder", kind: "folder", id: root2, targetOrder: 0 });
	assert.equal(state.folders.find((f) => f.id === root2)?.order, 0);

	state = apply(state, { action: "reorder-siblings", parentId: null, kind: "folder", ids: [root1, root2] });
	assert.equal(state.folders.find((f) => f.id === root1)?.order, 0);
	assert.equal(state.folders.find((f) => f.id === root2)?.order, 1);
});

it("only structurally empty folders can be deleted", () => {
	let state = emptyChatOrganization();
	state = apply(state, { action: "create-folder", name: "Parent", parentId: null });
	const parent = state.folders[0]!.id;
	state = apply(state, { action: "create-folder", name: "Child", parentId: parent });
	const child = state.folders[1]!.id;

	// Parent has a subfolder -> cannot delete
	assert.equal(chatFolderIsEmpty(state, parent, new Set()), false);
	assert.throws(() => apply(state, { action: "delete-folder", id: parent }), /Only empty folders/);

	// Place chat in child -> child cannot be deleted
	state = apply(state, { action: "move", kind: "chat", id: "c1", parentId: child });
	assert.equal(chatFolderIsEmpty(state, child, new Set(["c1"])), false);
	assert.throws(() => apply(state, { action: "delete-folder", id: child }), /Only empty folders/);

	// Move chat to root -> child becomes empty and can be deleted
	state = apply(state, { action: "move", kind: "chat", id: "c1", parentId: null });
	assert.equal(chatFolderIsEmpty(state, child, new Set(["c1"])), true);
	state = apply(state, { action: "delete-folder", id: child });
	assert.equal(state.folders.length, 1);

	// Now parent is empty and can be deleted
	assert.equal(chatFolderIsEmpty(state, parent, new Set(["c1"])), true);
	state = apply(state, { action: "delete-folder", id: parent });
	assert.equal(state.folders.length, 0);
});

it("stale sibling reorders do not move chats that have since changed folders", () => {
	let state = emptyChatOrganization();
	state = apply(state, { action: "create-folder", name: "First", parentId: null });
	state = apply(state, { action: "create-folder", name: "Second", parentId: null });
	const [first, second] = state.folders.map((f) => f.id);
	state = apply(state, { action: "move", kind: "chat", id: "c1", parentId: first });
	state = apply(state, { action: "move", kind: "chat", id: "c2", parentId: first });

	// A concurrent move happens after the reorder snapshot was captured.
	state = apply(state, { action: "move", kind: "chat", id: "c2", parentId: second });
	state = apply(state, {
		action: "reorder-siblings",
		kind: "chat",
		parentId: first,
		ids: ["c2", "c1"],
	});

	assert.equal(chatPlacementOf(state, "c2")?.folderId, second);
	assert.equal(chatPlacementOf(state, "c1")?.folderId, first);
});

it("invalid descendant moves are refused", () => {
	let state = emptyChatOrganization();
	state = apply(state, { action: "create-folder", name: "A", parentId: null });
	state = apply(state, { action: "create-folder", name: "B", parentId: state.folders[0]!.id });
	state = apply(state, { action: "create-folder", name: "C", parentId: state.folders[1]!.id });
	const [a, b, c] = state.folders.map((f) => f.id);

	// Folder into itself
	assert.equal(canMoveChatFolder(state, a!, a!), false);
	assert.throws(() => apply(state, { action: "move", kind: "folder", id: a, parentId: a }), /itself or its descendants/);

	// Folder into direct child
	assert.equal(canMoveChatFolder(state, a!, b!), false);
	assert.throws(() => apply(state, { action: "move", kind: "folder", id: a, parentId: b }), /itself or its descendants/);

	// Folder into grandchild
	assert.equal(canMoveChatFolder(state, a!, c!), false);
	assert.throws(() => apply(state, { action: "move", kind: "folder", id: a, parentId: c }), /itself or its descendants/);

	// Non-existent parent folder
	assert.throws(() => apply(state, { action: "move", kind: "folder", id: c, parentId: "gone" }), /Parent folder no longer exists/);
	assert.throws(() => apply(state, { action: "move", kind: "chat", id: "c1", parentId: "gone" }), /Parent folder no longer exists/);

	// Valid move upwards
	assert.equal(canMoveChatFolder(state, c!, null), true);
	state = apply(state, { action: "move", kind: "folder", id: c, parentId: null });
	assert.equal(state.folders.find((f) => f.id === c)?.parentId, null);

	// Restore destinations are validated with the same tree invariants.
	state = apply(state, { action: "archive", kind: "folder", id: a });
	assert.throws(
		() => apply(state, { action: "restore", kind: "folder", id: a, targetParentId: "missing" }),
		/Destination folder no longer exists/,
	);
	assert.throws(
		() => apply(state, { action: "restore", kind: "folder", id: a, targetParentId: b }),
		/itself or its descendants/,
	);
	assert.throws(
		() => parseChatOrganizationAction({ action: "restore", kind: "chat", id: "c1", targetParentId: 42 }),
		/Invalid destination folder/,
	);
});

it("archive tree archives folder subtree and restore retains hierarchy", () => {
	let state = emptyChatOrganization();
	state = apply(state, { action: "create-folder", name: "TreeRoot", parentId: null });
	const root = state.folders[0]!.id;
	state = apply(state, { action: "create-folder", name: "TreeChild", parentId: root });
	const child = state.folders[1]!.id;

	state = apply(state, { action: "move", kind: "chat", id: "c1", parentId: root });
	state = apply(state, { action: "move", kind: "chat", id: "c2", parentId: child });

	// Archive the whole TreeRoot subtree
	state = apply(state, { action: "archive", kind: "folder", id: root });

	const rootFolder = state.folders.find((f) => f.id === root);
	const childFolder = state.folders.find((f) => f.id === child);
	assert.ok(rootFolder?.archivedAt, "root folder must be archived");
	assert.ok(childFolder?.archivedAt, "child folder must be archived");
	assert.ok(chatPlacementOf(state, "c1")?.archivedAt, "c1 must be archived");
	assert.ok(chatPlacementOf(state, "c2")?.archivedAt, "c2 must be archived");

	// Hierarchy preserved while archived
	assert.equal(childFolder.parentId, root);
	assert.equal(chatPlacementOf(state, "c1")?.folderId, root);
	assert.equal(chatPlacementOf(state, "c2")?.folderId, child);

	// Restore the whole TreeRoot subtree
	state = apply(state, { action: "restore", kind: "folder", id: root });

	const restoredRoot = state.folders.find((f) => f.id === root);
	const restoredChild = state.folders.find((f) => f.id === child);
	assert.equal(restoredRoot?.archivedAt, null);
	assert.equal(restoredChild?.archivedAt, null);
	assert.equal(chatPlacementOf(state, "c1")?.archivedAt, null);
	assert.equal(chatPlacementOf(state, "c2")?.archivedAt, null);

	// Hierarchy retained
	assert.equal(restoredChild?.parentId, root);
	assert.equal(chatPlacementOf(state, "c1")?.folderId, root);
	assert.equal(chatPlacementOf(state, "c2")?.folderId, child);
});

it("missing-parent restore restores chat to Unorganized when original folder was deleted", () => {
	let state = emptyChatOrganization();
	state = apply(state, { action: "create-folder", name: "Temporary", parentId: null });
	const folderId = state.folders[0]!.id;

	// Place chat in folder, then archive it
	state = apply(state, { action: "move", kind: "chat", id: "c1", parentId: folderId });
	state = apply(state, { action: "archive", kind: "chat", id: "c1" });
	assert.equal(chatPlacementOf(state, "c1")?.folderId, folderId);

	// Now move c1 out of the folder conceptually in active list and delete the folder
	// (or folder was force deleted after entries cleared)
	state.folders = state.folders.filter((f) => f.id !== folderId);

	// Restore c1 when folder no longer exists
	state = apply(state, { action: "restore", kind: "chat", id: "c1" });
	assert.equal(chatPlacementOf(state, "c1")?.archivedAt, null);
	assert.equal(chatPlacementOf(state, "c1")?.folderId, null, "chat restored to Unorganized when parent folder is gone");
});

it("individual chat archive and restore unarchives parent folder to retain hierarchy", () => {
	let state = emptyChatOrganization();
	state = apply(state, { action: "create-folder", name: "Folder", parentId: null });
	const folderId = state.folders[0]!.id;

	state = apply(state, { action: "move", kind: "chat", id: "c1", parentId: folderId });
	// Archive the folder (which also archives c1)
	state = apply(state, { action: "archive", kind: "folder", id: folderId });
	assert.ok(state.folders.find((f) => f.id === folderId)?.archivedAt);
	assert.ok(chatPlacementOf(state, "c1")?.archivedAt);

	// Restore individual chat c1 without targetParentId:
	// Since folderId exists, it unarchives the folder chain to retain hierarchy!
	state = apply(state, { action: "restore", kind: "chat", id: "c1" });
	assert.equal(chatPlacementOf(state, "c1")?.archivedAt, null);
	assert.equal(chatPlacementOf(state, "c1")?.folderId, folderId);
	assert.equal(state.folders.find((f) => f.id === folderId)?.archivedAt, null);
});

it("legacy chats with no metadata remain in Unorganized without changing IDs", () => {
	const state = emptyChatOrganization();
	// Chat 'legacy_1' is not in placements
	assert.equal(chatPlacementOf(state, "legacy_1"), undefined);

	// Move legacy chat into a folder
	let next = apply(state, { action: "create-folder", name: "Legacy Folder", parentId: null });
	const folderId = next.folders[0]!.id;

	next = apply(next, { action: "move", kind: "chat", id: "legacy_1", parentId: folderId }, ["legacy_1"]);
	assert.deepEqual(chatPlacementOf(next, "legacy_1"), { folderId, order: 0 });

	// Archive legacy chat
	next = apply(next, { action: "archive", kind: "chat", id: "legacy_1" }, ["legacy_1"]);
	assert.ok(chatPlacementOf(next, "legacy_1")?.archivedAt);
	assert.equal(chatPlacementOf(next, "legacy_1")?.folderId, folderId);
});
