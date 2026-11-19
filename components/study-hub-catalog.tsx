"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { TopBar } from "@/components/top-bar";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { usePlugins } from "@/components/plugins";
import { useSettingsDialog } from "@/components/settings/settings-dialog";
import { HostDialog } from "@/components/host-dialog";
import { HostMarkdown } from "@/components/host-markdown";
import { InteractionLayersProvider, useOptionalInteractionLayers } from "@/components/interaction-layers";
import { cn } from "@/lib/utils";
import { fuzzyScore, type PluginModeMetadata } from "@/src/core";
import {
	AlertCircleIcon,
	ArrowDownIcon,
	ArrowRightIcon,
	BookOpenIcon,
	BrainIcon,
	CalculatorIcon,
	CheckIcon,
	ChevronDownIcon,
	CodeIcon,
	FlaskConicalIcon,
	GaugeIcon,
	GraduationCapIcon,
	LayoutGridIcon,
	LightbulbIcon,
	Loader2Icon,
	NetworkIcon,
	PuzzleIcon,
	RefreshCwIcon,
	SearchIcon,
	SlidersHorizontalIcon,
	TargetIcon,
	XIcon,
} from "lucide-react";

/** Stably identify a mode by its canonical (pluginId, modeId) pair to prevent collisions. */
export function getModeKey(pluginId: string, modeId: string): string {
	return `${pluginId}:${modeId}`;
}

function useSafeRouter() {
	try {
		return useRouter();
	} catch {
		return {
			push: (url: string) => {
				if (typeof window !== "undefined") window.location.href = url;
			},
			back: () => {
				if (typeof window !== "undefined") window.history.back();
			},
			forward: () => {
				if (typeof window !== "undefined") window.history.forward();
			},
			refresh: () => {},
			replace: (url: string) => {
				if (typeof window !== "undefined") window.location.replace(url);
			},
			prefetch: () => {},
		};
	}
}

export function getModeIcon(iconName?: string) {
	switch (iconName) {
		case "BookOpen": return BookOpenIcon;
		case "Brain": return BrainIcon;
		case "Calculator": return CalculatorIcon;
		case "Code": return CodeIcon;
		case "FlaskConical": return FlaskConicalIcon;
		case "GraduationCap": return GraduationCapIcon;
		case "Lightbulb": return LightbulbIcon;
		case "Network": return NetworkIcon;
		case "Puzzle": return PuzzleIcon;
		case "Target": return TargetIcon;
		default: return LayoutGridIcon;
	}
}

function DifficultyDots({ difficulty }: { difficulty?: string }) {
	const level = difficulty === "advanced" ? 3 : difficulty === "intermediate" ? 2 : 1;
	return (
		<span className="inline-flex items-center gap-0.5" aria-hidden="true">
			<span className={cn("size-1.5 rounded-full", level >= 1 ? "bg-foreground/85" : "bg-muted-foreground/30")} />
			<span className={cn("size-1.5 rounded-full", level >= 2 ? "bg-foreground/85" : "bg-muted-foreground/30")} />
			<span className={cn("size-1.5 rounded-full", level >= 3 ? "bg-foreground/85" : "bg-muted-foreground/30")} />
		</span>
	);
}

export function DefaultModeBanner({
	mode,
	iconName,
	className,
}: {
	mode: PluginModeMetadata;
	iconName?: string;
	className?: string;
}) {
	const Icon = getModeIcon(iconName ?? mode.icon);
	return (
		<div className={cn("relative w-full h-full bg-[#090c14] flex items-center justify-center overflow-hidden select-none", className)}>
			{/* Faint subtle grid */}
			<svg className="absolute inset-0 w-full h-full opacity-10 text-foreground" fill="none" aria-hidden="true">
				<defs>
					<pattern id={`quiet-grid-${mode.pluginId}-${mode.id}`} width="20" height="20" patternUnits="userSpaceOnUse">
						<path d="M 20 0 L 0 0 0 20" fill="none" stroke="currentColor" strokeWidth="0.5" />
					</pattern>
				</defs>
				<rect width="100%" height="100%" fill={`url(#quiet-grid-${mode.pluginId}-${mode.id})`} />
			</svg>

			{/* Centered mode icon emblem */}
			<div className="relative z-10 flex size-11 items-center justify-center rounded-xl border border-border/40 bg-card/80 text-foreground/80 shadow-xs backdrop-blur-xs">
				<Icon className="size-5 stroke-[1.5]" />
			</div>
		</div>
	);
}

function ReadmeModeBanner({ imageUrl, mode }: { imageUrl: string | null; mode: PluginModeMetadata }) {
	const [imageFailed, setImageFailed] = useState(false);
	const hasImage = Boolean(imageUrl) && !imageFailed;
	return (
		<div className="relative w-full h-40 sm:h-48 overflow-hidden border-b border-border/40 bg-[#090c14] shrink-0 select-none">
			{hasImage ? (
				/* eslint-disable-next-line @next/next/no-img-element */
				<img
					src={imageUrl!}
					alt={mode.name}
					className="w-full h-full object-cover"
					onError={() => setImageFailed(true)}
				/>
			) : (
				<DefaultModeBanner mode={mode} iconName={mode.icon} />
			)}
		</div>
	);
}

interface StudyHubModeCardProps {
	mode: PluginModeMetadata;
	activePlugins: readonly { info: { id: string; enabled: boolean; manifest?: import("@/src/core").PluginManifest }; phase: string; error?: string }[];
	activeModeRenderers: readonly { pluginId: string; modeId: string }[];
	activeManager?: any;
	launchingModeKeys: Set<string>;
	handleOpenReadme: (mode: PluginModeMetadata) => void;
	handleLaunch: (mode: PluginModeMetadata) => void;
	style?: React.CSSProperties;
}

