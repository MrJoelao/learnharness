export function activate(ctx) {
	for (const modeId of ["recall-lab", "tree-lab"]) {
		ctx.registerModeRenderer(ctx.manifest.id, modeId, {
			async mount(container, { workspace, storage, signal }) {
				const heading = document.createElement("h2");
				heading.textContent = workspace.title;
				const detail = document.createElement("p");
				const state = await storage.get("example");
				if (signal.aborted) return;
				detail.textContent = state ? `This instance has its own saved state (${workspace.id}).` : `Mode: ${modeId}`;
				container.append(heading, detail);
				return () => container.replaceChildren();
			},
		});
	}
}
