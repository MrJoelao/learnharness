import assert from "node:assert/strict";
import fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { after, describe, it } from "node:test";
import type { VisualArtifact } from "../src/core/contracts/visual-explanation.ts";

const TMP_DATA = fs.mkdtempSync(path.join(os.tmpdir(), "lh-visual-persist-"));
process.env.LH_DATA_DIR = TMP_DATA;

const { chatStore } = await import("../src/store/chats.ts");

describe("Visual Explanation Persistence and Projection (Fix E)", () => {
	after(() => {
		try {
			fs.rmSync(TMP_DATA, { recursive: true, force: true });
		} catch {
			// ignore cleanup errors
		}
	});

	const sampleArtifact: VisualArtifact = {
		version: 1,
		id: "mem-layout-1",
		title: "Virtual Memory Layout",
		summary: "Process address space segmentation",
		renderer: "svg",
		source: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" fill="#eee"/></svg>',
		presentation: "inline",
		initialState: { step: 0, segment: "text" },
		controls: [{ type: "button", id: "btn-reset", label: "Reset", action: "reset" }],
	};

	it("saves and retrieves visual artifact in full chat record (getChat)", () => {
		const chat = chatStore.createChat("Test Visual Session");
		assert.ok(chat.id);

		// Initially empty or undefined
		const freshRecord = chatStore.getChat(chat.id);
		assert.ok(freshRecord);
		assert.equal(freshRecord.visualArtifacts, undefined);

		// Save visual artifact
		chatStore.saveVisualArtifact(chat.id, sampleArtifact);

		const updatedRecord = chatStore.getChat(chat.id);
		assert.ok(updatedRecord);
		assert.ok(updatedRecord.visualArtifacts);
		assert.deepEqual(updatedRecord.visualArtifacts["mem-layout-1"], sampleArtifact);

		// getVisualArtifact retrieves single artifact directly
		const retrieved = chatStore.getVisualArtifact(chat.id, "mem-layout-1");
		assert.deepEqual(retrieved, sampleArtifact);

		// Non-existent artifact returns null
		const nonExistent = chatStore.getVisualArtifact(chat.id, "does-not-exist");
		assert.equal(nonExistent, null);
	});

	it("excludes visualArtifacts from listChats() projection payload", () => {
		const list = chatStore.listChats();
		assert.ok(list.length > 0);

		for (const summary of list) {
			assert.equal(
				"visualArtifacts" in summary,
				false,
				`listChats() summary for chat ${summary.id} must NOT contain visualArtifacts`,
			);
		}
	});

	it("preserves visualArtifacts across read-modify-write operations", () => {
		const chat = chatStore.createChat("RMW Visual Test");
		chatStore.saveVisualArtifact(chat.id, sampleArtifact);

		// 1. saveMessages does not discard visualArtifacts
		chatStore.saveMessages(chat.id, [
			{
				id: "msg_user_1",
				role: "user",
				content: "Explain memory",
				timestamp: Date.now(),
			},
		]);

		let record = chatStore.getChat(chat.id);
		assert.ok(record?.visualArtifacts?.["mem-layout-1"]);
		assert.equal(record.messages.length, 1);

		// 2. saveSettings preserves visualArtifacts
		chatStore.saveSettings(chat.id, { model: { provider: "test", id: "model-1" } });
		record = chatStore.getChat(chat.id);
		assert.ok(record?.visualArtifacts?.["mem-layout-1"]);
		assert.deepEqual(record.settings?.model, { provider: "test", id: "model-1" });

		// 3. saveNotes preserves visualArtifacts
		chatStore.saveNotes(chat.id, "Learner note about stack growth");
		record = chatStore.getChat(chat.id);
		assert.ok(record?.visualArtifacts?.["mem-layout-1"]);
		assert.equal(record.notes, "Learner note about stack growth");

		// 4. renameChat preserves visualArtifacts
		chatStore.renameChat(chat.id, "Renamed Visual Session");
		record = chatStore.getChat(chat.id);
		assert.ok(record?.visualArtifacts?.["mem-layout-1"]);
		assert.equal(record.title, "Renamed Visual Session");

		// 5. Updating artifact modifies only that artifact
		const updatedArtifact: VisualArtifact = {
			...sampleArtifact,
			title: "Virtual Memory Layout v2",
		};
		chatStore.saveVisualArtifact(chat.id, updatedArtifact);
		record = chatStore.getChat(chat.id);
		assert.equal(record?.visualArtifacts?.["mem-layout-1"]?.title, "Virtual Memory Layout v2");
	});

	it("is backwards compatible with records lacking visualArtifacts", () => {
		// Create a raw JSON record without visualArtifacts
		const legacyChatId = "legacy-chat-without-artifacts";
		const filePath = path.join(TMP_DATA, "chats", `${legacyChatId}.json`);
		fs.writeFileSync(
			filePath,
			JSON.stringify({
				id: legacyChatId,
				title: "Legacy Chat",
				createdAt: new Date().toISOString(),
				updatedAt: new Date().toISOString(),
				messages: [],
			}),
		);

		const record = chatStore.getChat(legacyChatId);
		assert.ok(record);
		assert.equal(record.visualArtifacts, undefined);

		// listChats reads legacy chat without errors or crashes
		const list = chatStore.listChats();
		const legacySummary = list.find((c) => c.id === legacyChatId);
		assert.ok(legacySummary);
		assert.equal("visualArtifacts" in legacySummary, false);

		// Can save artifact onto legacy chat without migration
		chatStore.saveVisualArtifact(legacyChatId, sampleArtifact);
		const refreshed = chatStore.getChat(legacyChatId);
		assert.ok(refreshed?.visualArtifacts?.["mem-layout-1"]);
	});
});
