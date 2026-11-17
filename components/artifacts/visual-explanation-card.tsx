"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import {
	Maximize2Icon,
	Minimize2Icon,
	PlayIcon,
	PauseIcon,
	RotateCcwIcon,
	StepForwardIcon,
	StepBackIcon,
	DownloadIcon,
	InfoIcon,
	CheckCircle2Icon,
} from "lucide-react";
import {
	type ArtifactPartProps,
	type VisualArtifact,
	type VisualControlDescriptor,
	type VisualButtonControl,
	validateDeclarativeVisualArtifact,
	parseDeclarativeSvg,
} from "@/src/core";
import { DeclarativeSvgRenderer } from "@/components/artifacts/declarative-svg-renderer";
import { downloadFile, slugFilename } from "@/components/artifacts/download";

interface VisualExplanationCardProps extends ArtifactPartProps {
	className?: string;
	chatId?: string;
}

// ── Shared Visual Artifact Registry & State Store (Fix B & C) ───────────────

type RegistryEntry = {
	artifact: VisualArtifact;
	listeners: Set<(art: VisualArtifact) => void>;
};

const artifactRegistry = new Map<string, RegistryEntry>();

export function scopedArtifactKey(id: string, chatId?: string): string {
	return chatId && chatId.trim().length > 0 ? `${chatId}:${id}` : id;
}

export function getRegisteredVisualArtifact(id: string, chatId?: string): VisualArtifact | undefined {
	return artifactRegistry.get(scopedArtifactKey(id, chatId))?.artifact;
}

export function registerVisualArtifact(artifact: VisualArtifact, chatId?: string): void {
	const key = scopedArtifactKey(artifact.id, chatId);
	const entry = artifactRegistry.get(key);
	if (!entry) {
		artifactRegistry.set(key, {
			artifact,
			listeners: new Set(),
		});
	} else {
		entry.artifact = artifact;
		for (const listener of entry.listeners) {
			listener(artifact);
		}
	}
}

export function subscribeVisualArtifact(
	id: string,
	listener: (art: VisualArtifact) => void,
	chatId?: string,
): () => void {
	const key = scopedArtifactKey(id, chatId);
	let entry = artifactRegistry.get(key);
	if (!entry) {
		entry = {
			artifact: undefined as unknown as VisualArtifact,
			listeners: new Set(),
		};
		artifactRegistry.set(key, entry);
	}
	entry.listeners.add(listener);
	return () => {
		const current = artifactRegistry.get(key);
		if (current) {
			current.listeners.delete(listener);
			if (current.listeners.size === 0) {
				artifactRegistry.delete(key);
			}
		}
	};
}

export function clearVisualArtifactRegistry(): void {
	artifactRegistry.clear();
}

export function getVisualArtifactRegistrySize(): number {
	return artifactRegistry.size;
}

