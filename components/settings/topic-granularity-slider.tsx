"use client";
/**
 * TopicGranularitySlider — Stepped, tactile range slider for topic clustering scale.
 *
 * Craft details:
 * - Stepped track with discrete tick markers for Fine, Balanced, Broad.
 * - Tabular figures displaying the active node count range.
 * - Full native keyboard accessibility (ArrowLeft/ArrowRight, Home/End) via an
 *   underlying accessible range input, coupled with a deliberate 4px-grid visual layer.
 */

import { type ChangeEvent } from "react";
import { cn } from "@/lib/utils";
import type { TopicGranularity } from "@/src/core";

export interface GranularityStep {
	readonly id: TopicGranularity;
	readonly label: string;
	readonly range: string;
	readonly nodesHint: string;
}

export const TOPIC_GRANULARITY_STEPS: readonly GranularityStep[] = [
	{ id: "fine", label: "Fine", range: "~3–6 nodes", nodesHint: "Small, specific subtopic islands" },
	{ id: "balanced", label: "Balanced", range: "~6–12 nodes", nodesHint: "Default balanced course modules" },
	{ id: "broad", label: "Broad", range: "~8–25 nodes", nodesHint: "Large overarching exam domains" },
] as const;

const DEFAULT_STEP: GranularityStep = {
	id: "balanced",
	label: "Balanced",
	range: "~6–12 nodes",
	nodesHint: "Default balanced course modules",
};

export function TopicGranularitySlider({
	value,
	onChange,
	disabled,
}: {
	value: TopicGranularity;
	onChange: (next: TopicGranularity) => void;
	disabled?: boolean;
}) {
	const currentIdx = TOPIC_GRANULARITY_STEPS.findIndex((s) => s.id === value);
	const activeIdx = currentIdx === -1 ? 1 : currentIdx;
	const currentStep: GranularityStep = TOPIC_GRANULARITY_STEPS[activeIdx] ?? DEFAULT_STEP;
	const percent = (activeIdx / (TOPIC_GRANULARITY_STEPS.length - 1)) * 100;

	const handleInputChange = (e: ChangeEvent<HTMLInputElement>) => {
		const nextIdx = Number(e.target.value);
		const step = TOPIC_GRANULARITY_STEPS[nextIdx];
		if (step) onChange(step.id);
	};

	return (
		<div
			className={cn(
				"group relative flex w-52 flex-col gap-1.5 select-none sm:w-56",
				disabled && "opacity-40 cursor-not-allowed"
			)}
		>
			{/* Top header: current label + tabular node range */}
			<div className="flex items-baseline justify-between text-xs">
				<span className="font-ui font-medium text-foreground transition-colors">
					{currentStep.label}
				</span>
				<span className="font-mono text-[11px] text-muted-foreground/80 tabular-nums">
					{currentStep.range}
				</span>
			</div>

			{/* Interactive Track Area */}
			<div className="relative flex h-4 items-center">
				{/* Background track line */}
				<div className="relative h-1 w-full rounded-full bg-border/80">
					{/* Active progress fill */}
					<div
						className="absolute left-0 top-0 h-1 rounded-full bg-foreground/60 transition-all duration-200 ease-out"
						style={{ width: `${percent}%` }}
					/>

					{/* Discrete Step Tick Dots */}
					<div className="absolute inset-0 flex items-center justify-between">
						{TOPIC_GRANULARITY_STEPS.map((step, idx) => {
							const isReached = idx <= activeIdx;
							return (
								<span
									key={step.id}
									style={{ left: `${(idx / (TOPIC_GRANULARITY_STEPS.length - 1)) * 100}%` }}
									className={cn(
										"absolute size-1.5 -translate-x-1/2 rounded-full transition-colors duration-200",
										isReached ? "bg-foreground/70" : "bg-border"
									)}
								/>
							);
						})}
					</div>
				</div>

				{/* Tactile Thumb */}
				<div
					className="pointer-events-none absolute size-3.5 -translate-x-1/2 rounded-full border border-foreground/30 bg-background shadow-xs transition-all duration-200 ease-out group-focus-within:border-foreground group-focus-within:ring-1 group-focus-within:ring-foreground/40"
					style={{ left: `${percent}%` }}
				/>

				{/* Native accessible input overlay */}
				<input
					type="range"
					min={0}
					max={TOPIC_GRANULARITY_STEPS.length - 1}
					step={1}
					value={activeIdx}
					disabled={disabled}
					aria-label="Topic granularity"
					aria-valuetext={`${currentStep.label}, ${currentStep.range}`}
					onChange={handleInputChange}
					className="absolute inset-0 size-full cursor-pointer opacity-0 disabled:cursor-not-allowed"
				/>
			</div>

			{/* Bottom step labels */}
			<div className="flex justify-between px-0.5 font-ui text-[10px] text-muted-foreground/60">
				{TOPIC_GRANULARITY_STEPS.map((step, idx) => {
					const isActive = idx === activeIdx;
					return (
						<button
							key={step.id}
							type="button"
							tabIndex={-1}
							onClick={() => !disabled && onChange(step.id)}
							className={cn(
								"transition-colors hover:text-foreground cursor-pointer focus:outline-none",
								isActive ? "font-medium text-foreground" : "text-muted-foreground/60"
							)}
						>
							{step.label}
						</button>
					);
				})}
			</div>
		</div>
	);
}
