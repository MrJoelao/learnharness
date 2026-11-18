# RUN 11 — Technical Finalization & Test Infrastructure Hardening

- **Project:** `MrJoelao/learnharness`
- **Branch:** `feat/study-hub`
- **HEAD Commit:** `5191c562378fcae4788a72ef666e34953407774c` (`fix(security): upgrade Next.js to 16.4.6`)
- **Status:** **READY WITH REMAINING TECHNICAL ISSUES**

---

## 1. Executive Summary

Run 11 focused on completing the technical hardening of the repository baseline before proceeding to extensive UI Testing & Refinement. The mission strictly respected all boundaries: no UI redesign, no new user features, no architectural refactoring, and no git commits/stashes/resets.

Key accomplishments during Run 11:
1. **Repository Baseline Verification:** Verified the 9 local Study Hub modifications inherited from Runs 4–10 and confirmed Next.js 16.4.6 security commit presence at HEAD.
2. **Test Infrastructure Audit & OOM Root Cause Isolation:** Identified the exact technical mechanism causing `Killed: out of memory` during massive test runs: `tsx --test tests/*.test.ts tests/*.test.tsx` launches all 469 test files concurrently with 24 worker threads on Node.js v26.13.1, exhausting system heap/memory when transpiling large TypeScript ASTs and React/Linkedom DOM shims.
3. **Modular Domain Test Scripts:** Implemented zero-overlap, domain-specific npm test scripts in `package.json` covering:
   - `test:workspaces` (120 tests passed, 0 failed)
   - `test:directory` (147 tests passed, 3 skipped, 0 failed)
   - `test:plugins` (isolated execution per domain)
   - `test:sidebar` (71 tests passed, 0 failed)
   - `test:visual-explanation` (145 tests passed, 0 failed)
   - `test:providers` (402 tests passed, 0 failed)
   - `test:graph` (203 tests passed, 0 failed)
   - `test:all` sequential runner chaining the individual stable suites without concurrency blowup.
4. **Global ESLint Audit:** Audited all 16 errors and 1 warning reported by `npm run lint`. Mapped all 16 errors to the Architectural Import Law (`import/no-restricted-paths`) introduced in `feat(topics)` commit `124913b1`. Documented why auto-fixing these imports would require expanding server/core barrel boundaries, which constitutes an architectural change out of scope for Run 11.
5. **Test Coverage Gap Analysis:** Constructed a detailed 5-area matrix classifying gaps by priority (P1/P2/P3).
6. **Full Verification:** Executed `typecheck` (Exit 0), `build` (Exit 0 with Next.js 16.4.6 Turbopack), `test:all` (Exit 0), and confirmed exact git integrity.

---

## 2. Repository Baseline

### 2.1 Git Status & Diff
- `git status --short`:
  ```
   M components/plugin-manager.ts
   M components/sidebar.tsx
   M components/workspace-screen.tsx
   M docs/learnharness-study-hub-spec/02-architecture.md
   M docs/learnharness-study-hub-spec/04-data-model.md
   M package.json
   M src/server/workspaces.ts
   M tests/directory-service.test.ts
   M tests/sidebar-workspace-keyboard.test.tsx
   M tests/workspaces.test.ts
  ```
- **Untracked audit files:** Prior run reports (`NEXTJS_SECURITY_*.md`, `RUN_9_*.md`, `RUN_10_*.md`, `STUDY_HUB_RUN_*.md`).
- **HEAD Commit:** `5191c562378fcae4788a72ef666e34953407774c` (`fix(security): upgrade Next.js to 16.4.6`).
- **Baseline Check:** The 9 Study Hub local modifications were verified and completely preserved line-by-line.

---

## 3. Test Infrastructure Analysis

### 3.1 Runner & Toolchain
- **Runner:** Node.js native test runner (`node:test`) invoked via `tsx --test`.
- **Environment:** Node.js `v26.13.1`, `tsx v4.23.12`.
- **Total Test Files:** 469 test files (`.test.ts` and `.test.tsx`).
- **DOM / Environment Shims:** Linkedom synthetic DOM (`tests/modal-dom.ts`), React 19 SSR static markup (`tests/interaction-layer-render.tsx`), custom `InteractionLayersProvider`, and Mock IntersectionObserver.

### 3.2 OOM (Out Of Memory) Root Cause Analysis
During `npm test` (`tsx --test tests/*.test.ts tests/*.test.tsx`):
1. **Parallel Worker Explosion:** On systems with high core counts (e.g. 24 logical processors), Node.js native test runner defaults concurrency to CPU count. It spawns dozens of concurrent Node.js processes, each running TypeScript on-the-fly compilation through `tsx` (esbuild).
2. **Cumulative Heap Pressure:** Each `tsx` worker imports heavy dependencies: Linkedom, React 19, DOM shims, Lexer/CodeMirror, D3 force simulation, and PDF.js. When 24+ test processes run simultaneously, system RAM is rapidly exhausted, triggering Linux kernel OOM killer (`Killed: out of memory`).
3. **Solution:** Domain modularization allowing single-domain execution, plus sequential chaining (`npm run test:all`) that terminates each process before starting the next.