/** Pure helper to extract maxSteps count from SVG source data-step attributes. */
export function countSvgSteps(source: string): number {
	const matches = source.match(/data-step\s*=\s*["'](\d+)["']/g);
	if (!matches || matches.length === 0) return 0;
	let max = 0;
	for (const m of matches) {
		const num = Number.parseInt(m.replace(/\D/g, ""), 10);
		if (Number.isFinite(num) && num > max) max = num;
	}
	return max;
}

/** Pure helper to enhance SVG with step-based visibility if data-step attributes exist */
export function applyStepToSvg(source: string, currentStep: number): string {
	if (!/data-step/i.test(source)) return source;
	const stepStyle = `
    <style>
      [data-step] { transition: opacity 0.2s ease, stroke-width 0.2s ease; }
      [data-step]:not([data-step="${currentStep}"]) { opacity: 0.35; }
      [data-step="${currentStep}"] { opacity: 1; filter: drop-shadow(0 0 3px rgba(37,99,235,0.4)); }
    </style>
  `;
	return source.replace(/<\/svg>/i, `${stepStyle}</svg>`);
}

function sanitizeCssIdent(ident: string): string {
	return ident.replace(/[^a-zA-Z0-9_-]/g, "");
}

function sanitizeCssValue(val: string): string {
	return val.replace(/[:;{}()<>"'/\\*]/g, "").replace(/\b(url|expression|javascript|behavior)\b/gi, "").trim();
}

function escapeCssAttributeValue(val: string): string {
	return val.replace(/[;{}\n\r<>\\]/g, "").replace(/["']/g, "");
}

/**
 * Pure helper to bind step & state variables to SVG source (Fix A & B).
 * Injects CSS variables and step highlight styles.
 */
export function applyStateToSvg(
	source: string,
	currentStep: number,
	stateValues: Record<string, unknown>,
): string {
	const cssVars: string[] = [];
	const rules: string[] = [];

	for (const [rawKey, val] of Object.entries(stateValues)) {
		const key = sanitizeCssIdent(rawKey);
		if (!key) continue;

		if (typeof val === "number" && Number.isFinite(val)) {
			cssVars.push(`--ctrl-${key}: ${val};`);
			cssVars.push(`--param-${key}: ${val};`);
		} else if (typeof val === "boolean") {
			cssVars.push(`--ctrl-${key}: ${val ? 1 : 0};`);
			cssVars.push(`--param-${key}: ${val ? 1 : 0};`);
			rules.push(`[data-toggle="${key}"] { display: ${val ? "inline" : "none"}; }`);
			rules.push(`[data-toggle-not="${key}"] { display: ${val ? "none" : "inline"}; }`);
		} else if (typeof val === "string") {
			const safeVal = sanitizeCssValue(val);
			cssVars.push(`--ctrl-${key}: ${safeVal};`);
			cssVars.push(`--param-${key}: ${safeVal};`);
			rules.push(`[data-select-${key}="${safeVal}"] { display: inline; }`);
			rules.push(`[data-select-${key}]:not([data-select-${key}="${safeVal}"]) { display: none; }`);
		}
	}

	const hasSteps = /data-step/i.test(source);
	const stepRules = hasSteps
		? `
      [data-step] { transition: opacity 0.2s ease, stroke-width 0.2s ease; }
      [data-step]:not([data-step="${currentStep}"]) { opacity: 0.35; }
      [data-step="${currentStep}"] { opacity: 1; filter: drop-shadow(0 0 3px rgba(37,99,235,0.4)); }
    `
		: "";

	const injectedStyle = `
    <style>
      :root, svg {
        ${cssVars.join("\n        ")}
      }
      ${rules.join("\n      ")}
      ${stepRules}
    </style>
  `;

	return source.replace(/<\/svg>/i, `${injectedStyle}</svg>`);
}

/**
 * Merges previous user state into new artifact state, preserving compatible
 * learner values (step index, button control state) without resets (Fix B).
 */
export function preserveCompatibleState(
	previousState: Record<string, unknown>,
	newArtifact: VisualArtifact,
	newMaxSteps: number,
): Record<string, unknown> {
	const next: Record<string, unknown> = {
		...(newArtifact.initialState ?? {}),
	};

	// 1. Step preservation
	if (typeof previousState.step === "number") {
		next.step = Math.min(Math.max(0, previousState.step), newMaxSteps);
	}

	// 2. Declarative button controls preservation
	if (newArtifact.controls) {
		for (const ctrl of newArtifact.controls) {
			const prevVal = previousState[ctrl.id];
			if (prevVal === undefined) continue;

			if (ctrl.type === "button") {
				next[ctrl.id] = prevVal;
			}
		}
	}

	return next;
}

/**
 * Computes a deterministic full signature of the visual artifact.
 * Captures all relevant content: id, version, renderer, presentation, title, summary,
 * full source text, controls, initialState, and accessibility configuration.
 */
export function computeArtifactSignature(artifact: VisualArtifact): string {
	return JSON.stringify([
		artifact.id,
		artifact.version,
		artifact.renderer,
		artifact.presentation ?? "auto",
		artifact.title,
		artifact.summary ?? "",
		artifact.source,
		artifact.controls ?? [],
		artifact.initialState ?? {},
		artifact.accessibility ?? {},
	]);
}

function VisualExplanationUpdateNotice({
	artifact,
	chatId,
}: {
	artifact: VisualArtifact;
	chatId?: string;
}) {
	const notifiedSignatureRef = useRef<string | null>(null);

	useEffect(() => {
		const sig = computeArtifactSignature(artifact);
		if (notifiedSignatureRef.current !== sig) {
			notifiedSignatureRef.current = sig;
			registerVisualArtifact(artifact, chatId);
		}
	}, [artifact, chatId]);

	return (
		<div
			className="my-2.5 flex items-center justify-between rounded-xl border border-primary/20 bg-primary/5 px-4 py-2.5 text-xs text-foreground"
			data-testid="visual-explanation-update-notice"
			data-artifact-id={artifact.id}
		>
			<div className="flex items-center gap-2">
				<CheckCircle2Icon className="size-4 text-primary shrink-0" />
				<span className="font-semibold text-primary">Updated Visual:</span>
				<span className="font-medium text-foreground">{artifact.title}</span>
			</div>
			<span className="text-[11px] text-muted-foreground">Updated in-place above</span>
		</div>
	);
}

export function VisualExplanationCard({
	part,
	className = "",
	chatId: explicitChatId,
}: VisualExplanationCardProps) {
	const rawOutput = (part.output as { artifact?: unknown })?.artifact ?? part.output ?? part.input;
	const rawAction =
		(part.output as { action?: string } | undefined)?.action ??
		(part.input as { action?: string } | undefined)?.action ??
		"create";
	const chatId =
		explicitChatId ??
		(part.output as { chatId?: string })?.chatId ??
		(part.input as { chatId?: string })?.chatId;

	const validation = useMemo(() => validateDeclarativeVisualArtifact(rawOutput), [rawOutput]);
	const validatedArtifact = validation.sanitized;

	// Invariant: Failed artifact or failed update renders error alert without crashing
	if (part.state === "output-error" || !validation.valid || !validatedArtifact) {
		const errorNotes = validation.problems.join("; ") || "Invalid visual artifact envelope.";
		return (
			<div
				className="my-3 rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-foreground"
				role="alert"
				data-testid="visual-explanation-failed"
			>
				<div className="flex items-center gap-2 font-medium text-destructive">
					<InfoIcon className="size-4 shrink-0" />
					<span>Visual explanation unavailable</span>
				</div>
				<p className="mt-1 text-xs text-muted-foreground">{errorNotes}</p>
			</div>
		);
	}

	// Update action (Fix B & C): Publishes update to existing visual instance via useEffect
	if (rawAction === "update") {
		return <VisualExplanationUpdateNotice artifact={validatedArtifact} chatId={chatId} />;
	}

	return (
		<VisualExplanationInstance
			artifact={validatedArtifact}
			chatId={chatId}
			className={className}
			initialExpanded={validatedArtifact.presentation === "panel"}
		/>
	);
}

export function VisualExplanationInstance({
	artifact: initialArtifact,
	chatId,
	className = "",
	initialExpanded = false,
}: {
	artifact: VisualArtifact;
	chatId?: string;
	className?: string;
	initialExpanded?: boolean;
}) {
	// Defense in depth (RUN 3.2): Strictly validate initial artifact at runtime entrance
	const initialDoc = useMemo(() => {
		if (initialArtifact.renderer !== "svg") return null;
		return parseDeclarativeSvg(initialArtifact.source);
	}, [initialArtifact]);

	if (initialArtifact.renderer !== "svg" || !initialDoc) {
		return (
			<div
				className="my-3 rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-foreground"
				role="alert"
				data-testid="visual-explanation-failed"
			>
				<div className="flex items-center gap-2 font-medium text-destructive">
					<InfoIcon className="size-4 shrink-0" />
					<span>Visual explanation unavailable</span>
				</div>
				<p className="mt-1 text-xs text-muted-foreground">
					Artifact source is not a valid declarative SVG document.
				</p>
			</div>
		);
	}

	return (
		<VisualExplanationInstanceInner
			initialArtifact={initialArtifact}
			chatId={chatId}
			className={className}
			initialExpanded={initialExpanded}
		/>
	);
}

function VisualExplanationInstanceInner({
	initialArtifact,
	chatId,
	className = "",
	initialExpanded = false,
}: {
	initialArtifact: VisualArtifact;
	chatId?: string;
	className?: string;
	initialExpanded?: boolean;
}) {
	// Active artifact (updated reactively when an update action arrives for this ID — Fix B)
	const [artifact, setArtifact] = useState<VisualArtifact>(() => {
		const registered = getRegisteredVisualArtifact(initialArtifact.id, chatId);
		return registered ?? initialArtifact;
	});

	// Register initial artifact outside render phase with idempotency check
	const lastRegisteredSignatureRef = useRef<string | null>(null);
	useEffect(() => {
		const sig = computeArtifactSignature(initialArtifact);
		if (lastRegisteredSignatureRef.current !== sig) {
			lastRegisteredSignatureRef.current = sig;
			registerVisualArtifact(initialArtifact, chatId);
		}
	}, [initialArtifact, chatId]);

	const containerRef = useRef<HTMLDivElement>(null);
	const dialogRef = useRef<HTMLDivElement>(null);
	const expandButtonRef = useRef<HTMLButtonElement>(null);
	const lastFocusedElementRef = useRef<HTMLElement | null>(null);

	// Shared artifact simulation state
	const [isExpanded, setIsExpanded] = useState(initialExpanded);
	const [isPlaying, setIsPlaying] = useState(false);
	const [isPageVisible, setIsPageVisible] = useState(() => (typeof document !== "undefined" ? !document.hidden : true));
	const [isIntersecting, setIsIntersecting] = useState(true);
	const [reducedMotion, setReducedMotion] = useState(false);

	// Parse declarative SVG document if schema is learnharness.visual.svg.v1
	const declarativeDoc = useMemo(() => {
		if (artifact.renderer !== "svg") return null;
		return parseDeclarativeSvg(artifact.source);
	}, [artifact]);

	// Calculate maximum steps
	const maxSteps = useMemo(() => {
		if (declarativeDoc) return Math.max(0, declarativeDoc.steps.length - 1);
		if (typeof artifact.initialState?.maxSteps === "number") return artifact.initialState.maxSteps as number;
		return 0;
	}, [artifact, declarativeDoc]);

	// State dictionary initialized from initialState, with step strictly clamped to [0, maxSteps]
	const rawInitialStep =
		typeof artifact.initialState?.step === "number" ? Math.floor(artifact.initialState.step as number) : 0;
	const initialStep = Math.max(0, Math.min(rawInitialStep, maxSteps));
	const [currentStep, setCurrentStep] = useState(initialStep);
	const [stateValues, setStateValues] = useState<Record<string, unknown>>(() => ({
		step: initialStep,
		...(artifact.initialState ?? {}),
	}));

	// Listen for artifact updates targeting this ID (Fix B: In-place update & state preservation)
	useEffect(() => {
		const unsubscribe = subscribeVisualArtifact(
			artifact.id,
			(updated) => {
				const updateValidation = validateDeclarativeVisualArtifact(updated);
				if (!updateValidation.valid || !updateValidation.sanitized) {
					// Invalid update: discard to prevent corrupting local state
					return;
				}
				const sanitizedUpdated = updateValidation.sanitized;
				setArtifact(sanitizedUpdated);
				const updatedDecl = parseDeclarativeSvg(sanitizedUpdated.source);
				const newMax = updatedDecl
					? Math.max(0, updatedDecl.steps.length - 1)
					: typeof sanitizedUpdated.initialState?.maxSteps === "number"
						? (sanitizedUpdated.initialState.maxSteps as number)
						: 0;
				setStateValues((prev) => preserveCompatibleState(prev, sanitizedUpdated, newMax));
				setCurrentStep((prev) => Math.min(prev, newMax));
			},
			chatId,
		);
		return unsubscribe;
	}, [artifact.id, chatId]);

	// Accessibility: Reduced motion check (prefers-reduced-motion is the sole source of truth)
	useEffect(() => {
		if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
			setReducedMotion(false);
			return;
		}
		const mediaQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
		setReducedMotion(Boolean(mediaQuery.matches));

		const handler = (e: MediaQueryListEvent) => {
			setReducedMotion(Boolean(e.matches));
		};
		mediaQuery.addEventListener?.("change", handler);
		return () => mediaQuery.removeEventListener?.("change", handler);
	}, []);

	// Visibility observer (Fix F: Pauses when hidden/offscreen, resumes cleanly when returning)
	useEffect(() => {
		if (!containerRef.current || typeof IntersectionObserver === "undefined") return;
		const observer = new IntersectionObserver(
			(entries) => {
				const entry = entries[0];
				if (entry) setIsIntersecting(entry.isIntersecting);
			},
			{ threshold: 0.1 },
		);
		observer.observe(containerRef.current);

		const onVisibilityChange = () => {
			setIsPageVisible(!document.hidden);
		};
		document.addEventListener("visibilitychange", onVisibilityChange);

		return () => {
			observer.disconnect();
			document.removeEventListener("visibilitychange", onVisibilityChange);
		};
	}, []);

	// Animation tick loop (paused when hidden, offscreen, collapsed or reduced motion — Fix F)
	const shouldAnimate = isPlaying && isPageVisible && isIntersecting && !reducedMotion;
	useEffect(() => {
		if (!shouldAnimate) return;

		const timer = setInterval(() => {
			setCurrentStep((prev) => {
				const next = prev >= maxSteps ? 0 : prev + 1;
				setStateValues((s) => ({ ...s, step: next }));
				return next;
			});
		}, 1200);

		return () => clearInterval(timer);
	}, [shouldAnimate, maxSteps]);

	// Action handlers for declarative controls
	const handleStepForward = useCallback(() => {
		setIsPlaying(false);
		setCurrentStep((prev) => {
			const next = Math.min(prev + 1, maxSteps);
			setStateValues((s) => ({ ...s, step: next }));
			return next;
		});
	}, [maxSteps]);

	const handleStepBackward = useCallback(() => {
		setIsPlaying(false);
		setCurrentStep((prev) => {
			const next = Math.max(prev - 1, 0);
			setStateValues((s) => ({ ...s, step: next }));
			return next;
		});
	}, []);

	const handleReset = useCallback(() => {
		setIsPlaying(false);
		setCurrentStep(initialStep);
		setStateValues({ step: initialStep, ...(artifact.initialState ?? {}) });
	}, [initialStep, artifact.initialState]);

	const handleTogglePlay = useCallback(() => {
		if (reducedMotion) return;
		setIsPlaying((p) => !p);
	}, [reducedMotion]);

	// Button control action dispatcher (Fix A)
	const handleButtonClick = useCallback(
		(ctrl: VisualButtonControl) => {
			switch (ctrl.action) {
				case "play":
					if (!reducedMotion) setIsPlaying(true);
					break;
				case "pause":
					setIsPlaying(false);
					break;
				case "reset":
					handleReset();
					break;
				case "step-forward":
					handleStepForward();
					break;
				case "step-backward":
					handleStepBackward();
					break;
			}
		},
		[reducedMotion, handleReset, handleStepForward, handleStepBackward],
	);

	// Panel focus management & accessibility (Fix D)
	const handleOpenPanel = () => {
		lastFocusedElementRef.current = (document.activeElement as HTMLElement) ?? null;
		setIsExpanded(true);
	};

	const handleClosePanel = useCallback(() => {
		setIsExpanded(false);
		setTimeout(() => {
			if (lastFocusedElementRef.current && typeof lastFocusedElementRef.current.focus === "function") {
				lastFocusedElementRef.current.focus();
			} else if (expandButtonRef.current) {
				expandButtonRef.current.focus();
			}
		}, 30);
	}, []);

	// Focus trap when modal opens (Fix D)
	useEffect(() => {
		if (!isExpanded || !dialogRef.current) return;

		const focusableElements = Array.from(
			dialogRef.current.querySelectorAll<HTMLElement>(
				'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
			),
		);

		if (focusableElements.length > 0) {
			focusableElements[0]?.focus();
		} else {
			dialogRef.current.focus();
		}
	}, [isExpanded]);

	// Tab key focus trap and Escape handler (Fix D)
	useEffect(() => {
		if (!isExpanded) return;

		const onKeyDown = (e: KeyboardEvent) => {
			if (e.key === "Escape") {
				e.preventDefault();
				handleClosePanel();
				return;
			}

			if (e.key === "Tab" && dialogRef.current) {
				const focusableElements = Array.from(
					dialogRef.current.querySelectorAll<HTMLElement>(
						'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
					),
				);

				if (focusableElements.length === 0) {
					e.preventDefault();
					return;
				}

				const first = focusableElements[0];
				const last = focusableElements[focusableElements.length - 1];

				if (e.shiftKey) {
					if (document.activeElement === first || !dialogRef.current.contains(document.activeElement)) {
						e.preventDefault();
						last?.focus();
					}
				} else {
					if (document.activeElement === last || !dialogRef.current.contains(document.activeElement)) {
						e.preventDefault();
						first?.focus();
					}
				}
			}
		};

		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, [isExpanded, handleClosePanel]);

	// Outside focus trap: keeps focus within the dialog if user tries to focus outside (Fix D)
	useEffect(() => {
		if (!isExpanded) return;

		const onFocusIn = (e: FocusEvent) => {
			if (dialogRef.current && !dialogRef.current.contains(e.target as Node)) {
				const focusableElements = Array.from(
					dialogRef.current.querySelectorAll<HTMLElement>(
						'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
					),
				);
				if (focusableElements.length > 0) {
					focusableElements[0]?.focus();
				} else {
					dialogRef.current.focus();
				}
			}
		};

		document.addEventListener("focusin", onFocusIn);
		return () => document.removeEventListener("focusin", onFocusIn);
	}, [isExpanded]);

	// Render the inner visual frame (Zero iframes, strictly declarative SVG renderer)
	const renderVisualContent = (expanded: boolean) => {
		if (declarativeDoc) {
			return (
				<div
					className="flex items-center justify-center overflow-hidden rounded-md bg-white p-2"
					style={{ minHeight: expanded ? "340px" : "180px", maxHeight: expanded ? "70vh" : "360px" }}
					data-testid="visual-explanation-declarative-container"
				>
					<DeclarativeSvgRenderer
						document={declarativeDoc}
						currentStep={currentStep}
						className="block h-auto max-h-full max-w-full"
					/>
				</div>
			);
		}

		// Strictly reject rendering non-declarative or null documents; never mount SvgImage
		return (
			<div
				className="flex items-center justify-center rounded-md border border-destructive/20 bg-destructive/5 p-4 text-xs text-destructive"
				role="alert"
				data-testid="visual-explanation-failed"
			>
				<p>Invalid or unsupported declarative visual document.</p>
			</div>
		);
	};

	// Controls toolbar (Fix A: renders step controls and declarative button controls)
	const renderControls = () => {
		const hasStepControls = maxSteps > 0;

		return (
			<div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-border/40 pt-2 text-xs">
				<div className="flex flex-wrap items-center gap-1.5">
					{/* Standard Step Controls */}
					{hasStepControls && (
						<>
							<button
								type="button"
								aria-label="Step backward"
								title="Step backward"
								disabled={currentStep <= 0}
								onClick={handleStepBackward}
								className="rounded-md border p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-40"
								data-testid="visual-control-step-backward"
							>
								<StepBackIcon className="size-3.5" />
							</button>

							<button
								type="button"
								aria-label={isPlaying ? "Pause animation" : "Play animation"}
								title={isPlaying ? "Pause animation" : "Play animation"}
								disabled={reducedMotion}
								onClick={handleTogglePlay}
								className="rounded-md border p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-40"
								data-testid="visual-control-play-pause"
							>
								{isPlaying ? <PauseIcon className="size-3.5" /> : <PlayIcon className="size-3.5" />}
							</button>

							<button
								type="button"
								aria-label="Step forward"
								title="Step forward"
								disabled={currentStep >= maxSteps}
								onClick={handleStepForward}
								className="rounded-md border p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-40"
								data-testid="visual-control-step-forward"
							>
								<StepForwardIcon className="size-3.5" />
							</button>

							<button
								type="button"
								aria-label="Reset visualization"
								title="Reset visualization"
								onClick={handleReset}
								className="rounded-md border p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
								data-testid="visual-control-reset"
							>
								<RotateCcwIcon className="size-3.5" />
							</button>

							<span className="ml-1 select-none font-mono text-[11px] text-muted-foreground" data-testid="visual-step-indicator">
								Step {currentStep} / {maxSteps}
							</span>
						</>
					)}

					{/* Declarative button controls from artifact descriptor (Fix A) */}
					{artifact.controls?.map((ctrl) => {
						if (ctrl.type === "button") {
							return (
								<button
									key={ctrl.id}
									type="button"
									disabled={ctrl.disabled || (ctrl.action === "play" && reducedMotion)}
									onClick={() => handleButtonClick(ctrl)}
									className="ml-1 rounded-md border bg-secondary/50 px-2 py-1 text-xs font-medium text-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-40"
									data-testid={`visual-control-button-${ctrl.id}`}
									data-action={ctrl.action}
								>
									{ctrl.label}
								</button>
							);
						}
						return null;
					})}
				</div>

				<div className="flex shrink-0 items-center gap-1.5">
					{reducedMotion && (
						<span
							className="rounded bg-secondary/80 px-1.5 py-0.5 text-[10px] text-muted-foreground"
							title="Reduced motion active: animations paused"
							data-testid="visual-reduced-motion-badge"
						>
							Reduced motion
						</span>
					)}

					<button
						type="button"
						aria-label="Download visual artifact"
						title="Download visual artifact"
						onClick={() =>
							downloadFile(
								`${slugFilename(artifact.title)}.svg`,
								artifact.source,
								"image/svg+xml",
							)
						}
						className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
						data-testid="visual-download-button"
					>
						<DownloadIcon className="size-3.5" />
					</button>

					{!isExpanded && (
						<button
							ref={expandButtonRef}
							type="button"
							aria-label="Expand visual to panel"
							title="Expand to panel"
							onClick={handleOpenPanel}
							className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
							data-testid="visual-expand-button"
						>
							<Maximize2Icon className="size-3.5" />
						</button>
					)}
				</div>
			</div>
		);
	};

	return (
		<div
			ref={containerRef}
			className={`my-3 w-full rounded-xl border bg-card p-4 text-card-foreground shadow-xs ${className}`}
			data-testid="visual-explanation-card"
			data-artifact-id={artifact.id}
		>
			{/* Header: Title and Summary */}
			<div className="mb-2 flex items-start justify-between gap-3">
				<div className="min-w-0 flex-1">
					<div className="flex items-center gap-2">
						<span className="rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-primary">
							Visual Explanation
						</span>
						<h4 className="truncate text-sm font-semibold text-foreground" title={artifact.title}>
							{artifact.title}
						</h4>
					</div>
					{artifact.summary && <p className="mt-1 text-xs text-muted-foreground">{artifact.summary}</p>}
				</div>
			</div>

			{/* Accessibility text description if available */}
			{artifact.accessibility?.description && (
				<p className="sr-only" aria-live="polite">
					{artifact.accessibility.description}
				</p>
			)}

			{/* Inline Visual View or Expanded Placeholder (Fix C: Single active view) */}
			{isExpanded ? (
				<div
					className="flex h-36 w-full items-center justify-center rounded-md border border-dashed border-border/60 bg-muted/20 text-xs text-muted-foreground"
					data-testid="visual-inline-expanded-placeholder"
				>
					<span>Visualization expanded in panel</span>
				</div>
			) : (
				renderVisualContent(false)
			)}

			{/* Inline Controls Toolbar */}
			{!isExpanded && renderControls()}

			{/* Expanded Panel Overlay (Fix C & Fix D) */}
			{isExpanded && (
				<div
					ref={dialogRef}
					role="dialog"
					aria-modal="true"
					aria-label={artifact.title}
					tabIndex={-1}
					className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 p-4 backdrop-blur-xs"
					data-testid="visual-explanation-panel"
				>
					<div className="flex h-full max-h-[92vh] w-full max-w-4xl flex-col rounded-xl border bg-card p-5 shadow-2xl">
						<div className="mb-3 flex items-center justify-between border-b pb-3">
							<div>
								<h3 className="text-base font-semibold text-foreground">{artifact.title}</h3>
								{artifact.summary && <p className="mt-0.5 text-xs text-muted-foreground">{artifact.summary}</p>}
							</div>
							<button
								type="button"
								aria-label="Close panel"
								title="Close panel (Esc)"
								onClick={handleClosePanel}
								className="rounded-md border p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
								data-testid="visual-panel-close-button"
							>
								<Minimize2Icon className="size-4" />
							</button>
						</div>

						<div className="flex-1 overflow-auto">{renderVisualContent(true)}</div>

						<div className="mt-4">{renderControls()}</div>
					</div>
				</div>
			)}
		</div>
	);
}
