"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { TopBar } from "@/components/top-bar";
import { Input } from "@/components/ui/input";
import { usePlugins } from "@/components/plugins";
import { useServerEvent } from "@/components/server-events";
import type { WorkspaceAvailability, WorkspaceRecord } from "@/src/core";
import {
	AlertCircleIcon,
	BoxIcon,
	ChevronLeftIcon,
	RefreshCwIcon,
} from "lucide-react";

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

/** Pure helper to determine if safe in-app back navigation is available. */
export function canNavigateBack(): boolean {
	if (typeof window === "undefined") return false;

	// 1. In Next.js App Router, window.history.state?.idx tracks in-app history index.
	// If idx > 0, the user has navigated internally within this SPA session.
	const historyState: unknown = window.history.state;
	const historyIdx =
		typeof historyState === "object" && historyState !== null && "idx" in historyState
			? (historyState as { idx: unknown }).idx
			: undefined;
	if (typeof historyIdx === "number" && historyIdx > 0) {
		return true;
	}

	// 2. If no valid positive in-app index, use same-origin referrer as fallback with history verification.
	if (document.referrer) {
		try {
			const refOrigin = new URL(document.referrer).origin;
			if (refOrigin === window.location.origin && window.history.length > 1) {
				return true;
			}
		} catch {
			// Ignore URL parse failures
		}
	}

	// 3. Neither condition met: external referrer without internal nav or direct URL opening.
	return false;
}

export type WorkspaceScreenState =
	| "loading"
	| "not-found"
	| "server-error"
	| "network-error"
	| WorkspaceAvailability;

export interface WorkspaceScreenProps {
	workspaceId: string;
	initialWorkspace?: WorkspaceRecord | null;
	initialAvailability?: WorkspaceAvailability | "not-found" | "server-error" | "network-error";
	initialPluginName?: string;
	initialModeName?: string;
}

