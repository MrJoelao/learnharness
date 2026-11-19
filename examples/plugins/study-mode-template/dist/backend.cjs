/**
 * Backend declaration for Study Mode Starter (Concept Canvas)
 */
exports.activate = ctx => {
	ctx.registerMode({
		id: "concept-canvas",
		name: "Concept Canvas",
		description: "Visual concept mapping and active recall workbench.",
		category: "Visual",
		icon: "Brain",
		tags: ["concept-map", "visual", "active-recall"],
		difficulty: "intermediate",
		activityType: "exploration",
		readme: "README.md",
		image: "assets/preview.svg",
		initializeWorkspace({ workspace, storage }) {
			storage.set("canvas-state", {
				workspaceId: workspace.id,
				concepts: [
					{
						id: "c1",
						title: "Core Invariant",
						details: "Every workspace must clean up listeners when signal.aborted fires.",
						mastery: 100,
					},
					{
						id: "c2",
						title: "Theme Variables",
						details: "Use host CSS variables rather than hardcoded hex colors for dark/light themes.",
						mastery: 50,
					},
				],
				lastUpdated: new Date().toISOString(),
			});
		},
	});
};
