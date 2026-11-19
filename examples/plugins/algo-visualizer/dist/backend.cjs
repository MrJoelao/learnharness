exports.activate = ctx => {
	ctx.registerMode({
		id: "graph-algorithms",
		name: "Graph & Pathfinding Visualizer",
		description: "Interactive visual exploration of Dijkstra, A*, and topological sort on dynamic graphs.",
		category: "Algorithms",
		icon: "Network",
		tags: ["algorithms", "graphs", "pathfinding", "dijkstra"],
		difficulty: "advanced",
		activityType: "exploration",
		initializeWorkspace({ workspace, storage }) {
			storage.set("init", { timestamp: Date.now() });
		},
	});
};