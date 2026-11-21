import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import os from "node:os";
import * as core from "@cortexkit/antigravity-auth-core";
import { AUTH_FILE } from "../../config.ts";
import { DICTATION_LANGUAGES } from "../core/dictation.ts";
import { codexDictationAuth } from "./codex-dictation.ts";

export const MAX_DICTATION_BYTES = 24_000 * 2 * 120;
const LOGIN_ERROR = "Connect your Google Antigravity account in Settings to use dictation.";

export function pcmToWav(pcm: Buffer, sampleRate = 24000): Buffer {
	const header = Buffer.alloc(44);
	// RIFF identifier
	header.write("RIFF", 0);
	// file length - 8
	header.writeUInt32LE(36 + pcm.length, 4);
	// RIFF type & format header
	header.write("WAVEfmt ", 8);
	// format chunk length
	header.writeUInt32LE(16, 16);
	// sample format (1 = PCM)
	header.writeUInt16LE(1, 20);
	// channel count
	header.writeUInt16LE(1, 22);
	// sample rate
	header.writeUInt32LE(sampleRate, 24);
	// byte rate (sampleRate * 1 * 16 / 8)
	header.writeUInt32LE(sampleRate * 2, 28);
	// block align (1 * 16 / 8)
	header.writeUInt16LE(2, 32);
	// bits per sample
	header.writeUInt16LE(16, 34);
	// data chunk identifier
	header.write("data", 36);
	// data chunk length
	header.writeUInt32LE(pcm.length, 40);

	return Buffer.concat([header, pcm]);
}

function isSilence(pcm: Buffer): boolean {
	if (pcm.length < 4800) return true;
	let sumSquares = 0;
	const sampleCount = Math.floor(pcm.length / 2);
	for (let i = 0; i < pcm.length; i += 2) {
		const sample = pcm.readInt16LE(i);
		sumSquares += sample * sample;
	}
	const rms = Math.sqrt(sumSquares / sampleCount);
	return rms < 80;
}

interface StoredAccount {
	id: string;
	email?: string;
	label?: string;
	access?: string;
	refresh?: string;
	expires?: number;
	availableModelIds?: string[];
	credential?: {
		type?: string;
		access?: string;
		refresh?: string;
		expires?: number;
	};
}

interface StoredAntigravityFile {
	version?: number;
	allowBackgroundUse?: boolean;
	connectionId?: string | null;
	activeId?: string | null;
	activeAccountId?: string | null;
	accounts?: StoredAccount[];
	credential?: {
		type?: string;
		access?: string;
		refresh?: string;
		expires?: number;
	};
}

function findCredentialsPath(): string | null {
	if (process.env.LH_AUTH_FILE) {
		return path.join(path.dirname(process.env.LH_AUTH_FILE), "google-antigravity-credentials.json");
	}
	const candidates = [
		path.join(path.dirname(AUTH_FILE), "google-antigravity-credentials.json"),
		path.join(os.homedir(), ".config", "LearnHarness", "google-antigravity-credentials.json"),
		path.join(os.homedir(), "Library", "Application Support", "LearnHarness", "google-antigravity-credentials.json"),
		process.env.APPDATA ? path.join(process.env.APPDATA, "LearnHarness", "google-antigravity-credentials.json") : null,
	].filter((p): p is string => typeof p === "string");

	for (const candidate of candidates) {
		if (fsSync.existsSync(candidate)) return candidate;
	}
	return candidates[0] ?? null;
}

export async function checkAntigravityAvailable(): Promise<boolean> {
	try {
		const credPath = findCredentialsPath();
		if (!credPath || !fsSync.existsSync(credPath)) return false;
		const raw = await fs.readFile(credPath, "utf8");
		const data = JSON.parse(raw) as StoredAntigravityFile;
		const accounts = data.accounts ?? [];
		const activeId = data.activeAccountId ?? data.activeId ?? null;
		const account = (activeId ? accounts.find((a) => a.id === activeId) : null) ?? accounts[0];
		const refresh = account?.refresh ?? account?.credential?.refresh ?? data.credential?.refresh;
		return typeof refresh === "string" && refresh.length > 0;
	} catch {
		return false;
	}
}

let cachedCodexCheck: { result: boolean; expires: number } | null = null;

