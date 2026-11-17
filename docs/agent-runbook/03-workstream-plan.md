# Multi-agent workstream plan

## Coordination rules

Run workstreams sequentially when their file scopes overlap. The orchestrator may run independent inspections in parallel, but implementation ownership must remain exclusive.

Each workstream starts from the same recorded base commit or from the explicitly integrated commit produced by the previous run. Never assume parallel branches can be merged without conflict.

## Run 0: baseline and issue triage

**Mode:** inspection only.  
**Owner:** orchestrator or one audit agent.  
**Write scope:** none.

Tasks:
1. Record branch, HEAD, working tree.
2. Locate the original Study Hub specification in the repository.
3. Compare current source against the original specification.
4. Reproduce each reported issue or mark it unconfirmed.
5. Produce a finding list with severity, evidence, affected files, and dependencies.

Output:
- baseline report;
- verified issue register;
- proposed order of workstreams.

Stop if the original specification cannot be located and the disputed requirement depends on it.

## Run 1: Visual Explanation trust boundary

**Goal:** prove that new artifacts created through the agent tool can only enter the strict declarative SVG path, without accidentally weakening valid legacy reads.

**Likely files:**
- `src/agent/tools/visual-explanation.ts`
- `src/core/visual-explanation-validator.ts`
- `src/core/contracts/visual-explanation.ts`
- `components/artifacts/visual-explanation-card.tsx`
- relevant visual explanation tests

**Allowed changes:** only the trust-boundary and compatibility handling needed for this finding, plus focused tests.

Tasks:
1. Trace input from tool schema to validator to persistence to renderer.
2. Identify every place `allowLegacy` or HTML renderer can be reached.
3. Determine whether legacy HTML can be newly created, updated, or only read from persisted data.
4. Add tests that reject HTML/XML/script payloads at the agent boundary.
5. Add tests that preserve legitimate legacy behavior only if the original contract requires it.
6. Keep the declarative renderer free of arbitrary markup execution.

**Do not:** remove legacy support before checking persisted data; rewrite the entire visual artifact model; add a new renderer.

Acceptance:
- the agent boundary rejects unsupported renderer/source combinations;
- the renderer receives validated data only;
- legacy handling is explicit and tested;
- invalid updates preserve the previous valid artifact;
- chat isolation remains covered.

## Run 2: Visual Explanation control contract

**Goal:** reconcile the declared control types with the actual MVP accepted by the agent tool.

**Likely files:**
- `src/core/contracts/visual-explanation.ts`
- `src/core/visual-explanation-validator.ts`
- `src/agent/tools/visual-explanation.ts`
- `components/artifacts/visual-explanation-card.tsx`
- visual control tests and prompt module

Tasks:
1. Compare original specification, type contract, validator, tool schema, and UI.
2. List controls supported at each layer.
3. Determine intended MVP scope from the source specification.
4. If the spec requires slider/toggle/select, implement them end-to-end with strict value validation.
5. If the spec defers them, keep the narrower implementation and update only the implementation documentation, not the original requirements.
6. Add tests for invalid values, defaults, updates, keyboard interaction, and state preservation.

**Do not:** expand controls solely because types exist; invent new controls; accept arbitrary callback code.

Acceptance:
- contract, validator, tool, UI, prompt, and tests agree;
- unsupported controls are rejected explicitly;
- no invalid control state can crash or bypass validation.

## Run 3: Workspace lifecycle and plugin persistence

**Goal:** verify workspace behavior across plugin disable, missing plugin, re-enable, refresh, deletion, interrupted deletion, and package replacement.

**Likely files:**
- `src/server/plugin-host.ts`
- `src/server/workspaces.ts`
- `src/store/workspaces.ts`
- `src/store/plugin-workspace-state.ts`
- `src/store/plugin-data-paths.ts`
- related tests

Tasks:
1. Map each lifecycle transition and identify the owning service.
2. Verify data directory ownership and path validation.
3. Verify that disable/unavailable does not delete workspace data.
4. Verify delete ordering and deletion journal recovery.
5. Verify package install/update does not overwrite private data.
6. Determine whether an actual uninstall operation exists and what it promises.
7. Add tests for the missing transitions.

**Do not:** add a speculative uninstall subsystem if the app has no uninstall action; do not delete user data to make tests pass; do not move storage directories without migration.

Acceptance:
- each lifecycle state has explicit expected availability;
- disable and package replacement preserve workspace data;
- workspace deletion is recoverable after partial failure;
- any uninstall behavior is documented and tested, or explicitly reported as unsupported.

## Run 4: Shared directory, sidebar, archive

**Goal:** prove that chats and workspaces behave as one organization without breaking chat-only flows.

**Likely files:**
- `src/core/organization.ts`
- `src/core/directory.ts`
- `src/server/directory.ts`
- `components/sidebar.tsx`
- `components/chat-folder-tree.tsx`
- `components/archive-page.tsx`
- `components/workspace-row.tsx`
- relevant tests

Tasks:
1. Trace mixed directory data from store to API to sidebar/archive.
2. Test chat-only legacy fallback.
3. Test mixed folder membership and sibling ordering.
4. Test archive/restore of individual items and nested folders.
5. Test keyboard selection and active workspace folder expansion.
6. Test drag/drop across item kinds.
7. Test context menus and delete semantics.

**Do not:** rename the entire chat organization API; redesign sidebar UX; change unrelated session interactions.

Acceptance:
- mixed items are correctly listed and navigated;
- chat-only compatibility remains;
- archive/restore preserves folder hierarchy and records;
- mixed ordering is deterministic;
- keyboard and pointer interactions work for both kinds.

## Run 5: Study Hub catalog and workspace screen

**Goal:** verify mode discovery, availability, launch, and workspace entry.

**Likely files:**
- `components/study-hub-catalog.tsx`
- `components/workspace-screen.tsx`
- `src/core/plugin-modes.ts`
- `src/server/plugin-host.ts`
- relevant routes and tests

Tasks:
1. Trace mode registration to API/catalog.
2. Verify duplicate mode IDs across different plugins.
3. Verify disabled, unavailable, stale, and renderer-missing states.
4. Verify repeated launches create distinct workspace IDs.
5. Verify failed initialization does not leave a misleading active workspace.
6. Verify workspace reopen after reload.

**Do not:** make mode registration mandatory for legacy plugins; add unrelated catalog features.

Acceptance:
- catalog entries reflect authoritative host availability;
- launch creates an independent persistent instance;
- unavailable modes cannot be launched;
- legacy Plugin API v1 remains functional.

## Run 6: Integrated regression and release gate

**Mode:** verification only unless the orchestrator assigns a specific defect.  
**Write scope:** tests/report only, if explicitly approved.

Tasks:
1. Run focused tests for all changed workstreams.
2. Run typecheck, lint, production build.
3. Run full test suite if feasible.
4. Exercise browser flows for sidebar, archive, catalog, workspace, and visual artifact.
5. Inspect final diff against the baseline.
6. Confirm no agent left uncommitted or untracked work outside the agreed scope.

Acceptance:
- all required checks have actual recorded outputs;
- failures are classified as introduced, pre-existing, environmental, or unresolved;
- no claim of full completion if browser/runtime paths were not exercised.
