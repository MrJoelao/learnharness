/**
 * Frontend renderer for Study Mode Starter (Concept Canvas)
 * Demonstrates clean architecture, quiet chrome, un-slopped UI, and strict cleanup.
 */
export function activate(ctx) {
	ctx.registerModeRenderer(ctx.manifest.id, "concept-canvas", {
		async mount(container, { workspace, storage, signal, setTitle }) {
			// Outer container
			const root = document.createElement("div");
			root.className = "concept-canvas-workspace flex-1 flex flex-col p-6 max-w-4xl mx-auto w-full gap-6";

			// SKELETON LOADING STATE
			const skeleton = document.createElement("div");
			skeleton.className = "flex flex-col gap-4 animate-pulse";
			skeleton.innerHTML = `
				<div class="h-8 bg-muted/50 rounded-lg w-1/3"></div>
				<div class="h-4 bg-muted/40 rounded w-1/2"></div>
				<div class="grid grid-cols-1 md:grid-cols-2 gap-4 pt-4">
					<div class="h-32 bg-muted/30 rounded-xl border border-border"></div>
					<div class="h-32 bg-muted/30 rounded-xl border border-border"></div>
				</div>
			`;
			root.appendChild(skeleton);
			container.appendChild(root);

			// Fetch persistent state
			let rawState;
			try {
				rawState = await storage.get("canvas-state");
			} catch (err) {
				if (signal.aborted) return;
				renderError(err instanceof Error ? err.message : String(err));
				return;
			}

			if (signal.aborted) return;
			skeleton.remove();

			// Default state fallback
			let state = rawState && typeof rawState === "object" ? { ...rawState } : {
				workspaceId: workspace.id,
				concepts: [],
				lastUpdated: new Date().toISOString(),
			};

			// DOM Elements
			const header = document.createElement("header");
			header.className = "flex items-start justify-between border-b border-border pb-4 gap-4";

			const headerText = document.createElement("div");
			headerText.className = "space-y-1";

			const titleEl = document.createElement("h2");
			titleEl.className = "font-title text-2xl font-semibold tracking-tight text-foreground";
			titleEl.textContent = workspace.title;

			const subtitleEl = document.createElement("p");
			subtitleEl.className = "text-xs text-muted-foreground";
			subtitleEl.textContent = `Instance: ${workspace.id} · Local persistent storage`;

			headerText.append(titleEl, subtitleEl);

			const actionRow = document.createElement("div");
			actionRow.className = "flex items-center gap-2";

			const addBtn = document.createElement("button");
			addBtn.type = "button";
			addBtn.className = "inline-flex h-8 items-center justify-center gap-1.5 rounded-lg bg-primary px-3 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring cursor-pointer";
			addBtn.textContent = "+ New Concept";

			actionRow.appendChild(addBtn);
			header.append(headerText, actionRow);

			// Status banner container (for notifications/errors)
			const bannerContainer = document.createElement("div");
			bannerContainer.className = "empty:hidden";

			// Concept grid
			const grid = document.createElement("div");
			grid.className = "grid grid-cols-1 md:grid-cols-2 gap-4";

			root.append(header, bannerContainer, grid);

			// Save state helper
			const persist = async () => {
				state.lastUpdated = new Date().toISOString();
				try {
					await storage.set("canvas-state", state);
				} catch (err) {
					if (!signal.aborted) {
						showBanner("Save failed: " + (err instanceof Error ? err.message : String(err)), true);
					}
				}
			};

			function showBanner(message, isError = false) {
				bannerContainer.replaceChildren();
				if (!message) return;
				const alert = document.createElement("div");
				alert.role = "alert";
				alert.className = `flex items-center justify-between rounded-lg border p-3 text-xs ${
					isError ? "border-destructive/30 bg-destructive/10 text-destructive" : "border-border bg-muted/40 text-muted-foreground"
				}`;
				alert.textContent = message;
				bannerContainer.appendChild(alert);
			}

			function renderGrid() {
				grid.replaceChildren();

				if (!state.concepts || state.concepts.length === 0) {
					const empty = document.createElement("div");
					empty.className = "col-span-full flex flex-col items-center justify-center rounded-xl border border-dashed border-border p-12 text-center text-muted-foreground";
					empty.innerHTML = `
						<p class="text-sm font-medium">No concepts mapped yet</p>
						<p class="text-xs text-muted-foreground/80 mt-1">Add your first core principle to start tracking active mastery.</p>
					`;
					grid.appendChild(empty);
					return;
				}

				for (const concept of state.concepts) {
					const card = document.createElement("article");
					card.className = "concept-canvas-card rounded-xl border border-border bg-card p-4 text-card-foreground shadow-sm flex flex-col justify-between gap-3";

					const cardHeader = document.createElement("div");
					cardHeader.className = "flex items-start justify-between gap-2";

					const cardTitle = document.createElement("h3");
					cardTitle.className = "font-medium text-sm text-foreground";
					cardTitle.textContent = concept.title;

					const masteryBadge = document.createElement("button");
					masteryBadge.type = "button";
					masteryBadge.className = `rounded-full px-2 py-0.5 text-[10px] font-mono font-medium transition-colors cursor-pointer ${
						concept.mastery === 100
							? "bg-primary/20 text-primary border border-primary/30"
							: concept.mastery === 50
							? "bg-accent text-accent-foreground border border-border"
							: "bg-muted text-muted-foreground border border-border"
					}`;
					masteryBadge.textContent = `${concept.mastery}% mastery`;
					masteryBadge.title = "Click to toggle mastery level";
					masteryBadge.addEventListener("click", () => {
						concept.mastery = concept.mastery === 100 ? 0 : concept.mastery === 50 ? 100 : 50;
						renderGrid();
						void persist();
					});

					cardHeader.append(cardTitle, masteryBadge);

					const cardDetails = document.createElement("p");
					cardDetails.className = "text-xs text-muted-foreground leading-relaxed";
					cardDetails.textContent = concept.details;

					const cardFooter = document.createElement("div");
					cardFooter.className = "flex items-center justify-end pt-2 border-t border-border/40";

					const deleteBtn = document.createElement("button");
					deleteBtn.type = "button";
					deleteBtn.className = "text-[11px] text-muted-foreground hover:text-destructive transition-colors cursor-pointer";
					deleteBtn.textContent = "Remove";
					deleteBtn.addEventListener("click", () => {
						state.concepts = state.concepts.filter(c => c.id !== concept.id);
						renderGrid();
						void persist();
					});

					cardFooter.appendChild(deleteBtn);
					card.append(cardHeader, cardDetails, cardFooter);
					grid.appendChild(card);
				}
			}

			// Add Concept action
			const handleAdd = () => {
				const id = "c_" + Date.now().toString(36);
				const index = (state.concepts?.length ?? 0) + 1;
				state.concepts = state.concepts || [];
				state.concepts.push({
					id,
					title: `Concept ${index}`,
					details: "Tap mastery badge to track your retention progress.",
					mastery: 0,
				});
				renderGrid();
				void persist();
			};

			addBtn.addEventListener("click", handleAdd);
			renderGrid();

			function renderError(errorMessage) {
				root.replaceChildren();
				const errBox = document.createElement("div");
				errBox.role = "alert";
				errBox.className = "rounded-xl border border-destructive/30 bg-destructive/10 p-6 text-center space-y-3";

				const title = document.createElement("h3");
				title.className = "font-medium text-sm text-destructive";
				title.textContent = "Unable to load Concept Canvas";

				const desc = document.createElement("p");
				desc.className = "text-xs text-muted-foreground";
				desc.textContent = errorMessage;

				errBox.append(title, desc);
				root.appendChild(errBox);
			}

			// Clean unmount listener
			const cleanup = () => {
				addBtn.removeEventListener("click", handleAdd);
				root.replaceChildren();
				root.remove();
			};

			signal.addEventListener("abort", cleanup, { once: true });
			return cleanup;
		},
	});
}