export async function checkCodexAvailable(): Promise<boolean> {
	const now = Date.now();
	if (cachedCodexCheck && cachedCodexCheck.expires > now) {
		return cachedCodexCheck.result;
	}
	try {
		const controller = new AbortController();
		const timeout = setTimeout(() => controller.abort(), 2000);
		await codexDictationAuth(controller.signal);
		clearTimeout(timeout);
		cachedCodexCheck = { result: true, expires: now + 20_000 };
		return true;
	} catch {
		cachedCodexCheck = { result: false, expires: now + 10_000 };
		return false;
	}
}

export async function antigravityDictationAuth(signal?: AbortSignal): Promise<{ accessToken: string; projectId: string }> {
	signal?.throwIfAborted();
	const credPath = findCredentialsPath();
	if (!credPath || !fsSync.existsSync(credPath)) {
		throw new Error(LOGIN_ERROR);
	}

	const raw = await fs.readFile(credPath, "utf8");
	const data = JSON.parse(raw) as StoredAntigravityFile;
	const accounts = data.accounts ?? [];
	const activeId = data.activeAccountId ?? data.activeId ?? null;
	const account = (activeId ? accounts.find((a) => a.id === activeId) : null) ?? accounts[0];

	if (!account) {
		throw new Error(LOGIN_ERROR);
	}

	const refresh = account.refresh ?? account.credential?.refresh;
	let access = account.access ?? account.credential?.access;
	let expires = account.expires ?? account.credential?.expires ?? 0;

	if (!refresh) {
		throw new Error(LOGIN_ERROR);
	}

	const parts = core.parseRefreshParts(refresh);
	if (!parts.refreshToken) {
		throw new Error(LOGIN_ERROR);
	}

	// If access token is missing, expired, or expiring in less than 60 seconds, refresh it.
	if (!access || expires <= Date.now() + 60_000) {
		signal?.throwIfAborted();
		const refreshed = await core.refreshAntigravityToken(parts.refreshToken);
		access = refreshed.access;
		expires = refreshed.expires;

		const updatedRefresh = core.formatRefreshParts({
			refreshToken: refreshed.refresh,
			projectId: parts.projectId,
			managedProjectId: parts.managedProjectId,
		});

		account.access = access;
		account.expires = expires;
		account.refresh = updatedRefresh;
		if (account.credential) {
			account.credential.access = access;
			account.credential.expires = expires;
			account.credential.refresh = updatedRefresh;
		}

		try {
			await fs.writeFile(credPath, JSON.stringify(data, null, 2), { mode: 0o600 });
		} catch {
			// Memory update still allows request to proceed if filesystem write fails.
		}
	}

	signal?.throwIfAborted();
	const auth = { type: "oauth" as const, access, refresh, expires };
	const project = await core.ensureProjectContext(auth);
	if (!project.effectiveProjectId) {
		throw new Error("Google Antigravity did not provide a usable project context.");
	}

	return { accessToken: access, projectId: project.effectiveProjectId };
}

let sessionStore: core.AgyRequestSessionStore | null = null;

