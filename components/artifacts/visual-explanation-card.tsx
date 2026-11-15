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
	type VisualSliderControl,
	type VisualToggleControl,
	type VisualSelectControl,
	validateVisualArtifact,
} from "@/src/core";
import { SvgImage } from "@/components/artifacts/svg-image";
import { downloadFile, slugFilename } from "@/components/artifacts/download";

interface VisualExplanationCardProps extends ArtifactPartProps {
	className?: string;
}

// ── Shared Visual Artifact Registry & State Store (Fix B & C) ───────────────

type RegistryEntry = {
	artifact: VisualArtifact;
	listeners: Set<(art: VisualArtifact) => void>;
};

const artifactRegistry = new Map<string, RegistryEntry>();

export function getRegisteredVisualArtifact(id: string): VisualArtifact | undefined {
	return artifactRegistry.get(id)?.artifact;
}

export function registerVisualArtifact(artifact: VisualArtifact): void {
	const entry = artifactRegistry.get(artifact.id);
	if (!entry) {
		artifactRegistry.set(artifact.id, {
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

export function subscribeVisualArtifact(id: string, listener: (art: VisualArtifact) => void): () => void {
	let entry = artifactRegistry.get(id);
	if (!entry) {
		entry = {
			artifact: undefined as unknown as VisualArtifact,
			listeners: new Set(),
		};
		artifactRegistry.set(id, entry);
	}
	entry.listeners.add(listener);
	return () => {
		const current = artifactRegistry.get(id);
		if (current) {
			current.listeners.delete(listener);
			if (current.listeners.size === 0) {
				artifactRegistry.delete(id);
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
 * Pure helper to bind declarative controls & state variables to SVG source (Fix A & B).
 * Injects CSS variables (--ctrl-<id>, --param-<id>) and display rules for toggles/selects.
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
 * learner values (step, slider positions, toggles, select choices) without resets (Fix B).
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

	// 2. Declarative controls preservation
	if (newArtifact.controls) {
		for (const ctrl of newArtifact.controls) {
			const prevVal = previousState[ctrl.id];
			if (prevVal === undefined) continue;

			switch (ctrl.type) {
				case "slider":
					if (typeof prevVal === "number" && Number.isFinite(prevVal)) {
						next[ctrl.id] = Math.max(ctrl.min, Math.min(ctrl.max, prevVal));
					}
					break;
				case "toggle":
					if (typeof prevVal === "boolean") {
						next[ctrl.id] = prevVal;
					}
					break;
				case "select":
					if (typeof prevVal === "string" && ctrl.options.some((o) => o.value === prevVal)) {
						next[ctrl.id] = prevVal;
					}
					break;
				case "button":
					next[ctrl.id] = prevVal;
					break;
			}
		}
	}

	return next;
}

function VisualExplanationUpdateNotice({ artifact }: { artifact: VisualArtifact }) {
	const notifiedSignatureRef = useRef<string | null>(null);

	useEffect(() => {
		const sig = `${artifact.id}:${artifact.version}:${artifact.title}:${artifact.source.length}`;
		if (notifiedSignatureRef.current !== sig) {
			notifiedSignatureRef.current = sig;
			registerVisualArtifact(artifact);
		}
	}, [artifact]);

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

export function VisualExplanationCard({ part, className = "" }: VisualExplanationCardProps) {
	const rawOutput = (part.output as { artifact?: unknown })?.artifact ?? part.output ?? part.input;
	const rawAction =
		(part.output as { action?: string } | undefined)?.action ??
		(part.input as { action?: string } | undefined)?.action ??
		"create";

	const validation = useMemo(() => validateVisualArtifact(rawOutput), [rawOutput]);
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
		return <VisualExplanationUpdateNotice artifact={validatedArtifact} />;
	}

	return (
		<VisualExplanationInstance
			artifact={validatedArtifact}
			className={className}
			initialExpanded={validatedArtifact.presentation === "panel"}
		/>
	);
}

export function VisualExplanationInstance({
	artifact: initialArtifact,
	className = "",
	initialExpanded = false,
}: {
	artifact: VisualArtifact;
	className?: string;
	initialExpanded?: boolean;
}) {
	// Active artifact (updated reactively when an update action arrives for this ID — Fix B)
	const [artifact, setArtifact] = useState<VisualArtifact>(() => {
		const registered = getRegisteredVisualArtifact(initialArtifact.id);
		return registered ?? initialArtifact;
	});

	// Register initial artifact outside render phase with idempotency check
	const lastRegisteredSignatureRef = useRef<string | null>(null);
	useEffect(() => {
		const sig = `${initialArtifact.id}:${initialArtifact.version}:${initialArtifact.title}:${initialArtifact.source.length}`;
		if (lastRegisteredSignatureRef.current !== sig) {
			lastRegisteredSignatureRef.current = sig;
			registerVisualArtifact(initialArtifact);
		}
	}, [initialArtifact]);

	const containerRef = useRef<HTMLDivElement>(null);
	const dialogRef = useRef<HTMLDivElement>(null);
	const expandButtonRef = useRef<HTMLButtonElement>(null);
	const lastFocusedElementRef = useRef<HTMLElement | null>(null);
	const iframeRef = useRef<HTMLIFrameElement>(null);

	// Shared artifact simulation state
	const [isExpanded, setIsExpanded] = useState(initialExpanded);
	const [isPlaying, setIsPlaying] = useState(false);
	const [isPageVisible, setIsPageVisible] = useState(() => (typeof document !== "undefined" ? !document.hidden : true));
	const [isIntersecting, setIsIntersecting] = useState(true);
	const [reducedMotion, setReducedMotion] = useState(false);

	// State dictionary initialized from initialState
	const initialStep = typeof artifact.initialState?.step === "number" ? (artifact.initialState.step as number) : 0;
	const [currentStep, setCurrentStep] = useState(initialStep);
	const [stateValues, setStateValues] = useState<Record<string, unknown>>(() => ({
		step: initialStep,
		...(artifact.initialState ?? {}),
	}));

	// Calculate maximum steps
	const detectedSvgSteps = useMemo(() => (artifact.renderer === "svg" ? countSvgSteps(artifact.source) : 0), [artifact]);
	const maxSteps = useMemo(() => {
		if (typeof artifact.initialState?.maxSteps === "number") return artifact.initialState.maxSteps as number;
		if (detectedSvgSteps > 0) return detectedSvgSteps;
		return 3;
	}, [artifact, detectedSvgSteps]);

	// Listen for artifact updates targeting this ID (Fix B: In-place update & state preservation)
	useEffect(() => {
		const unsubscribe = subscribeVisualArtifact(artifact.id, (updated) => {
			setArtifact(updated);
			const newDetectedSteps = updated.renderer === "svg" ? countSvgSteps(updated.source) : 0;
			const newMax =
				typeof updated.initialState?.maxSteps === "number"
					? (updated.initialState.maxSteps as number)
					: newDetectedSteps > 0
						? newDetectedSteps
						: 3;
			setStateValues((prev) => preserveCompatibleState(prev, updated, newMax));
			setCurrentStep((prev) => Math.min(prev, newMax));
		});
		return unsubscribe;
	}, [artifact.id]);

	// Accessibility: Reduced motion check
	useEffect(() => {
		if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
			if (artifact.accessibility?.reducedMotionFallback) {
				setReducedMotion(true);
			}
			return;
		}
		const mediaQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
		setReducedMotion(mediaQuery.matches || Boolean(artifact.accessibility?.reducedMotionFallback));

		const handler = (e: MediaQueryListEvent) => {
			setReducedMotion(e.matches || Boolean(artifact.accessibility?.reducedMotionFallback));
		};
		mediaQuery.addEventListener?.("change", handler);
		return () => mediaQuery.removeEventListener?.("change", handler);
	}, [artifact]);

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
				case "custom": {
					// Safe deterministic state transition without arbitrary code execution
					setStateValues((s) => {
						const currentVal = s[ctrl.id];
						const nextVal = typeof currentVal === "boolean" ? !currentVal : typeof currentVal === "number" ? currentVal + 1 : 1;
						return {
							...s,
							[ctrl.id]: nextVal,
							lastAction: ctrl.id,
						};
					});
					break;
				}
			}
		},
		[reducedMotion, handleReset, handleStepForward, handleStepBackward],
	);

	const handleSliderChange = useCallback((ctrl: VisualSliderControl, rawVal: number) => {
		const clamped = Math.max(ctrl.min, Math.min(ctrl.max, Number.isFinite(rawVal) ? rawVal : ctrl.value));
		setStateValues((s) => ({ ...s, [ctrl.id]: clamped }));
	}, []);

	const handleToggleChange = useCallback((id: string, value: boolean) => {
		setStateValues((s) => ({ ...s, [id]: value }));
	}, []);

	const handleSelectChange = useCallback((ctrl: VisualSelectControl, value: string) => {
		const isValidOption = ctrl.options.some((o) => o.value === value);
		const selectedVal = isValidOption ? value : ctrl.value;
		setStateValues((s) => ({ ...s, [ctrl.id]: selectedVal }));
	}, []);

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

	// Send state update to HTML iframe when stateValues change
	useEffect(() => {
		if (artifact.renderer === "html" && iframeRef.current?.contentWindow) {
			iframeRef.current.contentWindow.postMessage(
				{ type: "LH_VISUAL_STATE_UPDATE", state: stateValues },
				"*",
			);
		}
	}, [artifact.renderer, stateValues]);

	// Process SVG source with all bound control parameters and steps (Fix A)
	const processedSvgSource = useMemo(() => {
		if (artifact.renderer !== "svg") return artifact.source;
		return applyStateToSvg(artifact.source, currentStep, stateValues);
	}, [artifact, currentStep, stateValues]);

	// Render the inner visual frame (Fix C: exactly one active iframe/SVG is mounted at any time)
	const renderVisualContent = (expanded: boolean) => {
		if (artifact.renderer === "html") {
			const cssVars = Object.entries(stateValues)
				.map(([rawK, v]) => {
					const k = sanitizeCssIdent(rawK);
					if (!k) return "";
					if (typeof v === "number" && Number.isFinite(v)) return `--ctrl-${k}: ${v}; --param-${k}: ${v};`;
					if (typeof v === "boolean") return `--ctrl-${k}: ${v ? 1 : 0}; --param-${k}: ${v ? 1 : 0};`;
					if (typeof v === "string") {
						const safeVal = sanitizeCssValue(v);
						return `--ctrl-${k}: ${safeVal}; --param-${k}: ${safeVal};`;
					}
					return "";
				})
				.filter(Boolean)
				.join(" ");

			const safeStateJson = JSON.stringify(stateValues).replace(/</g, "\\u003c");

			const srcDoc = `
        <!DOCTYPE html>
        <html>
          <head>
            <meta charset="utf-8">
            <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data:; connect-src 'none'; frame-src 'none'; object-src 'none';">
            <style>
              :root { ${cssVars} }
              body { margin: 0; padding: 12px; font-family: system-ui, sans-serif; box-sizing: border-box; }
            </style>
            <script>
              window.__LH_STATE__ = ${safeStateJson};
              window.addEventListener('message', function(e) {
                if (e.data && e.data.type === 'LH_VISUAL_STATE_UPDATE') {
                  window.__LH_STATE__ = e.data.state;
                  window.dispatchEvent(new CustomEvent('lh-state-change', { detail: e.data.state }));
                }
              });
            </script>
          </head>
          <body>
            ${artifact.source}
          </body>
        </html>
      `;
			return (
				<iframe
					ref={iframeRef}
					title={artifact.title}
					sandbox="allow-scripts"
					srcDoc={srcDoc}
					className="w-full rounded-md border bg-white"
					style={{ height: expanded ? "60vh" : "260px" }}
					data-testid="visual-explanation-iframe"
				/>
			);
		}

		// SVG image boundary (isolated, reactive to state)
		return (
			<div
				className="flex items-center justify-center overflow-hidden rounded-md bg-white p-2"
				style={{ minHeight: expanded ? "340px" : "180px", maxHeight: expanded ? "70vh" : "360px" }}
				data-testid="visual-explanation-svg-container"
			>
				<SvgImage svg={processedSvgSource} className="block h-auto max-h-full max-w-full" />
			</div>
		);
	};

	// Controls toolbar (Fix A: renders buttons, sliders, toggles, selects)
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

					{/* Declarative controls from artifact descriptor (Fix A) */}
					{artifact.controls?.map((ctrl) => {
						switch (ctrl.type) {
							case "button":
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
							case "slider":
								return (
									<label key={ctrl.id} className="ml-2 flex items-center gap-1.5 text-muted-foreground">
										<span className="font-medium text-foreground">{ctrl.label}:</span>
										<input
											type="range"
											min={ctrl.min}
											max={ctrl.max}
											step={ctrl.step ?? 1}
											value={(stateValues[ctrl.id] as number) ?? ctrl.value}
											aria-label={ctrl.label}
											onChange={(e) => handleSliderChange(ctrl, Number.parseFloat(e.target.value))}
											className="h-1.5 w-18 cursor-pointer rounded-lg bg-secondary accent-primary"
											data-testid={`visual-control-slider-${ctrl.id}`}
										/>
										<span className="font-mono text-[10px]">
											{String((stateValues[ctrl.id] as number) ?? ctrl.value)}
										</span>
									</label>
								);
							case "toggle":
								return (
									<label key={ctrl.id} className="ml-2 flex cursor-pointer items-center gap-1.5 text-muted-foreground">
										<input
											type="checkbox"
											checked={Boolean(stateValues[ctrl.id] ?? ctrl.value)}
											aria-label={ctrl.label}
											onChange={(e) => handleToggleChange(ctrl.id, e.target.checked)}
											className="rounded border-border accent-primary"
											data-testid={`visual-control-toggle-${ctrl.id}`}
										/>
										<span className="font-medium text-foreground">{ctrl.label}</span>
									</label>
								);
							case "select":
								return (
									<label key={ctrl.id} className="ml-2 flex items-center gap-1.5 text-muted-foreground">
										<span className="font-medium text-foreground">{ctrl.label}:</span>
										<select
											value={(stateValues[ctrl.id] as string) ?? ctrl.value}
											aria-label={ctrl.label}
											onChange={(e) => handleSelectChange(ctrl, e.target.value)}
											className="rounded border bg-background px-1.5 py-0.5 text-xs text-foreground"
											data-testid={`visual-control-select-${ctrl.id}`}
										>
											{ctrl.options.map((opt) => (
												<option key={opt.value} value={opt.value}>
													{opt.label}
												</option>
											))}
										</select>
									</label>
								);
							default:
								return null;
						}
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
								`${slugFilename(artifact.title)}.${artifact.renderer}`,
								artifact.source,
								artifact.renderer === "svg" ? "image/svg+xml" : "text/html",
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

			{/* Inline Visual View or Expanded Placeholder (Fix C: Single active iframe) */}
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
