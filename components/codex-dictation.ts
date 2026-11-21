"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Dictation, DictationDestination, DictationPhase } from "./dictation";

const MAX_BYTES = 24_000 * 2 * 120;

export interface UseCodexDictationOptions {
	enabled?: boolean;
	append?: (text: string) => void | Promise<void>;
	onActive?: (active: boolean) => void;
	getLanguage?: () => Promise<string>;
	destination?: "primary" | "explicit";
	disabled?: boolean;
	providerLabel?: string;
}

export function useCodexDictation({
	append,
	onActive,
	getLanguage,
	enabled = true,
	destination = "primary",
	disabled = false,
	providerLabel = "Codex",
}: UseCodexDictationOptions = {}): Dictation {
	const [phase, setPhase] = useState<DictationPhase>("idle");
	const [error, setError] = useState<string | null>(null);
	const phaseRef = useRef<DictationPhase>("idle");
	const callbacks = useRef({ append, onActive, getLanguage });
	callbacks.current = { append, onActive, getLanguage };
	const levelRef = useRef(0);
	const generation = useRef(0);
	const media = useRef<MediaStream | null>(null);
	const context = useRef<AudioContext | null>(null);
	const source = useRef<MediaStreamAudioSourceNode | null>(null);
	const capture = useRef<AudioWorkletNode | null>(null);
	const frames = useRef<ArrayBuffer[]>([]);
	const bytes = useRef(0);
	const request = useRef<AbortController | null>(null);
	const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
	const flushTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
	const flushDone = useRef<(() => void) | null>(null);
	const waiters = useRef<Array<() => void>>([]);
	const stopRef = useRef<() => void>(() => {});
	const [destinationId, setDestinationId] = useState("main");

	const transition = useCallback((value: DictationPhase) => {
		phaseRef.current = value;
		setPhase(value);
	}, []);

	const releaseMedia = useCallback(() => {
		for (const track of media.current?.getTracks() ?? []) track.stop();
		media.current = null;
		source.current?.disconnect();
		source.current = null;
		capture.current?.disconnect();
		capture.current = null;
		void context.current?.close().catch(() => {});
		context.current = null;
		if (timer.current) clearTimeout(timer.current);
		timer.current = null;
	}, []);

	const cleanup = useCallback(() => {
		const wasActive = phaseRef.current !== "idle";
		generation.current++;
		request.current?.abort();
		request.current = null;
		if (flushTimer.current) clearTimeout(flushTimer.current);
		flushTimer.current = null;
		flushDone.current?.();
		flushDone.current = null;
		releaseMedia();
		frames.current = [];
		bytes.current = 0;
		levelRef.current = 0;
		if (wasActive) {
			callbacks.current.onActive?.(false);
		}
		transition("idle");
		for (const resolve of waiters.current.splice(0)) resolve();
	}, [releaseMedia, transition]);

	const stop = useCallback(() => {
		if (phaseRef.current !== "recording" && phaseRef.current !== "connecting") return;
		const gen = generation.current;
		transition("stopping");

		for (const track of media.current?.getTracks() ?? []) track.stop();
		media.current = null;
		source.current?.disconnect();
		source.current = null;

		void (async () => {
			try {
				if (capture.current) {
					await new Promise<void>((resolve) => {
						flushDone.current = resolve;
						flushTimer.current = setTimeout(resolve, 500);
						capture.current?.port.postMessage({ type: "flush" });
					});
				}
				if (gen !== generation.current) return;
				if (flushTimer.current) clearTimeout(flushTimer.current);
				flushTimer.current = null;
				flushDone.current = null;
				releaseMedia();

				if (bytes.current < 4_800) {
					cleanup();
					return;
				}

				const audio = new Blob(frames.current, { type: "audio/pcm;rate=24000" });
				frames.current = [];
				const controller = new AbortController();
				request.current = controller;
				const deadline = setTimeout(() => controller.abort(), 75_000);

				try {
					const language = await callbacks.current.getLanguage?.();
					if (gen !== generation.current) return;
					const headers: Record<string, string> = {
						"Content-Type": "audio/pcm;rate=24000",
						"x-lh-dictation": "1",
					};
					if (language && language !== "multi") headers["x-lh-dictation-language"] = language;
					const response = await fetch("/api/stt/transcribe", {
						method: "POST",
						body: audio,
						headers,
						signal: controller.signal,
					});

					const raw: unknown = await response.json();
					const result = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : null;
					const message = typeof result?.message === "string" ? result.message : undefined;
					const text = typeof result?.text === "string" ? result.text : undefined;

					if (gen !== generation.current) return;
					if (!response.ok) throw new Error(message || `${providerLabel} dictation failed. Try again.`);
					if (typeof text !== "string") throw new Error(`${providerLabel} returned an invalid transcript.`);
					if (text.trim() && callbacks.current.append) {
						void callbacks.current.append(text.trim());
					}
				} finally {
					clearTimeout(deadline);
				}
				if (gen === generation.current) cleanup();
			} catch (failure) {
				if (gen !== generation.current) return;
				const isAbort = failure instanceof DOMException && failure.name === "AbortError";
				const failureMessage = failure instanceof Error ? failure.message : `${providerLabel} dictation failed. Try again.`;
				setError(isAbort ? `${providerLabel} dictation took too long. Try again.` : failureMessage);
				cleanup();
			}
		})();
	}, [cleanup, releaseMedia, transition]);

	stopRef.current = stop;

	const start = useCallback(async () => {
		if (disabled || phaseRef.current !== "idle") return;
		const gen = ++generation.current;
		setError(null);
		transition("connecting");
		callbacks.current.onActive?.(true);
		frames.current = [];
		bytes.current = 0;

		try {
			const stream = await navigator.mediaDevices.getUserMedia({
				audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
			});
			if (gen !== generation.current) {
				for (const track of stream.getTracks()) track.stop();
				return;
			}
			media.current = stream;

			const ctx = new AudioContext({ sampleRate: 24_000 });
			context.current = ctx;
			if (ctx.sampleRate !== 24_000) {
				throw new Error("This device cannot record at the required sample rate.");
			}

			await ctx.audioWorklet.addModule("/worklets/pcm-capture.js");
			if (gen !== generation.current) return;

			if (ctx.state === "suspended") await ctx.resume();
			if (gen !== generation.current) return;

			const node = new AudioWorkletNode(ctx, "pcm-capture");
			capture.current = node;

			node.port.onmessage = (event: MessageEvent<unknown>) => {
				if (gen !== generation.current) return;
				const data = event.data;
				if (typeof data !== "object" || data === null) return;
				const msg = data as Record<string, unknown>;

				if (msg.type === "level" && typeof msg.rms === "number") {
					levelRef.current = msg.rms;
				} else if (msg.type === "flushed") {
					flushDone.current?.();
				} else if (msg.type === "audio") {
					const buf = msg.buffer;
					let arrayBuffer: ArrayBuffer | null = null;
					if (buf instanceof ArrayBuffer) {
						arrayBuffer = buf;
					} else if (ArrayBuffer.isView(buf)) {
						const raw = buf.buffer;
						if (raw instanceof ArrayBuffer) {
							arrayBuffer = raw.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
						}
					}
					if (arrayBuffer) {
						const frame = arrayBuffer.slice(0, MAX_BYTES - bytes.current);
						if (frame.byteLength) {
							frames.current.push(frame);
							bytes.current += frame.byteLength;
						}
						if (bytes.current >= MAX_BYTES) stopRef.current();
					}
				}
			};

			const input = ctx.createMediaStreamSource(stream);
			source.current = input;
			input.connect(node);
			node.connect(ctx.destination);
			transition("recording");
			timer.current = setTimeout(() => stopRef.current(), 120_000);
		} catch (failure) {
			if (gen !== generation.current) return;
			const isNotAllowed = failure instanceof DOMException && failure.name === "NotAllowedError";
			const isSampleRate = failure instanceof Error && failure.message.includes("sample rate");
			setError(
				isNotAllowed
					? "Microphone permission denied"
					: isSampleRate && failure instanceof Error
						? failure.message
						: "The microphone could not be started. Check your input device and try again.",
			);
			cleanup();
		}
	}, [cleanup, disabled, transition]);

	const cancel = useCallback(() => {
		if (phaseRef.current !== "idle") cleanup();
	}, [cleanup]);

	const finish = useCallback((): Promise<void> => {
		if (phaseRef.current === "idle") return Promise.resolve();
		const done = new Promise<void>((resolve) => waiters.current.push(resolve));
		stop();
		return done;
	}, [stop]);

	const toggle = useCallback(() => {
		if (phaseRef.current === "idle") void start();
		else stop();
	}, [start, stop]);

	const toggleFor = useCallback(
		(dest: DictationDestination) => {
			setDestinationId(dest.id);
			toggle();
		},
		[toggle],
	);

	const finishFor = useCallback(
		(targetDestId: string) => {
			if (destinationId === targetDestId) return finish();
			return Promise.resolve();
		},
		[destinationId, finish],
	);

	useEffect(() => {
		if (!enabled) return;
		window.addEventListener("lh:kbd-toggle-dictation", toggle);
		window.addEventListener("lh:kbd-cancel-dictation", cancel);
		return () => {
			window.removeEventListener("lh:kbd-toggle-dictation", toggle);
			window.removeEventListener("lh:kbd-cancel-dictation", cancel);
		};
	}, [toggle, cancel, enabled]);

	useEffect(() => {
		return () => {
			if (phaseRef.current !== "idle") cleanup();
		};
	}, [cleanup]);

	return {
		phase,
		destinationId,
		blocked: false,
		toggleFor,
		finishFor,
		error,
		levelRef,
		active: phase !== "idle",
		toggle,
		stop,
		finish,
		cancel,
		clearError: () => setError(null),
	};
}