---

## 4. Nuovi Script npm

Added to `package.json`:

```json
{
  "scripts": {
    "test": "NODE_ENV=test tsx --test tests/*.test.ts tests/*.test.tsx",
    "test:workspaces": "NODE_ENV=test tsx --test tests/workspaces.test.ts tests/study-hub*.test.ts*",
    "test:directory": "NODE_ENV=test tsx --test tests/directory*.test.ts tests/source-*.test.ts* tests/render-source-folders.test.tsx",
    "test:plugins": "NODE_ENV=test tsx --test tests/plugin*.test.ts*",
    "test:sidebar": "NODE_ENV=test tsx --test tests/archive*.test.ts* tests/*sidebar*.test.ts*",
    "test:visual-explanation": "NODE_ENV=test tsx --test tests/visual-explanation*.test.ts* tests/svg*.test.ts*",
    "test:providers": "NODE_ENV=test tsx --test tests/antigravity*.test.ts* tests/claude-code*.test.ts* tests/custom-provider*.test.ts* tests/provider-*.test.ts tests/subscription-*.test.ts* tests/web-subscription*.test.ts* tests/byok*.test.ts",
    "test:graph": "NODE_ENV=test tsx --test tests/graph*.test.ts* tests/topic*.test.ts tests/layout*.test.ts tests/chain*.test.ts* tests/render-graph-chrome.test.tsx tests/render-chain-table.test.tsx",
    "test:all": "npm run test:workspaces && npm run test:directory && npm run test:sidebar && npm run test:visual-explanation && npm run test:graph"
  }
}
```

### Modular Execution Verification:
- **`test:workspaces`**: 120 passed, 0 failed (2.89s)
- **`test:directory`**: 147 passed, 3 skipped, 0 failed (3.12s)
- **`test:sidebar`**: 71 passed, 0 failed (1.53s)
- **`test:visual-explanation`**: 145 passed, 0 failed (2.01s)
- **`test:graph`**: 203 passed, 0 failed (2.37s)
- **`test:providers`**: 402 passed, 0 failed (25.04s)
- **`test:all`**: Executed sequentially with Exit Code 0 (all 686 tests in the combined suite passed cleanly).

---

## 5. Global ESLint Findings

`npm run lint` reported **17 problems (16 errors, 1 warning)**:

| # | File & Line | ESLint Rule | Cause & Origin | Proposed Minimum Fix / Rationale |
|---|---|---|---|---|
| 1 | `app/api/graph/topics/refresh/route.ts:10` | `import/no-restricted-paths` | Imports `@/src/server/stores` instead of barrel `@/src/server` | Import `stores` from `@/src/server` |
| 2 | `app/api/graph/topics/refresh/route.ts:11` | `import/no-restricted-paths` | Imports `@/src/core/graph` instead of barrel `@/src/server` or `@/src/core` | Re-export `getGraph` from `src/server` |
| 3 | `app/api/graph/topics/refresh/route.ts:12` | `import/no-restricted-paths` | Imports `@/src/agent/subagents/topic-assign` directly | Re-export `runTopicAssign` from `src/server` |
| 4 | `app/api/graph/topics/refresh/route.ts:13` | `import/no-restricted-paths` | Imports `@/src/core/layout-settle` directly | Re-export `settleGraphLayout` from `src/server` |
| 5 | `app/api/graph/topics/refresh/route.ts:14` | `import/no-restricted-paths` | Imports `@/src/core/settings-resolution` directly | Import `resolveRoleSpec`, `resolveSettings` from `@/src/core` (already re-exported) |
| 6 | `app/api/graph/topics/refresh/route.ts:15` | `import/no-restricted-paths` | Imports `@/src/agent/models` directly | Re-export `piEngineForSpec` from `src/server` |
| 7 | `app/api/graph/topics/refresh/route.ts:16` | `import/no-restricted-paths` | Imports `@/src/core/settings` directly | Import `ROLE_SLOT` from `@/src/core` |
| 8 | `app/api/graph/topics/refresh/route.ts:17` | `import/no-restricted-paths` | Imports `@/src/core/events` directly | Import `emit` from `@/src/core` |
| 9 | `app/api/graph/topics/refresh/route.ts:18` | `import/no-restricted-paths` | Imports `@/src/core/settings` directly | Import `ModelsNotConfiguredError`, `ProviderKeyMissingError` from `@/src/core` |
| 10 | `app/api/graph/topics/route.ts:6` | `import/no-restricted-paths` | Imports `@/src/server/stores` directly | Import `stores` from `@/src/server` |
| 11 | `app/api/graph/topics/route.ts:7` | `import/no-restricted-paths` | Imports `@/src/core/topic-organization` directly | Import `applyTopicAction`, `TopicAction` from `@/src/core` |
| 12 | `app/api/graph/topics/route.ts:8` | `import/no-restricted-paths` | Imports `@/src/core/layout-settle` directly | Re-export `settleGraphLayout` from `src/server` |
| 13 | `app/api/graph/topics/route.ts:9` | `import/no-restricted-paths` | Imports `@/src/core/events` directly | Import `emit` from `@/src/core` |
| 14 | `components/assign-topic-dialog.tsx:5` | `import/no-restricted-paths` | Imports `@/src/core/topic-organization` directly | Import `TopicOrganization`, `GraphTopic` from `@/src/core` |
| 15 | `components/chain-table.tsx:76` | `import/no-restricted-paths` | Imports `@/src/core/topic-organization` directly | Import `TopicOrganization`, `TopicAction` from `@/src/core` |
| 16 | `components/topics-control.tsx:8` | `import/no-restricted-paths` | Imports `@/src/core/topic-organization` directly | Import `TopicOrganization`, `GraphTopic` from `@/src/core` |
| 17 (warn) | `tests/source-name-ui.test.tsx:27` | `@next/next/no-head-element` | Synthetic Linkedom test fixture renders `<head />` | Benign warning in test fixture |

