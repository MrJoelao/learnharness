export function activate(ctx) {
	// Mode A: Recall Lab with interactive counter, notes, and instant storage persistence
	ctx.registerModeRenderer(ctx.manifest.id, "recall-lab", {
		async mount(container, { workspace, storage, signal }) {
			const root = document.createElement("div");
			root.className = "recall-lab-container";
			root.style.padding = "24px";
			root.style.maxWidth = "640px";
			root.style.fontFamily = "inherit";

			const heading = document.createElement("h2");
			heading.textContent = workspace.title;
			heading.style.margin = "0 0 8px 0";
			heading.style.fontSize = "20px";
			heading.style.fontWeight = "600";

			const info = document.createElement("p");
			info.style.margin = "0 0 20px 0";
			info.style.fontSize = "13px";
			info.style.color = "var(--muted-foreground, #666)";

			const rawState = await storage.get("example");
			if (signal.aborted) return;

			let state = rawState && typeof rawState === "object" ? { ...rawState } : {
				createdFor: workspace.id,
				count: 0,
				notes: "",
				lastUpdated: new Date().toISOString(),
			};

			info.textContent = `Instance ${workspace.id} · Independent storage`;

			// Status badge
			const status = document.createElement("div");
			status.setAttribute("data-testid", "recall-status");
			status.style.fontSize = "12px";
			status.style.marginBottom = "16px";
			status.style.color = "var(--muted-foreground, #888)";
			status.textContent = state.lastUpdated ? `Last saved: ${new Date(state.lastUpdated).toLocaleTimeString()}` : "Ready";

			// Counter Section
			const counterCard = document.createElement("div");
			counterCard.style.border = "1px solid var(--border, #ccc)";
			counterCard.style.borderRadius = "8px";
			counterCard.style.padding = "16px";
			counterCard.style.marginBottom = "16px";

			const counterTitle = document.createElement("div");
			counterTitle.textContent = "Spaced Recall Counter";
			counterTitle.style.fontWeight = "500";
			counterTitle.style.fontSize = "14px";
			counterTitle.style.marginBottom = "8px";

			const counterDisplay = document.createElement("div");
			counterDisplay.style.fontSize = "24px";
			counterDisplay.style.fontWeight = "bold";
			counterDisplay.style.marginBottom = "12px";

			const countVal = document.createElement("span");
			countVal.setAttribute("data-testid", "counter-value");
			countVal.textContent = String(state.count ?? 0);
			counterDisplay.append("Count: ", countVal);

			const btnRow = document.createElement("div");
			btnRow.style.display = "flex";
			btnRow.style.gap = "8px";

			const incBtn = document.createElement("button");
			incBtn.type = "button";
			incBtn.textContent = "+1 Recall";
			incBtn.setAttribute("data-testid", "increment-btn");
			incBtn.setAttribute("aria-label", "Increment recall counter");
			incBtn.style.padding = "6px 12px";
			incBtn.style.borderRadius = "6px";
			incBtn.style.cursor = "pointer";

			const resetBtn = document.createElement("button");
			resetBtn.type = "button";
			resetBtn.textContent = "Reset";
			resetBtn.setAttribute("data-testid", "reset-btn");
			resetBtn.setAttribute("aria-label", "Reset counter to zero");
			resetBtn.style.padding = "6px 12px";
			resetBtn.style.borderRadius = "6px";
			resetBtn.style.cursor = "pointer";

			const saveState = async () => {
				state.lastUpdated = new Date().toISOString();
				status.textContent = "Saving…";
				try {
					await storage.set("example", state);
					if (!signal.aborted) {
						status.textContent = `Saved at ${new Date(state.lastUpdated).toLocaleTimeString()}`;
					}
				} catch (err) {
					if (!signal.aborted) {
						status.textContent = `Save failed: ${err.message || String(err)}`;
					}
				}
			};

			const handleInc = () => {
				state.count = (state.count ?? 0) + 1;
				countVal.textContent = String(state.count);
				void saveState();
			};

			const handleReset = () => {
				state.count = 0;
				countVal.textContent = "0";
				void saveState();
			};

			incBtn.addEventListener("click", handleInc);
			resetBtn.addEventListener("click", handleReset);
			btnRow.append(incBtn, resetBtn);
			counterCard.append(counterTitle, counterDisplay, btnRow);

			// Notes Section
			const notesCard = document.createElement("div");
			notesCard.style.border = "1px solid var(--border, #ccc)";
			notesCard.style.borderRadius = "8px";
			notesCard.style.padding = "16px";

			const notesLabel = document.createElement("label");
			notesLabel.htmlFor = `notes-${workspace.id}`;
			notesLabel.textContent = "Study Notes";
			notesLabel.style.display = "block";
			notesLabel.style.fontWeight = "500";
			notesLabel.style.fontSize = "14px";
			notesLabel.style.marginBottom = "8px";

			const notesArea = document.createElement("textarea");
			notesArea.id = `notes-${workspace.id}`;
			notesArea.setAttribute("data-testid", "notes-input");
			notesArea.setAttribute("aria-label", "Study notes");
			notesArea.value = state.notes ?? "";
			notesArea.placeholder = "Enter your recall reflections...";
			notesArea.style.width = "100%";
			notesArea.style.boxSizing = "border-box";
			notesArea.style.minHeight = "80px";
			notesArea.style.padding = "8px";
			notesArea.style.borderRadius = "6px";
			notesArea.style.fontFamily = "inherit";

			let debounceTimer = null;
			const handleInput = () => {
				state.notes = notesArea.value;
				if (debounceTimer) clearTimeout(debounceTimer);
				debounceTimer = setTimeout(() => {
					void saveState();
				}, 150);
			};

			notesArea.addEventListener("input", handleInput);
			notesCard.append(notesLabel, notesArea);

			root.append(heading, info, status, counterCard, notesCard);
			container.replaceChildren(root);

			return () => {
				incBtn.removeEventListener("click", handleInc);
				resetBtn.removeEventListener("click", handleReset);
				notesArea.removeEventListener("input", handleInput);
				if (debounceTimer) clearTimeout(debounceTimer);
				container.replaceChildren();
			};
		},
	});

	// Mode B: Tree Lab with interactive depth state
	ctx.registerModeRenderer(ctx.manifest.id, "tree-lab", {
		async mount(container, { workspace, storage, signal }) {
			const root = document.createElement("div");
			root.className = "tree-lab-container";
			root.style.padding = "24px";
			root.style.maxWidth = "640px";

			const heading = document.createElement("h2");
			heading.textContent = workspace.title;
			heading.style.margin = "0 0 8px 0";
			heading.style.fontSize = "20px";
			heading.style.fontWeight = "600";

			const info = document.createElement("p");
			info.style.margin = "0 0 20px 0";
			info.style.fontSize = "13px";
			info.style.color = "var(--muted-foreground, #666)";
			info.textContent = `Tree Lab (${workspace.id}) · Interactive Hierarchy`;

			const rawState = await storage.get("tree-state");
			if (signal.aborted) return;

			let state = rawState && typeof rawState === "object" ? { ...rawState } : {
				createdFor: workspace.id,
				depth: 2,
				nodeCount: 3,
			};

			const controls = document.createElement("div");
			controls.style.display = "flex";
			controls.style.alignItems = "center";
			controls.style.gap = "12px";
			controls.style.marginBottom = "16px";

			const depthLabel = document.createElement("span");
			depthLabel.textContent = "Tree Depth: ";

			const depthValue = document.createElement("span");
			depthValue.setAttribute("data-testid", "tree-depth-value");
			depthValue.style.fontWeight = "bold";
			depthValue.textContent = String(state.depth ?? 2);
			depthLabel.append(depthValue);

			const incDepthBtn = document.createElement("button");
			incDepthBtn.type = "button";
			incDepthBtn.setAttribute("data-testid", "increase-depth-btn");
			incDepthBtn.setAttribute("aria-label", "Increase tree depth");
			incDepthBtn.textContent = "+ Depth";
			incDepthBtn.style.padding = "6px 12px";
			incDepthBtn.style.cursor = "pointer";

			const handleIncDepth = async () => {
				state.depth = (state.depth ?? 2) + 1;
				state.nodeCount = Math.pow(2, state.depth) - 1;
				depthValue.textContent = String(state.depth);
				await storage.set("tree-state", state);
			};

			incDepthBtn.addEventListener("click", handleIncDepth);
			controls.append(depthLabel, incDepthBtn);

			root.append(heading, info, controls);
			container.replaceChildren(root);

			return () => {
				incDepthBtn.removeEventListener("click", handleIncDepth);
				container.replaceChildren();
			};
		},
	});
}
