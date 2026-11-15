"use client";

import Link from "next/link";
import { TopBar } from "@/components/top-bar";
import { ChevronLeftIcon, LayoutGridIcon } from "lucide-react";

export const dynamic = "force-dynamic";

export default function StudyHubPage() {
	return (
		<main data-testid="study-hub-page" className="flex h-dvh flex-col bg-background">
			<TopBar>
				<div className="flex items-center gap-3 min-w-0 flex-1">
					<Link
						href="/"
						aria-label="Back"
						data-testid="study-hub-back-button"
						className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground shrink-0 cursor-pointer"
					>
						<ChevronLeftIcon className="size-4" />
					</Link>
					<div className="flex items-center gap-2 min-w-0">
						<LayoutGridIcon className="size-4 text-muted-foreground shrink-0" />
						<h1 data-testid="study-hub-title" className="font-title text-3xl tracking-tight text-foreground truncate">
							Study Hub
						</h1>
					</div>
				</div>
			</TopBar>

			<div className="flex-1 overflow-y-auto px-6 py-8 max-w-5xl w-full mx-auto">
				<div className="rounded-2xl border border-border/60 bg-card p-8 text-center shadow-xs">
					<div className="mx-auto flex size-12 items-center justify-center rounded-xl bg-accent text-accent-foreground mb-4">
						<LayoutGridIcon className="size-6" />
					</div>
					<h2 className="text-lg font-semibold text-foreground">Interactive Learning Modes</h2>
					<p className="mt-2 text-sm text-muted-foreground max-w-lg mx-auto leading-relaxed">
						Explore interactive visual environments, simulators, and domain workspaces powered by LearnHarness plugins.
					</p>
				</div>
			</div>
		</main>
	);
}
