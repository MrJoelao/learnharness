"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { TopBar } from "@/components/top-bar";
import { Input } from "@/components/ui/input";
import { usePlugins } from "@/components/plugins";
import { useServerEvent } from "@/components/server-events";
import type { WorkspaceAvailability, WorkspaceRecord } from "@/src/core";
import {
	AlertCircleIcon,
	BoxIcon,
	ChevronLeftIcon,
} from "lucide-react";

export interface WorkspaceScreenProps {
	workspaceId: string;
	initialWorkspace?: WorkspaceRecord | null;
	initialAvailability?: WorkspaceAvailability | "not-found";
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
	const [workspace, setWorkspace] = useState<WorkspaceRecord | null>(initialWorkspace);
	const [availability, setAvailability] = useState<WorkspaceAvailability | "not-found" | "loading">(
		initialAvailability ?? (initialWorkspace ? "available" : "loading"),
	);
	const [pluginName, setPluginName] = useState<string>(initialPluginName ?? "");
	const [modeName, setModeName] = useState<string>(initialModeName ?? "");
	const [mountError, setMountError] = useState<string | null>(null);

	const [isRenaming, setIsRenaming] = useState(false);
	const [titleDraft, setTitleDraft] = useState(workspace?.title ?? "");
	const renameInputRef = useRef<HTMLInputElement>(null);
	const containerRef = useRef<HTMLDivElement>(null);

	const loadWorkspace = useCallback(async () => {
		try {
			const res = await fetch(`/api/workspaces/${encodeURIComponent(workspaceId)}`, { cache: "no-store" });
			if (!res.ok) {
				if (res.status === 404) {
					setAvailability("not-found");
				} else {
					setAvailability("plugin-missing");
				}
				return;
			}
			const data = (await res.json()) as {
				workspace: WorkspaceRecord;
				availability: WorkspaceAvailability;
				plugin?: { id: string; name?: string };
				mode?: { id: string; name?: string };
			};
			setWorkspace(data.workspace);
			setAvailability(data.availability);
			setTitleDraft(data.workspace.title);
			if (data.plugin?.name) setPluginName(data.plugin.name);
			if (data.mode?.name) setModeName(data.mode.name);
		} catch (err) {
			console.error("Failed to fetch workspace:", err);
			setAvailability("not-found");
		}
	}, [workspaceId]);

	useEffect(() => {
		if (!initialWorkspace || initialAvailability === undefined) {
			void loadWorkspace();
		}
	}, [workspaceId, initialWorkspace, initialAvailability, loadWorkspace]);

	useServerEvent("workspaces-changed", () => {
		void loadWorkspace();
	});

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
			setTitleDraft(data.workspace.title);
			window.dispatchEvent(
				new CustomEvent("lh:chat-renamed", { detail: { id: workspace.id, title: data.workspace.title } }),
			);
		} catch (err) {
			console.error("Failed to rename workspace:", err);
			setTitleDraft(workspace.title);
		}
	}, [titleDraft, workspace]);

	// Mount workspace into container when available and container ready
	useEffect(() => {
		setMountError(null);
		if (availability !== "available" || !workspace || !containerRef.current || !manager) {
			return;
		}

		const release = manager.mountWorkspace(workspace, containerRef.current, (err) => {
			setMountError(err);
		});

		return () => {
			release();
		};
	}, [availability, workspace, manager, snapshot]);

	return (
		<main data-testid="workspace-screen" className="flex h-dvh flex-col bg-background">
			<TopBar>
				<div className="flex items-center gap-3 min-w-0 flex-1">
					<Link
						href="/"
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
				{availability === "loading" && (
					<div
						data-testid="workspace-loading"
						className="flex flex-1 items-center justify-center text-xs text-muted-foreground animate-pulse"
					>
						Loading workspace…
					</div>
				)}

				{availability === "not-found" && (
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

				{availability === "plugin-disabled" && (
					<div
						data-testid="workspace-unavailable"
						data-availability="plugin-disabled"
						className="flex flex-1 flex-col items-center justify-center p-6 text-center"
					>
						<AlertCircleIcon className="size-10 text-amber-500 mb-3" />
						<h2 className="text-base font-semibold text-foreground">Plugin is disabled</h2>
						<p className="mt-1.5 text-xs text-muted-foreground max-w-md leading-relaxed">
							The plugin &ldquo;{workspace?.pluginId}&rdquo; providing this workspace is currently disabled.
							Enable the plugin in Settings to access this workspace. Your workspace data and state are preserved.
						</p>
					</div>
				)}

				{availability === "plugin-missing" && (
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

				{availability === "mode-missing" && (
					<div
						data-testid="workspace-unavailable"
						data-availability="mode-missing"
						className="flex flex-1 flex-col items-center justify-center p-6 text-center"
					>
						<AlertCircleIcon className="size-10 text-amber-500 mb-3" />
						<h2 className="text-base font-semibold text-foreground">Mode unavailable</h2>
						<p className="mt-1.5 text-xs text-muted-foreground max-w-md leading-relaxed">
							The learning mode &ldquo;{workspace?.modeId}&rdquo; is no longer registered by plugin &ldquo;
							{workspace?.pluginId}&rdquo;.
						</p>
					</div>
				)}

				{availability === "available" && (
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
