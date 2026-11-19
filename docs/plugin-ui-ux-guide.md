# Plugin UI and UX Design Guide (Craft over Slop)

This guide defines the design, user experience, and visual standards for LearnHarness plugins. Plugins render inside the host application, which provides native dark and light themes, typographic hierarchy, and interaction layers. 

AI coding agents authoring plugins **must** follow these principles to produce interfaces that look intentionally crafted rather than automatically generated ("vibecoded slop").

---

## 1. The Core Philosophy: Quiet Chrome, Rich Content

The difference between AI slop and true craft is where richness lives:
- **Slop** spreads neon gradients, glowing borders, floating emojis, and busy backgrounds across the chrome, navigation, and controls.
- **Craft** keeps the chrome quiet, neutral, and unobtrusive, focusing all visual richness into the actual pedagogical content (an interactive graph, a crisp canvas, a visual algorithm, or a memory matrix).

### The Five Invariants
1. **One Bright Element**: Each workspace mode has one primary visual focus that carries color and detail. Everything around it is quiet.
2. **Quiet Surfaces**: Surfaces, cards, sidebars, and toolbars stay in neutral shades. Depth is created via subtle border hairlines (`border-border`) and surface steps (`bg-card`), never through loud colored drop-shadows.
3. **No AI Tells**: Never use purple/violet gradients on surfaces, gradient text, glowing neon box-shadows, animated floating blobs, or emoji icons in headers and buttons.
4. **Deliberate Typography**: Use the host's font hierarchy (`CMU Serif` for titles, `Source Sans 3` for prose, `JetBrains Mono` for code and telemetry).
5. **Fluid, Non-Choppy Motion**: Transitions must be smooth (`transition-all duration-200 ease-out`), avoiding staggered delays or missing transition classes that cause 3-frame jarring jumps.

---

## 2. Host Theme Tokens and CSS Variables

LearnHarness uses CSS variables that dynamically adapt to the active theme (Dark / Light / Sepia). **Never hardcode hex colors** (such as `#ffffff` or `#111827`) or RGB strings in plugin styles; doing so breaks immediately when the user toggles themes.

### Available Theme Variables

| CSS Variable | Tailwind Utility Equivalent | Purpose |
| --- | --- | --- |
| `--background` | `bg-background` | Page background |
| `--foreground` | `text-foreground` | High-contrast primary text and icons |
| `--muted` | `bg-muted` | Subdued surface (pills, secondary containers) |
| `--muted-foreground` | `text-muted-foreground` | Secondary labels, timestamps, hints |
| `--card` | `bg-card` | Raised containers, panels, and mode workbenches |
| `--card-foreground` | `text-card-foreground` | Text rendered on top of card surfaces |
| `--border` | `border-border` | Hairline dividers and container outlines |
| `--primary` | `bg-primary`, `text-primary` | Primary action button, focused indicator |
| `--primary-foreground`| `text-primary-foreground` | Text inside primary buttons |
| `--accent` | `bg-accent` | Hover states and interactive highlights |
| `--accent-foreground` | `text-accent-foreground` | Text on hover accents |
| `--destructive` | `bg-destructive`, `text-destructive`| Destructive actions or severe errors |
| `--radius` | `rounded-lg`, `rounded-xl` | Standard corner curvature |

### Example: Slop vs Craft in Styling

#### Bad (Vibecoded Slop)
```html
<!-- Broken in light theme, glowing neon purple, arbitrary margins, emoji title -->
<div style="background: linear-gradient(135deg, #1e1b4b, #312e81); border: 2px solid #818cf8; box-shadow: 0 0 20px rgba(129,140,248,0.5); border-radius: 18px; margin-top: 13px; padding: 25px;">
  <h2 style="background: linear-gradient(to right, #ec4899, #8b5cf6); -webkit-background-clip: text; color: transparent;">
    ✨ Ultimate Quantum Lab AI ✨
  </h2>
  <button style="background: #a855f7; box-shadow: 0 0 10px #a855f7; border-radius: 9999px;">
    🚀 Launch Simulation 🚀
  </button>
</div>
```

#### Good (LearnHarness Craft)
```html
<!-- Perfectly adapts to both dark and light modes, crisp 4px rhythm, Lucide icon -->
<div class="rounded-xl border border-border bg-card p-6 text-card-foreground shadow-sm">
  <div class="flex items-center justify-between pb-4 border-b border-border">
    <div class="space-y-1">
      <h2 class="font-title text-xl font-semibold tracking-tight text-foreground">
        Quantum Simulation
      </h2>
      <p class="text-xs text-muted-foreground">
        State vector visualization and superposition controls
      </p>
    </div>
    <span class="rounded-md border border-border bg-muted/50 px-2 py-0.5 text-xs font-mono text-muted-foreground">
      128 states
    </span>
  </div>
  <div class="pt-6">
    <button type="button" class="inline-flex h-9 items-center justify-center gap-2 rounded-lg bg-primary px-4 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring cursor-pointer">
      Start Simulation
    </button>
  </div>
</div>
```