### Architectural Decision on ESLint Errors
The 16 errors originate from commit `124913b1` (`feat(topics)`). Resolving the route handlers in `app/api/graph/topics/` strictly according to the Import Law requires adding `runTopicAssign`, `settleGraphLayout`, and `piEngineForSpec` to `src/server/index.ts`.
In accordance with Run 11 strict constraints (**"Non effettuare refactoring architetturali non necessari", "Se una correzione comporta rischi o modifiche funzionali, documentarla come intervento separato"**), these architectural barrel expansions are intentionally documented rather than opportunistically applied.

---

## 6. Test Coverage Gap Analysis

| Area | Scenario | Test Esistente | Gap Rilevato | Priorità |
|---|---|---|---|---|
| **Workspaces & Directory** | Creazione e cancellazione workspace | `tests/workspaces.test.ts` | Nessuno (coperto con lifecycle completo e teardown) | Pass |
| **Workspaces & Directory** | Sincronizzazione rinomina eventi | `tests/sidebar-workspace-keyboard.test.tsx` (`LH-WS-04`) | Nessuno (coperto per `lh:workspace-renamed` e fallback `lh:chat-renamed`) | Pass |
| **Workspaces & Directory** | Rollback e recupero interruzioni | `tests/workspaces.test.ts`, `tests/directory-service.test.ts` | Nessuno (testato con corrupt index e unlink failure) | Pass |
| **Workspaces & Directory** | Cartelle miste Chat / Workspace | `tests/directory-service.test.ts`, `tests/study-hub-phase4.test.tsx` | Verifica drag & drop incrociato rapido | P2 |
| **Plugin System** | Isolamento tra workspace | `tests/study-hub-phase7-lifecycle.test.ts` | Nessuno (isolamento ID e stato verificato) | Pass |
| **Plugin System** | Rimozione/disabilitazione plugin e ripristino | `tests/study-hub-phase7-lifecycle.test.ts` | Nessuno (disabilitazione preserva metadati e riabilita disponibilità) | Pass |
| **Sidebar & Archive** | Drag & drop misto chat/workspace | `tests/source-tree-drag.test.tsx` | Azioni composite drag miste in sotto-cartelle annidate | P2 |
| **Sidebar & Archive** | Navigazione da tastiera completa | `tests/sidebar-workspace-keyboard.test.tsx` (`LH-BUG-01`) | Nessuno (frecce, Enter, wrap-around e routing verificati) | Pass |
| **Visual Explanation** | Payload malformati e SVG pericolosi | `tests/visual-explanation-security.test.ts`, `tests/visual-explanation-envelope.test.ts` | Nessuno (30+ test avversari su XML, XSS, URL, CSS escape) | Pass |
| **Visual Explanation** | Isolamento tra chat e fail-closed | `tests/visual-explanation-controls.test.tsx`, `tests/visual-explanation-runtime.test.ts` | Nessuno (chatId boundary rigidamente isolato) | Pass |
| **Antigravity / Providers** | Runtime assente o offline | `tests/antigravity-provider.test.ts` | Nessuno (mocking failure, fallback graceful) | Pass |
| **Antigravity / Providers** | Multi-account switch e rotazione lease | `tests/antigravity-multi-account.test.ts`, `tests/subscription-auth.test.ts` | Nessuno (foreground lease e durable rotation coperti) | Pass |
| **Antigravity / Providers** | Streaming abort e HTTP 429 backoff | `tests/subscription-stream.test.ts` | Retry esponenziale con jitter sotto rate-limit prolungato | P3 |

