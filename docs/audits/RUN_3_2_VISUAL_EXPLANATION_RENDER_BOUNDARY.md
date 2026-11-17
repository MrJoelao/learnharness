# RUN 3.2 — Visual Explanation: Render Boundary Hardening

Data: 17 Novembre 2026  
Autore: Gemini 3.8 Flash (Agente Tecnico Singolo)  
Orchestratore / Revisore: ChatGPT  
Repository: `MrJoelao/learnharness`  
Branch: `feat/study-hub`  
Commit di riferimento richiesto: `8d870a2b5af77183651b27277864839945a730ef` (presente in cronologia git; HEAD corrente: `e8069ff42794f3aaed0271dce21f06f55e7013ac`)

---

## 1. Baseline Git e Preflight

- **Branch attivo:** `feat/study-hub`
- **Working Tree all'avvio:** Pulito (`nothing to commit, working tree clean`).
- **Commit di riferimento:** `8d870a2b5af77183651b27277864839945a730ef` presente e verificato nella storia locale (`git log -n 5 --oneline`).
- **Verifica modifiche non autorizzate:** Nessuna modifica preliminare o non tracciata nel working tree.
- **Nessun subagente / delega:** Tutti gli interventi sono stati eseguiti direttamente dall'agente Gemini 3.8 Flash.
- **Commit e Push:** Nessun commit o push è stato eseguito, in conformità al vincolo di attendere esplicita autorizzazione dell'utente.

---

## 2. Inventario Consumatori e Analisi Architetturale (Finding A)

### Ispezione consumatori di `VisualExplanationInstance`
- **Codice di produzione (`components/`, `app/`, `src/`):**
  - Unico chiamante: `VisualExplanationCard` all'interno dello stesso modulo `components/artifacts/visual-explanation-card.tsx:322`.
  - Nessun altro componente di produzione importa direttamente `VisualExplanationInstance`.
- **Test suite (`tests/`):**
  - Chiamanti diretti: `tests/visual-explanation-card.test.tsx`, `tests/visual-explanation-panel.test.tsx`, `tests/visual-explanation-controls.test.tsx`, `tests/visual-explanation-declarative.test.tsx`.
- **Rationale architetturale per il mantenimento dell'export:**
  - `VisualExplanationCard` agisce come adattatore specifico per lo stream di tool-call dell'assistente AI (consuma `VisualExplanationPart`).
  - `VisualExplanationInstance` incapsula l'engine visuale, il gestore di simulazione, l'accessibilità (focus trap, ARIA, Esc), la reattività agli aggiornamenti e l'espansione a pannello modale.
  - Mantenere l'export è necessario per consentire l'ispezione e il test isolato dell'engine visivo senza dover fabbricare payload artificiali di tool invocation streaming (`LhViewPart`).
  - Per eliminare qualsiasi rischio di bypass del validatore, è stata implementata una validazione runtime fail-closed direttamente all'ingresso di `VisualExplanationInstance`.

### Ispezione consumatori di `SvgImage`, `applyStateToSvg`, `applyStepToSvg`, `validateSvgSource`
- `SvgImage`:
  - Utilizzato in produzione da `components/artifacts/visual-card.tsx` e `components/session-overlay.tsx`. Preservato intatto nel repository, ma completamente rimosso da `components/artifacts/visual-explanation-card.tsx`.
- `applyStateToSvg` e `applyStepToSvg`:
  - Preservati ed esportati in `components/artifacts/visual-explanation-card.tsx` poiché testati direttamente dalle suite di sicurezza CSS (`tests/visual-explanation-card.test.tsx` e `tests/visual-explanation-controls.test.tsx`).
- `validateSvgSource`:
  - Preservato in `src/core/visual-explanation-validator.ts` per l'esecuzione della suite di sicurezza avversaria (`tests/visual-explanation-security.test.ts`).

---

## 3. Modifiche Implementate

