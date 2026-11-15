"use client";

import { useMemo, useState, useRef, useEffect, type CSSProperties, type MouseEvent } from "react";
import { BoxIcon, AlertTriangleIcon } from "lucide-react";
import type { WorkspaceDirectoryEntry } from "@/src/core";
import { timeAgo } from "@/components/sidebar";
import { cn } from "@/lib/utils";
import { Hint } from "@/components/ui/hint";

export interface WorkspaceRowProps {
	workspace: WorkspaceDirectoryEntry;
	active: boolean;
	onOpen: () => void;
	kbdSelected?: boolean;
	onContextMenu?: (e: MouseEvent<HTMLButtonElement>) => void;
	folderPath?: string | null;
	style?: CSSProperties;
}

/**
 * Workspace row renderer.
 * Shares exact height, alignment, typography, hover, keyboard focus,
 * and context-menu interaction with SessionRow.
 * Distinct leading BoxIcon, right-aligned timeAgo and subtle unavailable indicator.
 */
export function WorkspaceRow({
	workspace,
	active,
	onOpen,
	kbdSelected = false,
	onContextMenu,
	folderPath,
	style,
}: WorkspaceRowProps) {
	const isUnavailable = workspace.availability && workspace.availability !== "available";

	return (
		<button
			type="button"
			onClick={onOpen}
			onContextMenu={onContextMenu}
			data-workspace-id={workspace.id}
			data-availability={workspace.availability}
			data-testid={kbdSelected ? "workspace-row-kbd" : "workspace-row"}
			aria-label={`Workspace: ${workspace.title}${isUnavailable ? ` (${workspace.availability})` : ""}`}
			className={cn(
				"group relative mb-0.5 flex w-full items-center gap-1.5 rounded-lg py-1.5 pl-2.5 pr-2 text-left transition-colors hover:bg-muted/40 cursor-pointer",
				active && "bg-accent text-foreground",
				kbdSelected && !active && "bg-accent/40 ring-1 ring-border/80",
			)}
			style={style}
		>
			<span className="min-w-0 flex-1">
				{folderPath && (
					<span
						data-testid="workspace-folder-path"
						className="block truncate text-[10px] text-muted-foreground/75 font-mono leading-none mb-0.5"
					>
						{folderPath}
					</span>
				)}
				<div className="flex h-5 items-center justify-between gap-1.5 min-w-0">
					<div className="flex items-center gap-1.5 min-w-0 flex-1">
						<BoxIcon
							className={cn(
								"size-3.5 shrink-0 text-muted-foreground/70",
								isUnavailable && "text-muted-foreground/40",
							)}
							aria-hidden="true"
						/>
						<span
							className={cn(
								"truncate font-prose text-sm leading-snug text-foreground min-w-0",
								isUnavailable && "text-muted-foreground",
							)}
						>
							{workspace.title}
						</span>
					</div>
					<div className="flex items-center gap-1.5 shrink-0 ml-auto pl-1.5">
						{isUnavailable && (
							<Hint label={`Unavailable: ${workspace.availability}`} side="left">
								<span
									className="inline-flex size-3 shrink-0 items-center justify-center text-muted-foreground/60 transition-colors hover:text-muted-foreground/90 cursor-default"
									title={`Unavailable: ${workspace.availability}`}
								>
									<AlertTriangleIcon className="size-3 shrink-0 text-amber-500/80" aria-hidden="true" />
									<span className="sr-only">Unavailable: {workspace.availability}</span>
								</span>
							</Hint>
						)}
						<span className="min-w-[44px] text-right text-[10px] tabular-nums text-muted-foreground/60 shrink-0">
							{timeAgo(workspace.updatedAt)}
						</span>
					</div>
				</div>
			</span>
		</button>
	);
}

/**
 * Inline rename row for workspaces.
 * Matches exact geometry of RenameRow in sidebar.
 */
export function RenameWorkspaceRow({
	workspace,
	onCommit,
	onCancel,
	style,
}: {
	workspace: { id: string; title: string; updatedAt: string };
	onCommit: (next: string) => void;
	onCancel: () => void;
	style?: CSSProperties;
}) {
	const [draft, setDraft] = useState(workspace.title);
	const inputRef = useRef<HTMLInputElement | null>(null);
	const committedRef = useRef(false);
	const cancelledRef = useRef(false);

	useEffect(() => {
		const el = inputRef.current;
		if (el) {
			el.focus();
			el.select();
		}
	}, []);

	const handleCommit = (val: string) => {
		if (committedRef.current || cancelledRef.current) return;
		committedRef.current = true;
		const trimmed = val.trim();
		if (!trimmed) {
			onCancel();
		} else {
			onCommit(trimmed);
		}
	};

	const handleCancel = () => {
		if (committedRef.current || cancelledRef.current) return;
		cancelledRef.current = true;
		onCancel();
	};

	return (
		<div
			data-testid="workspace-rename-row"
			className="relative mb-0.5 flex w-full items-center gap-1.5 rounded-lg bg-accent py-1.5 pl-2.5 pr-2"
			style={style}
		>
			<span className="flex min-w-0 w-full flex-col">
				<div className="flex h-5 items-center justify-between gap-1.5 min-w-0">
					<div className="flex items-center gap-1.5 min-w-0 flex-1">
						<BoxIcon className="size-3.5 shrink-0 text-muted-foreground/70" aria-hidden="true" />
						<input
							ref={inputRef}
							value={draft}
							spellCheck={false}
							onChange={(e) => setDraft(e.target.value)}
							onBlur={() => handleCommit(draft)}
							onKeyDown={(e) => {
								if (e.key === "Enter") {
									e.preventDefault();
									handleCommit(draft);
								}
								if (e.key === "Escape") {
									e.stopPropagation();
									handleCancel();
								}
							}}
							aria-label="Rename workspace"
							data-testid="workspace-rename-input"
							className="w-full min-w-0 truncate border-0 border-b border-border bg-transparent px-0 font-prose text-sm leading-snug text-foreground outline-none"
						/>
					</div>
					<div className="flex items-center gap-1.5 shrink-0 ml-auto pl-1.5">
						<span className="min-w-[44px] text-right text-[10px] tabular-nums text-muted-foreground/60 shrink-0">
							{timeAgo(workspace.updatedAt)}
						</span>
					</div>
				</div>
			</span>
		</div>
	);
}
