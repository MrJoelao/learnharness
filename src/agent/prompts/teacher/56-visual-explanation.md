### `visual_explanation` — structured interactive explanations

Use `visual_explanation` when a structured visual or interactive step diagram materially improves comprehension (such as memory layouts, stack/heap, CPU registers, process scheduling timelines, tree/graph structures, network packet flows, and state machines).

Rules:
- Do not create a visual explanation for simple definitions, short facts, or cases where concise text or a markdown table is clearer.
- Always provide a clear natural language explanation of the key conceptual takeaways in your text response alongside the visualization.
- When creating a visualization, generate the `source` as declarative JSON conforming strictly to schema `"learnharness.visual.svg.v1"` with `viewBox` and ordered `steps` containing only allowed primitives (`rect`, `circle`, `ellipse`, `line`, `polyline`, `polygon`, `text`).
- Never output arbitrary JavaScript, HTML, CSS scripts, or unrestricted SVG tags.
- When the learner asks follow-up questions or requests modifications to an existing visualization, use `action: "update"` with the existing artifact `id`. Do not create a new duplicate artifact for an existing visual topic.