### Finding A — Eliminazione del Bypass del Validatore e Hardening del Rendering Boundary
1. **Validazione runtime all'ingresso di `VisualExplanationInstance`:**
   - All'ingresso di `VisualExplanationInstance`, viene verificato che `initialArtifact.renderer === "svg"` e che `parseDeclarativeSvg(initialArtifact.source)` restituisca un documento dichiarativo valido non nullo.
   - Se l'artefatto non è conforme allo schema JSON dichiarativo `learnharness.visual.svg.v1`, il componente non monta alcun renderer grafico né l'istanza interna, restituendo immediatamente un alert di errore accessibile (`role="alert"`, `data-testid="visual-explanation-failed"`).
   - Creata la funzione interna `VisualExplanationInstanceInner` per garantire che hook di animazione, timer e observer vengano attivati unicamente per artefatti validati.
2. **Eliminazione completa del fallback a `SvgImage`:**
   - Rimosso l'import `SvgImage` da `components/artifacts/visual-explanation-card.tsx`.
   - Rimossa la computazione di fallback `processedSvgSource`.
   - In `renderVisualContent(expanded: boolean)`, se `declarativeDoc` è assente o nullo, viene renderizzato un alert di errore diagnostico; non esiste alcun percorso di codice che possa montare `SvgImage` o renderizzare SVG XML non conforme.
3. **Hardening degli aggiornamenti in-place via subscriber (`subscribeVisualArtifact`):**
   - Nel gestore di sottoscrizione di `VisualExplanationInstanceInner`, ogni artefatto ricevuto viene validato tramite `validateDeclarativeVisualArtifact(updated)`.
   - Se l'aggiornamento non è valido, viene scartato senza modificare lo stato del componente, impedendo la corruzione dello stato locale o dell'albero visivo.
4. **Invariante 0 iframes:**
   - Verificato che in nessun caso o stato (inline, modale expanded o errore) venga generato o montato alcun elemento `<iframe>`.

### Finding B — Aggiornamento Test Suite e Fixture
1. **Migrazione fixture da SVG XML statico a JSON dichiarativo `learnharness.visual.svg.v1`:**
   - Aggiornato `tests/visual-explanation-panel.test.tsx`:
     - Sostituito `SVG_SOURCE` con `DECLARATIVE_SOURCE` e `MULTI_STEP_SOURCE`.
     - Aggiornate le asserzioni di rendering da `data-testid="visual-explanation-svg-container"` a `data-testid="visual-explanation-declarative-container"`.
     - Aggiornati i test di focus trap, navigazione da tastiera e preservazione dello stato tra inline e panel modal.
   - Aggiornato `tests/visual-explanation-card.test.tsx`:
     - Sostituita la fixture del test panel da SVG statico a `TEST_DECLARATIVE_JSON`.
   - Aggiornato `tests/visual-explanation-controls.test.tsx`:
     - Sostituite le occorrenze di `MOCK_SVG` con `MOCK_DECLARATIVE_JSON` nei test dei pulsanti interattivi e del lifecycle `React.StrictMode`.
2. **Aggiunta di test espliciti di hardening del boundary:**
   - In `tests/visual-explanation-card.test.tsx`:
     - Verifica che `VisualExplanationInstance` rifiuti direttamente raw SVG XML e renderizzi un alert di errore senza montare `SvgImage` o iframe.
     - Verifica che `VisualExplanationInstance` rifiuti JSON malformato renderizzando alert di errore.
     - Verifica che `VisualExplanationInstance` renderizzi `visual-explanation-declarative-container` con 0 iframe in modalità inline ed espansa.
   - In `tests/visual-explanation-panel.test.tsx`:
     - Test specifico che accerta che aggiornamenti in-place contenenti raw SVG XML o JSON malformato vengano scartati dal subscriber, preservando inalterato lo stato della visualizzazione attiva con 0 iframe.

---

## 4. Riepilogo File Modificati