---

## 3. Spacing, Rhythm, and Layout

1. **4px Grid Scale**: Margins, paddings, gaps, and heights must be multiples of 4:
   - Gaps: `gap-2` (8px), `gap-3` (12px), `gap-4` (16px), `gap-6` (24px).
   - Padding: `p-3` (12px), `p-4` (16px), `p-6` (24px).
   - Never use strange one-off pixel values like `mt-[13px]` or `p-[19px]`.
2. **Alignment & Visual Lines**:
   - Align labels to the left edge of containers.
   - Align numbers, counts, and status timestamps to the right in data tables.
   - Use fixed icon containers (e.g. `size-4` or `size-5`) so adjacent text lines up squarely.
3. **Responsive Density**:
   - Toolbars and control strips: dense (`h-9` or `h-10`, `gap-2`).
   - Main workspace canvas: spacious (`p-6` or `p-8`).

---

## 4. Typography and Copywriting

- **Font Pairing**:
  - `font-title`: Titles and primary headers (uses CMU Serif in the host).
  - `font-mono`: Code snippets, state IDs, step numbers, timestamps (`JetBrains Mono`).
  - Default sans: Body text, UI labels, options (`Source Sans 3`).
- **Copywriting**:
  - Keep button labels short and active: "Reset state", "Run step", "Export JSON" (never "Click here to execute action!").
  - Do not use exclamation points or marketing slogans.
  - Avoid emoji prefixes in button text, category names, or headings.

---

## 5. Iconography

- **Only Use Lucide Icons**: Choose from standard host Lucide icons.
- **Consistent Size and Stroke**:
  - Standard buttons / menus: `size-3.5` or `size-4` (14px–16px).
  - Stat cards / section headers: `size-5` (20px).
  - Stroke width: default 1.5–2px.
- **Inherited Tone**: Icons should take the color of their text role (`text-muted-foreground` or `text-foreground`). Avoid giving every icon a different arbitrary color.

---

## 6. Motion and Animations

- **Duration and Easing**:
  - Micro-interactions (hover, focus, toggles): `transition-colors duration-150`.
  - Transform, drawer, or panel disclosures: `transition-all duration-200 ease-out`.
  - Floating pills or indicators: `transition-all duration-300 ease-out`.
- **Avoid Choppy Transitions**:
  - Always declare complete transition properties (e.g. `transition-all` or explicit `transition-[transform,opacity]`).
  - Never drop transition duration or timing curves, as browsers will default to abrupt stepping.
- **Never Pulse or Spin Unnecessarily**:
  - Spinners (`animate-spin`) belong strictly on active loading operations or refreshing indicators.
  - Never add continuous pulsing (`animate-pulse`) to idle elements.

---

## 7. State Handling: Loading, Error, and Empty States

Every plugin workspace mode must handle three essential states gracefully:

### A. Loading State
While data is being fetched from `storage.get()`:
- Do not render an empty white screen or a frozen UI.
- Render skeleton placeholders with `bg-muted/40 animate-pulse rounded-md` that reflect the shape of the upcoming content.

### B. Error State
If a calculation or persistent storage operation fails:
- Render a clear, recoverable error banner.
- Always include an action button to retry the failed operation.
- Example:
  ```html
  <div role="alert" class="flex items-center justify-between rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive">
    <span>Failed to save state: network timeout.</span>
    <button type="button" class="font-medium underline hover:text-destructive/80 cursor-pointer">Retry</button>
  </div>
  ```

### C. Empty State
When the workspace has no user items or data yet:
- Explain clearly what the mode does.
- Provide a direct, single call-to-action button to create or load sample data.

---

## 8. Lifecycle and Clean Unmount

When a workspace mode is closed, navigated away from, or disabled:
- The host passes an `AbortSignal` (`context.signal`).
- Plugins **must** listen to `signal.addEventListener("abort", ...)` or return a cleanup function from their mount function.
- Clean up:
  - Event listeners added to `window` or `document`.
  - Active `setInterval`, `setTimeout`, or `requestAnimationFrame`.
  - `ResizeObserver` or `MutationObserver` instances.
  - React roots via `root.unmount()`.
- Failing to clean up causes memory leaks, duplicate event triggers, and degraded host performance.
