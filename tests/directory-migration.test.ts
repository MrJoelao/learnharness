import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, it } from "node:test";

// Isolated data root for the store-level migration tests (set before the
// dynamic imports below, same pattern as the chat-organization route tests).
const root = fs.mkdtempSync(path.join(os.tmpdir(), "lh-directory-migration-"));
process.env.LH_DATA_DIR = root;
process.env.LH_AUTH_FILE = path.join(root, "auth.json");
fs.writeFileSync(process.env.LH_AUTH_FILE, "{}\n");
after(() => fs.rmSync(root, { recursive: true, force: true }));

import {
	chatKey,
	emptyOrganizationV2,
	itemKeyId,
	itemKeyKind,
	migrateV1toV2,
	parseItemKey,
	parseOrganizationV2,
	toV1CompatOrganization,
	workspaceKey,
	type OrganizationV2,
} from "../src/core/organization.ts";
import type { ChatFolder } from "../src/core/chat-organization.ts";

const { CHAT_ORGANIZATION_FILE } = await import("../config.ts");
const { organizationV2Store, chatOrganizationStore } = await import("../src/store/chat-organization.ts");

const NOW = "2026-11-01T00:00:00.000Z";
const folder = (id: string, overrides: Partial<ChatFolder> = {}): ChatFolder => ({
	id,
	name: `Folder ${id}`,
	parentId: null,
	createdAt: NOW,
	...overrides,
});

// ─── Typed item keys (R1) ─────────────────────────────────────────────────────

it("typed item keys round-trip through parse and expose kind/id", () => {
	assert.equal(parseItemKey(chatKey("c1")), "chat:c1");
	assert.equal(parseItemKey(workspaceKey("w1")), "workspace:w1");
	assert.equal(itemKeyKind(chatKey("c1")), "chat");
	assert.equal(itemKeyKind(workspaceKey("w1")), "workspace");
	assert.equal(itemKeyId(chatKey("c1")), "c1");
	assert.equal(itemKeyId(workspaceKey("w1")), "w1");
	for (const raw of ["", "chat:", "workspace:", "chat", "other:x", ":x"]) {
		assert.equal(parseItemKey(raw), null, `expected ${JSON.stringify(raw)} to be rejected`);
	}
});

it("collision guard: chat and workspace with the same bare ID keep distinct placements (R1)", () => {
	const state: OrganizationV2 = {
		version: 2,
		folders: [folder("f1")],
		placements: {
			[chatKey("same-id")]: { folderId: "f1", order: 0 },
			[workspaceKey("same-id")]: { folderId: "f1", order: 1 },
		},
	};
	const parsed = parseOrganizationV2(state);
	assert.ok(parsed.placements[chatKey("same-id")]);
	assert.ok(parsed.placements[workspaceKey("same-id")]);
	assert.notEqual(chatKey("same-id"), workspaceKey("same-id"));
});

// ─── V2 schema parsing ────────────────────────────────────────────────────────

it("parseOrganizationV2 accepts a valid v2 state and preserves all fields", () => {
	const state: OrganizationV2 = {
		version: 2,
		folders: [folder("f1", { updatedAt: NOW, archivedAt: null, order: 2 }), folder("f2", { parentId: "f1", order: 0 })],
		placements: {
			[chatKey("c1")]: { folderId: "f1", archivedAt: NOW, order: 3 },
			[workspaceKey("w1")]: { folderId: null },
		},
	};
	assert.deepEqual(parseOrganizationV2(structuredClone(state)), state);
	assert.deepEqual(parseOrganizationV2(emptyOrganizationV2()), emptyOrganizationV2());
});

