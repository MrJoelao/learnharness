# RUN 3 — LearnHarness: Consolidamento Visual Explanation MVP v1

Data: 17 Novembre 2026
Autore: Gemini 3.8 Flash (Agente Tecnico Singolo)
Orchestratore: ChatGPT
Repository: `MrJoelao/learnharness`
Branch: `feat/study-hub`

---

## 1. Identificativi del controllo

- **HEAD iniziale:** `d749fb4e2e0c24492d5565b08dd94e23e4f1a26f`
- **HEAD finale:** `d749fb4e2e0c24492d5565b08dd94e23e4f1a26f` (nessun commit o push effettuato, modifiche mantenute nel working tree come prescritto).
- **Working Tree:** Modifiche unstaged pronte per la revisione da parte dell'orchestratore esterno.

---

## 2. File modificati e motivazione di ciascuna modifica

| File | Modifiche e Motivazione |
|---|---|
| `src/core/contracts/visual-explanation.ts` | **Decisione A & B:** Ristretto `VisualRenderer` a sola unione `"svg"`. Rimossi i tipi `VisualSliderControl`, `VisualToggleControl`, `VisualSelectControl`, `VisualSelectOption`. Definito `export type VisualControlDescriptor = VisualButtonControl`. Aggiornati i commenti TSDoc a documentare che slider, toggle e select non appartengono al contratto attivo v1. |
| `src/core/visual-explanation-validator.ts` | **Decisione A & B:** Ristretto `ALLOWED_RENDERERS = ["svg"]`. Rimosso il supporto al parametro `allowLegacy` in `validateVisualArtifact`. Rifiuto incondizionato e fail-closed per `renderer === "html"` con diagnostica esplicita. Rimossa interamente la funzione `validateHtmlSource`. Rimosso il supporto a slider, toggle e select in `validateControlDescriptor`, accettando unicamente controlli `button` con le 5 azioni deterministiche (`play`, `pause`, `reset`, `step-forward`, `step-backward`). Rimossa la validazione di `initialState` per controlli parametrici, mantenendo unicamente la validazione di `step`, `maxSteps`, sicurezza CSS ed elementi primitivi SVG. |
| `components/artifacts/visual-explanation-card.tsx` | **Decisione A & B:** Rimossi gli import dei controlli non supportati. Rimosso `iframeRef`, l'effetto di ascolto/invio `postMessage` e il ramo di rendering HTML/iframe in `renderVisualContent`. Rimossi gli handler morti `handleSliderChange`, `handleToggleChange`, `handleSelectChange`. Semplificata la funzione pura `preserveCompatibleState` al solo tracciamento di `step` e `button`. Semplificata la toolbar di controllo per renderizzare unicamente bottoni `VisualButtonControl`. Aggiornato il download dell'artefatto per produrre esclusivamente file `.svg` con MIME type `"image/svg+xml"`. |
| `docs/learnharness-study-hub-spec/06-visual-explanation-engine.md` | Aggiornata la specifica di sistema del Visual Explanation Engine (Sezioni 4, 7 e 10) formalizzando la Decisione A (esclusione di controlli parametrici dall'MVP v1; sole 5 azioni deterministiche ammesse per i bottoni) e la Decisione B (esclusivo renderer dichiarativo SVG `learnharness.visual.svg.v1`; rimozione definitiva del percorso legacy HTML/iframe). |
| `docs/plugin-api/contracts-visual-explanation.md` | Rigenerata la documentazione delle API/contratti dei plugin: rimosse le sezioni relative a `VisualSelectControl`, `VisualSelectOption`, `VisualSliderControl`, `VisualToggleControl`; `VisualRenderer` documentato come `"svg"` e `VisualControlDescriptor = VisualButtonControl`. |
| `docs/plugin-api/README.md` | Rigenerato l'indice delle dichiarazioni pubbliche dei plugin rimuovendo i riferimenti a slider, toggle e select. |
| `docs/plugin-api/plugins.md` | Allineato con la rigenerazione dello script standard `build-plugin-api-reference.mjs`. |
| `tests/visual-explanation-card.test.tsx` | Aggiornati i test per utilizzare esclusivamente `VisualButtonControl` e verificare che l'artefatto produca SVG, che i controlli non-button vengano rifiutati, che nessun iframe venga mai montato e che il download sia strict `.svg`. |
| `tests/visual-explanation-controls.test.tsx` | Aggiornati i test di `preserveCompatibleState` e di reattività: verificata l'assenza di controlli `input[type="range"]`, `input[type="checkbox"]` e `select`, e confermato il comportamento fail-closed con 0 iframe in qualsiasi transizione. |
| `tests/visual-explanation-declarative.test.tsx` | Aggiornato il test BUG P2 per verificare il rifiuto fail-closed sia da parte del validatore sia da parte della card quando vengono passati controlli di tipo `slider`, `toggle` o `select`. |
| `tests/visual-explanation-envelope.test.ts` | Aggiornata la suite dell'envelope per testare il rifiuto incondizionato di `renderer: "html"`, il rifiuto di controlli diversi da `button` o con azioni non ammesse, e la validazione di `initialState` e primitive SVG. |
| `tests/visual-explanation-panel.test.tsx` | Aggiornato l'artefatto di test del pannello a SVG puro, verificando che la vista espansa contenga esattamente una vista attiva e 0 iframe nel DOM. |

---

## 3. Riferimenti a HTML/iframe eliminati

1. **Rami di esecuzione e renderer:**
   - Eliminato `renderer: "html"` e `renderer === "html"` da tutto il codice attivo (`src/core/contracts/visual-explanation.ts`, `src/core/visual-explanation-validator.ts`, `components/artifacts/visual-explanation-card.tsx`).
   - Eliminato il ramo iframe: `data-testid="visual-explanation-iframe"`, elementi `<iframe>`, attributi `sandbox`, `srcDoc`.
   - Eliminata completamente la funzione di validazione `validateHtmlSource`.
   - Eliminato il parametro `{ allowLegacy: true }` sia dalle opzioni di `validateVisualArtifact` che dai call-site.

2. **Bridge postMessage e lifecycle iframe:**
   - Eliminato `iframeRef`.
   - Eliminato l'ascoltatore `window.addEventListener("message", ...)` relativo all'iframe degli artefatti visivi.
   - Eliminato l'invio di messaggi `iframeRef.current.contentWindow.postMessage(...)` verso l'iframe per `init`, `state-change` e `theme-change`.

3. **Verifica assenza residui:**
   - Ricerca `git grep -n -E "renderer:\s*['\"]html['\"]|renderer\s*===\s*['\"]html['\"]" src/ components/`: **0 occorrenze**.
   - Ricerca `git grep -n "visual-explanation-iframe"`: **0 occorrenze**.
   - Ricerca `git grep -n "allowLegacy"`: **0 occorrenze**.
   - Ricerca `git grep -n "validateHtmlSource"`: **0 occorrenze**.

---

## 4. Controlli rimossi e contratti attivi risultanti

1. **Controlli rimossi dal contratto attivo v1:**
   - `VisualSliderControl` (`type: "slider"`)
   - `VisualToggleControl` (`type: "toggle"`)
   - `VisualSelectControl` (`type: "select"`)
   - `VisualSelectOption`

2. **Contratto attivo v1 (`src/core/contracts/visual-explanation.ts`):**
   ```ts
   export type VisualButtonAction =
     | "play"
     | "pause"
     | "reset"
     | "step-forward"
     | "step-backward";

   export interface VisualButtonControl {
     type: "button";
     id: string;
     label: string;
     action: VisualButtonAction;
     disabled?: boolean;
   }

   export type VisualControlDescriptor = VisualButtonControl;
   ```

3. **Validazione e limiti preservati:**
   - Limite massimo di 5 controlli per artefatto (`VISUAL_ARTIFACT_LIMITS.MAX_CONTROLS = 5`).
   - Univocità rigorosa degli ID dei controlli.
   - Lunghezza label compresa tra 1 e 64 caratteri.
   - Proprietà `disabled` validata come booleana.
   - Rifiuto immediato (fail-closed) di qualsiasi controllo con `type` diverso da `"button"` o con `action` non compresa tra le 5 azioni approvate.

---

## 5. Documentazione e tipi futuri

- **Specifica di sistema (`docs/learnharness-study-hub-spec/06-visual-explanation-engine.md`):** Aggiornate le sezioni 4, 7 e 10 con note chiare sul fatto che l'MVP v1 supporta esclusivamente il renderer SVG dichiarativo (`learnharness.visual.svg.v1`) e controlli button deterministici. I controlli parametrici e l'eventuale reintroduzione di renderer isolati richiederanno contratti versionati successivi.
- **Plugin API Reference (`docs/plugin-api/`):** Rigenerati i file `contracts-visual-explanation.md` e `README.md` tramite `scripts/build-plugin-types.mjs` e `scripts/build-plugin-api-reference.mjs`. Nessun tipo deprecato o non supportato è esposto nell'SDK pubblico dei plugin.
- **Skill package offline (`public/plugin-authoring/learnharness-plugins.zip`):** Ricostruito tramite `npm run plugins:build-authoring` per allineare l'archivio deterministico alla nuova superficie dei contratti.

---

## 6. Test aggiunti o aggiornati

- `tests/visual-explanation-card.test.tsx`:
  - Aggiornato il rendering dei bottoni standard (`step-forward`, `step-backward`, `reset`).
  - Aggiunto test esplicito per la generazione del download `.svg` (`image/svg+xml`).
  - Verificato che artefatti con `renderer: "html"` mostrino il banner di alert/errore senza montare iframe.
- `tests/visual-explanation-controls.test.tsx`:
  - Rimosse le suite obsolete relative a slider/toggle/select.
  - Testata la funzione `preserveCompatibleState` per `step` e `button`.
  - Verificata l'assenza di elementi form/slider nel DOM generato dalla card.
  - Verificato che in nessuna circostanza vengano generati elementi `iframe`.
- `tests/visual-explanation-declarative.test.tsx`:
  - Aggiornato `BUG P2`: verificato il rifiuto di payload contenenti `slider`, `toggle` o `select` sia nel validatore che nella card.
- `tests/visual-explanation-envelope.test.ts`:
  - Verificato il rifiuto fail-closed di `renderer: "html"`.
  - Verificato il rifiuto di azioni invalide (es. `action: "fly"`).
  - Verificato il rifiuto di `disabled` non booleano.
  - Verificato il rifiuto di controlli con `type: "slider"`, `type: "toggle"`, `type: "select"`.
- `tests/visual-explanation-panel.test.tsx`:
  - Aggiornato l'artefatto alla specifica SVG dichiarativa, verificando l'assenza totale di iframe e la presenza di una sola vista attiva.

---

## 7. Comandi eseguiti ed esiti reali

1. `npm run typecheck` (`tsc --noEmit`):
   - **Esito:** `Exit code 0`. Nessun errore TypeScript nell'intero repository.
2. `NODE_ENV=test npx tsx --test tests/visual-explanation-*.test.*`:
   - **Esito:** `tests 104, suites 12, pass 104, fail 0` (`duration: 4.63s`). Tutte le 104 verifiche del motore visivo sono passate.
3. `NODE_ENV=test npx tsx --test tests/study-hub-phase7-*.test.*`:
   - **Esito:** `tests 18, suites 0, pass 18, fail 0` (`duration: 3.48s`). Tutte le 18 verifiche di regressione ed e2e dello Study Hub sono passate.
4. `npx eslint src/core/contracts/visual-explanation.ts src/core/visual-explanation-validator.ts src/agent/tools/visual-explanation.ts components/artifacts/visual-explanation-card.tsx tests/visual-explanation-*.test.*`:
   - **Esito:** `Exit code 0`. 0 warning, 0 errori di lint sui file di competenza del Visual Explanation Engine.
5. `npm run plugins:build-authoring`:
   - **Esito:** `Exit code 0`. Dichiarazioni, 24 pagine markdown e pacchetto zip generati con successo.
6. `git diff --check`:
   - **Esito:** `Exit code 0`. Nessun conflitto, trailing whitespace o problema di formattazione git.
7. `npm run build`:
   - **Esito:** `Exit code 0` (compilazione Next.js 16.4.3 Turbopack completata con successo in 1.99s, TypeScript terminato in 6.7s, generazione di tutte le pagine statiche 10/10 completata).

---

## 8. Verifiche di sicurezza eseguite

1. **Assenza di runtime JS non controllato:** Nessun codice HTML o JavaScript generato dal modello può essere iniettato o eseguito; il renderer SVG opera tramite sanitizzazione XML basata su parser SAX e renderer React dichiarativo.
2. **Reiezione HTML rigorosa:** Payload con `renderer: "html"` falliscono la validazione alla radice (`ALLOWED_RENDERERS = ["svg"]`).
3. **Audit CSS e URL:** L'audit contro escape CSS malevoli (`\72`, `\66ile:`), commenti offuscanti e schemi pericolosi (`javascript:`, `vbscript:`, `data:`, `file:`, `ftp:`) rimane attivo e coperto da 20 test avversari specifici (`Fix G`).
4. **Isolamento multi-chat:** La persistenza e la notifica di aggiornamento degli artefatti rimangono rigidamente isolate per `chatId`.

---

## 9. Debito tecnico non bloccante ed elementi di sistema

1. **Next.js Security Advisory:**
   - Durante il comando `npm run build`, Next.js segnala un avviso relativo a una nota vulnerabilità della versione corrente (`16.4.3`).
   - Come da prescrizione, l'aggiornamento delle dipendenze di Next.js non è stato toccato in questa sessione. Al termine del task viene riportata la proposta formale per l'eventuale esecuzione in worktree separato.
2. **Linting preesistente su endpoint esterni:**
   - `app/api/graph/topics/...` presenta errori preesistenti di restricted imports estranei al Visual Explanation Engine, che sono stati rigorosamente lasciati intatti come da istruzioni.

---

## 10. Conferma di stabilità e feature preservate

- **Renderer SVG Dichiarativo MVP:** Completamente integro e funzionante (supporto per `learnharness.visual.svg.v1` con step, stili, geometrie primitive rettangolari, circolari, ellissi, linee, poligoni e testi).
- **Controlli deterministici:** Pienamente operativi i controlli `play`, `pause`, `reset`, `step-forward`, `step-backward`.
- **Pannello modale:** Apertura espansa, chiusura con tasto Escape, focus trap accessibile e sincronizzazione bidirezionale dello stato attiva.
- **Nessun commit né push eseguito:** Il repository si trova nello stato pulito e verificato, in attesa di validazione dell'orchestratore ChatGPT.
