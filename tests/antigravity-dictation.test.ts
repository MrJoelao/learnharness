import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, beforeEach, describe, it } from "node:test";
import {
	pcmToWav,
	checkAntigravityAvailable,
	transcribeAntigravityDictation,
	MAX_DICTATION_BYTES,
} from "../src/server/antigravity-dictation.ts";

describe("Antigravity dictation audio formatting", () => {
	it("converts 24kHz 16-bit mono PCM into standard RIFF WAVE", () => {
		const samplePcm = Buffer.alloc(48_000);
		for (let i = 0; i < samplePcm.length; i += 2) {
			samplePcm.writeInt16LE(Math.round(Math.sin(i / 10) * 10_000), i);
		}
		const wav = pcmToWav(samplePcm, 24_000);
		assert.equal(wav.length, samplePcm.length + 44);
		assert.equal(wav.subarray(0, 4).toString(), "RIFF");
		assert.equal(wav.readUInt32LE(4), samplePcm.length + 36);
		assert.equal(wav.subarray(8, 16).toString(), "WAVEfmt ");
		assert.equal(wav.readUInt32LE(16), 16); // format chunk size
		assert.equal(wav.readUInt16LE(20), 1); // PCM
		assert.equal(wav.readUInt16LE(22), 1); // mono
		assert.equal(wav.readUInt32LE(24), 24_000); // sample rate
		assert.equal(wav.readUInt32LE(28), 48_000); // byte rate (24000 * 2)
		assert.equal(wav.readUInt16LE(32), 2); // block align
		assert.equal(wav.readUInt16LE(34), 16); // bits per sample
		assert.equal(wav.subarray(36, 40).toString(), "data");
		assert.equal(wav.readUInt32LE(40), samplePcm.length);
	});

	it("returns empty string immediately for short audio or silence without making network requests", async () => {
		const shortBuffer = Buffer.alloc(2400); // 50ms at 24kHz
		const result = await transcribeAntigravityDictation(shortBuffer, new AbortController().signal);
		assert.equal(result, "");

		const silenceBuffer = Buffer.alloc(48_000); // 1 second of silence
		const silenceResult = await transcribeAntigravityDictation(silenceBuffer, new AbortController().signal);
		assert.equal(silenceResult, "");
	});

	it("rejects invalid buffer length or excessive size", async () => {
		const oddBuffer = Buffer.alloc(4801);
		await assert.rejects(
			transcribeAntigravityDictation(oddBuffer, new AbortController().signal),
			/Invalid dictation audio/,
		);

		const hugeBuffer = Buffer.alloc(MAX_DICTATION_BYTES + 2);
		await assert.rejects(
			transcribeAntigravityDictation(hugeBuffer, new AbortController().signal),
			/Invalid dictation audio/,
		);
	});
});

const testDir = mkdtempSync(path.join(tmpdir(), "lh-test-antigravity-suite-"));
const originalAuthFile = process.env.LH_AUTH_FILE;
const originalDataDir = process.env.LH_DATA_DIR;
process.env.LH_AUTH_FILE = path.join(testDir, "auth.json");
process.env.LH_DATA_DIR = testDir;

after(() => {
	if (originalAuthFile !== undefined) process.env.LH_AUTH_FILE = originalAuthFile;
	else delete process.env.LH_AUTH_FILE;
	if (originalDataDir !== undefined) process.env.LH_DATA_DIR = originalDataDir;
	else delete process.env.LH_DATA_DIR;
	rmSync(testDir, { recursive: true, force: true });
});

describe("Antigravity credentials and status check", () => {
	it("checkAntigravityAvailable returns false when credentials file is missing", async () => {
		const credFile = path.join(testDir, "google-antigravity-credentials.json");
		rmSync(credFile, { force: true });
		assert.equal(await checkAntigravityAvailable(), false);
	});

	it("checkAntigravityAvailable returns true when valid account with refresh exists", async () => {
		const credFile = path.join(testDir, "google-antigravity-credentials.json");
		writeFileSync(
			credFile,
			JSON.stringify({
				version: 1,
				allowBackgroundUse: true,
				activeAccountId: "acc-1",
				accounts: [
					{
						id: "acc-1",
						email: "user@example.com",
						access: "token-fixture",
						refresh: "refresh-fixture|project-fixture",
						expires: Date.now() + 3600_000,
					},
				],
			}),
		);
		assert.equal(await checkAntigravityAvailable(), true);
	});
});

describe("Antigravity dictation route integration", () => {
	it("GET /api/stt/providers reports availability correctly", async () => {
		const { GET } = await import("../app/api/stt/providers/route.ts");
		const res = await GET();
		assert.equal(res.status, 200);
		const data = (await res.json()) as { deepgram: boolean; codex: boolean; antigravity: boolean };
		assert.equal(typeof data.deepgram, "boolean");
		assert.equal(typeof data.codex, "boolean");
		assert.equal(typeof data.antigravity, "boolean");
	});

	it("POST /api/stt/transcribe rejects when dictation provider is not configured", async () => {
		const { writeSettings } = await import("../src/store/settings.ts");
		writeSettings({ version: 1, dictation: { provider: "deepgram" } });
		const { POST } = await import("../app/api/stt/transcribe/route.ts");

		const req = new Request("http://localhost:3000/api/stt/transcribe", {
			method: "POST",
			headers: {
				"x-lh-dictation": "1",
				origin: "http://localhost:3000",
				host: "localhost:3000",
				"content-type": "audio/pcm;rate=24000",
			},
			body: Buffer.alloc(9600),
		});

		const res = await POST(req);
		assert.equal(res.status, 403);
		const body = (await res.json()) as { message: string };
		assert.match(body.message, /Select Codex CLI or Google Antigravity/);
	});
});