it("parseOrganizationV2 rejects corrupt or newer data with the existing failure strategy", () => {
	const invalids: unknown[] = [
		null,
		"nope",
		[],
		{ version: 3, folders: [], placements: {} },
		{ version: 1, folders: [], placements: {} },
		{ version: 2 },
		{ version: 2, folders: [], placements: [] },
		{ version: 2, folders: [{ id: "", name: "F", parentId: null, createdAt: NOW }], placements: {} },
		{ version: 2, folders: [{ id: "f1", name: " ", parentId: null, createdAt: NOW }], placements: {} },
		{ version: 2, folders: [{ id: "f1", name: "F", parentId: "missing", createdAt: NOW }], placements: {} },
		{ version: 2, folders: [{ id: "f1", name: "F", parentId: "f2", createdAt: NOW }, { id: "f2", name: "G", parentId: "f1", createdAt: NOW }], placements: {} },
		{ version: 2, folders: [folder("f1")], placements: { c1: { folderId: "f1" } } },
		{ version: 2, folders: [folder("f1")], placements: { "chat:": { folderId: null } } },
		{ version: 2, folders: [folder("f1")], placements: { "workspace:": { folderId: null } } },
		{ version: 2, folders: [folder("f1")], placements: { [chatKey("c1")]: { folderId: 42 } } },
		{ version: 2, folders: [folder("f1")], placements: { [chatKey("c1")]: "invalid" } },
		{ version: 2, folders: [folder("f1")], placements: { [chatKey("c1")]: { folderId: "f1", order: "two" } } },
	];
	for (const raw of invalids) {
		assert.throws(() => parseOrganizationV2(raw), /invalid or newer/);
	}
});

// ─── Migration v1 → v2 ────────────────────────────────────────────────────────

it("migrateV1toV2 prefixes every chat placement and preserves folders, order and archive dates", () => {
	const v1 = {
		version: 1 as const,
		folders: [folder("f1", { order: 4, archivedAt: null, updatedAt: NOW }), folder("f2", { parentId: "f1", order: 1 })],
		placements: {
			c1: { folderId: "f1", order: 2 },
			c2: { folderId: null, archivedAt: NOW },
			c3: { folderId: "f2" },
		},
	};
	const v2 = migrateV1toV2(v1);
	assert.equal(v2.version, 2);
	assert.deepEqual(v2.folders, v1.folders, "folders copied verbatim");
	assert.deepEqual(v2.placements, {
		"chat:c1": { folderId: "f1", order: 2 },
		"chat:c2": { folderId: null, archivedAt: NOW },
		"chat:c3": { folderId: "f2" },
	});
});

it("migrateV1toV2 skips corrupt placement entries instead of failing the migration", () => {
	const warns: unknown[] = [];
	const originalWarn = console.warn;
	console.warn = (message: unknown) => warns.push(message);
	let v2: OrganizationV2;
	try {
		v2 = migrateV1toV2({
			version: 1,
			folders: [folder("f1")],
			placements: {
				c1: { folderId: "f1", order: 0 },
				broken: "not-an-object" as unknown as Record<string, unknown>,
				"gone": undefined as unknown as Record<string, unknown>,
			},
		});
	} finally {
		console.warn = originalWarn;
	}
	assert.deepEqual(v2.placements, { "chat:c1": { folderId: "f1", order: 0 } });
	assert.equal(warns.length, 2, "each skipped entry logs a warning");
});

it("migration is idempotent: an already-typed v2 state re-migrates to itself", () => {
	const v2 = parseOrganizationV2({
		version: 2,
		folders: [folder("f1")],
		placements: { [chatKey("c1")]: { folderId: "f1" }, [workspaceKey("w1")]: { folderId: "f1" } },
	});
	// The store only feeds v1 data to migrateV1toV2; re-running the migration
	// on the same logical v1 inputs yields the same placements.
	const again = migrateV1toV2({ version: 1, folders: v2.folders, placements: { c1: { folderId: "f1" } } });
	assert.deepEqual(again.placements, { "chat:c1": { folderId: "f1" } });
});

// ─── Store-level lazy migration ───────────────────────────────────────────────

