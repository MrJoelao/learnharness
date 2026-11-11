"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { BookOpenIcon, FileCodeIcon, FileTextIcon, GlobeIcon, LockIcon, PlusIcon, XIcon } from "lucide-react";
import { MenuShell } from "@/components/menu-shell";
import { pathsForFiles } from "@/components/attach-files-button";
import { BROWSER_NOTICE } from "@/components/file-path-drop-zone";
import { Hint } from "@/components/ui/hint";
import { blurAfterPointerClick } from "@/components/focus-hygiene";
import { filePathLabel, type SessionReference, type SourceDocumentRef } from "@/src/core";

/**
 * UNIFIED SOURCES CONTROL & PANEL
 *
 * Consolidates session-level knowledge materials under one persistent,
 * non-overflowing header control:
 *
 * 1. Session Documents (#623): Selected at session creation, define the
 *    learning curriculum and syllabus. Staged under data/graph/materials/.
 *    Read-only in-session.
 * 2. Additional References (#613): Files or URLs added mid-session to provide
 *    grounding context to tutor agents across all turns. Mutable.
 *
 * The header renders a single compact "Sources · N" button.
 * Individual filenames are never rendered in the toolbar flex row, keeping
 * the session header stable at every viewport width and resource count.
 */

export function referenceLabel(reference: SessionReference): string {
	if (reference.name) return reference.name;
	return reference.kind === "file" ? filePathLabel(reference.value) : reference.value;
}

export function documentKindBadge(name: string): string {
	const lower = name.toLowerCase();
	if (lower.endsWith(".pdf")) return "PDF";
	if (lower.endsWith(".md") || lower.endsWith(".markdown")) return "Markdown";
	if (lower.endsWith(".txt")) return "Text";
	return "Document";
}

export function urlDomain(url: string): string {
	try {
		return new URL(url).hostname.replace(/^www\./, "");
	} catch {
		return "";
	}
}

export async function putReferences(chatId: string, references: SessionReference[]): Promise<SessionReference[]> {
	const res = await fetch(`/api/chats/${encodeURIComponent(chatId)}/references`, {
		method: "PUT",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ references }),
	});
	const body = (await res.json().catch(() => null)) as { references?: SessionReference[]; error?: string } | null;
	if (!res.ok || !body?.references) throw new Error(body?.error ?? `Could not save references (${res.status})`);
	return body.references;
}

export interface SourcesChipProps {
	chatId: string;
	sourceDocuments?: readonly SourceDocumentRef[];
	initialReferences?: SessionReference[];
	disabled?: boolean;
	testId?: string;
	label?: string;
}