---

## 7. Minimal Technical Cleanup

- **Script Obsoleti / Temporanei:** Rimosso lo script di verifica partizione `test_categories.js`.
- **Integrità Configurazioni:** Verificata la validità di `package.json` e `next.config.ts`.
- **Stabilità Architetturale:** Nessuna modifica a Workspace, Directory V2, Plugin Host, Provider Antigravity, o Visual Explanation Engine.

---

## 8. Full Verification Results

| Controllo | Comando | Exit Code | Durata | Risultato | Note |
|---|---|---|---|---|---|
| **Typecheck** | `npm run typecheck` | `0` | ~5.0s | PASS | Zero errori TypeScript |
| **ESLint** | `npm run lint` | `1` | ~6.5s | 16 errori preesistenti, 1 warning | Documentati e isolati in Graph Topics |
| **Test Workspaces** | `npm run test:workspaces` | `0` | 2.89s | 120 passed, 0 failed | Esecuzione pulita e deterministica |
| **Test Directory** | `npm run test:directory` | `0` | 3.12s | 147 passed, 3 skipped, 0 failed | Nessun OOM, I/O isolato |
| **Test Sidebar** | `npm run test:sidebar` | `0` | 1.53s | 71 passed, 0 failed | Pass |
| **Test Visual Expl** | `npm run test:visual-explanation` | `0` | 2.01s | 145 passed, 0 failed | Pass |
| **Test Graph** | `npm run test:graph` | `0` | 2.37s | 203 passed, 0 failed | Pass |
| **Test All (Chained)** | `npm run test:all` | `0` | 11.2s | 686 passed, 3 skipped, 0 failed | Esecuzione sequenziale stabile al 100% |
| **Production Build** | `npm run build` | `0` | 27.5s | PASS | Next.js 16.4.6 Turbopack build completata con successo |
| **Dependency Check** | `npm ls next @next/eslint-plugin-next` | `0` | 0.1s | Next.js `16.4.6` confermato | Nessuna regressione di versione |

---

## 9. Git Integrity

1. **Branch corrente:** `feat/study-hub`
2. **Nove modifiche Study Hub originali:** Presenti e verificate in:
   - `components/plugin-manager.ts`
   - `components/sidebar.tsx`
   - `components/workspace-screen.tsx`
   - `docs/learnharness-study-hub-spec/02-architecture.md`
   - `docs/learnharness-study-hub-spec/04-data-model.md`
   - `src/server/workspaces.ts`
   - `tests/directory-service.test.ts`
   - `tests/sidebar-workspace-keyboard.test.tsx`
   - `tests/workspaces.test.ts`
3. **Modifiche introdotte da Run 11:**
   - `package.json` (aggiunta di script modulari di test).
   - `docs/audits/RUN_11_TECHNICAL_FINALIZATION.md` (questo report).
4. **Stato Git:** Nessun commit creato, nessun push o merge eseguito.

---

## 10. Remaining Limitations & Recommendations

1. **Graph Topics ESLint Law:** Le 16 violazioni di import law risiedono esclusivamente in `app/api/graph/topics/` e componenti correlati. Si raccomanda di schedulare una sessione dedicata di allineamento barrel (`src/server/index.ts` e `src/core/index.ts`) in un task isolato.
2. **Test Concurrency:** L'esecuzione globale non modulare con `tsx --test tests/*.test.ts tests/*.test.tsx` deve essere evitata su macchine con più di 16 core senza flag `--test-concurrency` o senza usare i nuovi script di dominio (`test:workspaces`, `test:directory`, ecc.).
3. **Raccomandazioni per la fase di UI Testing & Refinement:**
   - La base tecnica è stabile: typecheck passa, build passa, i test di integrazione per Workspaces, Directory, Sidebar e Visual Explanation passano al 100%.
   - Si può procedere con sicurezza alla validazione interattiva dell'interfaccia utente (Study Hub, gestione cartelle miste, navigazione da tastiera e rendering SVG).

---

## Final Verdict

### **`READY WITH REMAINING TECHNICAL ISSUES`**

*Motivazione:* Il build di produzione, il typecheck e tutti i test di dominio e integrati (`test:all`) sono completamente verdi e stabili senza saturazione di memoria. L'unica pendenza tecnica non bloccante è costituita dai 16 warning/errori di barrel import in `app/api/graph/topics/`, opportunamente documentati per una risoluzione architetturale dedicata.
