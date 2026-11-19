exports.activate = ctx => {
	ctx.registerMode({
		id: "quantum-circuit-lab",
		name: "Quantum Circuit Lab",
		description: "Bloch sphere state vector exploration, Hadamard gates, and quantum entanglement experiments.",
		category: "Physics & Computing",
		icon: "FlaskConical",
		tags: ["quantum", "physics", "circuits", "qubits"],
		difficulty: "advanced",
		activityType: "simulation",
		image: "assets/banner.svg",
		initializeWorkspace({ workspace, storage }) {
			storage.set("qubits", { count: 2, state: "|00>" });
		},
	});
};