function StudyHubModeCard({
	mode,
	activePlugins,
	activeModeRenderers,
	activeManager,
	launchingModeKeys,
	handleOpenReadme,
	handleLaunch,
	style,
}: StudyHubModeCardProps) {
	const modeKey = getModeKey(mode.pluginId, mode.id);
	const IconComponent = getModeIcon(mode.icon);
	const isLaunching = launchingModeKeys.has(modeKey);
	const [imageFailed, setImageFailed] = useState(false);

	// Renderer check
	const hasRenderer = activeModeRenderers.some(
		r => r.pluginId === mode.pluginId && r.modeId === mode.id
	) || (activeManager?.getModeRenderer?.(mode.pluginId, mode.id) !== undefined);

	// Plugin check
	const plugin = activePlugins.find(p => p.info.id === mode.pluginId);
	const isPluginDisabled = plugin ? (!plugin.info.enabled || plugin.phase === "disabled") : false;
	const isPluginError = plugin ? plugin.phase === "error" : false;

	const isUnavailable = !hasRenderer || isPluginDisabled || isPluginError;

	let statusNotice: { text: string; testId: string; title?: string } | null = null;
	if (isPluginDisabled) {
		statusNotice = { text: "Plugin Disabled", testId: "mode-plugin-disabled", title: "The plugin providing this mode is disabled" };
	} else if (isPluginError) {
		statusNotice = { text: "Plugin Error", testId: "mode-plugin-error", title: plugin?.error ?? "Plugin encountered an error" };
	} else if (!hasRenderer) {
		statusNotice = { text: "Renderer Unavailable", testId: "mode-renderer-unavailable", title: "Frontend renderer is not registered in the browser" };
	}

	const rawImage = mode.image || plugin?.info?.manifest?.image;
	const assetPath = rawImage ? rawImage.replace(/^\/+/, "") : null;
	const imageUrl = rawImage
		? rawImage.startsWith("http://") || rawImage.startsWith("https://") || rawImage.startsWith("data:")
			? rawImage
			: rawImage.startsWith("/")
				? rawImage
				: assetPath!.startsWith("assets/")
					? `/api/plugins/${encodeURIComponent(mode.pluginId)}/${assetPath}`
					: `/api/plugins/${encodeURIComponent(mode.pluginId)}/assets/${assetPath}`
		: null;

	const hasImage = Boolean(imageUrl) && !imageFailed;

	return (
		<div
			data-testid={`study-hub-mode-card-${modeKey}`}
			data-mode-key={modeKey}
			data-plugin-id={mode.pluginId}
			data-mode-id={mode.id}
			tabIndex={0}
			role="button"
			style={style}
			aria-label={`View details and launch ${mode.name}`}
			onClick={(e) => {
				if ((e.target as HTMLElement | null)?.closest?.("button")) {
					return;
				}
				handleOpenReadme(mode);
			}}
			onKeyDown={(e) => {
				if (e.key === "Enter" || e.key === " ") {
					e.preventDefault();
					handleOpenReadme(mode);
				}
			}}
			className={cn(
				"group relative rounded-xl border flex flex-col justify-between transition-all duration-200 cursor-pointer text-left overflow-hidden h-full study-hub-card-enter",
				isPluginError
					? "border-destructive/40 bg-destructive/[0.02] shadow-xs hover:border-destructive/60 hover:bg-destructive/[0.04]"
					: isPluginDisabled
						? "border-border/40 opacity-75 bg-card/60"
						: isUnavailable
							? "border-border/40 opacity-75 bg-card/70"
							: isLaunching
								? "border-foreground/30 shadow-xs bg-card"
								: "border-border/60 hover:border-border hover:shadow-xs hover:bg-card/95 bg-card",
			)}
		>
			{/* Accent line: error indication or launching progress */}
			{isPluginError ? (
				<div className="absolute top-0 inset-x-0 h-0.5 z-20 bg-destructive/70" />
			) : isLaunching ? (
				<div className="absolute top-0 inset-x-0 h-0.5 z-20 bg-gradient-to-r from-transparent via-foreground/50 to-transparent animate-pulse" />
			) : null}

			{/* Top Image Banner: Blueprint fallback or loaded image without overlay conflict */}
			<div className={cn("relative w-full h-24 overflow-hidden border-b border-border/40 shrink-0 bg-[#090c14]", isPluginError && "grayscale-[35%]")}>
				{hasImage ? (
					/* eslint-disable-next-line @next/next/no-img-element */
					<img
						src={imageUrl!}
						alt={mode.name}
						draggable={false}
						className="w-full h-full object-cover select-none pointer-events-none"
						onError={() => setImageFailed(true)}
					/>
				) : (
					<DefaultModeBanner mode={mode} iconName={mode.icon} />
				)}
			</div>

			<div className="p-3.5 sm:p-4 flex-1 flex flex-col justify-between space-y-2.5">
				<div className="space-y-1.5">
					{/* Mode Header */}
					<div className="flex items-start gap-2.5">
						<div className={cn(
							"flex size-7 items-center justify-center rounded-lg border shrink-0 transition-colors mt-0.5",
							isPluginError
								? "border-destructive/30 bg-destructive/10 text-destructive"
								: "border-border/40 bg-muted/25 text-foreground group-hover:border-border/70 group-hover:bg-muted/40"
						)}>
							<IconComponent className="size-3.5 stroke-[1.5]" />
						</div>
						<div className="min-w-0 flex-1">
							<h3 className="font-medium text-foreground text-[13px] tracking-tight truncate leading-snug" title={mode.name}>
								{mode.name}
							</h3>
							{mode.category && (
								<p className="text-[11px] text-muted-foreground/70 truncate mt-0.5">
									{mode.category}
								</p>
							)}
						</div>
					</div>

					{/* Mode Description: Locked height to eliminate variance across plugins */}
					<p className="text-xs text-muted-foreground/80 line-clamp-2 leading-relaxed h-10 overflow-hidden">
						{mode.description}
					</p>
				</div>

				{/* Metadata: Difficulty, Activity type, Tags in one single-line quiet row */}
				<div className="h-5 overflow-hidden flex items-center gap-1.5 text-[11px]">
					{mode.difficulty && (
						<span
							data-slot="difficulty-badge"
							className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground/85 font-medium capitalize shrink-0"
						>
							<DifficultyDots difficulty={mode.difficulty} />
							<span>{mode.difficulty}</span>
						</span>
					)}
					{mode.activityType && (
						<>
							{mode.difficulty && <span className="text-border/60 shrink-0">·</span>}
							<span
								data-slot="activity-type-badge"
								className="text-[11px] text-muted-foreground/75 capitalize shrink-0"
							>
								{mode.activityType}
							</span>
						</>
					)}
					{mode.tags && mode.tags.slice(0, 2).map(tag => (
						<span
							key={tag}
							data-slot="tag-badge"
							className="text-[10.5px] font-mono text-muted-foreground/50 ml-0.5 truncate"
						>
							#{tag}
						</span>
					))}
				</div>
			</div>

			{/* Bottom Action Row: Uniform height pinned at bottom */}
			<div className="h-10 px-3.5 sm:px-4 border-t border-border/40 flex items-center justify-between gap-2 mt-auto bg-muted/10 shrink-0">
				<span
					onClick={(e) => {
						e.stopPropagation();
						handleOpenReadme(mode);
					}}
					className="text-[11px] text-muted-foreground/70 hover:text-foreground transition-colors flex items-center gap-1.5 font-medium py-1 px-1.5 -ml-1.5 rounded-md hover:bg-muted/40 cursor-pointer"
				>
					<BookOpenIcon className="size-3 text-muted-foreground/60" />
					<span>Readme</span>
				</span>

				<Button
					variant="ghost"
					size="sm"
					onClick={(e) => {
						if (typeof e?.stopPropagation === "function") {
							e.stopPropagation();
						}
						handleLaunch(mode);
					}}
					disabled={isUnavailable || isLaunching}
					aria-label={statusNotice ? statusNotice.text : `Launch ${mode.name}`}
					title={statusNotice?.title}
					data-testid={`launch-mode-${modeKey}`}
					className={cn(
						"h-7 px-2.5 gap-1.5 shrink-0 ml-auto text-xs font-medium rounded-lg transition-all duration-200",
						isLaunching
							? "bg-muted/50 text-foreground animate-pulse cursor-wait"
							: isPluginError
								? "border border-destructive/30 bg-destructive/5 text-destructive cursor-not-allowed opacity-90"
								: isPluginDisabled
									? "border border-border/50 bg-muted/30 text-muted-foreground/70 cursor-not-allowed opacity-75"
									: !hasRenderer
										? "border border-border/50 bg-muted/30 text-muted-foreground/70 cursor-not-allowed opacity-75"
										: "text-muted-foreground/80 hover:text-foreground hover:bg-muted/60 active:scale-[0.97] cursor-pointer"
					)}
				>
					{isLaunching ? (
						<>
							<Loader2Icon className="size-3 animate-spin text-muted-foreground" />
							<span className="text-[11px] tracking-tight">Launching...</span>
						</>
					) : isPluginError ? (
						<span data-testid="mode-plugin-error" className="inline-flex items-center gap-1.5">
							<AlertCircleIcon className="size-3 text-destructive shrink-0" />
							<span>Plugin Error</span>
						</span>
					) : isPluginDisabled ? (
						<span data-testid="mode-plugin-disabled" className="inline-flex items-center gap-1.5">
							<span className="size-1.5 rounded-full bg-muted-foreground/40 shrink-0" />
							<span>Plugin Disabled</span>
						</span>
					) : !hasRenderer ? (
						<span data-testid="mode-renderer-unavailable" className="inline-flex items-center gap-1.5">
							<span className="size-1.5 rounded-full bg-muted-foreground/40 shrink-0" />
							<span>Renderer Unavailable</span>
						</span>
					) : (
						<>
							<span>Launch</span>
							<ArrowRightIcon className="size-3 text-muted-foreground/50 transition-all duration-200 ease-out hover:translate-x-0.5 hover:text-foreground" />
						</>
					)}
				</Button>
			</div>
		</div>
	);
}

