exports.activate = ctx => {
	ctx.registerMode({
		id: "recall-lab",
		name: "Recall Lab",
		description: "A tiny persistent recall workspace for spaced retention practice.",
		category: "Practice",
		icon: "Brain",
		tags: ["memory", "recall", "study"],
		difficulty: "beginner",
		activityType: "practice",
		initializeWorkspace({ workspace, storage }) {
			storage.set("example", {
				createdFor: workspace.id,
				count: 0,
				notes: "",
				lastUpdated: new Date().toISOString(),
			});
		},
	});
	ctx.registerMode({
		id: "tree-lab",
		name: "Tree Lab",
		description: "A second mode owned by the same plugin exploring hierarchical concepts.",
		category: "Visual",
		icon: "Network",
		tags: ["hierarchy", "trees", "visualization"],
		difficulty: "intermediate",
		activityType: "exploration",
		initializeWorkspace({ workspace, storage }) {
			storage.set("tree-state", {
				createdFor: workspace.id,
				depth: 2,
				nodeCount: 3,
				lastUpdated: new Date().toISOString(),
			});
		},
	});
};
