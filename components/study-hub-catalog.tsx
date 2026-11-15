"use client";

import { useId, useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { TopBar } from "@/components/top-bar";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { usePlugins } from "@/components/plugins";
import type { PluginModeMetadata } from "@/src/core";
import { fuzzyScore } from "@/src/core/fuzzy";
import {
	AlertCircleIcon,
	ArrowRightIcon,
	BookOpenIcon,
	BrainIcon,
	CalculatorIcon,
	ChevronLeftIcon,
	CodeIcon,
	FlaskConicalIcon,
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

export interface StudyHubCatalogProps {
	/** Optional explicit modes list, overriding snapshot.modes when supplied. */
	modes?: PluginModeMetadata[];
	/** Optional list of registered frontend mode renderers. */
	modeRenderers?: readonly { pluginId: string; modeId: string }[];
	/** Optional list of plugins for state checking. */
	plugins?: readonly { info: { id: string; enabled: boolean }; phase: string; error?: string }[];
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
	const safeRouter = useSafeRouter();

	const activeManager = propManager !== undefined ? propManager : contextManager;
	const activeRouter = propRouter ?? safeRouter;

	const [searchQuery, setSearchQuery] = useState("");
	const [selectedCategory, setSelectedCategory] = useState<string>("all");
	const [selectedDifficulty, setSelectedDifficulty] = useState<string>("all");
	const [launchingModeKeys, setLaunchingModeKeys] = useState<Set<string>>(() => new Set());
	const [launchError, setLaunchError] = useState<{ modeKey: string; message: string } | null>(null);
	const [isRetrying, startRetryTransition] = useTransition();

	// Modes resolution
	const activeModes = propModes ?? snapshot?.modes ?? [];
	const activeModesRef = useRef(activeModes);
	activeModesRef.current = activeModes;
	const isLoading = propIsLoading ?? snapshot?.loading ?? false;
	const errorMessage = propError ?? snapshot?.error;

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
		startRetryTransition(async () => {
			if (propOnRetry) {
				await propOnRetry();
			} else if (activeManager?.reload) {
				await activeManager.reload();
			}
		});
	};

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

	return (
		<main data-testid="study-hub-page" className="flex h-dvh flex-col bg-background">
			<TopBar>
				<div className="flex items-center gap-3 min-w-0 flex-1">
					<Link
						href="/"
						aria-label="Back"
						data-testid="study-hub-back-button"
						className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground shrink-0 cursor-pointer"
					>
						<ChevronLeftIcon className="size-4" />
					</Link>
					<div className="flex items-center gap-2 min-w-0">
						<LayoutGridIcon className="size-4 text-muted-foreground shrink-0" />
						<h1 data-testid="study-hub-title" className="font-title text-3xl tracking-tight text-foreground truncate">
							Study Hub
						</h1>
					</div>
				</div>
			</TopBar>

			<div className="flex-1 overflow-y-auto px-6 py-8 max-w-6xl w-full mx-auto space-y-8">
				{/* Header Section */}
				<header className="space-y-3">
					<div className="flex items-start justify-between gap-4 flex-wrap">
						<div>
							<h2 className="text-2xl font-semibold tracking-tight text-foreground">
								Interactive Study Modes
							</h2>
							<p className="mt-1 text-sm text-muted-foreground max-w-2xl leading-relaxed">
								Discover and launch interactive visual environments, simulators, and domain workspaces powered by LearnHarness plugins.
							</p>
						</div>
						{(activeManager || propOnRetry) && (
							<Button
								variant="outline"
								size="sm"
								onClick={handleRetry}
								disabled={isRetrying || isLoading}
								data-testid="study-hub-refresh-button"
								className="gap-2 cursor-pointer"
							>
								<RefreshCwIcon className={`size-3.5 ${isRetrying ? "animate-spin" : ""}`} />
								<span>Refresh</span>
							</Button>
						)}
					</div>

					{/* Search & Filter Controls */}
					{activeModes.length > 0 && (
						<div className="pt-2 space-y-4">
							<div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
								<div className="relative flex-1">
									<SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground pointer-events-none" />
									<Input
										type="text"
										value={searchQuery}
										onChange={e => setSearchQuery(e.target.value)}
										placeholder="Search by name, category, description, or tags..."
										aria-label="Search study modes"
										data-testid="study-hub-search-input"
										className="pl-9 pr-9 h-10 w-full"
									/>
									{searchQuery && (
										<button
											type="button"
											onClick={() => setSearchQuery("")}
											aria-label="Clear search"
											data-testid="study-hub-clear-search"
											className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 rounded-sm text-muted-foreground hover:text-foreground cursor-pointer"
										>
											<XIcon className="size-4" />
										</button>
									)}
								</div>

								{hasActiveFilters && (
									<Button
										variant="ghost"
										size="sm"
										onClick={clearFilters}
										data-testid="study-hub-clear-filters"
										className="text-xs text-muted-foreground hover:text-foreground shrink-0 cursor-pointer"
									>
										Clear filters
									</Button>
								)}
							</div>

							{/* Category Filters */}
							{categories.length > 1 && (
								<div className="flex items-center gap-2 overflow-x-auto pb-1" data-testid="study-hub-category-filters">
									<span className="text-xs font-medium text-muted-foreground shrink-0 mr-1 flex items-center gap-1">
										<SlidersHorizontalIcon className="size-3" /> Category:
									</span>
									<button
										type="button"
										onClick={() => setSelectedCategory("all")}
										data-testid="filter-category-all"
										className={`px-3 py-1 rounded-full text-xs font-medium transition-colors shrink-0 cursor-pointer ${
											selectedCategory === "all"
												? "bg-primary text-primary-foreground"
												: "bg-muted/70 text-muted-foreground hover:bg-muted hover:text-foreground"
										}`}
									>
										All ({activeModes.length})
									</button>
									{categories.map(cat => {
										const count = activeModes.filter(m => m.category === cat).length;
										const isSelected = selectedCategory === cat;
										return (
											<button
												key={cat}
												type="button"
												onClick={() => setSelectedCategory(isSelected ? "all" : cat)}
												data-testid={`filter-category-${cat.toLowerCase().replace(/\s+/g, "-")}`}
												className={`px-3 py-1 rounded-full text-xs font-medium transition-colors shrink-0 cursor-pointer ${
													isSelected
														? "bg-primary text-primary-foreground"
														: "bg-muted/70 text-muted-foreground hover:bg-muted hover:text-foreground"
												}`}
											>
												{cat} ({count})
											</button>
										);
									})}
								</div>
							)}

							{/* Difficulty Filters */}
							{hasDifficulties && (
								<div className="flex items-center gap-2 overflow-x-auto pb-1" data-testid="study-hub-difficulty-filters">
									<span className="text-xs font-medium text-muted-foreground shrink-0 mr-1">
										Difficulty:
									</span>
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
												onClick={() => setSelectedDifficulty(isSelected ? "all" : diff)}
												data-testid={`filter-difficulty-${diff}`}
												className={`px-2.5 py-0.5 rounded-md text-xs font-medium capitalize transition-colors shrink-0 cursor-pointer ${
													isSelected
														? "bg-secondary text-secondary-foreground ring-1 ring-border"
														: "text-muted-foreground hover:bg-accent hover:text-foreground"
												}`}
											>
												{diff}
											</button>
										);
									})}
								</div>
							)}
						</div>
					)}
				</header>

				{/* Error Notice */}
				{errorMessage && (
					<div
						role="alert"
						data-testid="study-hub-error"
						className="rounded-xl border border-destructive/40 bg-destructive/10 p-4 text-destructive flex items-start gap-3"
					>
						<AlertCircleIcon className="size-5 shrink-0 mt-0.5" />
						<div className="flex-1 space-y-1">
							<p className="font-medium text-sm">Failed to load study modes</p>
							<p className="text-xs opacity-90">{errorMessage}</p>
						</div>
						<Button
							variant="outline"
							size="xs"
							onClick={handleRetry}
							data-testid="study-hub-retry-button"
							className="shrink-0 border-destructive/30 hover:bg-destructive/20 text-destructive cursor-pointer"
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
						className="rounded-xl border border-destructive/40 bg-destructive/10 p-4 text-destructive flex items-start justify-between gap-3"
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
							className="p-1 rounded-sm text-destructive hover:bg-destructive/20 cursor-pointer"
						>
							<XIcon className="size-4" />
						</button>
					</div>
				)}

				{/* Catalog Content States */}
				{isLoading ? (
					<div
						data-testid="study-hub-loading"
						className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6"
					>
						{[1, 2, 3].map(n => (
							<div
								key={n}
								className="rounded-2xl border border-border/60 bg-card p-6 shadow-xs animate-pulse space-y-4"
							>
								<div className="flex items-center gap-3">
									<div className="size-10 rounded-xl bg-muted" />
									<div className="space-y-2 flex-1">
										<div className="h-4 w-2/3 bg-muted rounded" />
										<div className="h-3 w-1/3 bg-muted rounded" />
									</div>
								</div>
								<div className="space-y-2">
									<div className="h-3 w-full bg-muted rounded" />
									<div className="h-3 w-4/5 bg-muted rounded" />
								</div>
								<div className="pt-2 flex justify-between items-center">
									<div className="h-5 w-16 bg-muted rounded" />
									<div className="h-8 w-20 bg-muted rounded" />
								</div>
							</div>
						))}
					</div>
				) : activeModes.length === 0 ? (
					/* Empty Catalog State */
					<div
						data-testid="study-hub-empty"
						className="rounded-2xl border border-border/60 bg-card p-12 text-center shadow-xs max-w-lg mx-auto"
					>
						<div className="mx-auto flex size-14 items-center justify-center rounded-2xl bg-muted text-muted-foreground mb-4">
							<LayoutGridIcon className="size-7" />
						</div>
						<h3 className="text-lg font-semibold text-foreground">No Learning Modes Available</h3>
						<p className="mt-2 text-sm text-muted-foreground leading-relaxed">
							There are currently no learning modes registered by plugins. Enable or install plugins with interactive study modes to get started.
						</p>
						<div className="mt-6">
							<Link href="/settings">
								<Button variant="outline" size="sm" className="cursor-pointer">
									Manage Plugins in Settings
								</Button>
							</Link>
						</div>
					</div>
				) : filteredModes.length === 0 ? (
					/* No Search Results State */
					<div
						data-testid="study-hub-no-results"
						className="rounded-2xl border border-border/60 bg-card p-12 text-center shadow-xs max-w-lg mx-auto"
					>
						<div className="mx-auto flex size-12 items-center justify-center rounded-xl bg-muted text-muted-foreground mb-4">
							<SearchIcon className="size-6" />
						</div>
						<h3 className="text-base font-semibold text-foreground">No matching modes found</h3>
						<p className="mt-2 text-sm text-muted-foreground leading-relaxed">
							No study modes match your search or filter criteria. Try adjusting your search query or removing active filters.
						</p>
						<div className="mt-6">
							<Button
								variant="outline"
								size="sm"
								onClick={clearFilters}
								data-testid="study-hub-reset-search"
								className="cursor-pointer"
							>
								Reset Filters
							</Button>
						</div>
					</div>
				) : (
					/* Populated Catalog Grid */
					<div
						data-testid="study-hub-grid"
						className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6"
					>
						{filteredModes.map(mode => {
							const modeKey = getModeKey(mode.pluginId, mode.id);
							const IconComponent = getModeIcon(mode.icon);
							const isLaunching = launchingModeKeys.has(modeKey);

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

							return (
								<div
									key={`${mode.pluginId}:${mode.id}`}
									data-testid={`study-hub-mode-card-${modeKey}`}
									data-mode-key={modeKey}
									data-plugin-id={mode.pluginId}
									data-mode-id={mode.id}
									className={`group rounded-2xl border bg-card p-6 shadow-xs flex flex-col justify-between transition-all ${
										isUnavailable
											? "border-border/40 opacity-75"
											: "border-border/60 hover:border-border hover:shadow-sm"
									}`}
								>
									<div className="space-y-4">
										{/* Mode Header */}
										<div className="flex items-start gap-3.5">
											<div className="flex size-11 items-center justify-center rounded-xl bg-accent text-accent-foreground shrink-0 transition-transform group-hover:scale-105">
												<IconComponent className="size-5" />
											</div>
											<div className="min-w-0 flex-1">
												<div className="flex items-center justify-between gap-2">
													<h3 className="font-semibold text-foreground text-base tracking-tight truncate" title={mode.name}>
														{mode.name}
													</h3>
												</div>
												<div className="flex items-center gap-1.5 mt-0.5 text-xs text-muted-foreground truncate">
													<span className="font-medium text-foreground/80">{mode.category}</span>
													<span>•</span>
													<span className="truncate">{mode.pluginId}</span>
												</div>
											</div>
										</div>

										{/* Mode Description */}
										<p className="text-sm text-muted-foreground line-clamp-3 leading-relaxed">
											{mode.description}
										</p>

										{/* Tags & Badges */}
										<div className="flex flex-wrap items-center gap-1.5 pt-1">
											{mode.difficulty && (
												<span
													data-slot="difficulty-badge"
													className="rounded-md bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground capitalize"
												>
													{mode.difficulty}
												</span>
											)}
											{mode.activityType && (
												<span
													data-slot="activity-type-badge"
													className="rounded-md bg-muted/70 px-2 py-0.5 text-xs text-muted-foreground"
												>
													{mode.activityType}
												</span>
											)}
											{mode.tags?.slice(0, 3).map(tag => (
												<span
													key={tag}
													data-slot="tag-badge"
													className="rounded-md bg-accent/40 px-2 py-0.5 text-xs text-accent-foreground"
												>
													#{tag}
												</span>
											))}
										</div>
									</div>

									{/* Bottom Action Row */}
									<div className="mt-6 pt-4 border-t border-border/40 flex items-center justify-between gap-3">
										{statusNotice ? (
											<span
												data-testid={statusNotice.testId}
												title={statusNotice.title}
												className="text-xs font-medium text-amber-600 dark:text-amber-400 bg-amber-500/10 rounded-md px-2 py-1 truncate"
											>
												{statusNotice.text}
											</span>
										) : (
											<span className="text-xs text-muted-foreground">
												New workspace
											</span>
										)}

										<Button
											variant={isUnavailable ? "outline" : "default"}
											size="sm"
											onClick={() => handleLaunch(mode)}
											disabled={isUnavailable || isLaunching}
											aria-label={`Launch ${mode.name}`}
											data-testid={`launch-mode-${modeKey}`}
											className="gap-1.5 cursor-pointer shrink-0 ml-auto"
										>
											{isLaunching ? (
												<>
													<Loader2Icon className="size-3.5 animate-spin" />
													<span>Launching...</span>
												</>
											) : (
												<>
													<span>Launch</span>
													<ArrowRightIcon className="size-3.5 transition-transform group-hover:translate-x-0.5" />
												</>
											)}
										</Button>
									</div>
								</div>
							);
						})}
					</div>
				)}
			</div>
		</main>
	);
}
