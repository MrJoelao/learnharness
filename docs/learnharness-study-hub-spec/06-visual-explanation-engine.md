# 06 — Visual Explanation Engine

## 1. Purpose

Allow the teaching agent to produce a compact, interactive visual explanation when it materially improves comprehension. The engine should support concepts such as:
- Memory layout and paging.
- Process scheduling.
- Stack/heap/register changes.
- Trees and graphs.
- Network packet flow.
- State machines and algorithm steps.

This is not video generation. The output is a structured visual artifact rendered by the application.

## 2. Core design

One artifact, two presentation modes:
- **Inline:** embedded in the conversation for short explanations.
- **Panel:** expanded into a dedicated panel for larger simulations.

The artifact has a stable ID and state. Expanding it must not create a second artifact. Follow-up requests should update the same artifact when they refer to it.

## 3. Agent behavior

The agent may choose `auto` when a visual representation is useful. Do not force a visualization for every answer.

Good triggers:
- A process has multiple state transitions.
- A memory layout or address translation is easier to inspect visually.
- An algorithm changes a data structure step by step.
- A network exchange has multiple actors/packets.
- The learner asks for a diagram, simulation, animation or “show me what happens”.

Poor triggers:
- Simple definitions.
- Short factual answers.
- Cases where a static text table is clearer.
- Visuals that add decoration but no learning value.

The agent should explain the key takeaway in text even when it creates an artifact.

## 4. Artifact envelope

Use a versioned, validated envelope. Exact field names may be adapted to existing tool contracts.

```ts
interface VisualArtifact {
  version: 1;
  id: string;
  title: string;
  summary?: string;
  renderer: "svg" | "html";
  source: string;
  presentation: "auto" | "inline" | "panel";
  initialState?: unknown;
  controls?: VisualControlDescriptor[];
  accessibility?: {
    description?: string;
    reducedMotionFallback?: boolean;
  };
}
```

The host must validate:
- Version.
- ID and title lengths.
- Renderer allowlist.
- Source byte limit.
- State/control schema limits.
- Maximum number of controls/nodes/steps where relevant.
- No unsupported external resources.
- No unknown privileged capabilities.

Do not accept arbitrary host component names, filesystem paths, network permissions or plugin API handles in the artifact.

## 5. Rendering technology

Preferred progression:
1. SVG for diagrams and controlled animation.
2. HTML/CSS with a restricted declarative/runtime layer for richer layouts.
3. Canvas only for cases that need it.
4. Python execution only in a later phase, using a separate isolated runtime such as Pyodide or a server-side sandbox with explicit resource limits.

Do not introduce D3 or a large charting framework unless a concrete feature requires it.

Reusable visual primitives should cover common learning structures:
- Memory blocks/pages/frames.
- CPU/registers.
- Process/state timelines.
- Stack and heap.
- Trees/graphs.
- Network nodes and packets.
- Algorithm step/highlight controls.

Prefer a small declarative schema and reusable components over unrestricted arbitrary JavaScript whenever feasible.

## 6. Security model

Existing plugin frontend code runs in the trusted application page. The plugin architecture documentation explicitly does not promise a filesystem/network sandbox.

Therefore generated visual code must not be executed as a normal plugin or in the main application JavaScript context.

Minimum safe design:
- Render in a sandboxed iframe or equivalent isolated execution boundary.
- Use a restrictive sandbox attribute; do not grant same-origin or top-navigation privileges unless independently justified.
- No access to host cookies, local storage, application globals, filesystem, plugin contexts or internal APIs.
- No arbitrary network access.
- No dynamic script loading.
- Strict Content Security Policy.
- Bounded message bridge with schema validation.
- Only allowlisted messages such as ready, state-change, control-event, resize and error.
- Validate every inbound and outbound message.
- Source and runtime size limits.
- Execution timeout and ability to terminate/recreate the frame.
- Rate/size limits on messages.
- No secrets or user credentials in the iframe.
- Never trust artifact source just because it came from the model.

If the repository's CSP or framework makes a safe iframe impossible in the first release, start with a declarative SVG/JSON renderer that does not execute generated JavaScript. Do not weaken security to ship arbitrary code.

## 7. Interaction contract

The artifact may support:
- Play/pause.
- Step forward/backward.
- Reset.
- Parameter controls.
- Highlight/select.
- Timeline/progress.
- Expand to panel.

Controls are data-driven and bounded. The host owns generic chrome; the artifact owns its internal simulation state.

Follow-up update flow:
1. Agent receives artifact ID and relevant current state summary.
2. Agent requests a patch/update against that artifact.
3. Host validates artifact identity and patch.
4. Renderer applies update or replaces source under the same artifact ID.
5. If update fails, preserve the last known good artifact.

Do not let a follow-up update silently replace an unrelated artifact.

## 8. Accessibility and motion

- Every visual has a text summary/description.
- Controls have labels.
- Keyboard operation is supported.
- Reduced-motion mode disables or simplifies animation.
- A static state remains understandable.
- Avoid flashing, rapid movement and color-only encoding.

## 9. Performance and lifecycle

- Do not mount the visual runtime until the artifact is visible/expanded as appropriate.
- Pause animation when offscreen, collapsed or backgrounded.
- Dispose frame/runtime on artifact deletion or conversation teardown.
- Limit simultaneous running artifacts.
- Debounce resize/state messages.
- Avoid unbounded simulation loops.

## 10. First-release scope

Recommended MVP:
- Versioned artifact envelope.
- Static SVG/declarative renderer.
- Small set of reusable primitives.
- Inline display.
- Expand/collapse into panel.
- Play/step/reset for deterministic step-based artifacts.
- Strict validation and isolation.
- No Python runtime in MVP.
- No unrestricted generated JavaScript in the trusted app context.

Add richer HTML/JS and Python only after the security and lifecycle model is proven.
