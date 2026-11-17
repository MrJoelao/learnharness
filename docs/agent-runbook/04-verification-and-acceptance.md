# Verification and acceptance

## 1. Evidence hierarchy

Use evidence in this order:

1. Reproduced runtime behavior.
2. Automated test executing the real production path.
3. Focused unit/integration test.
4. Static typecheck and lint.
5. Source inspection.
6. Agent explanation.

An agent's summary is not proof. Inspect the diff and command output.

## 2. Baseline evidence

At the start of a run, capture:

```bash
git branch --show-current
git rev-parse HEAD
git status --short
```

If working tree changes already exist, do not overwrite or reset them. Identify ownership and ask before editing overlapping files.

## 3. Test strategy

### Focused tests

Run the narrowest relevant suite first. Examples, subject to current package scripts and filenames:

```bash
NODE_ENV=test npx tsx --test tests/directory-*.test.ts
NODE_ENV=test npx tsx --test tests/workspace*.test.ts
NODE_ENV=test npx tsx --test tests/plugin-modes.test.ts
NODE_ENV=test npx tsx --test tests/visual-explanation-*.test.*
```

Do not assume glob expansion includes the intended files. Print or inspect the matched file list if necessary.

### Project checks

Inspect `package.json` before assuming script names. Then run the available equivalents of:

```bash
npm run typecheck
npm run lint
npm run build
```

If the repository uses a different lint script or test runner, use the actual configured command and report it.

### Browser/runtime checks

For UI and lifecycle work, automated component tests are not enough. Exercise:
- create workspace from Study Hub;
- reload and reopen workspace;
- disable plugin and inspect availability;
- re-enable plugin and reopen;
- move chat and workspace into the same folder;
- reorder mixed siblings;
- archive and restore a folder containing both item kinds;
- search and keyboard-select workspace;
- create a visual artifact, update it in place, navigate away/back, and confirm chat isolation.

If a browser check cannot be performed, explicitly mark it unverified.

## 4. Required regression cases

### Workspace and plugin lifecycle
- legacy plugin without modes;
- plugin with one mode;
- same mode ID in two plugins;
- plugin disabled while workspace exists;
- plugin missing at startup;
- plugin re-enabled;
- workspace initialization failure;
- interrupted workspace deletion at each journal stage;
- corrupt or unsupported metadata;
- symlink/path traversal attempts;
- package update preserving plugin data.

### Shared organization
- chat-only folder;
- workspace-only folder;
- mixed folder;
- nested mixed folders;
- empty-folder calculation;
- archive/restore nested subtree;
- mixed sibling reorder;
- move to root;
- delete placement without deleting underlying record;
- v1 migration with folder order and archive metadata;
- unknown future schema is not overwritten.

### Visual Explanation
- valid declarative SVG;
- malformed JSON;
- unknown schema;
- forbidden SVG primitive;
- forbidden attribute and URL;
- CSS injection attempt;
- source and element limits;
- create with host-generated ID;
- update same artifact in same chat;
- reject cross-chat update;
- invalid update preserves last valid artifact;
- legacy artifact path only if supported;
- controls: valid defaults, invalid values, update behavior, keyboard behavior;
- reduced motion;
- panel expand/collapse and focus restoration.

## 5. Regression test quality

A test is weak if it:
- mocks the exact boundary whose behavior is under investigation;
- asserts only that a component rendered;
- checks only that an API returned HTTP 200;
- verifies a helper but not the caller path;
- tests only the new happy path and ignores legacy callers;
- accepts either the correct and incorrect output;
- duplicates implementation logic inside the test.

Prefer tests that call the real service/tool and assert observable persisted or rendered results.

## 6. Diff review

Run:

```bash
git diff --check
git diff --stat
git diff --name-only
git status --short
```

Review every changed file. Check:
- unrelated formatting or cleanup;
- changed public types;
- changed persistence format;
- weakened validation;
- new broad catch blocks;
- stale comments;
- tests deleted or weakened;
- generated artifacts accidentally added;
- secrets or local paths.

## 7. Final acceptance report

For every finding, use one status:
- `FIXED_AND_VERIFIED`
- `FIXED_STATIC_ONLY`
- `NOT_REPRODUCED`
- `SPEC_CONFLICT`
- `BLOCKED`
- `DEFERRED_BY_DECISION`

Include evidence. Do not collapse all findings into a single "done" label.
