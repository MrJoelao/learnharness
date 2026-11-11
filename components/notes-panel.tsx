"use client";

import { useEffect, useRef, useState } from "react";
import { NotebookPenIcon, PanelRightCloseIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { blurAfterPointerClick } from "@/components/focus-hygiene";
import { NotesEditor } from "@/components/notes-editor";
import { cn } from "@/lib/utils";
import {
	clampNotesWidth,
	NOTES_DEFAULT_WIDTH,
	NOTES_MAX_WIDTH,
	NOTES_MIN_WIDTH,
} from "@/components/notes-layout";
import { useNotesController, useNotesSnapshot } from "@/components/notes-state";

/** Always mounted so the editor (and its undo history) survives folding. */
export function NotesPanel() {
	const controller = useNotesController();
	const { visible, width: savedWidth, saveError } = useNotesSnapshot();
	const [mounted, setMounted] = useState(false);
	const [dragWidth, setDragWidth] = useState<number | null>(null);
	const drag = useRef<{ x: number; width: number } | null>(null);
	// transitions gated on mount: no slide-in flash on page load
	useEffect(() => setMounted(true), []);
	if (!controller) return null;
	const width = dragWidth ?? savedWidth;
	const step = (delta: number) => controller.setWidth(width + delta);
	return (
		<aside
			data-testid="notes-panel"
			data-state={visible ? "open" : "folded"}
			aria-hidden={!visible}
			inert={!visible}
			style={{ width: visible ? width : 0 }}
			className={`relative shrink-0 overflow-hidden ${mounted && dragWidth === null ? "transition-[width] duration-200" : ""}`}
		>
			<div
				role="separator"
				aria-orientation="vertical"
				aria-label="Resize notes"
				aria-valuenow={width}
				aria-valuemin={NOTES_MIN_WIDTH}
				aria-valuemax={NOTES_MAX_WIDTH}
				tabIndex={0}
				className="lh-no-drag absolute inset-y-0 left-0 z-10 w-1.5 cursor-col-resize touch-none hover:bg-border focus-visible:bg-border"
				onPointerDown={(e) => {
					e.currentTarget.setPointerCapture(e.pointerId);
					drag.current = { x: e.clientX, width };
				}}
				onPointerMove={(e) => {
					if (drag.current) setDragWidth(clampNotesWidth(drag.current.width + drag.current.x - e.clientX));
				}}
				onPointerUp={(e) => {
					if (!drag.current) return;
					controller.setWidth(drag.current.width + drag.current.x - e.clientX);
					drag.current = null;
					setDragWidth(null);
				}}
				onPointerCancel={() => {
					drag.current = null;
					setDragWidth(null);
				}}
				onKeyDown={(e) => {
					if (e.key === "ArrowLeft") { e.preventDefault(); step(16); }
					else if (e.key === "ArrowRight") { e.preventDefault(); step(-16); }
				}}
				onDoubleClick={() => controller.setWidth(NOTES_DEFAULT_WIDTH)}
			/>
			<div style={{ width }} className="flex h-full flex-col border-l bg-background">
				<div className="lh-drag lh-wco-gutter flex h-15 shrink-0 select-none items-center gap-2 border-b border-border px-3">
					<span className="flex-1 text-sm font-medium">Notes</span>
					{saveError && <span role="status" className="text-xs text-destructive">{saveError}</span>}
					<Button variant="ghost" size="icon" aria-label="Fold notes" onClick={() => controller.setOpen(false)} className="lh-no-drag">
						<PanelRightCloseIcon className="size-4" />
					</Button>
				</div>
				<div className="min-h-0 flex-1">
					<NotesEditor controller={controller} />
				</div>
			</div>
		</aside>
	);
}

import { Hint } from "@/components/ui/hint";

export function NotesChip() {
	const controller = useNotesController();
	const { visible } = useNotesSnapshot();
	return (
		<div
			className={cn(
				"flex items-center shrink-0 overflow-hidden transition-all duration-200 ease-in-out",
				visible ? "max-w-0 opacity-0 pointer-events-none -mr-1" : "max-w-36 opacity-100 mr-0",
			)}
		>
			<div className="h-3.5 w-px bg-border/50 ml-2 mr-2 shrink-0" aria-hidden="true" />
			<Hint label={visible ? "Close notes panel" : "Open notes panel"} side="bottom">
				<button
					type="button"
					data-testid="notes-chip"
					aria-pressed={visible}
					onClick={(e) => {
						blurAfterPointerClick(e);
						controller?.setOpen(!visible);
					}}
					className={
						"lh-no-drag flex h-7 shrink-0 cursor-pointer items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium uppercase tracking-wide transition-colors focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-none " +
						(visible
							? "border-border/90 bg-accent text-foreground shadow-xs font-medium"
							: "border-border/80 text-muted-foreground hover:border-border hover:text-foreground hover:bg-muted/30")
					}
				>
					<NotebookPenIcon className="size-3.5 text-muted-foreground/80" aria-hidden="true" />
					<span>Notes</span>
				</button>
			</Hint>
		</div>
	);
}
