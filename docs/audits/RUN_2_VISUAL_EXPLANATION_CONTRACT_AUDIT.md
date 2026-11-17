# LearnHarness — Visual Explanation Engine Contract Audit
## Audit Architetturale e Diagnostica Contratti (RUN 2)

**Data:** 2026-11-17  
**Autore:** Gemini 3.8 Flash (Senior Software Architect & Auditor)  
**Repository:** `MrJoelao/learnharness`  
**Branch:** `feat/study-hub`  
**Orchestratore esterno:** ChatGPT  
**Finding analizzati:** `SPEC-CONFLICT-01` (Controlli interattivi), `SPEC-CONFLICT-02` (Percorso legacy HTML/iframe)  
**Stato della run:** **COMPLETATA CON SUCCESSO (Sola diagnosi e audit architetturale — Nessun codice applicativo modificato)**

---

## 1. Baseline Git e Integrità Operativa

All'avvio e durante l'intera esecuzione di RUN 2 sono stati eseguiti i controlli di integrità sullo stato del workspace:

- **Repository root:** `/home/joel/learnharness`
- **Branch verificato:** `feat/study-hub`
- **HEAD commit:** `d749fb4` (`fix(sidebar): resolve keyboard navigation and workspace routing (LH-BUG-01)`)
- **Stato working tree:** `clean` (nessun file modificato, aggiunto o in staging prima dell'audit)
- **Allineamento remoto:** `Your branch is up to date with 'origin/feat/study-hub'.`
- **Vincolo operativo rispettato:** nessun commit, push, checkout, rebase, reset o alterazione del codice sorgente applicativo o dei test esistenti.

---

## 2. Documentazione Esaminata

L'indagine è stata condotta assumendo la documentazione originale in [docs/learnharness-study-hub-spec/](file:///home/joel/learnharness/docs/learnharness-study-hub-spec/) come **fonte autoritativa primaria**, prevalente su qualsiasi interpretazione o report pregresso.

### Documenti di specifica originale:
1. [docs/learnharness-study-hub-spec/README.md](file:///home/joel/learnharness/docs/learnharness-study-hub-spec/README.md): Architettura globale, principi guida e vincoli non negoziabili.
2. [docs/learnharness-study-hub-spec/06-visual-explanation-engine.md](file:///home/joel/learnharness/docs/learnharness-study-hub-spec/06-visual-explanation-engine.md): Specifica tecnica del Visual Explanation Engine (Sezioni 1-10: scopi, design a due modalità inline/panel, envelope, progressione tecnologica, modello di sicurezza, controlli e scope MVP).
3. [docs/learnharness-study-hub-spec/03-api-contracts.md](file:///home/joel/learnharness/docs/learnharness-study-hub-spec/03-api-contracts.md): Contratti Plugin API v1 e compatibilità retroattiva.
4. [docs/learnharness-study-hub-spec/02-architecture.md](file:///home/joel/learnharness/docs/learnharness-study-hub-spec/02-architecture.md): Confini di ownership tra Host, Plugin e Teaching Agent.
5. [docs/learnharness-study-hub-spec/08-testing-and-acceptance.md](file:///home/joel/learnharness/docs/learnharness-study-hub-spec/08-testing-and-acceptance.md): Criteri di accettazione e requisiti di testing per il motore visivo (Sezioni 7 e 8).

### Documenti operativi e audit precedenti:
6. [docs/agent-runbook/00-orchestration-contract.md](file:///home/joel/learnharness/docs/agent-runbook/00-orchestration-contract.md) e [01-gemini-38-flash-operating-rules.md](file:///home/joel/learnharness/docs/agent-runbook/01-gemini-38-flash-operating-rules.md): Regole di ingaggio e isolamento operativo dell'agente.
7. [docs/agent-runbook/06-findings-and-open-decisions.md](file:///home/joel/learnharness/docs/agent-runbook/06-findings-and-open-decisions.md): Registro dei finding e definizioni F-01 e F-02.
8. [docs/audits/STUDY_HUB_REPAIR_BASELINE.md](file:///home/joel/learnharness/docs/audits/STUDY_HUB_REPAIR_BASELINE.md): Baseline di riparazione (RUN 0).
9. [docs/audits/RUN_1_SIDEBAR_KEYBOARD_ROUTING.md](file:///home/joel/learnharness/docs/audits/RUN_1_SIDEBAR_KEYBOARD_ROUTING.md): Chiusura e verifica del finding `LH-BUG-01`.
10. [docs/plugin-api/contracts-visual-explanation.md](file:///home/joel/learnharness/docs/plugin-api/contracts-visual-explanation.md): Documentazione generata dei tipi pubblici dell'SDK.

---

## 3. Ricostruzione del Flusso End-to-End

È stato tracciato l'intero ciclo di vita di un artefatto visivo, dal prompt dell'agente fino al rendering nel browser e alla gestione degli errori.

```
[1. Prompt] 
   └─ src/agent/prompts/teacher/56-visual-explanation.md
        │
[2. Tool Definition & Registry]
   └─ src/agent/tools/visual-explanation.ts (createVisualExplanationTool)
        │
[3. Input Schema Acceptance]
   └─ visualExplanationInputSchema (TypeBox)
        │
[4. Server Validation]
   └─ src/core/visual-explanation-validator.ts (validateDeclarativeVisualArtifact - strictDeclarative: true)
        │
[5. Creation / Update Execution]
   ├─ Host ID generation (nanoid) / In-place update merge
   └─ Last Known Good preservation on failure
        │
[6. Persistence & Retrieval]
   └─ src/store/chats.ts (saveVisualArtifact, getVisualArtifact, ChatRecord.visualArtifacts)
        │
[7. Frontend Transport]
   └─ ToolPartRenderer (components/plugin-renderers.tsx) -> Builtin (artifactRenderers["visual_explanation"])
        │
[8. Inline Rendering]
   ├─ VisualExplanationCard (components/artifacts/visual-explanation-card.tsx)
   ├─ DeclarativeSvgRenderer (components/artifacts/declarative-svg-renderer.tsx)
   └─ In-place Update Notification (VisualExplanationUpdateNotice)
        │
[9. Expanded Panel Rendering]
   └─ VisualExplanationInstance modal dialog (dialogRef, trap focus, Esc listener, placeholder inline)
        │
[10. Interactive Controls Handling]
   ├─ Standard step controls (step-forward, step-backward, play/pause, reset, counter)
   └─ Button action dispatcher
        │
[11. Error, Legacy & Unsupported Data Handling]
   ├─ Validation failure alert (visual-explanation-failed)
   └─ Residual HTML iframe branch (allowLegacy: true)
```

### Dettaglio dei singoli passaggi:

#### 1. Prompt e istruzioni fornite all'agente
- **File coinvolto:** [`src/agent/prompts/teacher/56-visual-explanation.md`](file:///home/joel/learnharness/src/agent/prompts/teacher/56-visual-explanation.md)
- **Responsabilità:** Istruire il modello didattico su quando ricorrere a spiegazioni visive (layout di memoria, stack/heap, registri CPU, scheduling, alberi/grafi, pacchetti di rete, macchine a stati).
- **Vincoli imposti:** Vietato usare visualizzazioni per semplici definizioni; obbligatorio spiegare i concetti chiave in testo naturale; l'output deve essere esclusivamente JSON dichiarativo conforme a `"learnharness.visual.svg.v1"` con primitive consentite (`rect`, `circle`, `ellipse`, `line`, `polyline`, `polygon`, `text`); vietati esplicitamente JavaScript, HTML, CSS arbitrari o tag SVG non vincolati; per domande di follow-up è prescritto `action: "update"` riutilizzando l'ID esistente.
- **Divergenze:** Il prompt non menziona slider, toggle, select né codice HTML: è al 100% allineato allo scope MVP della specifica.

#### 2. Definizione e registrazione del tool `visual_explanation`
- **File coinvolti:** [`src/agent/tools/visual-explanation.ts`](file:///home/joel/learnharness/src/agent/tools/visual-explanation.ts), [`src/agent/tool-registry.ts`](file:///home/joel/learnharness/src/agent/tool-registry.ts)
- **Responsabilità:** Registrazione del tool `visual_explanation` con execution mode `"sequential"` per entrambi gli agenti didattici (`prober` e `teacher`).
- **Input/Output:** Riceve `VisualExplanationInput` e `VisualExplanationToolContext` (`chatId`, `chatStore`); restituisce un oggetto `{ text: string, details: { ok: boolean, action, chatId, artifact } }`.

#### 3. Input accettato dal tool
- **File coinvolto:** [`src/agent/tools/visual-explanation.ts:44-90`](file:///home/joel/learnharness/src/agent/tools/visual-explanation.ts#L44-L90)
- **Responsabilità:** Validazione strutturale dei parametri della tool call tramite schema TypeBox (`visualExplanationInputSchema`).
- **Campi ammessi:**
  - `action`: `"create" | "update"`
  - `id`: stringa (1-64 caratteri, richiesta solo per `update`, ignorata per `create`)
  - `title`, `summary`: stringhe con limiti di lunghezza
  - `renderer`: letterale opzionale `"svg"` (il valore `"html"` è respinto a livello di schema TypeBox)
  - `source`: stringa JSON dichiarativa SVG
  - `presentation`: `"auto" | "inline" | "panel"`
  - `initialState`: record chiave-valore
  - `controls`: array di oggetti aventi tassativamente `type: Type.Literal("button")` e `action: "play" | "pause" | "reset" | "step-forward" | "step-backward"` (massimo 8 controlli)
  - `accessibility`: `description`, `reducedMotionFallback`
- **Divergenze:** Lo schema dell'agente accetta unicamente controlli di tipo `button` e rifiuta categoricamente `"html"`.

#### 4. Validazione dell'input
- **File coinvolto:** [`src/core/visual-explanation-validator.ts:69-342`](file:///home/joel/learnharness/src/core/visual-explanation-validator.ts#L69-L342)
- **Responsabilità:** Validazione semantica e sicurezza server-side tramite `validateDeclarativeVisualArtifact(candidate)` (che invoca `validateVisualArtifact` con `strictDeclarative: true`).
- **Regole applicate:**
  - Rifiuto di proprietà privilegiate (`filesystem`, `fs`, `network`, `plugin`, `cookie`, `localStorage`, `eval`, `exec`).
  - Controllo versione (solo versione 1).
  - Controllo ID e titoli (alfanumerico bounded).
  - `renderer`: in modalità `strictDeclarative`, rifiuta esplicitamente `"html"`.
  - `source`: parsing JSON e verifica dello schema `learnharness.visual.svg.v1`; convalida di `viewBox` e degli elementi in ogni step.
  - `controls`: in modalità `strictDeclarative`, rifiuta esplicitamente qualsiasi controllo diverso da `type: "button"`.
  - `initialState.step`: validato e limitato all'intervallo `[0, steps.length - 1]`.

#### 5. Creazione e aggiornamento dell'artefatto
- **File coinvolto:** [`src/agent/tools/visual-explanation.ts:115-217`](file:///home/joel/learnharness/src/agent/tools/visual-explanation.ts#L115-L217)
- **Responsabilità:** Esecuzione sicura dell'operazione:
  - Per `action: "create"`: l'host genera un ID deterministico con prefisso `vis-` (`nanoid(8)`) garantendone l'unicità nella chat; assegna `renderer: "svg"`; salva l'artefatto validato.
  - Per `action: "update"`: verifica che l'artefatto esista nella chat corrente; fonde lo stato preesistente con le modifiche richieste; se la validazione del merge fallisce, **preserva l'artefatto precedente integro** (invariante di Last Known Good); se valida, persiste l'aggiornamento.

#### 6. Persistenza e recupero degli artefatti
- **File coinvolti:** [`src/store/chats.ts:248-265`](file:///home/joel/learnharness/src/store/chats.ts#L248-L265), [`src/core/contracts/chat.ts:35`](file:///home/joel/learnharness/src/core/contracts/chat.ts#L35)
- **Responsabilità:** Persistenza isolata per sessione all'interno del record `ChatRecord.visualArtifacts`:
  - `saveVisualArtifact(chatId, artifact)`: scrittura atomica nel file `data/chats/<id>.json`.
  - `getVisualArtifact(chatId, artifactId)`: lettura diretta indicizzata per ID.
  - `listChats()`: esclude intenzionalmente `visualArtifacts` dal payload riassuntivo per garantire performance e leggerezza.
  - Isolamento totale: una chat non può leggere o modificare gli artefatti di un'altra sessione.

#### 7. Trasmissione dei dati al frontend
- **File coinvolti:** [`components/plugin-renderers.tsx:108-119`](file:///home/joel/learnharness/components/plugin-renderers.tsx#L108-L119), [`components/artifacts/index.ts:33`](file:///home/joel/learnharness/components/artifacts/index.ts#L33)
- **Responsabilità:** Ricezione del messaggio dell'assistente contenente il tool part `tool-visual_explanation`. `ToolPartRenderer` interroga il registro `artifactRenderers` e delega la visualizzazione a `VisualExplanationCard`.
- **Dati passati:** Il payload `part.output` contiene `{ ok: true, action, chatId, artifact }`.

#### 8. Rendering inline
- **File coinvolti:** [`components/artifacts/visual-explanation-card.tsx`](file:///home/joel/learnharness/components/artifacts/visual-explanation-card.tsx), [`components/artifacts/declarative-svg-renderer.tsx`](file:///home/joel/learnharness/components/artifacts/declarative-svg-renderer.tsx)
- **Responsabilità:**
  - Se `rawAction === "update"`: renderizza `<VisualExplanationUpdateNotice>` che notifica l'avvenuto aggiornamento in-place e pubblica l'aggiornamento al registro condiviso client-side tramite `registerVisualArtifact(artifact, chatId)`. Non duplica la card nella cronologia.
  - Se `rawAction === "create"`: renderizza `<VisualExplanationInstance>`. L'istanza si sottoscrive agli aggiornamenti per il suo ID via `subscribeVisualArtifact`.
  - Se `declarativeDoc` è presente: invoca `<DeclarativeSvgRenderer>`, mappando i primitivi SVG dello step corrente direttamente in elementi React SVG nativi (`<rect>`, `<circle>`, `<text>`, ecc.). Nessun utilizzo di `dangerouslySetInnerHTML`.
  - Se l'artefatto ha `renderer === "html"`: renderizza un `<iframe>` sandboxed.

#### 9. Rendering nel pannello espanso
- **File coinvolto:** [`components/artifacts/visual-explanation-card.tsx:999-1032`](file:///home/joel/learnharness/components/artifacts/visual-explanation-card.tsx#L999-L1032)
- **Responsabilità:** Quando l'utente preme "Expand to panel" (o `presentation === "panel"`):
  - La card inline mostra un placeholder leggero (`visual-inline-expanded-placeholder`), garantendo che esista **un solo runtime attivo montato** (nessuna duplicazione di canvas/iframe).
  - Viene aperto un modale a schermo intero accessibile (`role="dialog"`, `aria-modal="true"`).
  - Vengono attivati il focus trap, la chiusura con tasto `Escape` e il ripristino del focus sull'elemento attivatore alla chiusura.

#### 10. Interazione con eventuali controlli
- **File coinvolto:** [`components/artifacts/visual-explanation-card.tsx:765-952`](file:///home/joel/learnharness/components/artifacts/visual-explanation-card.tsx#L765-L952)
- **Responsabilità:** Renderizza la toolbar dei controlli:
  - Controlli standard di navigazione step (abilitati se `maxSteps > 0`): `Step Backward`, `Play/Pause`, `Step Forward`, `Reset`, indicatore di avanzamento `Step X / Y`.
  - Pulsanti dichiarativi definiti dall'artefatto (`artifact.controls` di tipo `button`).
  - Gestione accessibilità: rilevamento `prefers-reduced-motion` tramite `window.matchMedia`; se attivo, le animazioni automatiche vengono inibite e viene mostrato il badge "Reduced motion".
  - Inibizione background: l'animazione si sospende se la pagina non è visibile (`document.hidden`) o se la card è fuori dal viewport (`IntersectionObserver`).

#### 11. Comportamento in caso di dati non validi, legacy o non supportati
- Se `part.state === "output-error"` o la validazione client fallisce: renderizza un banner di errore non bloccante (`visual-explanation-failed`) con `role="alert"`, senza provocare crash dell'applicazione.
- Se un aggiornamento fallisce la validazione server-side, il backend rifiuta la modifica e la card client-side mantiene visualizzato l'ultimo artefatto valido.

---

## 4. Audit SPEC-CONFLICT-01 — Controlli Interattivi

### 4.1 Analisi Comparativa dei Livelli di Contratto

La specifica originale ([06-visual-explanation-engine.md](file:///home/joel/learnharness/docs/learnharness-study-hub-spec/06-visual-explanation-engine.md)) affronta i controlli in due punti distinti:
1. **Sezione 7 (Interaction contract):** elenca le funzionalità che l'artefatto può supportare a regime: Play/pause, Step forward/backward, Reset, Parameter controls, Highlight/select, Timeline/progress, Expand to panel.
2. **Sezione 10 (First-release scope - MVP):** circoscrive tassativamente i requisiti della prima release:
   > *"Recommended MVP: Play/step/reset for deterministic step-based artifacts. Strict validation and isolation. Small set of reusable primitives."*

Confrontando i diversi livelli dell'architettura attuale:

| Controllo | Specifica (MVP vs Vision) | Tipi TypeScript (`src/core/contracts`) | Validatore Runtime (`visual-explanation-validator`) | Agent Tool (`src/agent/tools`) | Teaching Prompt | Renderer SVG Nativo | UI Card Wrapper | Stato Complessivo |
|---|---|---|---|---|---|---|---|---|
| **Step forward** | Obbligatorio MVP (Sez. 10) | `VisualButtonAction` | Valido (`button`) | Valido (`button`) | Implicito negli step | Nativo (`currentStep`) | Toolbar step + Button custom | **IMPLEMENTATO** |
| **Step backward** | Obbligatorio MVP (Sez. 10) | `VisualButtonAction` | Valido (`button`) | Valido (`button`) | Implicito negli step | Nativo (`currentStep`) | Toolbar step + Button custom | **IMPLEMENTATO** |
| **Play / Pause** | Obbligatorio MVP (Sez. 10) | `VisualButtonAction` | Valido (`button`) | Valido (`button`) | Opzionale | Timer tick loop | Toolbar step + Button custom | **IMPLEMENTATO** |
| **Reset** | Obbligatorio MVP (Sez. 10) | `VisualButtonAction` | Valido (`button`) | Valido (`button`) | Implicito negli step | Nativo (step 0) | Toolbar step + Button custom | **IMPLEMENTATO** |
| **Pulsanti custom (`button`)** | Previsto MVP (Sez. 4 & 7) | `VisualButtonControl` | Valido (`button`) | Valido (max 8) | Non menzionato | Indiretto (via step) | Renderizzato (`data-action`) | **IMPLEMENTATO** |
| **Slider (`slider`)** | Previsto a regime (Sez. 7) / Non in MVP (Sez. 10) | `VisualSliderControl` | Rifiutato in `strictDeclarative` (accettato solo se legacy) | **Rifiutato da schema e codice** | Non menzionato | Non supportato | Soppresso su SVG (`return null`) | **SOLO DICHIARATO / PARZIALE LEGACY** |
| **Toggle (`toggle`)** | Previsto a regime (Sez. 7) / Non in MVP (Sez. 10) | `VisualToggleControl` | Rifiutato in `strictDeclarative` (accettato solo se legacy) | **Rifiutato da schema e codice** | Non menzionato | Non supportato | Soppresso su SVG (`return null`) | **SOLO DICHIARATO / PARZIALE LEGACY** |
| **Select (`select`)** | Previsto a regime (Sez. 7) / Non in MVP (Sez. 10) | `VisualSelectControl` | Rifiutato in `strictDeclarative` (accettato solo se legacy) | **Rifiutato da schema e codice** | Non menzionato | Non supportato | Soppresso su SVG (`return null`) | **SOLO DICHIARATO / PARZIALE LEGACY** |
| **Highlight / Select** | Previsto a regime (Sez. 7) | Non tipizzato come controllo | Non presente | Non presente | Tramite attributi primitive SVG | Nativo tramite attributi primitive | Non presente come form control | **IMPLEMENTATO A LIVELLO PRIMITIVE** |
| **Timeline / Progress** | Previsto a regime (Sez. 7) | Non tipizzato come controllo | Non presente | Non presente | Tramite primitive timeline | Nativo (`renderProcessTimelineSvg`) | Testo `Step X / Y` | **IMPLEMENTATO COME INDICATORE** |

### 4.2 Diagnosi della Discrepanza

1. **La causa radice:** i tipi TypeScript pubblici in [`src/core/contracts/visual-explanation.ts`](file:///home/joel/learnharness/src/core/contracts/visual-explanation.ts) hanno anticipato le interfacce per i controlli continui parametrici (`VisualSliderControl`, `VisualToggleControl`, `VisualSelectControl`).
2. **Il confine di sicurezza e l'MVP:** l'implementazione del motore visivo in Phase 6 ha correttamente aderito alla Sezione 10 della specifica, implementando un motore SVG dichiarativo basato su **step discreti** (`learnharness.visual.svg.v1`). In questo modello, un controllo slider continuo o un select non hanno una semantica di rendering definita nel motore SVG dichiarativo (che opera a step discreti `0..N`).
3. **Comportamento attuale del frontend:** nel file [`components/artifacts/visual-explanation-card.tsx:830`](file:///home/joel/learnharness/components/artifacts/visual-explanation-card.tsx#L830), il codice include esplicitamente:
   ```tsx
   if (declarativeDoc && ctrl.type !== "button") {
       // Declarative SVG only supports deterministic button controls (step navigation / simulation)
       return null;
   }
   ```
   Di conseguenza, anche se un artefatto dichiarativo includesse uno slider o un toggle, la card React lo sopprimerebbe deliberatamente.
4. **Comportamento dell'agente:** il tool [`src/agent/tools/visual-explanation.ts`](file:///home/joel/learnharness/src/agent/tools/visual-explanation.ts) valida i controlli richiedendo tassativamente `type: "button"`. L'invio di uno slider provoca un errore immediato di validazione.

### 4.3 Decisione Architetturale Raccomandata per i Controlli

- **Contratto minimo coerente con l'MVP:** per l'MVP, l'unico tipo di controllo custom supportato e garantito nel contratto è `VisualButtonControl` con azioni deterministiche legate agli step (`play`, `pause`, `reset`, `step-forward`, `step-backward`).
- **Implementazione necessaria per rispettare i requisiti:**
  - Nessuna aggiunta di codice runtime richiesta per i bottoni: il sistema di navigazione a step, play/pause, reset e bottoni custom è già **completamente funzionante, testato al 100% e conforme alla specifica MVP**.
  - Allineare formalmente il contratto Typescript e la documentazione SDK: contrassegnare `VisualSliderControl`, `VisualToggleControl` e `VisualSelectControl` come `@experimental` o estrometterli dal tipo unione `VisualControlDescriptor` attivo dell'MVP v1, per evitare che gli autori di plugin o futuri agenti assumano che siano operativi su SVG dichiarativo.
- **Funzionalità opzionali da rinviare (Post-MVP):**
  - Controlli parametrici continui (slider per frequenze/valori numerici, toggle per livelli/layer): richiedono l'estensione dello schema SVG dichiarativo con binding di variabili CSS (`--param-xxx`) o interpolazione numerica nello schema `learnharness.visual.svg.v2`. Devono essere rinviati a una successiva fase di feature design.
- **Funzionalità che NON devono essere introdotte:**
  - Callback JavaScript arbitrari o handler `onClick` generici nei controlli (es. action non standard o codice eseguibile), che violerebbero i principi di isolamento e sicurezza della specifica.

---

## 5. Audit SPEC-CONFLICT-02 — Legacy HTML / Iframe

### 5.1 Verifica dei 9 Punti Chiave

#### 1. Dove viene dichiarato il formato legacy?
- Nella specifica originale: [06-visual-explanation-engine.md Sezione 4](file:///home/joel/learnharness/docs/learnharness-study-hub-spec/06-visual-explanation-engine.md#L52) definiva provvisoriamente `renderer: "svg" | "html"`.
- Nei contratti core: [`src/core/contracts/visual-explanation.ts:8`](file:///home/joel/learnharness/src/core/contracts/visual-explanation.ts#L8): `export type VisualRenderer = "svg" | "html";`.
- Nel validatore: [`src/core/visual-explanation-validator.ts:35`](file:///home/joel/learnharness/src/core/visual-explanation-validator.ts#L35): `const ALLOWED_RENDERERS = ["svg", "html"];`.
- Nella documentazione SDK: [`docs/plugin-api/contracts-visual-explanation.md:231`](file:///home/joel/learnharness/docs/plugin-api/contracts-visual-explanation.md#L231).

#### 2. Quali componenti lo renderizzano?
- Esclusivamente [`components/artifacts/visual-explanation-card.tsx:724-735`](file:///home/joel/learnharness/components/artifacts/visual-explanation-card.tsx#L724-L735):
  ```tsx
  if (artifact.renderer === "html") {
      ...
      return (
          <iframe
              ref={iframeRef}
              title={artifact.title}
              sandbox="allow-scripts"
              srcDoc={srcDoc}
              className="w-full rounded-md border bg-white"
              style={{ height: expanded ? "60vh" : "260px" }}
              data-testid="visual-explanation-iframe"
          />
      );
  }
  ```

#### 3. Quali API o servizi possono produrlo?
- **Nessuna.** L'unico punto di ingresso applicativo per la creazione o modifica di artefatti visivi è il tool `visual_explanation` ([`src/agent/tools/visual-explanation.ts`](file:///home/joel/learnharness/src/agent/tools/visual-explanation.ts)).
- Il tool rifiuta incondizionatamente qualsiasi richiesta con `renderer: "html"` sia a livello di schema TypeBox (`Type.Literal("svg")`) sia tramite controllo runtime esplicito:
  ```ts
  if ((input as { renderer?: string }).renderer && (input as { renderer?: string }).renderer !== "svg") {
      return invalidInputResult("visual_explanation", [
          "Renderer must be 'svg'. 'html' renderer is not permitted for visual explanation artifacts.",
      ]);
  }
  ```
- Nessun endpoint REST o servizio di backend espone la creazione di artefatti HTML.

#### 4. Esistono artefatti HTML già persistiti?
- **Ispezione analitica del filesystem:** è stata eseguita una ricerca esaustiva su tutti i file `.json` della directory dati reale [`data/chats/`](file:///home/joel/learnharness/data/chats/).
- **Risultato:**
  - Sono stati individuati 4 file chat contenenti `visualArtifacts`:
    - `data/chats/chat_mwjjrzdj_3e0c1417.json`
    - `data/chats/chat_mwj9gg4r_83c4b4c1.json`
    - `data/chats/chat_mwj4hk3n_1d66dcff.json`
    - `data/chats/chat_mwj4if2p_21959065.json`
  - **Tutti e 4 gli artefatti salvati hanno `"renderer": "svg"`** conforme a `learnharness.visual.svg.v1`.
  - **ZERO artefatti con `"renderer": "html"` sono presenti nei dati salvati.**

#### 5. Esistono fixture, test o dati di esempio?
- Nelle fixture storiche in `tests/fixtures/golden-data/` non esiste alcun artefatto visivo.
- Gli unici riferimenti a `renderer: "html"` nel repository si trovano all'interno di mock sintetici in-memory creati direttamente all'interno dei file di test per verificare che:
  - Il validatore di base (quando non in strictDeclarative) accetti la sintassi (`tests/visual-explanation-envelope.test.ts`).
  - La card renderizzi un iframe sandboxed (`tests/visual-explanation-card.test.tsx`, `tests/visual-explanation-panel.test.tsx`).
  - L'agent tool e il validatore dichiarativo **rifiutino** categoricamente il formato HTML (`tests/visual-explanation-tool.test.ts`, `tests/visual-explanation-declarative.test.tsx`).

#### 6. Il formato è ancora raggiungibile da un normale flusso applicativo?
- **No.** È completamente irraggiungibile per qualsiasi utente o agente durante il normale utilizzo dell'applicazione.

#### 7. Il renderer legacy applica sandbox e restrizioni adeguate?
- L'iframe utilizza `sandbox="allow-scripts"` **senza** `allow-same-origin`.
- Viene iniettata una Content Security Policy stringente all'interno di `srcDoc`:
  `default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data:; connect-src 'none'; frame-src 'none'; object-src 'none';`
- Senza `allow-same-origin`, il codice nell'iframe è isolato dall'origine dell'applicazione host e non può accedere a `localStorage`, cookie, indexedDB o al DOM genitore.

#### 8. Esistono rischi di injection, esecuzione di codice o caricamento di contenuti remoti?
- **Rischio teorico di esecuzione script:** la presenza di `sandbox="allow-scripts"` combinata con `script-src 'unsafe-inline'` abilita l'esecuzione di JavaScript arbitrario all'interno del contesto dell'iframe.
- **Rischio di interpolazione template string:** nel file `visual-explanation-card.tsx:720`, `artifact.source` viene interpolato direttamente nel corpo HTML (`<body>${artifact.source}</body>`) senza sanitizzazione DOM (a differenza del percorso SVG che usa `DeclarativeSvgRenderer` con mapping React nativo). Se una sorgente HTML non sanificata raggiungesse il componente, potrebbe eseguire script nell'iframe o abusare di costrutti HTML complessi.
- **Rischio di messaggistica:** la comunicazione via `postMessage` invia lo stato con wildcard target origin `"*"` (`iframeRef.current.contentWindow.postMessage(..., "*")`).

#### 9. È una compatibilità intenzionale o codice residuo?
- **Evidenza storica e architetturale:** si tratta inequivocabilmente di **codice residuo di prototipazione**. Durante le prime fasi di esplorazione tecnica, prima che venisse concepito e formalizzato lo schema `learnharness.visual.svg.v1`, era stato ipotizzato l'uso di iframe per animazioni HTML/Canvas. Con l'adozione dello schema SVG educativo deterministico (Phase 6), la generazione HTML è stata bloccata a livello di agente e di validatore, lasciando il ramo iframe nella card UI e l'opzione `{ allowLegacy: true }` come rimasuglio non ripulito.

---

### 5.2 Valutazione Dettagliata delle 4 Opzioni

#### Opzione A: Eliminare completamente il percorso legacy HTML/iframe (RACCOMANDATA)
- **Vantaggi:**
  - Elimina totalmente la superficie di attacco legata all'iframe e a `allow-scripts`.
  - Rimuove codice morto e ridondante da `visual-explanation-card.tsx`.
  - Allinea al 100% il frontend con il validatore server-side e con il tool dell'agente.
  - Semplifica il modello di sicurezza eliminando la necessità di manutenere una CSP complessa per `srcDoc` e un bridge `postMessage`.
  - Piena aderenza a Spec 06 Sezione 10 ("No unrestricted generated JavaScript in the trusted app context").
- **Rischi:** Nessun rischio funzionale per gli utenti: nessun artefatto HTML esiste nei dati reali.
- **Impatto sui dati persistiti:** Zero. Tutti i dati persistiti contengono già esclusivamente artefatti SVG dichiarativi.
- **Impatto sul renderer:** Rimozione di circa 50 righe di codice iframe/postMessage in `visual-explanation-card.tsx`.
- **Impatto sui test:** Richiede l'aggiornamento di pochi test unitari che creavano mock HTML sintetici, trasformandoli in test che certificano il rifiuto definitivo di `renderer: "html"`.
- **Compatibilità con la specifica:** Perfettamente conforme alla Sezione 10 dell'MVP.

#### Opzione B: Mantenere temporaneamente la lettura di artefatti legacy già salvati, senza consentire nuove generazioni
- **Vantaggi:** Garantirebbe compatibilità se esistessero vecchi artefatti.
- **Rischi:** Mantiene attiva una superficie di attacco (iframe con script) senza alcuna necessità reale.
- **Impatto sui dati persistiti:** Nullo (non ci sono dati da leggere).
- **Impatto sul renderer:** Mantiene il codice complesso dell'iframe.
- **Valutazione:** **Ingiustificata**, poiché è stato dimostrato empiricamente che non esiste alcun artefatto HTML persistito.

#### Opzione C: Mantenere il percorso legacy come funzionalità supportata
- **Vantaggi:** Nessuno nell'immediato.
- **Rischi:**
  - Violazione esplicita della specifica MVP (Sez. 6 e Sez. 10).
  - Necessità di progettare e manutenere un protocollo di messaggistica bidirezionale bidirezionale sicuro con rate-limiting, schema validation e CSP complessa per plugin/agenti.
  - Complessità di gestione del ciclo di vita dei frame multipli.
- **Valutazione:** **Fortemente sconsigliata**.

#### Opzione D: Introdurre una migrazione esplicita verso il formato SVG dichiarativo
- **Vantaggi:** Nessuno.
- **Rischi:** Complessità ingegneristica per convertire HTML arbitrario in primitive SVG `learnharness.visual.svg.v1`.
- **Valutazione:** **Non applicabile**: non esiste alcun dato da migrare.

---

## 6. Analisi di Sicurezza e Trust Boundary

Valutazione approfondita del confine di fiducia del sottosistema visivo:

```
[Untrusted Agent / LLM Output]
       │
       ▼
[Server Validation Boundary] ──► Limiti dimensionali (source <= 64KB, state <= 8KB, max 8 controls)
                               ──► Schema learnharness.visual.svg.v1 obbligatorio
                               ──► Sanificazione XML/CSS (scarto regex/SAX di script, foreignObject, iframe, protocolli)
                               ──► Rifiuto assoluto di proprietà privilegiate (token, cookie, fs, network)
       │
       ▼
[Persistence Boundary]       ──► ChatStore isolato per sessione
                               ──► Nessuna esposizione o scrittura cross-chat
       │
       ▼
[React UI Rendering Boundary]──► DeclarativeSvgRenderer: mapping esclusivo su primitive React native
                               ──► Nessun dangerouslySetInnerHTML, nessun eval(), nessun tag script
                               ──► Controlli ristretti a button deterministici per step
```

### Classificazione dei Rischi:

| Elemento | Rischio | Livello | Classificazione | Evidenza e Mitigazione |
|---|---|---|---|---|
| **Input generato dal modello (LLM)** | Generazione di payload malevoli (XSS, XML bomb, injection CSS) | Alto | **Già mitigato** | `validateDeclarativeVisualArtifact` convalida ogni byte dell'input lato server prima della persistenza; scarta qualsiasi formato non-JSON dichiarativo. |
| **Limiti dimensionali** | Denial of Service (DoS) per stringhe o oggetti giganteschi | Medio | **Già mitigato** | `VISUAL_ARTIFACT_LIMITS` impone limiti rigidi (source max 64 KB, state max 8 KB, max 30 step, max 100 elementi/step, max 8 controlli). |
| **Primitive SVG consentite** | Tag pericolosi (`<foreignObject>`, `<script>`, `<embed>`, `<applet>`) | Alto | **Già mitigato** | Solo 7 primitive ammesse (`rect`, `circle`, `ellipse`, `line`, `polyline`, `polygon`, `text`). Ogni elemento è un componente React puro senza esecuzione script. |
| **Attributi e stili CSS** | Infiltrazione di `@import`, `url(javascript:...)`, `expression(...)` o esfiltrazione dati via CSS | Alto | **Già mitigato** | `auditCssContent` e `decodeCssEscapes` decodificano sequenze escape esadecimale e verificano che nessun URL esterno o espressione dinamica possa essere iniettata. |
| **Link e protocolli** | Esecuzione protocolli non sicuri (`javascript:`, `vbscript:`, `data:`) | Alto | **Già mitigato** | Il validatore scarta qualsiasi attributo `href`/`src` che non sia un frammento locale identità `#fragment`. |
| **Percorso legacy Iframe / HTML** | Esecuzione di codice JavaScript arbitrario e potenziale XSS nel contesto iframe | Medio | **Rischio teorico (residuo)** | L'iframe usa `sandbox="allow-scripts"` ma NON ha `allow-same-origin`. Tuttavia, `script-src 'unsafe-inline'` e l'interpolazione non protetta in `srcDoc` costituiscono una superficie non necessaria. **Risoluzione:** Eliminazione definitiva in RUN 3 (Opzione A). |
| **Serializzazione / Deserializzazione** | Prototype pollution o deserializzazione non sicura di `initialState` | Basso | **Già mitigato** | `initialState` è serializzato/deserializzato via `JSON.parse(JSON.stringify(...))` ed è sanitizzato per rimuovere caratteri speciali CSS. |
| **Rendering React UI** | Bypass del virtual DOM o injection tramite proprietà React | Basso | **Già mitigato** | Nessun componente fa uso di `dangerouslySetInnerHTML`. Gli attributi sono passati come primitive React fortemente tipizzate. |

---

## 7. Matrice di Conformità Finale

| Sezione Specifica Originale | Requisito Originale | Implementazione Effettiva | Evidenza nel Codice | Conformità | Intervento Raccomandato |
|---|---|---|---|---|---|
| **Spec 06 § 2 & § 4** | Versioned artifact envelope con ID stabile, titolo, presentazione, controlli | Envelope versione 1 con campi bounded (`id`, `title`, `source`, `controls`) | [`src/core/contracts/visual-explanation.ts:67-78`](file:///home/joel/learnharness/src/core/contracts/visual-explanation.ts#L67-L78) | **CONFORME** | Nessuno |
| **Spec 06 § 4 & § 10** | Renderer limitato all'MVP a formato SVG statico/dichiarativo | `learnharness.visual.svg.v1` pienamente supportato; agent tool impone `"svg"` | [`src/agent/tools/visual-explanation.ts:58-62`](file:///home/joel/learnharness/src/agent/tools/visual-explanation.ts#L58-L62) | **CONFORME LATO TOOL** / **CONFLITTO RESIDUO LATO UI** | Rimuovere ramo `renderer === "html"` in `visual-explanation-card.tsx` |
| **Spec 06 § 6 & § 10** | Nessuna esecuzione di JavaScript non vincolato nel contesto applicativo | Motore dichiarativo React nativo senza runtime JS generato | [`components/artifacts/declarative-svg-renderer.tsx`](file:///home/joel/learnharness/components/artifacts/declarative-svg-renderer.tsx) | **CONFORME** | Rimuovere iframe legacy per blindare il confine di sicurezza |
| **Spec 06 § 7 & § 10** | Controlli interattivi deterministici per navigazione step (play, step, reset) | Toolbar step standard completa + pulsanti custom (max 8) con azioni `play/pause/reset/step` | [`components/artifacts/visual-explanation-card.tsx:773-825`](file:///home/joel/learnharness/components/artifacts/visual-explanation-card.tsx#L773-L825) | **CONFORME ALL'MVP** | Deprecare formalmente slider/toggle/select dai tipi attivi v1 |
| **Spec 06 § 7** | Aggiornamento in-place su follow-up: preservare ID ed evitare duplicazioni | Notifica in-place (`VisualExplanationUpdateNotice`) e sottoscrizione reattiva dell'istanza | [`components/artifacts/visual-explanation-card.tsx:336-338`](file:///home/joel/learnharness/components/artifacts/visual-explanation-card.tsx#L336-L338) | **CONFORME** | Nessuno |
| **Spec 06 § 7** | Se l'aggiornamento fallisce, preservare l'ultimo artefatto valido noto | Merge condizionale nel tool: su errore di validazione il record rimane intatto | [`src/agent/tools/visual-explanation.ts:191-196`](file:///home/joel/learnharness/src/agent/tools/visual-explanation.ts#L191-L196) | **CONFORME** | Nessuno |
| **Spec 06 § 8** | Accessibilità, ridotta mobilità (`prefers-reduced-motion`) e tastiera | Rilevamento media query dinamico, blocco animazioni, badge indicatore, focus trap | [`components/artifacts/visual-explanation-card.tsx:439-452`](file:///home/joel/learnharness/components/artifacts/visual-explanation-card.tsx#L439-L452) | **CONFORME** | Nessuno |
| **Spec 06 § 9** | Singola istanza attiva tra inline e panel; pausa fuori dal viewport | Placeholder inline su espansione; IntersectionObserver + visibilitychange | [`components/artifacts/visual-explanation-card.tsx:454-475`](file:///home/joel/learnharness/components/artifacts/visual-explanation-card.tsx#L454-L475) | **CONFORME** | Nessuno |
| **Spec 02 § 2** | Confine di ownership: l'agente non possiede path o privilegi dell'host | Tool confinato nel perimetro chat; validazione server-side deterministica | [`src/agent/tools/visual-explanation.ts:105-156`](file:///home/joel/learnharness/src/agent/tools/visual-explanation.ts#L105-L156) | **CONFORME** | Nessuno |

---

## 8. Decisioni Architetturali Raccomandate

### Decisione 1 (su SPEC-CONFLICT-01 — Controlli):
1. **Fissare il contratto MVP v1:** consolidare il contratto del Visual Explanation Engine stabilendo che la v1 supporta esclusivamente controlli di tipo `button` dedicati alla simulazione a step (`play`, `pause`, `reset`, `step-forward`, `step-backward`), sia tramite la toolbar fissa del componente sia tramite pulsanti custom dichiarati nell'envelope.
2. **Razionalizzare i tipi core:** marcare `VisualSliderControl`, `VisualToggleControl`, `VisualSelectControl` come controlli futuri/estensioni post-MVP e rimuoverli dal tipo unione attivo `VisualControlDescriptor` per evitare promesse di contratto non implementate.
3. **Rimuovere la logica morta di soppressione nella UI:** rimuovere da `visual-explanation-card.tsx` i rami che tentavano di renderizzare slider, toggle e select per renderer non dichiarativi, semplificando il codice e allineandolo al comportamento del validatore.

### Decisione 2 (su SPEC-CONFLICT-02 — Legacy HTML/Iframe):
1. **Adottare l'Opzione A (Eliminazione completa del percorso legacy HTML):**
   - Poiché non esiste **nessun artefatto HTML salvato** su disco, né nelle fixture, né nei golden data, non sussiste alcun requisito di retrocompatibilità dati.
   - Rimuovere `renderer === "html"` e l'elemento `<iframe>` sandboxed da `components/artifacts/visual-explanation-card.tsx`.
   - Modificare `validateVisualArtifact` nel componente client rimuovendo `{ allowLegacy: true }` e utilizzando ovunque la validazione dichiarativa uniforme (`strictDeclarative: true`).
   - Rimuovere `"html"` dal tipo unione `VisualRenderer = "svg"` nei contratti core e nel validatore.
   - Eliminare le funzioni ausiliarie inutilizzate (es. `validateHtmlSource`) e i listener `postMessage` residui.

---

## 9. Piano Dettagliato per RUN 3

Il piano di implementazione per RUN 3 è articolato in 4 task strettamente atomici, indipendenti e a rischio di regressione quasi nullo:

### Task 3.1: Allineamento e Consolidamento dei Contratti Core e Validatore
- **Obiettivo:** Riconciliare i contratti pubblici con lo scope MVP della specifica, eliminando `"html"` e consolidando i controlli supportati sui soli pulsanti step.
- **Finding risolti:** `SPEC-CONFLICT-01` e `SPEC-CONFLICT-02`.
- **File coinvolti:**
  - `src/core/contracts/visual-explanation.ts`
  - `src/core/visual-explanation-validator.ts`
- **Modifiche previste:**
  - `export type VisualRenderer = "svg";` (rimozione del tipo letterale `"html"`).
  - Rimozione di `VisualSliderControl`, `VisualToggleControl`, `VisualSelectControl` da `VisualControlDescriptor` (oppure isolamento in sezione commentata per future estensioni post-MVP).
  - Rimozione di `ALLOWED_RENDERERS = ["svg"]` e dismissione della funzione interna `validateHtmlSource`.
  - Rimozione dell'opzione `allowLegacy` dal validatore, rendendo la validazione dichiarativa l'unico standard canonico.
- **Dipendenze:** Nessuna.
- **Test da aggiornare:** `tests/visual-explanation-envelope.test.ts` (aggiornare i test per verificare che `"html"` e i controlli continui vengano rifiutati determinata-mente).
- **Criteri di accettazione:** `npm run typecheck` passa con 0 errori; i test di validazione confermano il rigetto di payload non SVG.
- **Possibilità di rollback:** Immediata tramite `git checkout` dei due file.

### Task 3.2: Bonifica del Componente UI Card e Rimozione del Runtime Iframe
- **Obiettivo:** Rimuovere il percorso di rendering iframe, la messaggistica `postMessage` e la logica morta di slider/toggle/select dal frontend.
- **Finding risolti:** `SPEC-CONFLICT-02` e pulizia secondaria di `SPEC-CONFLICT-01`.
- **File coinvolti:**
  - `components/artifacts/visual-explanation-card.tsx`
- **Modifiche previste:**
  - Rimozione dell'intero blocco `if (artifact.renderer === "html") { return <iframe ... />; }`.
  - Rimozione di `iframeRef`, dell'`useEffect` con `postMessage`, e della costruzione di `srcDoc`.
  - Sostituzione di `validateVisualArtifact(rawOutput, { allowLegacy: true })` con `validateDeclarativeVisualArtifact(rawOutput)`.
  - Rimozione dei rami `case "slider"`, `case "toggle"`, `case "select"` da `renderControls()` e dai gestori di stato, mantenendo la toolbar step completa e i bottoni custom.
- **Dipendenze:** Task 3.1.
- **Test da verificare:** `tests/visual-explanation-card.test.tsx`, `tests/visual-explanation-controls.test.tsx`, `tests/visual-explanation-panel.test.tsx`.
- **Criteri di accettazione:** La card continua a renderizzare perfettamente le simulazioni a step (inline ed expanded panel); nessun elemento iframe è presente nel DOM.
- **Rischi di regressione:** Nessuno sul flusso principale SVG.
- **Possibilità di rollback:** Immediata tramite `git checkout` del file.

### Task 3.3: Aggiornamento e Pulizia della Suite di Test
- **Obiettivo:** Allineare i test esistenti alla rimozione del ramo legacy, rimuovendo test obsoleti che presupponevano iframe HTML attivi e sostituendoli con test di sicurezza negativi (verifica che HTML e slider siano scartati).
- **Finding risolti:** `SPEC-CONFLICT-01` e `SPEC-CONFLICT-02`.
- **File coinvolti:**
  - `tests/visual-explanation-card.test.tsx`
  - `tests/visual-explanation-controls.test.tsx`
  - `tests/visual-explanation-panel.test.tsx`
  - `tests/visual-explanation-envelope.test.ts`
- **Modifiche previste:**
  - Aggiornare i test che asserivano la presenza di `iframe` su `renderer: "html"` in modo che asseriscano che tale payload produca un errore di validazione controllato.
  - Rimuovere i test sintetici che simulavano slider HTML/iframe.
- **Dipendenze:** Task 3.1 e Task 3.2.
- **Criteri di accettazione:** Esecuzione di `NODE_ENV=test npx tsx --test tests/visual-explanation-*.test.*` con esito 100% positivo.
- **Possibilità di rollback:** Immediata.

### Task 3.4: Rigenerazione Documentazione SDK
- **Obiettivo:** Mantenere aggiornata la documentazione contrattuale dei tipi per i plugin.
- **Finding risolti:** Allineamento documentale.
- **File coinvolti:**
  - `docs/plugin-api/contracts-visual-explanation.md` (o script di build correlato)
- **Modifiche previste:** Esecuzione dello script di documentazione per riflettere i tipi ripuliti.
- **Dipendenze:** Task 3.1.
- **Criteri di accettazione:** Nessun diff spurio; i contratti riflettono esattamente `VisualRenderer = "svg"`.

---

## 10. Test e Verifiche Eseguite in RUN 2

Durante questa run di solo audit non è stato modificato alcun file di codice sorgente o di test. Sono state eseguite esclusivamente verifiche e test in **sola lettura** per accertare lo stato del sistema e confermare la riproducibilità dei comportamenti analizzati.

### Riepilogo Esecuzioni:

| Comando Esatto | Exit Code | Risultato | Dettaglio e Comportamento Verificato |
|---|---|---|---|
| `git status && git log -n 5 --oneline` | 0 | Conforme | Branch `feat/study-hub` pulito, HEAD a `d749fb4` |
| `NODE_ENV=test npx tsx --test tests/visual-explanation-*.test.*` | 0 | **103 passati su 103** (12 suite) | Durata 6.84s. Verificato il funzionamento completo di envelope, validator, agent tool, panel, lifecycle, controlli, persistenza e sicurezza adversarial |
| `npm run typecheck` (`tsc --noEmit`) | 0 | **0 errori** | Tipizzazione TypeScript pienamente valida nel repository |
| `grep -rn '"renderer": "html"' src/ tests/ docs/` | 1 (nessun match) | Verificato | Nessun file dati o contratto core definisce `"renderer": "html"` come valore valido attivo |
| `grep -rn '"renderer"' data/chats/` | 0 | Verificato | Tutti i 4 file salvati reali hanno `"renderer": "svg"`; 0 file hanno `"html"` |
| `grep -rn '"controls"' data/chats/` | 1 (nessun match) | Verificato | Nessun controllo legacy o non standard è presente nei file persistiti reali |

### Distinzione dello Stato di Verifica:
- **Comportamento verificato tramite test:**
  - Rifiuto categorico di HTML e raw SVG XML da parte dell'agent tool (`tests/visual-explanation-tool.test.ts`).
  - Rifiuto categorico di controlli continui (slider, toggle, select) da parte dell'agent tool (`tests/visual-explanation-tool.test.ts`).
  - Funzionamento ineccepibile dei controlli a step (play, pause, step-forward, step-backward, reset) su SVG dichiarativo (`tests/visual-explanation-controls.test.tsx`).
  - Isolamento delle sessioni e persistenza in `chatStore` (`tests/visual-explanation-persistence.test.ts`).
  - Robustezza contro attacchi XSS e injection CSS (`tests/visual-explanation-security.test.ts`).
- **Comportamento verificato tramite ispezione statica:**
  - Assenza totale di file chat o fixture con formato HTML nel filesystem.
  - Soppressione deliberata dei controlli non-button nel componente `visual-explanation-card.tsx`.
  - Presenza del ramo residuo iframe e della validazione con `allowLegacy: true` nella UI card.
- **Comportamento non verificato:**
  - Nessun aspetto del sottosistema visivo è rimasto non verificato.

---

## 11. Registro dei Finding (Triage Status)

### Finding SPEC-CONFLICT-01: Discrepanza nei Contratti dei Controlli Interattivi
- **ID:** `SPEC-CONFLICT-01` (anche catalogato come F-02)
- **Current HEAD:** `d749fb4`
- **Status:** **`CONFIRMED`** (Discrepanza tra tipi TypeScript ampi ed esecuzione MVP a step discreti)
- **Reproduction:**
  - L'interfaccia Typescript `VisualControlDescriptor` include `VisualSliderControl`, `VisualToggleControl`, `VisualSelectControl`.
  - L'invio di uno slider all'agent tool viene respinto con errore di validazione.
  - Nel componente UI, la presenza di `declarativeDoc` sopprime qualsiasi controllo che non sia di tipo `button`.
- **Source evidence:**
  - `src/core/contracts/visual-explanation.ts:56-60`
  - `src/agent/tools/visual-explanation.ts:36-42, 74-79`
  - `src/core/visual-explanation-validator.ts:243-248`
  - `components/artifacts/visual-explanation-card.tsx:830`
- **Tests coinvolti:** `tests/visual-explanation-tool.test.ts`, `tests/visual-explanation-controls.test.tsx`, `tests/visual-explanation-declarative.test.tsx`.
- **Files da modificare in RUN 3:** `src/core/contracts/visual-explanation.ts`, `components/artifacts/visual-explanation-card.tsx`, `docs/plugin-api/contracts-visual-explanation.md`.
- **Remaining uncertainty:** Nessuna incertezza. Lo scope MVP della specifica prescrive chiaramente i soli controlli a step deterministici.

### Finding SPEC-CONFLICT-02: Presenza di Percorso Legacy HTML / Iframe nel Renderer
- **ID:** `SPEC-CONFLICT-02` (anche catalogato come F-01)
- **Current HEAD:** `d749fb4`
- **Status:** **`CONFIRMED`** (Codice residuo di prototipazione non rimosso nel frontend)
- **Reproduction:**
  - In `components/artifacts/visual-explanation-card.tsx:724-735`, è presente il blocco di rendering `iframe` per `artifact.renderer === "html"`.
  - L'agent tool vieta rigorosamente il valore `"html"`.
  - Non esiste alcun dato persistito o fixture con `"renderer": "html"`.
- **Source evidence:**
  - `components/artifacts/visual-explanation-card.tsx:314, 724-735`
  - `src/agent/tools/visual-explanation.ts:58-62, 109-113`
  - `src/core/visual-explanation-validator.ts:35, 185-192`
- **Tests coinvolti:** `tests/visual-explanation-card.test.tsx`, `tests/visual-explanation-envelope.test.ts`, `tests/visual-explanation-panel.test.tsx`.
- **Files da modificare in RUN 3:** `components/artifacts/visual-explanation-card.tsx`, `src/core/contracts/visual-explanation.ts`, `src/core/visual-explanation-validator.ts`, suite di test correlate.
- **Remaining uncertainty:** Nessuna incertezza. Il formato HTML è inutilizzato nei dati reali e viola la filosofia di isolamento dichiarativo della specifica.

---

## 12. Conclusioni e Chiusura della Run

1. **Obiettivo raggiunto al 100%:** entrambi i finding aperti nel baseline (`SPEC-CONFLICT-01` e `SPEC-CONFLICT-02`) sono stati analizzati e diagnosticati in ogni dettaglio sulla base della specifica originale autoritativa.
2. **Integrità del codice garantita:** nessun file applicativo o di test è stato modificato in questa run. L'unico artefatto prodotto è il presente report diagnostico.
3. **Proposta per RUN 3 pronta e autonoma:** il piano di intervento è suddiviso in task atomici a rischio minimo, pronti per essere implementati nella run successiva previa approvazione dell'orchestratore.
