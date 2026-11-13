"use client";

import { useEffect, useRef, useState } from "react";
import { FolderTreeIcon, Loader2Icon, PencilIcon, PlusIcon, SettingsIcon, RefreshCwIcon, Trash2Icon, CheckIcon, XIcon } from "lucide-react";
import { Hint } from "@/components/ui/hint";
import { useInteractionLayer, useInteractionLayers } from "@/components/interaction-layers";
import { INTERACTION_LAYER_Z_BASE } from "@/components/host-dialog";
import type { TopicOrganization, GraphTopic } from "@/src/core/topic-organization";
import { useNotifyHub } from "@/components/server-events";
import { useSettingsDialog } from "@/components/settings/settings-dialog";
import { cn } from "@/lib/utils";

export function TopicsControl({
	onTopicsChanged,
}: {
	onTopicsChanged?: () => void;
}) {
	const { open: openSettings } = useSettingsDialog();
	const [open, setOpen] = useState(false);
	const [org, setOrg] = useState<TopicOrganization | null>(null);
	const [refreshing, setRefreshing] = useState(false);
	const [statusMsg, setStatusMsg] = useState<string | null>(null);
	const [editingTopicId, setEditingTopicId] = useState<string | null>(null);
	const [editingLabel, setEditingLabel] = useState("");
	const [newTopicLabel, setNewTopicLabel] = useState("");

	const rootRef = useRef<HTMLDivElement>(null);
	const panelRef = useRef<HTMLDivElement>(null);
	const interactions = useInteractionLayers();
	const popupLayer = useInteractionLayer({
		kind: "popup",
		enabled: open,
		rootRef: panelRef,
		anchorRef: rootRef,
		onClose: () => {
			setOpen(false);
			setEditingTopicId(null);
			return "closed";
		},
	});

	const fetchTopics = () => {
		fetch("/api/graph/topics")
			.then((res) => res.json() as Promise<TopicOrganization>)
			.then((data) => setOrg(data))
			.catch((err) => console.error("[topics] fetch failed:", err));
	};

	useEffect(() => {
		if (open) fetchTopics();
	}, [open]);

	const hub = useNotifyHub();
	useEffect(() => {
		if (!hub) return;
		const off = hub.subscribe("topics-changed", () => {
			fetchTopics();
		});
		return () => {
			off();
		};
	}, [hub]);

	const runAutoAssign = async () => {
		setRefreshing(true);
		setStatusMsg(null);
		try {
			const res = await fetch("/api/graph/topics/refresh", { method: "POST" });
			const data = (await res.json()) as { topics?: number; error?: string; message?: string };
			if (!res.ok || data.error) {
				setStatusMsg(data.error || "Failed to organize topics");
			} else {
				setStatusMsg(`Organized into ${data.topics ?? 0} topics`);
				fetchTopics();
				onTopicsChanged?.();
			}
		} catch (err) {
			setStatusMsg(err instanceof Error ? err.message : "Error connecting to server");
		} finally {
			setRefreshing(false);
		}
	};

	const postAction = async (body: unknown) => {
		try {
			const res = await fetch("/api/graph/topics", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(body),
			});
			if (res.ok) {
				const next = (await res.json()) as TopicOrganization;
				setOrg(next);
				onTopicsChanged?.();
			}
		} catch (err) {
			console.error("[topics] action failed:", err);
		}
	};

	const handleRename = (id: string) => {
		if (!editingLabel.trim()) return;
		void postAction({ action: "rename-topic", id, label: editingLabel.trim() });
		setEditingTopicId(null);
	};

	const handleDelete = (id: string) => {
		void postAction({ action: "delete-topic", id });
	};

	const handleCreate = () => {
		if (!newTopicLabel.trim()) return;
		void postAction({ action: "create-topic", label: newTopicLabel.trim(), nodeIds: [] });
		setNewTopicLabel("");
	};

	const topics = org?.topics ?? [];

	return (
		<div
			ref={rootRef}
			className="relative shrink-0 rounded-xl border bg-card/85 px-1 py-[3px] shadow-lg backdrop-blur"
			onBlur={(event) => {
				if (
					interactions.isElementEligible(panelRef.current) &&
					!event.currentTarget.contains(event.relatedTarget)
				) {
					setOpen(false);
					setEditingTopicId(null);
				}
			}}
		>
			<Hint label="Organize graph by semantic topics" side="bottom">
				<button
					type="button"
					onClick={() => setOpen(!open)}
					aria-expanded={open}
					aria-haspopup="menu"
					data-testid="open-topics-menu"
					className="flex h-7 items-center gap-1.5 rounded-lg px-2.5 text-xs text-muted-foreground transition-colors hover:bg-accent cursor-pointer"
				>
					<FolderTreeIcon className="size-3" />
					Topics
				</button>
			</Hint>

			{open && (
				<div
					ref={panelRef}
					role="menu"
					aria-label="Topic Organization"
					style={{ zIndex: INTERACTION_LAYER_Z_BASE + popupLayer.order }}
					className="absolute right-0 top-full mt-1.5 w-80 rounded-xl border border-border/80 bg-card/95 p-3.5 shadow-xl backdrop-blur-md flex flex-col gap-3 select-none"
				>
					{/* Header: Title + count + settings gear + quiet auto-organize button */}
					<div className="flex items-center justify-between pb-2 border-b border-border/50">
						<div className="flex items-center gap-2">
							<span className="font-ui text-xs font-medium text-foreground">Topics</span>
							<span className="font-mono text-[11px] text-muted-foreground tabular-nums">
								{topics.length}
							</span>
							<button
								type="button"
								onClick={() => {
									setOpen(false);
									openSettings("graph");
								}}
								className="flex size-5 items-center justify-center rounded-sm text-muted-foreground/80 hover:text-foreground transition-colors hover:bg-muted/40 cursor-pointer"
								title="Topic settings (granularity, unification, custom prompt)"
							>
								<SettingsIcon className="size-3.5" />
							</button>
						</div>

						<button
							type="button"
							data-testid="btn-auto-assign-topics"
							disabled={refreshing}
							onClick={() => void runAutoAssign()}
							className="flex h-6.5 items-center gap-1.5 rounded-md border border-border/70 bg-background/60 px-2 font-ui text-[11px] font-medium text-foreground transition-all duration-150 hover:bg-muted/40 hover:border-border active:scale-[0.98] disabled:opacity-40 cursor-pointer"
							title="Re-run AI topic assignment on graph nodes"
						>
							<RefreshCwIcon className={cn("size-3 text-muted-foreground", refreshing && "animate-spin text-foreground")} />
							<span>{refreshing ? "Organizing…" : "Auto-organize"}</span>
						</button>
					</div>

					{/* Status feedback banner */}
					{statusMsg && (
						<div className="rounded-md border border-border/40 bg-muted/25 px-2.5 py-1.5 text-[11px] text-muted-foreground leading-tight flex items-center justify-between">
							<span>{statusMsg}</span>
							<button
								type="button"
								onClick={() => setStatusMsg(null)}
								className="text-muted-foreground/60 hover:text-foreground text-[10px] ml-2"
							>
								✕
							</button>
						</div>
					)}

					{/* Topic List */}
					<div className="max-h-60 overflow-y-auto flex flex-col gap-0.5 pr-0.5">
						{topics.length === 0 ? (
							<div className="py-6 px-2 text-center text-xs text-muted-foreground">
								<p className="font-medium text-foreground/80">No topics yet</p>
								<p className="mt-1 text-[11px] text-muted-foreground/70">
									Click &quot;Auto-organize&quot; to cluster your notes semantically.
								</p>
							</div>
						) : (
							topics.map((topic: GraphTopic) => (
								<div
									key={topic.id}
									className="group flex h-8 items-center justify-between rounded-md px-2 text-xs transition-colors hover:bg-muted/30"
								>
									{editingTopicId === topic.id ? (
										<div className="flex items-center gap-1.5 w-full">
											<input
												type="text"
												value={editingLabel}
												onChange={(e) => setEditingLabel(e.target.value)}
												onKeyDown={(e) => {
													if (e.key === "Enter") handleRename(topic.id);
													if (e.key === "Escape") setEditingTopicId(null);
												}}
												autoFocus
												className="h-6.5 flex-1 rounded border border-foreground/30 bg-background px-2 font-ui text-xs outline-none"
											/>
											<button
												type="button"
												onClick={() => handleRename(topic.id)}
												className="flex size-5 items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-muted/40 cursor-pointer"
												title="Save"
											>
												<CheckIcon className="size-3.5" />
											</button>
											<button
												type="button"
												onClick={() => setEditingTopicId(null)}
												className="flex size-5 items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-muted/40 cursor-pointer"
												title="Cancel"
											>
												<XIcon className="size-3.5" />
											</button>
										</div>
									) : (
										<>
											<div className="flex items-center gap-2 min-w-0 flex-1 pr-2">
												<span className="truncate font-prose text-xs text-foreground/90 font-medium">
													{topic.label}
												</span>
												<span className="shrink-0 rounded-[3px] border border-border/50 bg-muted/20 px-1 py-0.2 font-mono text-[10px] text-muted-foreground tabular-nums">
													{topic.members.length}
												</span>
												{topic.overriddenAt && (
													<span
														className="shrink-0 rounded-[3px] border border-border/50 px-1 font-ui text-[9px] text-muted-foreground/80"
														title="Customized by user"
													>
														manual
													</span>
												)}
											</div>
											<div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
												<button
													type="button"
													onClick={() => {
														setEditingTopicId(topic.id);
														setEditingLabel(topic.label);
													}}
													className="flex size-6 items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-muted/40 cursor-pointer"
													title="Rename topic"
												>
													<PencilIcon className="size-3" />
												</button>
												<button
													type="button"
													onClick={() => handleDelete(topic.id)}
													className="flex size-6 items-center justify-center rounded text-muted-foreground hover:text-error hover:bg-error/10 cursor-pointer"
													title="Delete topic"
												>
													<Trash2Icon className="size-3" />
												</button>
											</div>
										</>
									)}
								</div>
							))
						)}
					</div>

					{/* Footer: Create custom topic input */}
					<div className="pt-2 border-t border-border/50 flex items-center gap-1.5">
						<input
							type="text"
							placeholder="New topic…"
							value={newTopicLabel}
							onChange={(e) => setNewTopicLabel(e.target.value)}
							onKeyDown={(e) => {
								if (e.key === "Enter") handleCreate();
							}}
							className="h-7 flex-1 rounded-md border border-border/70 bg-background/60 px-2.5 font-ui text-xs outline-none placeholder:text-muted-foreground/50 focus:border-foreground/40 transition-colors"
						/>
						<button
							type="button"
							disabled={!newTopicLabel.trim()}
							onClick={handleCreate}
							className="flex h-7 items-center gap-1 rounded-md border border-border/70 bg-background/80 px-2.5 font-ui text-xs font-medium text-foreground transition-all hover:bg-muted/40 hover:border-border active:scale-[0.98] disabled:opacity-40 cursor-pointer"
						>
							<PlusIcon className="size-3" />
							Add
						</button>
					</div>
				</div>
			)}
		</div>
	);
}
