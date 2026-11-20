import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { externalCliEnv } from "../core/auth-env.ts";
import WebSocket from "ws";
import { codexBinary } from "./codex-binary.ts";

export const MAX_DICTATION_BYTES = 24_000 * 2 * 120;
const LOGIN_ERROR = "Sign in to Codex on this PC to use dictation.";

function isRecord(val: unknown): val is Record<string, unknown> {
	return typeof val === "object" && val !== null && !Array.isArray(val);
}

function parseJwtPayload(token: string): Record<string, unknown> | null {
	const parts = token.split(".");
	if (parts.length < 2 || !parts[1]) return null;
	try {
		const json = Buffer.from(parts[1], "base64url").toString("utf8");
		const parsed: unknown = JSON.parse(json);
		return isRecord(parsed) ? parsed : null;
	} catch {
		return null;
	}
}

/** Ask Codex's own auth manager for its current login; never copy its auth file. */
export async function codexDictationAuth(signal: AbortSignal): Promise<Record<string, string>> {
	signal.throwIfAborted();
	const env = externalCliEnv();
	for (const key of Object.keys(env)) {
		if (key.startsWith("LH_")) delete env[key];
	}
	delete env.ELECTRON_RUN_AS_NODE;

	const child = spawn(codexBinary(), ["app-server", "--stdio"], {
		cwd: tmpdir(),
		env,
		windowsHide: true,
		stdio: ["pipe", "pipe", "ignore"],
	});

	const lines = createInterface({ input: child.stdout });
	const pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();
	let nextId = 0;

	const fail = (error: Error) => {
		for (const call of pending.values()) call.reject(error);
		pending.clear();
	};

	const abort = () => {
		fail(new Error("Dictation cancelled."));
		child.kill();
	};

	const timeout = setTimeout(() => {
		fail(new Error("Codex sign-in took too long. Try again."));
		child.kill();
	}, 20_000);

	child.stdin.on("error", () => fail(new Error(LOGIN_ERROR)));
	child.on("error", () => fail(new Error("Codex could not be started. Check that Codex CLI is installed.")));
	child.on("exit", () => fail(new Error(LOGIN_ERROR)));

	signal.addEventListener("abort", abort, { once: true });
	if (signal.aborted) abort();

	lines.on("line", (line) => {
		if (line.length > 512 * 1024) {
			fail(new Error("Codex returned an invalid sign-in response."));
			return;
		}
		try {
			const parsed: unknown = JSON.parse(line);
			if (!isRecord(parsed)) return;
			const id = typeof parsed.id === "number" ? parsed.id : undefined;
			if (id === undefined) return;
			const call = pending.get(id);
			if (!call) return;
			pending.delete(id);
			if (parsed.error) {
				call.reject(new Error(LOGIN_ERROR));
			} else {
				call.resolve(parsed.result);
			}
		} catch {
			// Ignore non-protocol diagnostic output.
		}
	});

	const rpc = (method: string, params: unknown): Promise<unknown> =>
		new Promise<unknown>((resolve, reject) => {
			const id = ++nextId;
			pending.set(id, { resolve, reject });
			child.stdin.write(`${JSON.stringify({ id, method, params })}\n`, (error) => {
				if (error) {
					pending.delete(id);
					reject(new Error(LOGIN_ERROR));
				}
			});
		});

	try {
		await rpc("initialize", {
			clientInfo: { name: "learnharness_dictation", title: "LearnHarness dictation", version: "0.4.1" },
		});
		child.stdin.write(`${JSON.stringify({ method: "initialized" })}\n`);

		let result = await rpc("getAuthStatus", { includeToken: true, refreshToken: false });
		if (!isRecord(result)) throw new Error(LOGIN_ERROR);

		let authToken = typeof result.authToken === "string" ? result.authToken : undefined;
		if (authToken) {
			const claims = parseJwtPayload(authToken);
			const expiry = typeof claims?.exp === "number" ? claims.exp : undefined;
			if (expiry !== undefined && expiry * 1000 < Date.now() + 60_000) {
				const refreshed = await rpc("getAuthStatus", { includeToken: true, refreshToken: true });
				if (isRecord(refreshed)) {
					result = refreshed;
					if (typeof refreshed.authToken === "string") authToken = refreshed.authToken;
				}
			}
		}

		if (result.authMethod !== "chatgpt" || !authToken) throw new Error(LOGIN_ERROR);
		const claims = parseJwtPayload(authToken);
		if (!claims) throw new Error(LOGIN_ERROR);

		const openAiAuth = claims["https://api.openai.com/auth"];
		const account = isRecord(openAiAuth) && typeof openAiAuth.chatgpt_account_id === "string" ? openAiAuth.chatgpt_account_id : undefined;
		if (!account) throw new Error(LOGIN_ERROR);

		return {
			authorization: `Bearer ${authToken}`,
			"chatgpt-account-id": account,
			originator: "learnharness",
			"x-session-id": randomUUID(),
			"user-agent": "LearnHarness-Codex-Dictation",
		};
	} finally {
		clearTimeout(timeout);
		signal.removeEventListener("abort", abort);
		lines.close();
		try {
			child.stdin.end();
		} catch {
			// Stdin already closed or broken.
		}
		child.kill();
	}
}