export interface StudyHubCatalogProps {
	/** Optional explicit modes list, overriding snapshot.modes when supplied. */
	modes?: PluginModeMetadata[];
	/** Optional list of registered frontend mode renderers. */
	modeRenderers?: readonly { pluginId: string; modeId: string }[];
	/** Optional list of plugins for state checking. */
	plugins?: readonly { info: { id: string; enabled: boolean; manifest?: import("@/src/core").PluginManifest }; phase: string; error?: string }[];
	/** Optional plugin manager override (for direct testing or custom host). */
	manager?: {
		createWorkspace(pluginId: string, modeId: string, title?: string): Promise<import("@/src/core").WorkspaceRecord>;
		getModeRenderer?(pluginId: string, modeId: string): any;
		reload?(): Promise<void>;
		refresh?(): Promise<void>;
		[key: string]: any;
	} | null;
	/** Optional router override (for testing navigation destinations). */
	router?: {
		push: (url: string) => void;
		back?: () => void;
		[key: string]: any;
	};
	/** Explicit loading override. */
	isLoading?: boolean;
	/** Explicit error message override. */
	error?: string;
	/** Custom launch handler, overriding default workspace creation when supplied. */
	onLaunch?: (mode: PluginModeMetadata) => Promise<void> | void;
	/** Custom retry/reload handler. */
	onRetry?: () => Promise<void> | void;
}