export async function transcribeAntigravityDictation(
	pcm: Buffer,
	signal: AbortSignal,
	language?: string,
): Promise<string> {
	if (!pcm.length || pcm.length % 2 || pcm.length > MAX_DICTATION_BYTES) {
		throw new Error("Invalid dictation audio. Record up to two minutes and try again.");
	}
	if (pcm.length < 4_800 || isSilence(pcm)) return "";

	signal.throwIfAborted();
	const { accessToken, projectId } = await antigravityDictationAuth(signal);
	signal.throwIfAborted();

	const wav = pcmToWav(pcm, 24_000);
	const base64Audio = wav.toString("base64");

	sessionStore ??= new core.AgyRequestSessionStore("learnharness-stt");
	const sessionScope = sessionStore.beginRequest(`stt-${Date.now()}`);
	const resolution = core.resolveAntigravityModel("antigravity-gemini-3.8-flash-low");

	const langInfo = language ? DICTATION_LANGUAGES.find((item) => item.code === language) : undefined;
	const langLabel = langInfo?.label ?? language;

	const systemPrompt =
		"You are a precise, verbatim speech-to-text transcription engine. " +
		"Output ONLY the exact spoken words in the audio with standard punctuation and capitalization. " +
		"If the audio contains silence, noise, or no intelligible speech, output absolutely nothing. " +
		"Never translate, summarize, explain, or hallucinate.";

	const userPrompt = language && language !== "multi"
		? `Transcribe this audio recording accurately in ${langLabel} (${language}). Output only the exact transcribed words.`
		: "Transcribe this audio recording accurately. Output only the exact transcribed words.";

	const request: Record<string, unknown> = {
		contents: [
			{
				role: "user",
				parts: [
					{
						inlineData: {
							mimeType: "audio/wav",
							data: base64Audio,
						},
					},
					{
						text: userPrompt,
					},
				],
			},
		],
		systemInstruction: {
			parts: [{ text: systemPrompt }],
		},
		generationConfig: {
			temperature: 0.0,
			maxOutputTokens: 2048,
			thinkingConfig: {
				includeThoughts: false,
				thinkingBudget: 0,
			},
		},
	};

	const metadata = core.buildAgyAgentRequestMetadata(
		sessionScope.session,
		request as unknown as Parameters<typeof core.buildAgyAgentRequestMetadata>[1],
		resolution.actualModel,
		Date.now(),
		{ stepCountMode: "cli" },
	);
	request.labels = metadata.labels;
	request.sessionId = metadata.sessionId;
	core.orderAgyRequestPayloadInPlace(request as unknown as Parameters<typeof core.orderAgyRequestPayloadInPlace>[0]);

	const payload = {
		project: projectId,
		requestId: metadata.requestId,
		request,
		model: resolution.actualModel,
		userAgent: "antigravity",
		requestType: "agent",
	};

	const url = `${core.ANTIGRAVITY_ENDPOINT}/v1internal:streamGenerateContent?alt=sse`;
	const response = await fetch(url, {
		method: "POST",
		signal,
		headers: {
			Authorization: `Bearer ${accessToken}`,
			"Content-Type": "application/json",
			"User-Agent": core.buildAntigravityHarnessUserAgent(),
		},
		body: JSON.stringify(payload),
	});

	if (!response.ok) {
		throw new Error(`Antigravity returned HTTP ${response.status}${response.status === 429 ? " (usage limit)" : ""}.`);
	}
	if (!response.body) {
		throw new Error("Antigravity returned an empty stream.");
	}

	const reader = response.body.getReader();
	const decoder = new TextDecoder();
	let buffer = "";
	let transcript = "";

	const parseFrame = (frame: string) => {
		for (const line of frame.split("\n")) {
			if (!line.startsWith("data:")) continue;
			const raw = line.slice(5).trim();
			if (!raw || raw === "[DONE]") continue;
			let parsed: unknown;
			try {
				parsed = JSON.parse(raw);
			} catch {
				continue;
			}
			if (typeof parsed !== "object" || parsed === null) continue;
			const chunk = ((parsed as Record<string, unknown>).response ?? parsed) as Record<string, unknown>;
			if (chunk.error) {
				const err = chunk.error as Record<string, unknown>;
				throw new Error(`Antigravity stream error (${err.status ?? err.code ?? "provider error"}).`);
			}
			const candidates = Array.isArray(chunk.candidates) ? chunk.candidates : [];
			const candidate = candidates[0] as Record<string, unknown> | undefined;
			const content = candidate?.content as Record<string, unknown> | undefined;
			const parts = Array.isArray(content?.parts) ? content.parts : [];
			for (const part of parts) {
				if (typeof part !== "object" || part === null) continue;
				const p = part as Record<string, unknown>;
				if (p.thought) continue;
				if (typeof p.text === "string") {
					transcript += p.text;
				}
			}
		}
	};

	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) {
				buffer += decoder.decode().replace(/\r\n/g, "\n");
				break;
			}
			buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, "\n");
			let boundary: number;
			while ((boundary = buffer.indexOf("\n\n")) >= 0) {
				parseFrame(buffer.slice(0, boundary));
				buffer = buffer.slice(boundary + 2);
			}
		}
		if (buffer.trim()) parseFrame(buffer);
	} finally {
		reader.releaseLock();
	}

	return transcript.trim();
}
