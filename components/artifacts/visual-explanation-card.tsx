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
	// Inject styling for step-based reveal if not already present
	const stepStyle = `
    <style>
      [data-step] { transition: opacity 0.2s ease, stroke-width 0.2s ease; }
      [data-step]:not([data-step="${currentStep}"]) { opacity: 0.35; }
      [data-step="${currentStep}"] { opacity: 1; filter: drop-shadow(0 0 3px rgba(37,99,235,0.4)); }
    </style>
  `;
	return source.replace(/<\/svg>/i, `${stepStyle}</svg>`);
}

export function VisualExplanationCard({ part, className = "" }: VisualExplanationCardProps) {
	// Extract artifact payload safely
	const rawOutput = (part.output as { artifact?: unknown })?.artifact ?? part.output ?? part.input;
	const validation = useMemo(() => validateVisualArtifact(rawOutput), [rawOutput]);
	const artifact = validation.sanitized;

	if (part.state === "output-error" || !validation.valid || !artifact) {
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

	return (
		<VisualExplanationInstance
			artifact={artifact}
			className={className}
			initialExpanded={artifact.presentation === "panel"}
		/>
	);
}

export function VisualExplanationInstance({
	artifact,
	className = "",
	initialExpanded = false,
}: {
	artifact: VisualArtifact;
	className?: string;
	initialExpanded?: boolean;
}) {
	const containerRef = useRef<HTMLDivElement>(null);
	const expandButtonRef = useRef<HTMLButtonElement>(null);

	// Shared artifact simulation state
	const [isExpanded, setIsExpanded] = useState(initialExpanded);
	const [isPlaying, setIsPlaying] = useState(false);
	const [isVisible, setIsVisible] = useState(true);
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

	// Accessibility: Reduced motion check
	useEffect(() => {
		if (typeof window === "undefined") return;
		const mediaQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
		setReducedMotion(mediaQuery.matches || Boolean(artifact.accessibility?.reducedMotionFallback));

		const handler = (e: MediaQueryListEvent) => {
			setReducedMotion(e.matches || Boolean(artifact.accessibility?.reducedMotionFallback));
		};
		mediaQuery.addEventListener?.("change", handler);
		return () => mediaQuery.removeEventListener?.("change", handler);
	}, [artifact]);

	// Visibility observer: suspend animation when offscreen
	useEffect(() => {
		if (!containerRef.current || typeof IntersectionObserver === "undefined") return;
		const observer = new IntersectionObserver(
			(entries) => {
				const entry = entries[0];
				setIsVisible(entry ? entry.isIntersecting : true);
			},
			{ threshold: 0.1 },
		);
		observer.observe(containerRef.current);

		const onVisibilityChange = () => {
			if (document.hidden) setIsVisible(false);
		};
		document.addEventListener("visibilitychange", onVisibilityChange);

		return () => {
			observer.disconnect();
			document.removeEventListener("visibilitychange", onVisibilityChange);
		};
	}, []);

	// Animation tick loop (paused when hidden, offscreen, or reduced motion)
	useEffect(() => {
		if (!isPlaying || !isVisible || reducedMotion) return;

		const timer = setInterval(() => {
			setCurrentStep((prev) => {
				const next = prev >= maxSteps ? 0 : prev + 1;
				setStateValues((s) => ({ ...s, step: next }));
				return next;
			});
		}, 1200);

		return () => clearInterval(timer);
	}, [isPlaying, isVisible, reducedMotion, maxSteps]);

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

	const handleSliderChange = useCallback((id: string, value: number) => {
		setStateValues((s) => ({ ...s, [id]: value }));
	}, []);

	const handleToggleChange = useCallback((id: string, value: boolean) => {
		setStateValues((s) => ({ ...s, [id]: value }));
	}, []);

	const handleSelectChange = useCallback((id: string, value: string) => {
		setStateValues((s) => ({ ...s, [id]: value }));
	}, []);

	// Handle panel open/close with focus hygiene
	const handleOpenPanel = () => {
		setIsExpanded(true);
	};

	const handleClosePanel = () => {
		setIsExpanded(false);
		setTimeout(() => expandButtonRef.current?.focus(), 50);
	};

	// Escape key to close panel
	useEffect(() => {
		if (!isExpanded) return;
		const onKeyDown = (e: KeyboardEvent) => {
			if (e.key === "Escape") {
				e.preventDefault();
				handleClosePanel();
			}
		};
		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, [isExpanded]);

	// Process source for step highlight
	const processedSvgSource = useMemo(() => {
		if (artifact.renderer !== "svg") return artifact.source;
		return applyStepToSvg(artifact.source, currentStep);
	}, [artifact, currentStep]);

	// Render the inner visual frame
	const renderVisualContent = (expanded: boolean) => {
		if (artifact.renderer === "html") {
			// Sandboxed iframe for HTML
			const srcDoc = `
        <!DOCTYPE html>
        <html>
          <head>
            <meta charset="utf-8">
            <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline';">
            <style>
              body { margin: 0; padding: 12px; font-family: system-ui, sans-serif; box-sizing: border-box; }
            </style>
          </head>
          <body>
            ${artifact.source}
          </body>
        </html>
      `;
			return (
				<iframe
					title={artifact.title}
					sandbox="allow-scripts"
					srcDoc={srcDoc}
					className="w-full rounded-md border bg-white"
					style={{ height: expanded ? "60vh" : "260px" }}
					data-testid="visual-explanation-iframe"
				/>
			);
		}

		// SVG image boundary (no script execution, isolated)
		return (
			<div
				className="flex items-center justify-center overflow-hidden rounded-md bg-white p-2"
				style={{ minHeight: expanded ? "340px" : "180px", maxHeight: expanded ? "70vh" : "360px" }}
				data-testid="visual-explanation-svg-container"
			>
				<SvgImage
					svg={processedSvgSource}
					className="block h-auto max-h-full max-w-full"
				/>
			</div>
		);
	};

	// Controls toolbar
	const renderControls = () => {
		const hasStepControls = maxSteps > 0 || artifact.controls?.some((c) => c.type === "button");

		return (
			<div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-border/40 pt-2 text-xs">
				<div className="flex flex-wrap items-center gap-1.5">
					{/* Standard Step / Play / Pause / Reset buttons */}
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

					{/* Custom declarative controls from artifact descriptor */}
					{artifact.controls?.map((ctrl) => {
						switch (ctrl.type) {
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
											onChange={(e) => handleSliderChange(ctrl.id, Number.parseFloat(e.target.value))}
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
											onChange={(e) => handleSelectChange(ctrl.id, e.target.value)}
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

			{/* Inline Visual View */}
			{renderVisualContent(false)}

			{/* Controls Toolbar */}
			{renderControls()}

			{/* Expanded Panel Overlay */}
			{isExpanded && (
				<div
					role="dialog"
					aria-modal="true"
					aria-label={artifact.title}
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