/** Recorded PCM is sent only after the user finishes. No VAD or assistant turn. */
export async function transcribeCodexDictation(pcm: Buffer, signal: AbortSignal, language?: string): Promise<string> {
	if (!pcm.length || pcm.length % 2 || pcm.length > MAX_DICTATION_BYTES) {
		throw new Error("Invalid dictation audio. Record up to two minutes and try again.");
	}
	if (pcm.length < 4_800) return "";

	const headers = await codexDictationAuth(signal);
	signal.throwIfAborted();

	return new Promise<string>((resolve, reject) => {
		const socket = new WebSocket("wss://api.openai.com/v1/realtime?intent=transcription", {
			headers,
			handshakeTimeout: 15_000,
			maxPayload: 128 * 1024,
			followRedirects: false,
		});

		let settled = false;
		let committed = false;

		const finish = (error: Error | null, text = "") => {
			if (settled) return;
			settled = true;
			clearTimeout(timeout);
			signal.removeEventListener("abort", abort);
			if (socket.readyState === WebSocket.OPEN) {
				socket.close();
			} else if (socket.readyState !== WebSocket.CLOSED) {
				socket.terminate();
			}
			if (error) reject(error);
			else resolve(text);
		};

		const abort = () => finish(new Error("Dictation cancelled."));
		const timeout = setTimeout(() => finish(new Error("Codex dictation took too long. Try again.")), 45_000);

		signal.addEventListener("abort", abort, { once: true });
		if (signal.aborted) {
			abort();
			return;
		}

		socket.on("open", () => {
			socket.send(
				JSON.stringify({
					type: "session.update",
					session: {
						type: "transcription",
						audio: {
							input: {
								format: { type: "audio/pcm", rate: 24_000 },
								noise_reduction: { type: "near_field" },
								transcription: {
									model: "gpt-4o-mini-transcribe",
									...(language ? { language } : {}),
								},
								turn_detection: null,
							},
						},
					},
				}),
			);
		});

		socket.on("message", (raw) => {
			if (settled) return;
			try {
				const parsed: unknown = JSON.parse(raw.toString());
				if (!isRecord(parsed)) return;

				const eventType = typeof parsed.type === "string" ? parsed.type : undefined;
				if (eventType === "error") {
					finish(
						new Error(
							"Codex dictation could not transcribe this recording. Check your Codex sign-in and plan access, then retry.",
						),
					);
					return;
				}

				if ((eventType === "session.updated" || eventType === "transcription_session.updated") && !committed) {
					committed = true;
					for (let offset = 0; offset < pcm.length; offset += 48_000) {
						socket.send(
							JSON.stringify({
								type: "input_audio_buffer.append",
								audio: pcm.subarray(offset, offset + 48_000).toString("base64"),
							}),
						);
					}
					socket.send(JSON.stringify({ type: "input_audio_buffer.commit" }));
				}

				if (
					committed &&
					(eventType === "conversation.item.input_audio_transcription.completed" ||
						eventType === "input_audio_transcription.completed")
				) {
					const transcript = typeof parsed.transcript === "string" ? parsed.transcript : undefined;
					if (transcript === undefined || Buffer.byteLength(transcript) > 64 * 1024) {
						throw new Error("Invalid transcription payload");
					}
					finish(null, transcript.trim());
				}

				if (eventType === "conversation.item.input_audio_transcription.failed") {
					finish(new Error("Codex could not transcribe this audio. Try recording again."));
				}
			} catch {
				finish(new Error("Codex returned an invalid transcription response."));
			}
		});

		socket.on("error", (error) => {
			const message = error.message;
			finish(
				new Error(
					/401/.test(message)
						? LOGIN_ERROR
						: /403/.test(message)
							? "Your Codex account does not currently allow dictation."
							: "Codex dictation could not connect. Check your connection and try again.",
				),
			);
		});

		socket.on("close", () => {
			finish(new Error("Codex dictation disconnected before transcription finished. Try again."));
		});
	});
}