export function StudyHubCatalog({
	modes: propModes,
	modeRenderers: propModeRenderers,
	plugins: propPlugins,
	manager: propManager,
	router: propRouter,
	isLoading: propIsLoading,
	error: propError,
	onLaunch: propOnLaunch,
	onRetry: propOnRetry,
}: StudyHubCatalogProps) {
	const { manager: contextManager, snapshot } = usePlugins();
	const { open: openSettings } = useSettingsDialog();
	const safeRouter = useSafeRouter();

	const activeManager = propManager !== undefined ? propManager : contextManager;
	const activeRouter = propRouter ?? safeRouter;
	const layersController = useOptionalInteractionLayers();

	const [searchQuery, setSearchQuery] = useState("");
	const [selectedCategory, setSelectedCategory] = useState<string>("all");
	const [selectedDifficulty, setSelectedDifficulty] = useState<string>("all");
	const [isSearchFocused, setIsSearchFocused] = useState(false);
	const searchInputRef = useRef<HTMLInputElement>(null);
	const [launchingModeKeys, setLaunchingModeKeys] = useState<Set<string>>(() => new Set());
	const [launchError, setLaunchError] = useState<{ modeKey: string; message: string } | null>(null);
	const [retryError, setRetryError] = useState<string | null>(null);
	const [isRetrying, startRetryTransition] = useTransition();
	const [isTopicOpen, setIsTopicOpen] = useState(false);
	const [isDiffOpen, setIsDiffOpen] = useState(false);
	const topicMenuRef = useRef<HTMLDivElement>(null);
	const diffMenuRef = useRef<HTMLDivElement>(null);

	// Pull-to-refresh state
	const scrollContainerRef = useRef<HTMLDivElement>(null);
	const [pullDistance, setPullDistance] = useState(0);
	const pullDistanceRef = useRef(0);
	const [isPulling, setIsPulling] = useState(false);
	const dragStartYRef = useRef<number | null>(null);
	const isDraggingRef = useRef(false);
	const wasPullingRef = useRef(false);
	const wheelTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

	useEffect(() => {
		const handleKeyDown = (e: KeyboardEvent) => {
			if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
				e.preventDefault();
				searchInputRef.current?.focus();
			} else if (e.key === "Escape") {
				setIsTopicOpen(false);
				setIsDiffOpen(false);
			}
		};
		const handleMouseDown = (e: MouseEvent) => {
			if (topicMenuRef.current && !topicMenuRef.current.contains(e.target as Node)) {
				setIsTopicOpen(false);
			}
			if (diffMenuRef.current && !diffMenuRef.current.contains(e.target as Node)) {
				setIsDiffOpen(false);
			}
		};
		window.addEventListener("keydown", handleKeyDown);
		document.addEventListener("mousedown", handleMouseDown);
		return () => {
			window.removeEventListener("keydown", handleKeyDown);
			document.removeEventListener("mousedown", handleMouseDown);
		};
	}, []);

	// Readme documentation dialog state
	const [selectedReadmeMode, setSelectedReadmeMode] = useState<PluginModeMetadata | null>(null);
	const [readmeContent, setReadmeContent] = useState<string | null>(null);
	const [isLoadingReadme, setIsLoadingReadme] = useState(false);
	const [isLaunchPillVisible, setIsLaunchPillVisible] = useState(true);

	const handleReadmeScroll = (e: React.UIEvent<HTMLDivElement>) => {
		const { scrollTop, scrollHeight, clientHeight } = e.currentTarget;

		// If content fits without scrolling, keep visible
		if (scrollHeight <= clientHeight + 20) {
			setIsLaunchPillVisible(true);
			return;
		}

		// Visible only at the beginning (top) or end (bottom) of document
		const isAtTop = scrollTop <= 25;
		const isAtBottom = scrollTop + clientHeight >= scrollHeight - 35;

		setIsLaunchPillVisible(isAtTop || isAtBottom);
	};

	const handleOpenReadme = async (mode: PluginModeMetadata) => {
		if (wasPullingRef.current) return;
		setSelectedReadmeMode(mode);
		setIsLaunchPillVisible(true);
		if (mode.readme) {
			setReadmeContent(mode.readme);
			return;
		}
		setIsLoadingReadme(true);
		setReadmeContent(null);
		try {
			const res = await fetch(`/api/plugins/${encodeURIComponent(mode.pluginId)}/readme`);
			if (res.ok) {
				const data = await res.json();
				if (data?.readme && typeof data.readme === "string" && data.readme.trim()) {
					setReadmeContent(data.readme);
					return;
				}
			}
		} catch {
			// Fallback below
		} finally {
			setIsLoadingReadme(false);
		}
		const fallbackLines = [
			`# ${mode.name}`,
			``,
			mode.description,
			``,
			`**Topic:** ${mode.category}  `,
			mode.difficulty ? `**Difficulty:** ${mode.difficulty.charAt(0).toUpperCase() + mode.difficulty.slice(1)}  ` : null,
			mode.activityType ? `**Activity:** ${mode.activityType.charAt(0).toUpperCase() + mode.activityType.slice(1)}  ` : null,
			``,
			mode.capabilities && mode.capabilities.length > 0
				? `### Capabilities\n${mode.capabilities.map(c => `- ${c}`).join("\n")}\n`
				: null,
			mode.tags && mode.tags.length > 0
				? `### Topics & Tags\n${mode.tags.map(t => `\`#${t}\``).join(" ")}\n`
				: null,
		].filter(Boolean);
		setReadmeContent(fallbackLines.join("\n"));
	};

	// Modes resolution
	const activeModes = propModes ?? snapshot?.modes ?? [];
	const activeModesRef = useRef(activeModes);
	activeModesRef.current = activeModes;
	const isLoading = propIsLoading ?? snapshot?.loading ?? false;
	const errorMessage = retryError ?? propError ?? snapshot?.error;

	// Registered mode renderers in the browser
	const activeModeRenderers = propModeRenderers ?? snapshot?.modeRenderers ?? [];
	const activePlugins = propPlugins ?? snapshot?.plugins ?? [];

	// Extract unique categories and difficulties from available modes
	const categories = useMemo(() => {
		const set = new Set<string>();
		for (const mode of activeModes) {
			if (mode.category && mode.category.trim()) {
				set.add(mode.category.trim());
			}
		}
		return Array.from(set).sort((a, b) => a.localeCompare(b));
	}, [activeModes]);

	const hasDifficulties = useMemo(() => {
		return activeModes.some(m => !!m.difficulty);
	}, [activeModes]);

	// Filter modes based on search query, category, and difficulty
	const filteredModes = useMemo(() => {
		const query = searchQuery.trim();
		return activeModes.filter(mode => {
			// Category filter
			if (selectedCategory !== "all" && mode.category !== selectedCategory) {
				return false;
			}

			// Difficulty filter
			if (selectedDifficulty !== "all" && mode.difficulty !== selectedDifficulty) {
				return false;
			}

			// Text search
			if (!query) return true;

			const fields = [
				mode.name,
				mode.description,
				mode.category,
				mode.pluginId,
				mode.id,
				...(mode.tags ?? []),
				mode.activityType ?? "",
			].filter(Boolean) as string[];

			const score = fuzzyScore(query, ...fields);
			return score !== null;
		}).sort((a, b) => {
			if (query) {
				const scoreA = fuzzyScore(query, a.name, a.description, a.category, ...(a.tags ?? [])) ?? 0;
				const scoreB = fuzzyScore(query, b.name, b.description, b.category, ...(b.tags ?? [])) ?? 0;
				if (scoreB !== scoreA) return scoreB - scoreA;
			}
			return a.name.localeCompare(b.name);
		});
	}, [activeModes, searchQuery, selectedCategory, selectedDifficulty]);

	const handleRetry = () => {
		setLaunchError(null);
		setRetryError(null);
		startRetryTransition(async () => {
			try {
				if (propOnRetry) {
					await propOnRetry();
				} else if (activeManager?.reload) {
					await activeManager.reload();
				}
			} catch (err) {
				setRetryError(err instanceof Error ? err.message : "Failed to refresh study modes");
			}
		});
	};

	// Progressive pull-to-refresh handlers
	const handleMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
		if (e.button !== 0) return;
		if ((e.target as HTMLElement | null)?.closest?.("button, input, textarea, a")) {
			return;
		}
		const scrollTop = scrollContainerRef.current?.scrollTop ?? 0;
		if (scrollContainerRef.current && scrollTop <= 0) {
			dragStartYRef.current = e.clientY;
			isDraggingRef.current = true;
			wasPullingRef.current = false;
		}
	};

	const handleTouchStart = (e: React.TouchEvent<HTMLDivElement>) => {
		const touch = e.touches[0];
		if (!touch) return;
		const scrollTop = scrollContainerRef.current?.scrollTop ?? 0;
		if (scrollContainerRef.current && scrollTop <= 0) {
			dragStartYRef.current = touch.clientY;
			isDraggingRef.current = true;
			wasPullingRef.current = false;
		}
	};

	const handleTouchMove = (e: React.TouchEvent<HTMLDivElement>) => {
		if (!isDraggingRef.current || dragStartYRef.current === null) return;
		const touch = e.touches[0];
		if (!touch) return;
		const scrollTop = scrollContainerRef.current?.scrollTop ?? 0;
		if (!scrollContainerRef.current || scrollTop > 0) {
			if (pullDistanceRef.current > 0) {
				pullDistanceRef.current = 0;
				setPullDistance(0);
				setIsPulling(false);
			}
			return;
		}
		const currentY = touch.clientY;
		const diff = currentY - dragStartYRef.current;
		if (diff > 8) {
			setIsPulling(true);
			if (diff > 12) wasPullingRef.current = true;
			const distance = Math.min(96, (diff - 8) * 0.45);
			pullDistanceRef.current = distance;
			setPullDistance(distance);
		} else {
			pullDistanceRef.current = 0;
			setPullDistance(0);
			setIsPulling(false);
		}
	};

	const handleTouchEnd = () => {
		if (!isDraggingRef.current) return;
		isDraggingRef.current = false;
		setIsPulling(false);
		dragStartYRef.current = null;
		const shouldRetry = pullDistanceRef.current >= 76 && !isRetrying && !isLoading;
		pullDistanceRef.current = 0;
		setPullDistance(0);
		if (shouldRetry) {
			handleRetry();
		}
		setTimeout(() => {
			wasPullingRef.current = false;
		}, 100);
	};

	const handleWheel = (e: React.WheelEvent<HTMLDivElement>) => {
		const scrollTop = scrollContainerRef.current?.scrollTop ?? 0;
		if (scrollTop <= 0 && e.deltaY < 0 && !isRetrying && !isLoading) {
			const step = Math.min(80, Math.abs(e.deltaY) * 0.35);
			const next = Math.min(96, pullDistanceRef.current + step);
			pullDistanceRef.current = next;
			setIsPulling(true);
			setPullDistance(next);

			if (wheelTimeoutRef.current) {
				clearTimeout(wheelTimeoutRef.current);
			}

			if (next >= 76) {
				wheelTimeoutRef.current = setTimeout(() => {
					const shouldRetry = pullDistanceRef.current >= 76;
					pullDistanceRef.current = 0;
					setPullDistance(0);
					setIsPulling(false);
					if (shouldRetry) {
						handleRetry();
					}
				}, 220);
			} else {
				wheelTimeoutRef.current = setTimeout(() => {
					pullDistanceRef.current = 0;
					setPullDistance(0);
					setIsPulling(false);
				}, 300);
			}
		} else if (e.deltaY > 0 && pullDistanceRef.current > 0) {
			pullDistanceRef.current = 0;
			setPullDistance(0);
			setIsPulling(false);
			if (wheelTimeoutRef.current) {
				clearTimeout(wheelTimeoutRef.current);
			}
		}
	};

	useEffect(() => {
		const handleWindowMouseMove = (e: MouseEvent) => {
			if (!isDraggingRef.current || dragStartYRef.current === null) return;
			const scrollTop = scrollContainerRef.current?.scrollTop ?? 0;
			if (!scrollContainerRef.current || scrollTop > 0) {
				if (pullDistanceRef.current > 0) {
					pullDistanceRef.current = 0;
					setPullDistance(0);
					setIsPulling(false);
				}
				return;
			}
			const diff = e.clientY - dragStartYRef.current;
			if (diff > 8) {
				setIsPulling(true);
				if (diff > 12) wasPullingRef.current = true;
				const distance = Math.min(96, (diff - 8) * 0.45);
				pullDistanceRef.current = distance;
				setPullDistance(distance);
			} else {
				pullDistanceRef.current = 0;
				setPullDistance(0);
				setIsPulling(false);
			}
		};

		const handleWindowMouseUp = () => {
			if (!isDraggingRef.current) return;
			isDraggingRef.current = false;
			setIsPulling(false);
			dragStartYRef.current = null;
			const shouldRetry = pullDistanceRef.current >= 76 && !isRetrying && !isLoading;
			pullDistanceRef.current = 0;
			setPullDistance(0);
			if (shouldRetry) {
				handleRetry();
			}
			setTimeout(() => {
				wasPullingRef.current = false;
			}, 100);
		};

		const handleDragStart = (e: DragEvent) => {
			if (isDraggingRef.current) {
				e.preventDefault();
			}
		};

		window.addEventListener("mousemove", handleWindowMouseMove);
		window.addEventListener("mouseup", handleWindowMouseUp);
		window.addEventListener("dragstart", handleDragStart);
		return () => {
			window.removeEventListener("mousemove", handleWindowMouseMove);
			window.removeEventListener("mouseup", handleWindowMouseUp);
			window.removeEventListener("dragstart", handleDragStart);
			if (wheelTimeoutRef.current) {
				clearTimeout(wheelTimeoutRef.current);
			}
		};
	}, [isRetrying, isLoading]);

	const handleLaunch = async (mode: PluginModeMetadata) => {
		const modeKey = getModeKey(mode.pluginId, mode.id);

		// 1. Verify availability against latest modes
		const isModeStillPresent = activeModesRef.current.some(
			m => m.pluginId === mode.pluginId && m.id === mode.id
		);
		if (!isModeStillPresent) {
			setLaunchError({
				modeKey,
				message: `Mode "${mode.name}" is no longer available.`,
			});
			return;
		}

		// 2. Verify plugin state
		const owningPlugin = activePlugins.find(p => p.info.id === mode.pluginId);
		if (owningPlugin) {
			if (!owningPlugin.info.enabled || owningPlugin.phase === "disabled") {
				setLaunchError({
					modeKey,
					message: `Plugin "${mode.pluginId}" is disabled. Enable the plugin in Settings to launch this mode.`,
				});
				return;
			}
			if (owningPlugin.phase === "error") {
				setLaunchError({
					modeKey,
					message: `Plugin "${mode.pluginId}" encountered an error: ${owningPlugin.error || "Initialization failed"}.`,
				});
				return;
			}
		}

		// 3. Verify frontend renderer
		const hasRenderer = activeModeRenderers.some(
			r => r.pluginId === mode.pluginId && r.modeId === mode.id
		) || (activeManager?.getModeRenderer?.(mode.pluginId, mode.id) !== undefined);

		if (!hasRenderer) {
			setLaunchError({
				modeKey,
				message: `Interactive renderer for "${mode.name}" is not registered in the browser.`,
			});
			return;
		}

		// 4. Proceed with launch
		setLaunchError(null);
		setLaunchingModeKeys(prev => {
			const next = new Set(prev);
			next.add(modeKey);
			return next;
		});

		try {
			if (propOnLaunch) {
				await propOnLaunch(mode);
			} else if (activeManager) {
				const workspace = await activeManager.createWorkspace(mode.pluginId, mode.id);
				activeRouter.push(`/workspaces/${encodeURIComponent(workspace.id)}`);
			} else {
				const res = await fetch("/api/workspaces", {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({ pluginId: mode.pluginId, modeId: mode.id }),
				});
				if (!res.ok) {
					const data = await res.json().catch(() => ({}));
					throw new Error(data.error || `Failed to create workspace (${res.status})`);
				}
				const data = await res.json();
				activeRouter.push(`/workspaces/${encodeURIComponent(data.workspace.id)}`);
			}
		} catch (err) {
			setLaunchError({
				modeKey,
				message: err instanceof Error ? err.message : "Failed to launch workspace",
			});
		} finally {
			setLaunchingModeKeys(prev => {
				if (!prev.has(modeKey)) return prev;
				const next = new Set(prev);
				next.delete(modeKey);
				return next;
			});
		}
	};

	const clearFilters = () => {
		setSearchQuery("");
		setSelectedCategory("all");
		setSelectedDifficulty("all");
	};

	const hasActiveFilters = searchQuery.trim() !== "" || selectedCategory !== "all" || selectedDifficulty !== "all";

	const renderModeCard = (mode: PluginModeMetadata, index: number) => {
		const modeKey = getModeKey(mode.pluginId, mode.id);
		return (
			<StudyHubModeCard
				key={`${modeKey}-${searchQuery.trim().toLowerCase()}-${selectedCategory}-${selectedDifficulty}`}
				style={{ animationDelay: `${Math.min(index * 40, 240)}ms` }}
				mode={mode}
				activePlugins={activePlugins}
				activeModeRenderers={activeModeRenderers}
				activeManager={activeManager}
				launchingModeKeys={launchingModeKeys}
				handleOpenReadme={handleOpenReadme}
				handleLaunch={handleLaunch}
			/>
		);
	};

	return (
		<main data-testid="study-hub-page" className="relative flex h-dvh flex-col bg-background overflow-hidden">
			<TopBar>
				<div className="flex flex-1 items-center justify-between min-w-0 pr-1">
					<div className="flex items-center gap-2 min-w-0">
						<h1 data-testid="study-hub-title" className="font-title text-3xl tracking-tight text-foreground truncate">
							Study Hub
						</h1>
					</div>
					<div className="flex items-center gap-2 shrink-0">
						<button
							type="button"
							onClick={handleRetry}
							disabled={isRetrying || isLoading}
							aria-label="Refresh study modes"
							title="Refresh study modes"
							data-testid="study-hub-refresh-button"
							className="sr-only"
						>
							Refresh
						</button>
					</div>
				</div>
			</TopBar>

			<div
				ref={scrollContainerRef}
				onMouseDown={handleMouseDown}
				onTouchStart={handleTouchStart}
				onTouchMove={handleTouchMove}
				onTouchEnd={handleTouchEnd}
				onWheel={handleWheel}
				className="flex-1 overflow-y-auto overflow-x-hidden px-4 sm:px-6 py-6 pb-48 max-w-6xl w-full mx-auto overscroll-y-contain"
			>
				{/* Progressive Pull-To-Refresh Indicator */}
				<div
					data-testid="study-hub-pull-indicator"
					aria-hidden={pullDistance === 0 && !isRetrying}
					className={cn(
						"w-full flex justify-center pointer-events-none select-none transition-all",
						isPulling ? "duration-75" : "duration-300 ease-out"
					)}
					style={{
						height: isRetrying ? 52 : pullDistance > 0 ? pullDistance : 0,
						opacity: isRetrying ? 1 : pullDistance > 0 ? Math.min(1, pullDistance / 10) : 0,
						marginBottom: isRetrying ? 12 : pullDistance > 0 ? 8 : 0,
					}}
				>
					<div
						className={cn(
							"flex items-center justify-center size-10 rounded-full bg-card border border-border shadow-lg relative transition-transform",
							isPulling ? "duration-0" : "duration-200 ease-out"
						)}
						style={{
							transform: `scale(${isRetrying ? 1 : Math.min(1, Math.max(0.6, pullDistance / 28))})`,
						}}
					>
						<svg className="size-6 text-muted-foreground/25" viewBox="0 0 24 24">
							<circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2.5" fill="none" />
							<circle
								cx="12"
								cy="12"
								r="9"
								stroke="currentColor"
								strokeWidth="2.5"
								fill="none"
								className="text-primary transition-[stroke-dashoffset] duration-75"
								strokeDasharray={56.55}
								strokeDashoffset={56.55 * (1 - Math.min(1, pullDistance / 76))}
								strokeLinecap="round"
								transform="rotate(-90 12 12)"
							/>
						</svg>
						<div className="absolute inset-0 flex items-center justify-center">
							{isRetrying ? (
								<RefreshCwIcon className="size-4 text-primary animate-spin" />
							) : (
								<ArrowDownIcon
									className={cn(
										"size-4 transition-transform duration-200",
										pullDistance >= 76 ? "rotate-180 text-primary" : "rotate-0 text-muted-foreground"
									)}
								/>
							)}
						</div>
					</div>
				</div>

				<div className="space-y-6">
					{/* Error Notice */}
				{errorMessage && (
					<div
						role="alert"
						data-testid="study-hub-error"
						className="rounded-xl border border-destructive/30 bg-destructive/10 p-4 text-destructive flex items-start gap-3"
					>
						<AlertCircleIcon className="size-5 shrink-0 mt-0.5" />
						<div className="flex-1 space-y-1">
							<p className="font-medium text-sm">Failed to load study modes</p>
							<p className="text-xs opacity-90">{errorMessage}</p>
						</div>
						<Button
							variant="outline"
							size="sm"
							onClick={handleRetry}
							data-testid="study-hub-retry-button"
							className="shrink-0 h-8 px-3 rounded-lg border-destructive/30 hover:bg-destructive/20 text-destructive cursor-pointer text-xs"
						>
							Retry
						</Button>
					</div>
				)}

				{/* Launch Error Notice */}
				{launchError && (
					<div
						role="alert"
						data-testid="study-hub-launch-error"
						className="rounded-xl border border-destructive/30 bg-destructive/10 p-4 text-destructive flex items-start justify-between gap-3"
					>
						<div className="flex items-start gap-3">
							<AlertCircleIcon className="size-5 shrink-0 mt-0.5" />
							<div className="space-y-1">
								<p className="font-medium text-sm">Launch Error</p>
								<p className="text-xs opacity-90">{launchError.message}</p>
							</div>
						</div>
						<button
							type="button"
							onClick={() => setLaunchError(null)}
							aria-label="Dismiss error"
							className="p-1 rounded-md text-destructive hover:bg-destructive/20 cursor-pointer transition-colors"
						>
							<XIcon className="size-4" />
						</button>
					</div>
				)}

				{/* Catalog Content States */}
				{isLoading ? (
					<div
						data-testid="study-hub-loading"
						className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4.5"
					>
						{[1, 2, 3, 4, 5, 6].map(n => (
							<div
								key={n}
								className="rounded-xl border border-border/40 bg-card p-4 sm:p-5 animate-pulse space-y-3"
							>
								<div className="flex items-start gap-3">
									<div className="size-8 rounded-lg bg-muted/60 shrink-0" />
									<div className="space-y-1.5 flex-1 min-w-0">
										<div className="h-4 w-2/3 bg-muted/60 rounded" />
										<div className="h-3 w-1/3 bg-muted/40 rounded" />
									</div>
								</div>
								<div className="space-y-1.5 pt-1">
									<div className="h-3 w-full bg-muted/40 rounded" />
									<div className="h-3 w-4/5 bg-muted/40 rounded" />
								</div>
								<div className="flex gap-1.5 pt-1">
									<div className="h-4 w-16 bg-muted/40 rounded-md" />
									<div className="h-4 w-14 bg-muted/40 rounded-md" />
								</div>
								<div className="mt-4 pt-3 border-t border-border/30 flex items-center justify-between">
									<div className="h-3 w-14 bg-muted/30 rounded" />
									<div className="h-7 w-20 bg-muted/60 rounded-lg" />
								</div>
							</div>
						))}
					</div>
				) : errorMessage && activeModes.length === 0 ? (
					/* Loading error when catalog is not available: do not show empty catalog */
					null
				) : activeModes.length === 0 ? (
					/* Empty Catalog State */
					<div
						data-testid="study-hub-empty"
						className="rounded-xl border border-border/50 bg-card p-10 sm:p-12 text-center max-w-md mx-auto space-y-4"
					>
						<div className="mx-auto flex size-12 items-center justify-center rounded-lg border border-border/40 bg-muted/40 text-muted-foreground">
							<LayoutGridIcon className="size-6 stroke-[1.5]" />
						</div>
						<div className="space-y-1.5">
							<h3 className="text-base font-semibold text-foreground">No Learning Modes Available</h3>
							<p className="text-xs text-muted-foreground leading-relaxed">
								Study Hub is ready, but no installed plugins currently provide interactive learning modes. Install or enable a plugin that includes study modes to get started.
							</p>
						</div>
						<div className="pt-2">
							<Button
								variant="outline"
								size="sm"
								onClick={() => openSettings("plugins")}
								data-testid="study-hub-browse-plugins"
								className="cursor-pointer rounded-lg border-border/50 text-xs font-medium hover:bg-muted/60"
							>
								Browse Community Plugins
							</Button>
						</div>
					</div>
				) : filteredModes.length === 0 ? (
					/* No Search Results State */
					<div
						data-testid="study-hub-no-results"
						className="rounded-xl border border-border/50 bg-card p-10 sm:p-12 text-center max-w-md mx-auto space-y-4 study-hub-card-enter"
					>
						<div className="mx-auto flex size-12 items-center justify-center rounded-lg border border-border/40 bg-muted/40 text-muted-foreground">
							<SearchIcon className="size-6 stroke-[1.5]" />
						</div>
						<div className="space-y-1.5">
							<h3 className="text-base font-semibold text-foreground">No matching modes found</h3>
							<p className="text-xs text-muted-foreground leading-relaxed">
								No study modes match your search or filter criteria. Try adjusting your search query or removing active filters.
							</p>
						</div>
						<div className="pt-2">
							<Button
								variant="outline"
								size="sm"
								onClick={clearFilters}
								data-testid="study-hub-reset-search"
								className="cursor-pointer rounded-lg border-border/50 text-xs font-medium hover:bg-muted/60"
							>
								Reset Filters
							</Button>
						</div>
					</div>
				) : (
					/* Populated Catalog Grid: Continuous unified grid */
					<div className="space-y-3">
						{hasActiveFilters && (
							<div className="flex items-center justify-between text-xs text-muted-foreground pb-0.5 study-hub-card-enter">
								<span>
									{searchQuery.trim() !== ""
										? `Search results for “${searchQuery}”`
										: selectedCategory !== "all"
											? selectedCategory
											: "Results"}{" "}
									• {filteredModes.length} {filteredModes.length === 1 ? "mode" : "modes"} found
								</span>
							</div>
						)}
						<div
							data-testid="study-hub-grid"
							className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4.5 items-stretch"
						>
							{filteredModes.map((mode, index) => renderModeCard(mode, index))}
						</div>
					</div>
				)}
				</div>
			</div>

			{/* Floating Search & Filter Dock */}
			{activeModes.length > 0 && (
				<div className="pointer-events-none absolute inset-x-0 bottom-0 pb-5 z-20">
					<div className="pointer-events-auto mx-auto w-full max-w-[46rem] px-4 space-y-2.5">
						{/* Filter Pills Action Row (inspired by home.tsx ComposerActions) */}
						{(categories.length > 1 || hasDifficulties) && (
							<div className="flex flex-wrap items-center gap-2 text-xs mb-1">
								{/* Topic Filter Pill & Popover */}
								{categories.length > 1 && (
									<div ref={topicMenuRef} data-testid="study-hub-category-filters" className="relative flex items-center gap-1.5">
										<button
											type="button"
											onClick={() => {
												setIsTopicOpen(prev => !prev);
												setIsDiffOpen(false);
											}}
											aria-expanded={isTopicOpen}
											className={cn(
												"flex cursor-pointer items-center gap-1.5 rounded-full px-3 py-1.5 font-ui text-xs transition-colors shadow-2xs backdrop-blur-xs select-none",
												selectedCategory !== "all"
													? "border border-border bg-card text-foreground hover:bg-accent"
													: "border border-dashed border-border/80 bg-card/60 text-muted-foreground hover:border-border hover:bg-card hover:text-foreground"
											)}
										>
											<SlidersHorizontalIcon aria-hidden="true" className="size-3 text-muted-foreground" />
											<span>Topic</span>
											{selectedCategory === "all" ? (
												<span className="text-[10px] opacity-60">({categories.length})</span>
											) : (
												<span className="font-semibold text-foreground truncate max-w-[120px]">{selectedCategory}</span>
											)}
											<ChevronDownIcon className={cn("size-3 opacity-60 transition-transform duration-150", isTopicOpen && "rotate-180")} />
										</button>

										{/* Active Topic Chip (with quick clear) if filtered */}
										{selectedCategory !== "all" && (
											<button
												type="button"
												onClick={() => setSelectedCategory("all")}
												aria-label="Clear topic filter"
												className="flex cursor-pointer items-center justify-center size-5 rounded-full bg-muted/60 hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
												title="Clear topic"
											>
												<XIcon className="size-3" />
											</button>
										)}

										{/* Popover Menu: Anchored above, handles many options gracefully */}
										<div
											className={cn(
												"absolute bottom-full mb-2 left-0 z-30 min-w-[220px] max-w-[300px] w-max rounded-xl border border-border/80 bg-card/95 p-1.5 shadow-xl backdrop-blur-md",
												isTopicOpen ? "study-hub-popover-enter" : "hidden"
											)}
										>
											<div className="px-2.5 py-1 text-[10px] font-mono uppercase tracking-wider text-muted-foreground/70 flex items-center justify-between border-b border-border/40 mb-1">
												<span>Topics</span>
												<span className="tabular-nums font-mono">{categories.length}</span>
											</div>
											<div className="max-h-56 overflow-y-auto overscroll-contain space-y-0.5 pr-0.5">
												<button
													type="button"
													onClick={() => {
														setSelectedCategory("all");
														setIsTopicOpen(false);
													}}
													aria-pressed={selectedCategory === "all"}
													data-testid="filter-category-all"
													className={cn(
														"flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 text-xs text-left cursor-pointer transition-colors",
														selectedCategory === "all"
															? "bg-accent text-foreground font-medium"
															: "text-muted-foreground hover:bg-muted/50 hover:text-foreground"
													)}
												>
													<span>All topics</span>
													<span className="text-[10px] font-mono text-muted-foreground/70 tabular-nums">({activeModes.length})</span>
												</button>

												{categories.map(cat => {
													const count = activeModes.filter(m => m.category === cat).length;
													const isSelected = selectedCategory === cat;
													return (
														<button
															key={cat}
															type="button"
															onClick={() => {
																setSelectedCategory(isSelected ? "all" : cat);
																setIsTopicOpen(false);
															}}
															aria-pressed={isSelected}
															data-testid={`filter-category-${cat.toLowerCase().replace(/\s+/g, "-")}`}
															className={cn(
																"flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 text-xs text-left cursor-pointer transition-colors",
																isSelected
																	? "bg-accent text-foreground font-medium"
																	: "text-muted-foreground hover:bg-muted/50 hover:text-foreground"
															)}
															title={cat}
														>
															<div className="flex items-center gap-2 min-w-0 flex-1">
																{isSelected && <CheckIcon className="size-3 text-primary shrink-0" />}
																<span className="truncate">{cat}</span>
															</div>
															<span className="text-[10px] font-mono text-muted-foreground/70 tabular-nums shrink-0">
																({count})
															</span>
														</button>
													);
												})}
											</div>
										</div>
									</div>
								)}

								{/* Difficulty Filter Pill & Popover */}
								{hasDifficulties && (
									<div ref={diffMenuRef} data-testid="study-hub-difficulty-filters" className="relative flex items-center gap-1.5">
										<button
											type="button"
											onClick={() => {
												setIsDiffOpen(prev => !prev);
												setIsTopicOpen(false);
											}}
											aria-expanded={isDiffOpen}
											className={cn(
												"flex cursor-pointer items-center gap-1.5 rounded-full px-3 py-1.5 font-ui text-xs transition-colors shadow-2xs backdrop-blur-xs select-none",
												selectedDifficulty !== "all"
													? "border border-border bg-card text-foreground hover:bg-accent"
													: "border border-dashed border-border/80 bg-card/60 text-muted-foreground hover:border-border hover:bg-card hover:text-foreground"
											)}
										>
											<GaugeIcon aria-hidden="true" className="size-3 text-muted-foreground" />
											<span>Difficulty</span>
											{selectedDifficulty !== "all" && (
												<span className="font-semibold text-foreground capitalize truncate max-w-[100px]">{selectedDifficulty}</span>
											)}
											<ChevronDownIcon className={cn("size-3 opacity-60 transition-transform duration-150", isDiffOpen && "rotate-180")} />
										</button>

										{/* Active Difficulty Chip (with quick clear) if filtered */}
										{selectedDifficulty !== "all" && (
											<button
												type="button"
												onClick={() => setSelectedDifficulty("all")}
												aria-label="Clear difficulty filter"
												className="flex cursor-pointer items-center justify-center size-5 rounded-full bg-muted/60 hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
												title="Clear difficulty"
											>
												<XIcon className="size-3" />
											</button>
										)}

										{/* Popover Menu */}
										<div
											className={cn(
												"absolute bottom-full mb-2 left-0 z-30 min-w-[190px] rounded-xl border border-border/80 bg-card/95 p-1.5 shadow-xl backdrop-blur-md",
												isDiffOpen ? "study-hub-popover-enter" : "hidden"
											)}
										>
											<div className="px-2.5 py-1 text-[10px] font-mono uppercase tracking-wider text-muted-foreground/70 flex items-center justify-between border-b border-border/40 mb-1">
												<span>Difficulty</span>
											</div>
											<div className="space-y-0.5">
												{(["all", "beginner", "intermediate", "advanced"] as const).map(diff => {
													const count = diff === "all"
														? activeModes.length
														: activeModes.filter(m => m.difficulty === diff).length;
													if (diff !== "all" && count === 0) return null;
													const isSelected = selectedDifficulty === diff;
													return (
														<button
															key={diff}
															type="button"
															onClick={() => {
																setSelectedDifficulty(isSelected ? "all" : diff);
																setIsDiffOpen(false);
															}}
															aria-pressed={isSelected}
															data-testid={`filter-difficulty-${diff}`}
															className={cn(
																"flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 text-xs text-left cursor-pointer transition-colors capitalize",
																isSelected
																	? "bg-accent text-foreground font-medium"
																	: "text-muted-foreground hover:bg-muted/50 hover:text-foreground"
															)}
														>
															<div className="flex items-center gap-2 min-w-0">
																{isSelected && <CheckIcon className="size-3 text-primary shrink-0" />}
																{diff !== "all" && <DifficultyDots difficulty={diff} />}
																<span>{diff === "all" ? "All levels" : diff}</span>
															</div>
															<span className="text-[10px] font-mono text-muted-foreground/70 tabular-nums">
																({count})
															</span>
														</button>
													);
												})}
											</div>
										</div>
									</div>
								)}
							</div>
						)}

						{/* Search Bar Card */}
						<div
							onClick={() => searchInputRef.current?.focus()}
							className={cn(
								"group relative flex items-center rounded-2xl border bg-card/90 p-2 shadow-lg backdrop-blur transition-all duration-200 cursor-text",
								isSearchFocused
									? "border-foreground/30 ring-1 ring-foreground/20 shadow-xl bg-card"
									: "border-border/80 hover:border-border hover:shadow-xl"
							)}
						>
							<div className="flex size-9 items-center justify-center rounded-xl bg-muted/40 text-muted-foreground transition-colors group-hover:text-foreground shrink-0 mr-2.5">
								<SearchIcon className={cn("size-4 transition-transform duration-200", isSearchFocused && "scale-110 text-primary")} />
							</div>

							<input
								ref={searchInputRef}
								type="text"
								value={searchQuery}
								onChange={e => setSearchQuery(e.target.value)}
								onFocus={() => setIsSearchFocused(true)}
								onBlur={() => setIsSearchFocused(false)}
								placeholder="Search study modes by name, topic, or tags…"
								aria-label="Search study modes"
								data-testid="study-hub-search-input"
								className="h-8 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground text-foreground"
							/>

							{searchQuery ? (
								<button
									type="button"
									onClick={(e) => {
										e.stopPropagation();
										setSearchQuery("");
										searchInputRef.current?.focus();
									}}
									aria-label="Clear search"
									data-testid="study-hub-clear-search"
									className="flex size-7 items-center justify-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/60 cursor-pointer transition-colors shrink-0 mr-1"
								>
									<XIcon className="size-3.5" />
								</button>
							) : (
								<div className="hidden sm:flex items-center gap-1 rounded border border-border/60 bg-muted/30 px-1.5 py-0.5 text-[10px] font-mono text-muted-foreground shrink-0 mr-1 select-none pointer-events-none">
									<kbd>⌘</kbd>
									<kbd>K</kbd>
								</div>
							)}
						</div>
					</div>
				</div>
			)}

			{/* Readme Documentation Modal Dialog */}
			{selectedReadmeMode && (() => {
				const plugin = activePlugins.find(p => p.info.id === selectedReadmeMode.pluginId);
				const rawImage = selectedReadmeMode.image || plugin?.info?.manifest?.image;
				const assetPath = rawImage ? rawImage.replace(/^\/+/, "") : null;
				const imageUrl = rawImage
					? rawImage.startsWith("http://") || rawImage.startsWith("https://") || rawImage.startsWith("data:")
						? rawImage
						: rawImage.startsWith("/")
							? rawImage
							: assetPath!.startsWith("assets/")
								? `/api/plugins/${encodeURIComponent(selectedReadmeMode.pluginId)}/${assetPath}`
								: `/api/plugins/${encodeURIComponent(selectedReadmeMode.pluginId)}/assets/${assetPath}`
					: null;

				const modeKey = getModeKey(selectedReadmeMode.pluginId, selectedReadmeMode.id);
				const hasRenderer = activeModeRenderers.some(
					r => r.pluginId === selectedReadmeMode.pluginId && r.modeId === selectedReadmeMode.id
				) || (activeManager?.getModeRenderer?.(selectedReadmeMode.pluginId, selectedReadmeMode.id) !== undefined);
				const isPluginDisabled = plugin ? (!plugin.info.enabled || plugin.phase === "disabled") : false;
				const isPluginError = plugin ? plugin.phase === "error" : false;
				const isLaunchDisabled = !hasRenderer || isPluginDisabled || isPluginError || launchingModeKeys.has(modeKey);

				const dialogElement = (
					<HostDialog
						open={Boolean(selectedReadmeMode)}
						onClose={() => setSelectedReadmeMode(null)}
						aria-label={`Documentation for ${selectedReadmeMode.name}`}
						backdropProps={{
							"data-testid": "study-hub-readme-dialog-backdrop",
							className: "fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 sm:p-6",
						}}
						frame={
							<div
								data-testid="study-hub-readme-dialog"
								className="relative max-h-[88vh] w-full max-w-3xl flex flex-col rounded-2xl border border-border bg-card shadow-2xl overflow-hidden"
								onClick={(e) => e.stopPropagation()}
							/>
						}
					>
						{/* Floating Round Close Button */}
						<button
							type="button"
							onClick={() => setSelectedReadmeMode(null)}
							aria-label="Close documentation"
							data-testid="study-hub-close-readme"
							className="absolute top-3.5 right-3.5 z-30 size-8 sm:size-9 rounded-full flex items-center justify-center bg-background/80 hover:bg-background text-muted-foreground hover:text-foreground backdrop-blur-md border border-border/50 shadow-xs transition-colors cursor-pointer"
						>
							<XIcon className="size-4" />
						</button>

						{/* Modal Scrollable Content */}
						<div onScroll={handleReadmeScroll} className="flex-1 overflow-y-auto">
							{/* Full-bleed Banner */}
							<ReadmeModeBanner imageUrl={imageUrl} mode={selectedReadmeMode} />

							<div className="p-6 sm:p-7 space-y-5 pb-8">
								{/* Quick Metadata Bar (unslopped) */}
								{(selectedReadmeMode.difficulty || selectedReadmeMode.activityType || (selectedReadmeMode.tags && selectedReadmeMode.tags.length > 0)) && (
									<div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-muted-foreground/80 pb-3 border-b border-border/30">
										{selectedReadmeMode.difficulty && (
											<div className="inline-flex items-center gap-1.5 text-foreground/85 font-medium">
												<DifficultyDots difficulty={selectedReadmeMode.difficulty} />
												<span className="capitalize">{selectedReadmeMode.difficulty}</span>
											</div>
										)}
										{selectedReadmeMode.difficulty && (selectedReadmeMode.activityType || (selectedReadmeMode.tags && selectedReadmeMode.tags.length > 0)) && (
											<span className="text-border/70" aria-hidden="true">•</span>
										)}
										{selectedReadmeMode.activityType && (
											<span className="capitalize text-muted-foreground">
												{selectedReadmeMode.activityType}
											</span>
										)}
										{selectedReadmeMode.activityType && selectedReadmeMode.tags && selectedReadmeMode.tags.length > 0 && (
											<span className="text-border/70" aria-hidden="true">•</span>
										)}
										{selectedReadmeMode.tags?.map(t => (
											<span key={t} className="text-muted-foreground/70 font-mono text-[11px]">
												#{t}
											</span>
										))}
									</div>
								)}

								{/* Markdown Body */}
								{isLoadingReadme ? (
									<div
										data-testid="study-hub-readme-loading"
										className="animate-pulse space-y-4 py-2 select-none"
									>
										{/* Title skeleton */}
										<div className="h-6 w-3/5 bg-muted/60 rounded-md" />

										{/* Paragraph 1 */}
										<div className="space-y-2 pt-1">
											<div className="h-3.5 w-full bg-muted/40 rounded" />
											<div className="h-3.5 w-[92%] bg-muted/40 rounded" />
											<div className="h-3.5 w-[75%] bg-muted/40 rounded" />
										</div>

										{/* Section Heading */}
										<div className="h-5 w-2/5 bg-muted/50 rounded-md pt-2" />

										{/* Bullet list */}
										<div className="space-y-2.5 pt-1">
											<div className="flex items-center gap-2">
												<div className="size-1.5 rounded-full bg-muted/50 shrink-0" />
												<div className="h-3.5 w-2/3 bg-muted/40 rounded" />
											</div>
											<div className="flex items-center gap-2">
												<div className="size-1.5 rounded-full bg-muted/50 shrink-0" />
												<div className="h-3.5 w-1/2 bg-muted/40 rounded" />
											</div>
											<div className="flex items-center gap-2">
												<div className="size-1.5 rounded-full bg-muted/50 shrink-0" />
												<div className="h-3.5 w-3/5 bg-muted/40 rounded" />
											</div>
										</div>

										{/* Paragraph 2 */}
										<div className="space-y-2 pt-2">
											<div className="h-3.5 w-[95%] bg-muted/40 rounded" />
											<div className="h-3.5 w-[80%] bg-muted/40 rounded" />
										</div>
									</div>
								) : readmeContent ? (
									<div className="prose prose-sm dark:prose-invert max-w-none text-foreground/90 leading-relaxed text-xs sm:text-sm">
										<HostMarkdown text={readmeContent} />
									</div>
								) : null}

								{/* Bottom spacer so floating Launch pill never overlaps text at the end of the document */}
								<div className="h-20 shrink-0 select-none pointer-events-none" aria-hidden="true" />
							</div>
						</div>

						{/* Floating Animated Launch Pill */}
						<div className="absolute bottom-5 inset-x-0 flex justify-center z-20 pointer-events-none">
							<button
								type="button"
								onClick={() => {
									const mode = selectedReadmeMode;
									setSelectedReadmeMode(null);
									handleLaunch(mode);
								}}
								disabled={isLaunchDisabled}
								data-testid="study-hub-readme-launch-button"
								className={cn(
									"pointer-events-auto inline-flex items-center justify-center gap-2 px-6 py-2.5 rounded-full text-xs sm:text-sm font-medium shadow-xl border border-foreground/10",
									"bg-foreground text-background hover:bg-foreground/90 active:scale-[0.98]",
									"transition-all duration-300 ease-out cursor-pointer select-none",
									"disabled:opacity-50 disabled:pointer-events-none",
									isLaunchPillVisible
										? "translate-y-0 opacity-100"
										: "translate-y-14 opacity-0 pointer-events-none"
								)}
							>
								<span>Launch Mode</span>
								<ArrowRightIcon className="size-3.5 sm:size-4" />
							</button>
						</div>
					</HostDialog>
				);

				return layersController ? dialogElement : (
					<InteractionLayersProvider>
						{dialogElement}
					</InteractionLayersProvider>
				);
			})()}
		</main>
	);
}