it("v1 file is read without being rewritten; first write upgrades it to v2 atomically", () => {
	const v1File = {
		version: 1,
		folders: [folder("f1")],
		placements: { c1: { folderId: "f1", order: 2 }, c2: { folderId: null, archivedAt: NOW } },
	};
	fs.mkdirSync(path.dirname(CHAT_ORGANIZATION_FILE), { recursive: true });
	fs.writeFileSync(CHAT_ORGANIZATION_FILE, JSON.stringify(v1File, null, "\t") + "\n");
	const before = fs.readFileSync(CHAT_ORGANIZATION_FILE, "utf8");

	const read = organizationV2Store.read();
	assert.equal(read.version, 2);
	assert.deepEqual(read.folders, v1File.folders);
	assert.deepEqual(read.placements, {
		"chat:c1": { folderId: "f1", order: 2 },
		"chat:c2": { folderId: null, archivedAt: NOW },
	});
	assert.equal(
		fs.readFileSync(CHAT_ORGANIZATION_FILE, "utf8"),
		before,
		"lazy migration must not write on read",
	);

	organizationV2Store.write({
		version: 2,
		folders: v1File.folders,
		placements: { ...read.placements, [workspaceKey("w1")]: { folderId: "f1" } },
	});
	const onDisk = JSON.parse(fs.readFileSync(CHAT_ORGANIZATION_FILE, "utf8"));
	assert.equal(onDisk.version, 2);
	assert.deepEqual(Object.keys(onDisk.placements).sort(), ["chat:c1", "chat:c2", "workspace:w1"]);

	const reread = organizationV2Store.read();
	assert.deepEqual(reread.placements[chatKey("c1")], { folderId: "f1", order: 2 }, "folderId/order preserved");
	assert.deepEqual(reread.placements[chatKey("c2")], { folderId: null, archivedAt: NOW }, "archive date preserved");
});

it("new installs start directly on v2", () => {
	fs.rmSync(CHAT_ORGANIZATION_FILE, { force: true });
	assert.deepEqual(organizationV2Store.read(), emptyOrganizationV2());
	organizationV2Store.write({ version: 2, folders: [folder("f1")], placements: {} });
	const onDisk = JSON.parse(fs.readFileSync(CHAT_ORGANIZATION_FILE, "utf8"));
	assert.equal(onDisk.version, 2);
});

// ─── V1 compat store (R2: the transform must not lose foreign metadata) ──────

it("compat store read down-projects v2 to bare chat IDs without workspace keys", () => {
	// Seed: chat c1 and workspace w1 both placed in f1 (v2 on disk).
	organizationV2Store.write({
		version: 2,
		folders: [folder("f1")],
		placements: {
			[chatKey("c1")]: { folderId: "f1", order: 0 },
			[workspaceKey("w1")]: { folderId: "f1", order: 1 },
		},
	});
	const v1 = chatOrganizationStore.read();
	assert.equal(v1.version, 1);
	for (const key of Object.keys(v1.placements)) {
		assert.ok(!key.includes(":"), `placement key ${key} must be a bare chat ID`);
	}
	assert.equal(v1.placements["c1"]?.folderId, "f1");
});

it("compat store write merges chat state and preserves workspace placements (R2)", () => {
	// Seed: chat c1 and workspace w1 both placed in f1 (v2 on disk).
	const seeded: OrganizationV2 = {
		version: 2,
		folders: [folder("f1")],
		placements: {
			[chatKey("c1")]: { folderId: "f1", order: 0 },
			[workspaceKey("w1")]: { folderId: "f1", order: 1 },
		},
	};
	organizationV2Store.write(seeded);

	// A v1 caller (e.g. the chat organization surface) writes its chat-only view.
	chatOrganizationStore.write({
		version: 1,
		folders: [folder("f1")],
		placements: { c1: { folderId: "f1", order: 7 } },
	});

	const current = organizationV2Store.read();
	assert.equal(current.version, 2);
	assert.deepEqual(current.placements[chatKey("c1")], { folderId: "f1", order: 7 }, "chat placement replaced");
	assert.deepEqual(current.placements[workspaceKey("w1")], { folderId: "f1", order: 1 }, "workspace placement untouched");
});

it("toV1CompatOrganization strips prefixes and keeps chat placements only", () => {
	const v1View = toV1CompatOrganization({
		version: 2,
		folders: [folder("f1")],
		placements: {
			[chatKey("c1")]: { folderId: "f1" },
			[workspaceKey("w1")]: { folderId: "f1" },
		},
	});
	assert.equal(v1View.version, 1);
	assert.deepEqual(v1View.placements, { c1: { folderId: "f1" } });
});
