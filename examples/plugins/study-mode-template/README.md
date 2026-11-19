# Study Mode Template for LearnHarness

This is a canonical starter template for building high-quality, un-slopped workspace modes for LearnHarness's **Study Hub**.

## Quick Start for AI Agents and Developers

1. **Copy this directory** to your app's plugins directory:
   `<learning-data>/plugins/my-study-mode`
2. **Rename the ID** in `dist/manifest.json` to match your directory name (`my-study-mode`).
3. **Customize your mode definition** in `dist/backend.cjs` (`registerMode`).
4. **Build your interactive interface** in `dist/main.js` (`registerModeRenderer`).
5. Open **Settings → Community plugins → Refresh**, then launch your mode from **Study Hub**!

## Architecture at a Glance

```
my-study-mode/
├── README.md               # Source documentation
└── dist/                   # Shipped/installed distribution
    ├── manifest.json       # Plugin metadata (apiVersion: 1, minAppVersion: 0.7.0)
    ├── backend.cjs         # Mode declaration, category, difficulty, initialization
    ├── main.js             # Interactive frontend renderer, storage persistence, unmount cleanup
    ├── styles.css          # Optional scoped styles
    ├── README.md           # Displayed in the Study Hub modal dialog
    └── assets/
        └── preview.svg     # 16:9 banner rendered in the Study Hub catalog card
```

## UI and UX Standards

All UI elements in this template adhere to the LearnHarness Design System and `$unslop` rules:
- **No hardcoded colors**: uses host CSS tokens (`--background`, `--card`, `--foreground`, `--muted`, `--border`, `--primary`, `--accent`).
- **Quiet Chrome**: neutral backgrounds, hairlines (`border-border`), single primary focus.
- **Loading Skeletons**: elegant placeholders while reading `storage.get()`.
- **Recoverable Errors**: banner with explicit retry action.
- **Smooth Motion**: standard transitions (`transition-all duration-200 ease-out`).
- **Resource Hygiene**: cleans up all listeners and observers on `signal.aborted`.