export function SourcesChip({
	chatId,
	sourceDocuments = [],
	initialReferences = [],
	disabled = false,
	testId = "sources-chip",
	label = "Sources",
}: SourcesChipProps) {
	const [references, setReferences] = useState<SessionReference[]>(initialReferences ?? []);
	const [open, setOpen] = useState(false);
	const [error, setError] = useState("");
	const [urlDraft, setUrlDraft] = useState("");
	const buttonRef = useRef<HTMLButtonElement>(null);
	const pickerRef = useRef<HTMLInputElement>(null);

	const totalCount = sourceDocuments.length + references.length;

	const save = useCallback(
		async (next: SessionReference[]) => {
			try {
				setReferences(await putReferences(chatId, next));
				setError("");
			} catch (err) {
				setError(err instanceof Error ? err.message : "Could not save references");
			}
		},
		[chatId],
	);

	useEffect(() => {
		if (!open) return;
		const onPointerDown = (e: PointerEvent) => {
			const target = e.target as Node;
			if (target instanceof Element && target.closest("[data-lh-menu]")) return;
			if (buttonRef.current?.contains(target)) return;
			setOpen(false);
		};
		const onKeyDown = (e: KeyboardEvent) => {
			if (e.key === "Escape") {
				e.stopPropagation();
				setOpen(false);
				buttonRef.current?.focus();
			}
		};
		document.addEventListener("pointerdown", onPointerDown);
		document.addEventListener("keydown", onKeyDown);
		return () => {
			document.removeEventListener("pointerdown", onPointerDown);
			document.removeEventListener("keydown", onKeyDown);
		};
	}, [open]);

	const addPicked = (files: File[]) => {
		const resolve = window.lh?.getPathForFile;
		if (!resolve) {
			setError(BROWSER_NOTICE);
			return;
		}
		const now = new Date().toISOString();
		const fresh = pathsForFiles(files, resolve).paths
			.filter((value) => !references.some((r) => r.kind === "file" && r.value === value))
			.map((value) => ({ id: crypto.randomUUID(), kind: "file" as const, value, addedAt: now }));
		if (fresh.length === 0) {
			setError("That file is already on the shelf.");
			return;
		}
		void save([...references, ...fresh]);
	};

	const addUrl = () => {
		const value = urlDraft.trim();
		if (!value) return;
		if (references.some((r) => r.kind === "url" && r.value === value)) {
			setError("That URL is already on the shelf.");
			return;
		}
		setUrlDraft("");
		void save([...references, { id: crypto.randomUUID(), kind: "url", value, addedAt: new Date().toISOString() }]);
	};

	const remove = (id: string) => {
		void save(references.filter((r) => r.id !== id));
	};

	return (
		<div className="shrink-0">
			<input
				ref={pickerRef}
				type="file"
				multiple
				hidden
				data-testid="references-file-input"
				onChange={(e) => {
					addPicked(Array.from(e.currentTarget.files ?? []));
					e.currentTarget.value = "";
				}}
			/>
			<Hint label="View session documents and additional references" side="bottom">
				<button
					ref={buttonRef}
					type="button"
					data-testid={testId}
					aria-haspopup="dialog"
					aria-expanded={open}
					disabled={disabled}
					onClick={(e) => {
						blurAfterPointerClick(e);
						setError("");
						if (!disabled) setOpen(!open);
					}}
					className={
						"lh-no-drag flex h-7 shrink-0 cursor-pointer items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium uppercase tracking-wide transition-colors focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-none " +
						(open
							? "border-border/90 bg-accent text-foreground shadow-xs font-medium"
							: "border-border/80 text-muted-foreground hover:border-border hover:text-foreground hover:bg-muted/30")
					}
				>
					<BookOpenIcon className="size-3.5 text-muted-foreground/80" aria-hidden="true" />
					<span>
						{label}
						{totalCount > 0 ? ` · ${totalCount}` : ""}
					</span>
				</button>
			</Hint>
			{open && (
				<MenuShell
					anchorRef={buttonRef}
					testid="sources-panel"
					preferredSide="down"
					align="right"
					menuClass="flex w-[420px] sm:w-[450px] max-w-[calc(100vw-24px)] flex-col rounded-xl border border-border bg-card text-xs shadow-2xl"
				>
					{/* Dual testid container so legacy references-panel assertions resolve */}
					<div data-testid="references-panel" className="flex flex-col flex-1 min-h-0 overflow-hidden">
						{/* 1. Fixed Header */}
						<div className="flex shrink-0 items-center justify-between border-b border-border/40 px-4 py-3">
							<div className="flex flex-col gap-0.5">
								<span className="font-semibold text-foreground text-sm tracking-tight">Sources</span>
								<p className="text-muted-foreground text-[11px] leading-snug">
									Materials associated with this session
								</p>
							</div>
						</div>

						{/* 2. Scrollable Content Area */}
						<div className="flex-1 min-h-0 overflow-y-auto px-4 py-3 flex flex-col gap-3.5">
							{/* Total Empty State (when 0 sources and 0 references) */}
							{totalCount === 0 && (
								<div
									data-testid="sources-empty-all"
									className="py-3 px-1 text-center text-xs text-muted-foreground/80"
								>
									<p className="font-medium text-foreground">No sources attached</p>
									<p className="text-[11px] text-muted-foreground/60 mt-0.5">
										Add files or links below to ground tutor answers.
									</p>
								</div>
							)}

							{/* Section A: Session Source Documents (Creation-time, Read-only Curriculum) */}
							{sourceDocuments.length > 0 && (
								<div className="flex flex-col gap-1.5" data-testid="session-documents-section">
									<div className="flex items-center justify-between text-[11px] font-mono uppercase tracking-wider text-muted-foreground/80">
										<span>Session Documents · {sourceDocuments.length}</span>
										<Hint label="Curriculum documents are read-only" side="left">
											<span
												className="flex items-center text-muted-foreground/60 cursor-default"
												aria-label="Curriculum · Read-only"
											>
												<LockIcon className="size-3" aria-hidden="true" />
												<span className="sr-only">Curriculum · Read-only</span>
											</span>
										</Hint>
									</div>
									<ul className="flex flex-col gap-1" data-testid="session-documents-list">
										{sourceDocuments.map((doc) => {
											const lower = doc.name.toLowerCase();
											const isCodeOrMd =
												lower.endsWith(".md") ||
												lower.endsWith(".markdown") ||
												lower.endsWith(".py") ||
												lower.endsWith(".ts") ||
												lower.endsWith(".js") ||
												lower.endsWith(".json");
											return (
												<li
													key={doc.sourceId}
													data-testid={`session-doc-${doc.sourceId}`}
													title={doc.name}
													className="flex h-10 min-h-[40px] items-center gap-2.5 rounded-md px-2.5 transition-colors hover:bg-muted/40"
												>
													{isCodeOrMd ? (
														<FileCodeIcon className="size-4 shrink-0 text-muted-foreground/80" aria-hidden="true" />
													) : (
														<FileTextIcon className="size-4 shrink-0 text-muted-foreground/80" aria-hidden="true" />
													)}
													<span className="min-w-0 flex-1 truncate font-medium text-foreground text-xs">
														{doc.name}
													</span>
												</li>
											);
										})}
									</ul>
								</div>
							)}

							{/* Separator if session documents exist */}
							{sourceDocuments.length > 0 && (
								<div className="border-t border-border/40" aria-hidden="true" />
							)}

							{/* Section B: Additional References (Mutable session grounding shelf) */}
							<div className="flex flex-col gap-1.5" data-testid="additional-references-section">
								<div className="flex items-center justify-between text-[11px] font-mono uppercase tracking-wider text-muted-foreground/80">
									<span>Additional References{references.length > 0 ? ` · ${references.length}` : ""}</span>
								</div>
								{references.length === 0 ? (
									<div
										data-testid="references-empty"
										className="py-2 px-1 text-xs text-muted-foreground/80"
									>
										<p className="font-normal text-muted-foreground">No additional references yet.</p>
										<p className="text-[11px] text-muted-foreground/60 mt-0.5">
											Add files or links to provide extra context.
										</p>
									</div>
								) : (
									<ul className="flex flex-col gap-1" data-testid="references-list">
										{references.map((reference) => {
											const labelText = referenceLabel(reference);
											const domain = reference.kind === "url" ? urlDomain(reference.value) : "";
											return (
												<li
													key={reference.id}
													data-testid={`reference-item-${reference.id}`}
													className="flex h-10 min-h-[40px] items-center gap-2.5 rounded-md px-2.5 transition-colors hover:bg-accent/40"
												>
													{reference.kind === "file" ? (
														<FileTextIcon className="size-4 shrink-0 text-muted-foreground/80" aria-hidden="true" />
													) : (
														<GlobeIcon className="size-4 shrink-0 text-muted-foreground/80" aria-hidden="true" />
													)}
													<div className="min-w-0 flex-1 flex flex-col justify-center">
														<span className="truncate text-foreground font-medium text-xs" title={reference.value}>
															{labelText}
														</span>
														{domain && (
															<span className="truncate text-[10px] text-muted-foreground/70 font-mono">
																{domain}
															</span>
														)}
													</div>
													<button
														type="button"
														data-testid={`references-remove-${reference.id}`}
														aria-label={`Remove ${labelText}`}
														onClick={() => remove(reference.id)}
														className="flex size-6 shrink-0 cursor-pointer items-center justify-center rounded text-muted-foreground/70 transition-colors hover:bg-accent hover:text-foreground"
													>
														<XIcon className="size-3.5" aria-hidden="true" />
													</button>
												</li>
											);
										})}
									</ul>
								)}
							</div>
						</div>

						{/* 3. Fixed Footer: Add reference actions */}
						<div className="shrink-0 border-t border-border/40 bg-card px-4 py-2.5 flex flex-col gap-2">
							<div className="flex items-center justify-between text-[11px] font-mono uppercase tracking-wider text-muted-foreground/80">
								<span>Add Reference</span>
							</div>
							<div className="flex items-center gap-2">
								<button
									type="button"
									data-testid="references-add-file"
									onClick={() => pickerRef.current?.click()}
									className="flex h-8 shrink-0 cursor-pointer items-center gap-1.5 rounded-md border border-border/70 bg-card px-2.5 text-xs font-medium text-foreground transition-colors hover:bg-accent/60"
								>
									<PlusIcon className="size-3.5 text-muted-foreground" aria-hidden="true" />
									<span>Add file…</span>
								</button>
								<div className="flex h-8 min-w-0 flex-1 items-center rounded-md border border-border/70 bg-background/50 focus-within:border-border focus-within:bg-background transition-colors">
									<input
										data-testid="references-url-input"
										value={urlDraft}
										onChange={(e) => setUrlDraft(e.target.value)}
										onKeyDown={(e) => {
											if (e.key === "Enter") {
												e.preventDefault();
												addUrl();
											}
										}}
										placeholder="https://… (article, docs)"
										spellCheck={false}
										className="min-w-0 flex-1 bg-transparent px-2.5 text-xs outline-none placeholder:text-muted-foreground/50"
									/>
									<button
										type="button"
										data-testid="references-add-url"
										disabled={urlDraft.trim() === ""}
										onClick={addUrl}
										className="flex h-full shrink-0 cursor-pointer items-center px-2.5 text-xs font-medium text-foreground transition-colors hover:bg-accent/60 disabled:cursor-default disabled:opacity-30 rounded-r-md border-l border-border/50"
									>
										Add URL
									</button>
								</div>
							</div>
							{error && (
								<p data-testid="references-error" role="alert" className="text-destructive text-[11px] leading-tight">
									{error}
								</p>
							)}
						</div>
					</div>
				</MenuShell>
			)}
		</div>
	);
}

/** Backwards-compatible wrapper matching the previous ReferencesChip contract. */
export function ReferencesChip({
	chatId,
	initialReferences,
	sourceDocuments = [],
}: {
	chatId: string;
	initialReferences?: SessionReference[];
	sourceDocuments?: readonly SourceDocumentRef[];
}) {
	return (
		<SourcesChip
			chatId={chatId}
			sourceDocuments={sourceDocuments}
			initialReferences={initialReferences}
			testId="references-chip"
			label="References"
		/>
	);
}