export function WorkspaceScreen({
	workspaceId,
	initialWorkspace = null,
	initialAvailability,
	initialPluginName,
	initialModeName,
}: WorkspaceScreenProps) {
	const { manager, snapshot } = usePlugins();
	const router = useSafeRouter();
	const [workspace, setWorkspace] = useState<WorkspaceRecord | null>(initialWorkspace);
	const [screenState, setScreenState] = useState<WorkspaceScreenState>(
		initialAvailability ?? (initialWorkspace ? "available" : "loading"),
	);
	const [errorMessage, setErrorMessage] = useState<string | null>(null);
	const [pluginName, setPluginName] = useState<string>(initialPluginName ?? "");
	const [modeName, setModeName] = useState<string>(initialModeName ?? "");
	const [mountError, setMountError] = useState<string | null>(null);

	const [isRenaming, setIsRenaming] = useState(false);
	const [titleDraft, setTitleDraft] = useState(workspace?.title ?? "");
	const renameInputRef = useRef<HTMLInputElement>(null);
	const containerRef = useRef<HTMLDivElement>(null);

	const currentWorkspaceId = workspace?.id;
	const currentPluginId = workspace?.pluginId;
	const currentModeId = workspace?.modeId;

	const loadWorkspace = useCallback(async () => {
		setScreenState((prev) => (prev === "server-error" || prev === "network-error" ? "loading" : prev));
		setErrorMessage(null);
		try {
			const res = await fetch(`/api/workspaces/${encodeURIComponent(workspaceId)}`, { cache: "no-store" });
			if (!res.ok) {
				if (res.status === 404) {
					setScreenState("not-found");
					return;
				}
				// 500, 503 and other temporary HTTP errors
				setScreenState("server-error");
				setErrorMessage(`Server error (${res.status}). Please try again.`);
				return;
			}
			const data = (await res.json()) as {
				workspace: WorkspaceRecord;
				availability: WorkspaceAvailability;
				plugin?: { id: string; name?: string };
				mode?: { id: string; name?: string };
			};
			setWorkspace(data.workspace);
			manager?.updateWorkspace?.(data.workspace);
			setScreenState(data.availability);
			setTitleDraft(data.workspace.title);
			if (data.plugin?.name) setPluginName(data.plugin.name);
			if (data.mode?.name) setModeName(data.mode.name);
		} catch (err) {
			console.error("Failed to fetch workspace:", err);
			setScreenState("network-error");
			setErrorMessage("Network error: unable to reach the server. Please check your connection and try again.");
		}
	}, [workspaceId, manager]);

	useEffect(() => {
		if (initialWorkspace && initialWorkspace.id === workspaceId) {
			setWorkspace(initialWorkspace);
			manager?.updateWorkspace?.(initialWorkspace);
			if (initialAvailability !== undefined) {
				setScreenState(initialAvailability);
			}
			setTitleDraft(initialWorkspace.title);
		} else if (!initialWorkspace || initialAvailability === undefined) {
			void loadWorkspace();
		}
	}, [workspaceId, initialWorkspace, initialAvailability, loadWorkspace, manager]);

	useServerEvent("workspaces-changed", () => {
		void loadWorkspace();
	});

	// Synchronize rename events from other components or context.setTitle()
	useEffect(() => {
		const onRenamed = (e: Event) => {
			const detail = (e as CustomEvent<{ id: string; title: string }>).detail;
			if (detail && detail.id === currentWorkspaceId) {
				setWorkspace((prev) => (prev ? { ...prev, title: detail.title } : prev));
				setTitleDraft(detail.title);
			}
		};
		window.addEventListener("lh:workspace-renamed", onRenamed);
		window.addEventListener("lh:chat-renamed", onRenamed);
		return () => {
			window.removeEventListener("lh:workspace-renamed", onRenamed);
			window.removeEventListener("lh:chat-renamed", onRenamed);
		};
	}, [currentWorkspaceId]);

	// Focus rename input on rename start
	useEffect(() => {
		if (isRenaming) {
			renameInputRef.current?.focus();
			renameInputRef.current?.select();
		}
	}, [isRenaming]);

	const commitRename = useCallback(async () => {
		setIsRenaming(false);
		const nextTitle = titleDraft.trim();
		if (!nextTitle || !workspace || nextTitle === workspace.title) {
			setTitleDraft(workspace?.title ?? "");
			return;
		}
		try {
			const res = await fetch(`/api/workspaces/${encodeURIComponent(workspace.id)}`, {
				method: "PUT",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ title: nextTitle }),
			});
			if (!res.ok) throw new Error("Rename failed");
			const data = (await res.json()) as { workspace: WorkspaceRecord };
			setWorkspace(data.workspace);
			manager?.updateWorkspace?.(data.workspace);
			setTitleDraft(data.workspace.title);
			window.dispatchEvent(
				new CustomEvent("lh:workspace-renamed", { detail: { id: workspace.id, title: data.workspace.title } }),
			);
		} catch (err) {
			console.error("Failed to rename workspace:", err);
			setTitleDraft(workspace.title);
		}
	}, [titleDraft, workspace, manager]);

	const handleBack = useCallback(
		(e?: React.MouseEvent) => {
			if (e) e.preventDefault();
			if (canNavigateBack()) {
				router.back();
			} else {
				router.push("/");
			}
		},
		[router],
	);


	// Targeted selector: only re-evaluate when this specific plugin's mode renderer registration changes
	const modeRendererRegistration = (currentPluginId && currentModeId)
		? snapshot.modeRenderers?.find((r) => r.pluginId === currentPluginId && r.modeId === currentModeId)
		: undefined;

	const workspaceRef = useRef(workspace);
	workspaceRef.current = workspace;

	// Mount workspace into container when available and container ready
	useEffect(() => {
		setMountError(null);
		const currentWs = workspaceRef.current;
		if (
			screenState !== "available" ||
			!currentWs ||
			currentWs.id !== currentWorkspaceId ||
			!containerRef.current ||
			!manager ||
			!modeRendererRegistration
		) {
			return;
		}

		const release = manager.mountWorkspace(() => workspaceRef.current ?? currentWs, containerRef.current, (err) => {
			setMountError(err);
		});

		return () => {
			release();
		};
	}, [screenState, currentWorkspaceId, currentPluginId, currentModeId, manager, modeRendererRegistration]);

	return (
		<main data-testid="workspace-screen" className="flex h-dvh flex-col bg-background">
			<TopBar>
				<div className="flex items-center gap-3 min-w-0 flex-1">
					<Link
						href="/"
						onClick={handleBack}
						aria-label="Back"
						data-testid="workspace-back-button"
						className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground shrink-0 cursor-pointer"
					>
						<ChevronLeftIcon className="size-4" />
					</Link>

					<div className="flex items-center gap-2 min-w-0">
						<BoxIcon className="size-4 text-muted-foreground shrink-0" />
						{isRenaming ? (
							<form
								onSubmit={(e) => {
									e.preventDefault();
									void commitRename();
								}}
								className="flex items-center"
							>
								<Input
									ref={renameInputRef}
									data-testid="workspace-rename-input"
									value={titleDraft}
									onChange={(e) => setTitleDraft(e.target.value)}
									onKeyDown={(e) => {
										if (e.key === "Escape") {
											setIsRenaming(false);
											setTitleDraft(workspace?.title ?? "");
										}
									}}
									onBlur={() => void commitRename()}
									className="h-8 font-title text-2xl tracking-tight max-w-md px-2 py-0"
								/>
							</form>
						) : (
							<h1
								data-testid="workspace-title"
								onClick={() => setIsRenaming(true)}
								title="Click to rename"
								className="font-title text-3xl tracking-tight text-foreground truncate cursor-pointer hover:underline"
							>
								{workspace?.title ?? "Workspace"}
							</h1>
						)}

						{workspace && (
							<span
								data-testid="workspace-identity"
								className="rounded bg-muted/60 px-2 py-0.5 text-[10px] font-mono text-muted-foreground/80 shrink-0 select-none"
							>
								{modeName || workspace.modeId} · {pluginName || workspace.pluginId}
							</span>
						)}
					</div>
				</div>
			</TopBar>

			<div className="relative flex-1 min-h-0 min-w-0 flex flex-col w-full h-full overflow-hidden">
				{screenState === "loading" && (
					<div
						data-testid="workspace-loading"
						className="flex flex-1 items-center justify-center text-xs text-muted-foreground animate-pulse"
					>
						Loading workspace…
					</div>
				)}

				{screenState === "not-found" && (
					<div
						data-testid="workspace-not-found"
						className="flex flex-1 flex-col items-center justify-center p-6 text-center"
					>
						<AlertCircleIcon className="size-10 text-muted-foreground mb-3" />
						<h2 className="text-base font-semibold text-foreground">Workspace not found</h2>
						<p className="mt-1 text-xs text-muted-foreground max-w-sm">
							This workspace does not exist or may have been deleted.
						</p>
						<Link
							href="/"
							className="mt-4 rounded-md border border-border bg-card px-3 py-1.5 text-xs text-foreground hover:bg-accent transition-colors"
						>
							Return home
						</Link>
					</div>
				)}

				{(screenState === "server-error" || screenState === "network-error") && (
					<div
						data-testid="workspace-error"
						data-error-kind={screenState}
						className="flex flex-1 flex-col items-center justify-center p-6 text-center"
					>
						<AlertCircleIcon className="size-10 text-destructive mb-3" />
						<h2 className="text-base font-semibold text-foreground">
							{screenState === "server-error" ? "Server error" : "Network error"}
						</h2>
						<p className="mt-1.5 text-xs text-muted-foreground max-w-md leading-relaxed">
							{errorMessage ??
								(screenState === "server-error"
									? "A temporary server error occurred while loading this workspace. Workspace data is preserved."
									: "Unable to connect to the server. Please check your network connection and try again.")}
						</p>
						<div className="mt-4 flex items-center gap-2">
							<button
								type="button"
								data-testid="workspace-retry-button"
								onClick={() => void loadWorkspace()}
								className="flex items-center gap-1.5 rounded-md border border-border bg-card px-3 py-1.5 text-xs font-medium text-foreground hover:bg-accent transition-colors cursor-pointer"
							>
								<RefreshCwIcon className="size-3.5" />
								Retry
							</button>
							<Link
								href="/"
								className="rounded-md border border-border bg-card px-3 py-1.5 text-xs text-foreground hover:bg-accent transition-colors"
							>
								Return home
							</Link>
						</div>
					</div>
				)}

				{screenState === "plugin-disabled" && (
					<div
						data-testid="workspace-unavailable"
						data-availability="plugin-disabled"
						className="flex flex-1 flex-col items-center justify-center p-6 text-center"
					>
						<AlertCircleIcon className="size-10 text-warning mb-3" />
						<h2 className="text-base font-semibold text-foreground">Plugin is disabled</h2>
						<p className="mt-1.5 text-xs text-muted-foreground max-w-md leading-relaxed">
							The plugin &ldquo;{workspace?.pluginId}&rdquo; providing this workspace is currently disabled.
							Enable the plugin in Settings to access this workspace. Your workspace data and state are preserved.
						</p>
					</div>
				)}

				{screenState === "plugin-missing" && (
					<div
						data-testid="workspace-unavailable"
						data-availability="plugin-missing"
						className="flex flex-1 flex-col items-center justify-center p-6 text-center"
					>
						<AlertCircleIcon className="size-10 text-destructive mb-3" />
						<h2 className="text-base font-semibold text-foreground">Plugin missing</h2>
						<p className="mt-1.5 text-xs text-muted-foreground max-w-md leading-relaxed">
							The plugin &ldquo;{workspace?.pluginId}&rdquo; is not installed on this system.
							Reinstall the plugin to restore access. Workspace state and data are preserved.
						</p>
					</div>
				)}

				{screenState === "mode-missing" && (
					<div
						data-testid="workspace-unavailable"
						data-availability="mode-missing"
						className="flex flex-1 flex-col items-center justify-center p-6 text-center"
					>
						<AlertCircleIcon className="size-10 text-warning mb-3" />
						<h2 className="text-base font-semibold text-foreground">Mode unavailable</h2>
						<p className="mt-1.5 text-xs text-muted-foreground max-w-md leading-relaxed">
							The learning mode &ldquo;{workspace?.modeId}&rdquo; is no longer registered by plugin &ldquo;
							{workspace?.pluginId}&rdquo;.
						</p>
					</div>
				)}

				{screenState === "available" && (
					<div className="relative flex-1 min-h-0 min-w-0 flex flex-col w-full h-full overflow-hidden">
						{mountError && (
							<div
								role="alert"
								className="mx-4 my-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive shrink-0"
							>
								{mountError}
							</div>
						)}
						<div
							ref={containerRef}
							data-testid="workspace-container"
							className="flex-1 w-full h-full min-h-0 min-w-0 overflow-auto"
						/>
					</div>
				)}
			</div>
		</main>
	);
}
