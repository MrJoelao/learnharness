"use client";
/**
 * Topic Unification Selector — visual schematic selector for cross-material topic clustering.
 *
 * Implements the unslop craft guidelines:
 * - Quiet chrome, tinted neutral surfaces, intentional accent on the active selection.
 * - Geometric 1.5-stroke vector schematics illustrating the physical clustering topology:
 *     1. Course folder: Boundary containing source notes/chats converging into a unified topic.
 *     2. Entire graph: Open network mesh linking distributed clusters across all boundaries.
 *     3. By session: Isolated parallel silos with a strict dividing partition.
 * - Purposeful transitions: stroke drawing and node illumination when switching options.
 */

import { type KeyboardEvent, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import type { TopicUnification } from "@/src/core";

interface OptionMeta {
	id: TopicUnification;
	title: string;
	badge: string;
	isRecommended?: boolean;
	description: string;
	schematic: (props: { active: boolean }) => ReactNode;
}

/**
 * Schematic 1: Course folder
 * Content sources within a course boundary converge into a unified topic node.
 */
function FolderSchematic({ active }: { active: boolean }) {
	return (
		<svg
			viewBox="0 0 100 48"
			fill="none"
			className="size-full overflow-visible"
			aria-hidden="true"
		>
			{/* Folder container outline */}
			<path
				d="M 12 12 L 12 38 A 4 4 0 0 0 16 42 L 84 42 A 4 4 0 0 0 88 38 L 88 14 A 4 4 0 0 0 84 10 L 44 10 L 38 6 L 16 6 A 4 4 0 0 0 12 10 Z"
				className={cn(
					"transition-all duration-300 ease-out",
					active
						? "stroke-foreground/70 fill-foreground/[0.03]"
						: "stroke-border/70 fill-transparent"
				)}
				strokeWidth={1.25}
				strokeLinejoin="round"
			/>

			{/* Left source nodes (chat / document) */}
			<circle
				cx="26"
				cy="19"
				r="3.5"
				className={cn(
					"transition-all duration-300 ease-out",
					active ? "fill-foreground/80 stroke-foreground" : "fill-muted-foreground/30 stroke-muted-foreground/50"
				)}
				strokeWidth={1.2}
			/>
			<circle
				cx="26"
				cy="31"
				r="3.5"
				className={cn(
					"transition-all duration-300 ease-out",
					active ? "fill-foreground/80 stroke-foreground" : "fill-muted-foreground/30 stroke-muted-foreground/50"
				)}
				strokeWidth={1.2}
			/>

			{/* Converging connecting paths */}
			<path
				d="M 30 19 C 46 19, 52 25, 66 25"
				className={cn(
					"transition-all duration-300 ease-out",
					active ? "stroke-foreground opacity-100" : "stroke-muted-foreground/40 opacity-40"
				)}
				strokeWidth={1.5}
				strokeLinecap="round"
				style={{
					strokeDasharray: "45",
					strokeDashoffset: active ? 0 : 15,
				}}
			/>
			<path
				d="M 30 31 C 46 31, 52 25, 66 25"
				className={cn(
					"transition-all duration-300 ease-out",
					active ? "stroke-foreground opacity-100" : "stroke-muted-foreground/40 opacity-40"
				)}
				strokeWidth={1.5}
				strokeLinecap="round"
				style={{
					strokeDasharray: "45",
					strokeDashoffset: active ? 0 : 15,
				}}
			/>

			{/* Unified target topic node */}
			<circle
				cx="70"
				cy="25"
				r="5.5"
				className={cn(
					"transition-all duration-300 ease-out origin-center",
					active
						? "fill-foreground stroke-foreground scale-105"
						: "fill-muted-foreground/30 stroke-muted-foreground/60 scale-95"
				)}
				strokeWidth={1.2}
			/>
			<circle
				cx="70"
				cy="25"
				r="2"
				className={cn(
					"transition-opacity duration-300",
					active ? "fill-background opacity-100" : "fill-transparent opacity-0"
				)}
			/>
		</svg>
	);
}

/**
 * Schematic 2: Entire graph
 * Open semantic network where cross-cutting edges freely bridge multiple clusters.
 */
function GlobalSchematic({ active }: { active: boolean }) {
	return (
		<svg
			viewBox="0 0 100 48"
			fill="none"
			className="size-full overflow-visible"
			aria-hidden="true"
		>
			{/* Local cluster satellites */}
			<circle
				cx="16"
				cy="18"
				r="2.5"
				className={cn("transition-colors duration-300", active ? "fill-foreground/70" : "fill-muted-foreground/30")}
			/>
			<circle
				cx="64"
				cy="12"
				r="2.5"
				className={cn("transition-colors duration-300", active ? "fill-foreground/70" : "fill-muted-foreground/30")}
			/>
			<circle
				cx="86"
				cy="20"
				r="2.5"
				className={cn("transition-colors duration-300", active ? "fill-foreground/70" : "fill-muted-foreground/30")}
			/>

			{/* Satellite branches */}
			<line
				x1="16"
				y1="18"
				x2="24"
				y2="30"
				className={cn("transition-colors duration-300", active ? "stroke-foreground/50" : "stroke-muted-foreground/30")}
				strokeWidth={1.2}
			/>
			<line
				x1="64"
				y1="12"
				x2="52"
				y2="16"
				className={cn("transition-colors duration-300", active ? "stroke-foreground/50" : "stroke-muted-foreground/30")}
				strokeWidth={1.2}
			/>
			<line
				x1="86"
				y1="20"
				x2="78"
				y2="32"
				className={cn("transition-colors duration-300", active ? "stroke-foreground/50" : "stroke-muted-foreground/30")}
				strokeWidth={1.2}
			/>

			{/* Cross-cutting global bridges */}
			<path
				d="M 24 30 C 34 20, 42 16, 52 16"
				className={cn(
					"transition-all duration-300 ease-out",
					active ? "stroke-foreground opacity-100" : "stroke-muted-foreground/40 opacity-40"
				)}
				strokeWidth={1.5}
				strokeLinecap="round"
				style={{
					strokeDasharray: "40",
					strokeDashoffset: active ? 0 : 20,
				}}
			/>
			<path
				d="M 52 16 C 62 18, 70 24, 78 32"
				className={cn(
					"transition-all duration-300 ease-out",
					active ? "stroke-foreground opacity-100" : "stroke-muted-foreground/40 opacity-40"
				)}
				strokeWidth={1.5}
				strokeLinecap="round"
				style={{
					strokeDasharray: "40",
					strokeDashoffset: active ? 0 : 20,
				}}
			/>
			<path
				d="M 24 30 C 40 40, 62 40, 78 32"
				className={cn(
					"transition-all duration-300 ease-out",
					active ? "stroke-foreground opacity-100" : "stroke-muted-foreground/35 opacity-30"
				)}
				strokeWidth={1.4}
				strokeLinecap="round"
				style={{
					strokeDasharray: "60",
					strokeDashoffset: active ? 0 : 30,
				}}
			/>

			{/* Central network hubs */}
			<circle
				cx="24"
				cy="30"
				r="4"
				className={cn(
					"transition-all duration-300 ease-out origin-center",
					active ? "fill-foreground stroke-foreground scale-105" : "fill-muted-foreground/30 stroke-muted-foreground/60 scale-95"
				)}
				strokeWidth={1.2}
			/>
			<circle
				cx="52"
				cy="16"
				r="4.5"
				className={cn(
					"transition-all duration-300 ease-out origin-center",
					active ? "fill-foreground stroke-foreground scale-105" : "fill-muted-foreground/30 stroke-muted-foreground/60 scale-95"
				)}
				strokeWidth={1.2}
			/>
			<circle
				cx="78"
				cy="32"
				r="4"
				className={cn(
					"transition-all duration-300 ease-out origin-center",
					active ? "fill-foreground stroke-foreground scale-105" : "fill-muted-foreground/30 stroke-muted-foreground/60 scale-95"
				)}
				strokeWidth={1.2}
			/>
		</svg>
	);
}

/**
 * Schematic 3: By session
 * Strict provenance with partitioned silos and zero cross-source bridging.
 */
function StrictSchematic({ active }: { active: boolean }) {
	return (
		<svg
			viewBox="0 0 100 48"
			fill="none"
			className="size-full overflow-visible"
			aria-hidden="true"
		>
			{/* Partitioned silo frames */}
			<rect
				x="12"
				y="7"
				width="33"
				height="34"
				rx="4"
				className={cn(
					"transition-all duration-300 ease-out",
					active ? "stroke-foreground/60 fill-foreground/[0.02]" : "stroke-border/70 fill-transparent"
				)}
				strokeWidth={1.2}
			/>
			<rect
				x="55"
				y="7"
				width="33"
				height="34"
				rx="4"
				className={cn(
					"transition-all duration-300 ease-out",
					active ? "stroke-foreground/60 fill-foreground/[0.02]" : "stroke-border/70 fill-transparent"
				)}
				strokeWidth={1.2}
			/>

			{/* Center partition barrier */}
			<line
				x1="50"
				y1="9"
				x2="50"
				y2="39"
				className={cn(
					"transition-colors duration-300",
					active ? "stroke-foreground/40" : "stroke-border"
				)}
				strokeWidth={1.2}
				strokeDasharray="2 3"
			/>

			{/* Silo 1 internal cluster */}
			<circle
				cx="20"
				cy="18"
				r="3"
				className={cn("transition-colors duration-300", active ? "fill-foreground/70" : "fill-muted-foreground/30")}
			/>
			<circle
				cx="32"
				cy="29"
				r="4.2"
				className={cn(
					"transition-all duration-300 ease-out origin-center",
					active ? "fill-foreground stroke-foreground scale-105" : "fill-muted-foreground/30 stroke-muted-foreground/60 scale-95"
				)}
				strokeWidth={1.2}
			/>
			<line
				x1="20"
				y1="18"
				x2="32"
				y2="29"
				className={cn(
					"transition-all duration-300",
					active ? "stroke-foreground opacity-100" : "stroke-muted-foreground/40 opacity-40"
				)}
				strokeWidth={1.5}
			/>

			{/* Silo 2 internal cluster */}
			<circle
				cx="63"
				cy="18"
				r="3"
				className={cn("transition-colors duration-300", active ? "fill-foreground/70" : "fill-muted-foreground/30")}
			/>
			<circle
				cx="75"
				cy="29"
				r="4.2"
				className={cn(
					"transition-all duration-300 ease-out origin-center",
					active ? "fill-foreground stroke-foreground scale-105" : "fill-muted-foreground/30 stroke-muted-foreground/60 scale-95"
				)}
				strokeWidth={1.2}
			/>
			<line
				x1="63"
				y1="18"
				x2="75"
				y2="29"
				className={cn(
					"transition-all duration-300",
					active ? "stroke-foreground opacity-100" : "stroke-muted-foreground/40 opacity-40"
				)}
				strokeWidth={1.5}
			/>
		</svg>
	);
}

const OPTIONS: readonly OptionMeta[] = [
	{
		id: "folder",
		title: "Course folder",
		badge: "Recommended",
		isRecommended: true,
		description: "Merges chats and notes within the course folder.",
		schematic: FolderSchematic,
	},
	{
		id: "global",
		title: "Entire graph",
		badge: "Global",
		description: "Connects related concepts across all courses.",
		schematic: GlobalSchematic,
	},
	{
		id: "strict",
		title: "By session",
		badge: "Isolated",
		description: "Keeps topics strictly separated per source.",
		schematic: StrictSchematic,
	},
];

export function TopicUnificationSelector({
	value,
	onChange,
}: {
	value: TopicUnification;
	onChange: (next: TopicUnification) => void;
}) {
	const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
		const currentIndex = OPTIONS.findIndex((opt) => opt.id === value);
		if (currentIndex === -1) return;

		if (e.key === "ArrowRight" || e.key === "ArrowDown") {
			e.preventDefault();
			const next = OPTIONS[(currentIndex + 1) % OPTIONS.length];
			if (next) onChange(next.id);
		} else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
			e.preventDefault();
			const prev = OPTIONS[(currentIndex - 1 + OPTIONS.length) % OPTIONS.length];
			if (prev) onChange(prev.id);
		}
	};

	return (
		<div
			role="radiogroup"
			aria-label="Cross-material unification scope"
			onKeyDown={handleKeyDown}
			className="grid grid-cols-3 gap-2.5 sm:gap-3"
		>
			{OPTIONS.map((opt) => {
				const active = opt.id === value;
				const Schematic = opt.schematic;

				return (
					<button
						key={opt.id}
						type="button"
						role="radio"
						aria-checked={active}
						tabIndex={active ? 0 : -1}
						data-testid={`topic-unification-${opt.id}`}
						onClick={() => onChange(opt.id)}
						className={cn(
							"group relative flex flex-col justify-between rounded-lg border p-2.5 text-left transition-all duration-200 ease-out cursor-pointer active:scale-[0.98] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-foreground/40",
							active
								? "border-foreground/40 bg-accent/30 dark:bg-accent/20 shadow-xs"
								: "border-border/60 bg-background/50 hover:border-border hover:bg-muted/20"
						)}
					>
						{/* Schematic visual box */}
						<div
							className={cn(
								"mb-2 flex h-14 w-full items-center justify-center rounded-md border px-1 transition-all duration-200 ease-out",
								active
									? "border-foreground/20 bg-background/60 shadow-2xs"
									: "border-border/40 bg-muted/10 group-hover:bg-muted/25"
							)}
						>
							<Schematic active={active} />
						</div>

						{/* Title & Badge */}
						<div className="flex w-full items-center justify-between gap-1.5">
							<span
								className={cn(
									"font-prose text-xs font-medium transition-colors",
									active ? "text-foreground" : "text-foreground/80 group-hover:text-foreground"
								)}
							>
								{opt.title}
							</span>
							<span
								className={cn(
									"shrink-0 rounded-[3px] border px-1 py-0.5 font-ui text-[10px] tracking-wide transition-colors",
									active
										? opt.isRecommended
											? "border-accent/40 bg-accent/20 text-foreground"
											: "border-border bg-foreground/[0.04] text-foreground"
										: "border-border/60 text-muted-foreground/80"
								)}
							>
								{opt.badge}
							</span>
						</div>

						{/* Subtitle / Description */}
						<p
							className={cn(
								"mt-1 text-[11px] leading-snug transition-colors line-clamp-2",
								active ? "text-muted-foreground" : "text-muted-foreground/70"
							)}
						>
							{opt.description}
						</p>
					</button>
				);
			})}
		</div>
	);
}
