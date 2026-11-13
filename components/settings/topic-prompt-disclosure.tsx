"use client";
/**
 * TopicPromptDisclosure — Collapsible power-user disclosure for custom prompt directives.
 *
 * Keeps the primary settings interface quiet and serene while providing power users
 * with an escape hatch for bespoke AI topic clustering rules.
 */

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

export function TopicPromptDisclosure({
	value,
	onCommit,
}: {
	value: string;
	onCommit: (val: string) => void;
}) {
	const hasContent = Boolean(value && value.trim().length > 0);
	const [isOpen, setIsOpen] = useState(false);
	const [draft, setDraft] = useState(value);

	useEffect(() => {
		setDraft(value);
	}, [value]);

	const handleBlur = () => {
		if (draft !== value) {
			onCommit(draft);
		}
	};

	const handleClear = () => {
		setDraft("");
		onCommit("");
	};

	return (
		<div
			data-testid="disclosure-topic-custom-prompt"
			className={cn(
				"rounded-lg border transition-all duration-200 ease-out",
				isOpen
					? "border-border bg-card/40"
					: "border-border/50 bg-background/30 hover:border-border hover:bg-muted/15"
			)}
		>
			{/* Collapsible Trigger Row */}
			<button
				type="button"
				onClick={() => setIsOpen((prev) => !prev)}
				aria-expanded={isOpen}
				className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-foreground/40 rounded-lg"
			>
				<div className="flex items-center gap-2 text-xs">
					<svg
						viewBox="0 0 16 16"
						fill="none"
						stroke="currentColor"
						strokeWidth="1.5"
						className={cn(
							"size-3.5 text-muted-foreground transition-transform duration-200 ease-out",
							isOpen ? "rotate-90 text-foreground" : "text-muted-foreground/60"
						)}
						aria-hidden="true"
					>
						<path d="M6 3.5 L10.5 8 L6 12.5" strokeLinecap="round" strokeLinejoin="round" />
					</svg>
					<span
						className={cn(
							"font-prose transition-colors",
							isOpen ? "text-foreground font-medium" : "text-foreground/80"
						)}
					>
						Advanced prompt directives
					</span>
				</div>

				<div className="flex items-center gap-2">
					<span
						className={cn(
							"rounded-[3px] border px-1.5 py-0.5 font-ui text-[10px] tracking-wide transition-colors",
							hasContent
								? "border-accent/40 bg-accent/15 text-foreground"
								: "border-border/60 text-muted-foreground/70"
						)}
					>
						{hasContent ? "Configured" : "Optional"}
					</span>
				</div>
			</button>

			{/* Collapsible Content Area */}
			{isOpen && (
				<div className="flex flex-col gap-2 px-3 pb-3 pt-1 border-t border-border/40">
					<p className="text-[11px] leading-relaxed text-muted-foreground/80">
						Optional directives appended to the AI topic classification prompt to enforce custom categorization criteria.
					</p>

					<textarea
						rows={3}
						value={draft}
						placeholder="e.g. Group topics following course syllabus; keep technical terms in English..."
						onChange={(e) => setDraft(e.target.value)}
						onBlur={handleBlur}
						data-testid="textarea-topic-custom-prompt"
						className="w-full rounded-md border border-border/70 bg-background/80 p-2 font-mono text-xs text-foreground placeholder:text-muted-foreground/45 transition-colors focus:border-foreground/40 focus:outline-none focus:ring-1 focus:ring-foreground/20"
					/>

					<div className="flex items-center justify-between text-[10px] text-muted-foreground/60">
						<span>Saved automatically on blur</span>
						{draft.length > 0 && (
							<button
								type="button"
								onClick={handleClear}
								className="text-muted-foreground transition-colors hover:text-error cursor-pointer focus:outline-none"
							>
								Clear directives
							</button>
						)}
					</div>
				</div>
			)}
		</div>
	);
}