| File | Intervento |
|---|---|
| `components/artifacts/visual-explanation-card.tsx` | Rimossi import `SvgImage`, `validateVisualArtifact` e `isDeclarativeSvg`. Implementata validazione runtime all'ingresso di `VisualExplanationInstance` e separazione in `VisualExplanationInstanceInner`. Rimosso fallback a `SvgImage` e `processedSvgSource` in `renderVisualContent`. Validati gli aggiornamenti dinamici in `subscribeVisualArtifact`. |
| `tests/visual-explanation-card.test.tsx` | Convertita la fixture panel a JSON dichiarativo. Aggiunti 3 test di boundary su `VisualExplanationInstance` (reiezione raw SVG, reiezione JSON malformato, rendering dichiarativo a zero iframe). |
| `tests/visual-explanation-panel.test.tsx` | Convertite tutte le fixture SVG XML statiche in documenti dichiarativi JSON. Aggiornate le asserzioni a `visual-explanation-declarative-container`. Aggiunto test di rifiuto aggiornamenti non conformi in-place. |
| `tests/visual-explanation-controls.test.tsx` | Convertite le fixture da `MOCK_SVG` a `MOCK_DECLARATIVE_JSON` per i test dei bottoni e del ciclo di vita. |

---

## 5. Verifica e Comandi Eseguiti

Tutti i comandi sono stati eseguiti con successo nell'ambiente reale:

1. **Test Suite Visual Explanation:**
   - `NODE_ENV=test npx tsx --test tests/visual-explanation-*.test.*`
   - **Esito:** `tests 109, suites 12, pass 109, fail 0` (`4.65s`).
2. **Regressione Phase 7 (Study Hub Catalog, Workspace & Acceptance):**
   - `NODE_ENV=test npx tsx --test tests/study-hub-phase7-*.test.*`
   - **Esito:** `tests 18, suites 0, pass 18, fail 0` (`3.24s`).
3. **Suite Completa Integrata (Visual Explanation + Phase 7):**
   - `NODE_ENV=test npx tsx --test tests/visual-explanation-*.test.* tests/study-hub-phase7-*.test.*`
   - **Esito:** `tests 127, suites 12, pass 127, fail 0` (`7.23s`).
4. **Typecheck TypeScript:**
   - `npm run typecheck` (`tsc --noEmit`)
   - **Esito:** `Exit code 0` (0 errori di compilazione).
5. **Linting ESLint:**
   - `npx eslint components/artifacts/visual-explanation-card.tsx tests/visual-explanation-card.test.tsx tests/visual-explanation-panel.test.tsx tests/visual-explanation-controls.test.tsx`
   - **Esito:** `Exit code 0` (0 errori, 0 warning).
6. **Git Diff Check:**
   - `git diff --check`
   - **Esito:** `Exit code 0` (nessun whitespace issue o conflitto).
7. **Plugin Authoring Skill Build:**
   - `npm run plugins:build-authoring`
   - **Esito:** `Exit code 0`.
8. **Next.js Production Build:**
   - `npm run build`
   - **Esito:** `Exit code 0` (Tutti i 59 endpoint e pagine compilati e ottimizzati con successo).

---

## 6. Verdetto Finale

**ESITO: PASS**

Tutti gli obiettivi della RUN 3.2 sono stati pienamente soddisfatti:
- Qualsiasi percorso di bypass per sorgenti SVG XML non conformi è stato eliminato.
- `SvgImage` non viene più importato né montato nel componente `visual-explanation-card`.
- La validazione all'ingresso di `VisualExplanationInstance` e nel subscriber `subscribeVisualArtifact` opera rigidamente fail-closed.
- L'invariante di zero `<iframe>` è verificata su tutti gli stati.
- Tutte le fixture dei test sono state convertite al formato JSON `learnharness.visual.svg.v1`.
- Nessuna regressione rilevata nell'intera suite di test.
- Nessun commit o push eseguito, in attesa di istruzioni dell'utente.
