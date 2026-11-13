"use client";

import { useEffect, useState } from "react";
import { HostDialog } from "@/components/host-dialog";
import type { TopicOrganization, GraphTopic } from "@/src/core";
import { Loader2Icon, PlusIcon } from "lucide-react";

export function AssignTopicDialog({
	node,
	onClose,
	onAssigned,
}: {
	node: { id: string; name: string } | null;
	onClose: () => void;
	onAssigned: () => void;
}) {
	const [org, setOrg] = useState<TopicOrganization | null>(null);
	const [selectedTopicId, setSelectedTopicId] = useState<string | null>(null);
	const [isNew, setIsNew] = useState(false);
	const [newTopicName, setNewTopicName] = useState("");
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		if (!node) return;
		setIsNew(false);
		setNewTopicName("");
		setError(null);
		fetch("/api/graph/topics")
			.then((res) => res.json() as Promise<TopicOrganization>)
			.then((data) => {
				setOrg(data);
				// Find current topic
				const current = data.topics.find((t: GraphTopic) => t.members.includes(node.id));
				setSelectedTopicId(current ? current.id : null);
			})
			.catch((err) => console.error("[assign-topic] fetch failed:", err));
	}, [node]);

	if (!node) return null;

	const handleSave = async () => {
		setBusy(true);
		setError(null);
		try {
			if (isNew) {
				const label = newTopicName.trim();
				if (!label) {
					setError("Please enter a topic name");
					setBusy(false);
					return;
				}
				const res = await fetch("/api/graph/topics", {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ action: "create-topic", label, nodeIds: [node.id] }),
				});
				if (!res.ok) throw new Error("Failed to create topic");
			} else {
				const res = await fetch("/api/graph/topics", {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ action: "move-node", nodeId: node.id, toTopicId: selectedTopicId }),
				});
				if (!res.ok) throw new Error("Failed to move node");
			}
			onAssigned();
			onClose();
		} catch (err) {
			setError(err instanceof Error ? err.message : "Error saving topic");
		} finally {
			setBusy(false);
		}
	};

	const topics = org?.topics ?? [];

	return (
		<HostDialog open={node !== null} onClose={onClose}>
			<div
				role="dialog"
				aria-modal="true"
				aria-label="Assign topic"
				data-testid="assign-topic-dialog"
				onClick={(e) => e.stopPropagation()}
				className="w-96 max-w-[calc(100vw-2rem)] rounded-xl border bg-card p-5 shadow-xl flex flex-col gap-3 text-xs"
			>
				<div>
					<h2 className="text-sm font-semibold text-foreground">Assign Topic</h2>
					<p className="mt-1 text-muted-foreground truncate" title={node.name}>
						Node: <span className="font-medium text-foreground">{node.name}</span>
					</p>
				</div>

				{error && (
					<div className="rounded bg-destructive/10 text-destructive px-2.5 py-1 text-xs">
						{error}
					</div>
				)}

				<div className="flex flex-col gap-1.5 max-h-56 overflow-y-auto pr-1">
					<label
						className={`flex items-center gap-2 rounded-lg border px-3 py-2 cursor-pointer transition-colors ${
							!isNew && selectedTopicId === null
								? "border-primary bg-primary/5 text-foreground font-medium"
								: "border-border/60 hover:bg-accent/50 text-muted-foreground"
						}`}
					>
						<input
							type="radio"
							name="topic-choice"
							checked={!isNew && selectedTopicId === null}
							onChange={() => {
								setIsNew(false);
								setSelectedTopicId(null);
							}}
							className="sr-only"
						/>
						<span>(Unassigned / No topic)</span>
					</label>

					{topics.map((t) => (
						<label
							key={t.id}
							className={`flex items-center justify-between rounded-lg border px-3 py-2 cursor-pointer transition-colors ${
								!isNew && selectedTopicId === t.id
									? "border-primary bg-primary/5 text-foreground font-medium"
									: "border-border/60 hover:bg-accent/50 text-muted-foreground"
							}`}
						>
							<div className="flex items-center gap-2 min-w-0">
								<input
									type="radio"
									name="topic-choice"
									checked={!isNew && selectedTopicId === t.id}
									onChange={() => {
										setIsNew(false);
										setSelectedTopicId(t.id);
									}}
									className="sr-only"
								/>
								<span className="truncate">{t.label}</span>
							</div>
							<span className="text-[10px] text-muted-foreground ml-2 shrink-0">
								{t.members.length} {t.members.length === 1 ? "node" : "nodes"}
							</span>
						</label>
					))}

					<label
						className={`flex flex-col gap-2 rounded-lg border px-3 py-2 cursor-pointer transition-colors ${
							isNew
								? "border-primary bg-primary/5 text-foreground font-medium"
								: "border-border/60 hover:bg-accent/50 text-muted-foreground"
						}`}
					>
						<div className="flex items-center gap-2">
							<input
								type="radio"
								name="topic-choice"
								checked={isNew}
								onChange={() => setIsNew(true)}
								className="sr-only"
							/>
							<PlusIcon className="size-3.5 shrink-0" />
							<span>Create new topic…</span>
						</div>
						{isNew && (
							<input
								type="text"
								placeholder="Topic name"
								value={newTopicName}
								onChange={(e) => setNewTopicName(e.target.value)}
								autoFocus
								onKeyDown={(e) => {
									if (e.key === "Enter") void handleSave();
								}}
								className="h-7 w-full rounded border bg-background px-2 text-xs outline-none focus:border-primary"
							/>
						)}
					</label>
				</div>

				<div className="mt-2 flex items-center justify-end gap-2 pt-2 border-t border-border/60">
					<button
						type="button"
						onClick={onClose}
						disabled={busy}
						className="rounded-lg px-3 py-1.5 text-xs text-muted-foreground hover:bg-accent"
					>
						Cancel
					</button>
					<button
						type="button"
						onClick={() => void handleSave()}
						disabled={busy}
						className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
					>
						{busy && <Loader2Icon className="size-3 animate-spin" />}
						Save
					</button>
				</div>
			</div>
		</HostDialog>
	);
}
