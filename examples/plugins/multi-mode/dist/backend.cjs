exports.activate = ctx => {
	ctx.registerMode({
		id: "recall-lab",
		name: "Recall Lab",
		description: "A tiny persistent recall workspace.",
		category: "Practice",
		tags: ["memory", "recall"],
		initializeWorkspace({ workspace, storage }) {
			storage.set("example", { createdFor: workspace.id, visits: 0 });
		},
	});
	ctx.registerMode({
		id: "tree-lab",
		name: "Tree Lab",
		description: "A second mode owned by the same plugin.",
		category: "Visual",
		activityType: "exploration",
		initializeWorkspace() {},
	});
};
