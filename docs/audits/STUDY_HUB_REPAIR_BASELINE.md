# LearnHarness — Study Hub & Visual Explanation Engine
## Audit Tecnico, Baseline e Piano di Riparazione (RUN 0)

Data: 2026-11-17  
Autore: Gemini 3.8 Flash (Technical Implementation Agent)  
Riferimento: `MrJoelao/learnharness` — Branch `feat/study-hub`

---

## 1. Baseline Git

Al termine delle verifiche di baseline eseguite all'avvio della Run 0:

- **Repository root**: `/home/joel/learnharness`
- **Branch corrente**: `feat/study-hub`
- **Comando `git pull`**: eseguito prima di qualsiasi analisi (`Already up to date.`)
- **HEAD completo**: `58fdbedb2107bcdb11fc1b940be3b89b96e8ef7a`
- **Stato working tree**: `clean` (nessun file modificato o untracked)
- **Relazione con `origin/dev`**:
  - `feat/study-hub` è avanti di 41 commit rispetto a `origin/dev`.
  - `feat/study-hub` è indietro di 0 commit rispetto a `origin/dev` (`41 0` da `git rev-list --left-right --count feat/study-hub...origin/dev`).
- **Verifica integrità**: nessun commit, push, rebase o alterazione locale di codice è stata effettuata durante questa run.

---

## 2. Specifiche Originali Individuate e Lette

La specifica originale **Study Hub & Workspace Architecture (v1.0 - 2026-11-13)** è stata individuata integralmente nella directory [docs/learnharness-study-hub-spec/](file:///home/joel/learnharness/docs/learnharness-study-hub-spec).

Tutti i documenti originali sono stati letti e analizzati come fonte primaria di verità autoritativa (prevalente sui report precedenti):

1. [docs/learnharness-study-hub-spec/README.md](file:///home/joel/learnharness/docs/learnharness-study-hub-spec/README.md): Mappa della specifica e decisioni architetturali vincolanti non negoziabili.
2. [docs/learnharness-study-hub-spec/01-product-requirements.md](file:///home/joel/learnharness/docs/learnharness-study-hub-spec/01-product-requirements.md): Visione, terminologia, requisiti funzionali (FR-01..FR-14) e non funzionali.
3. [docs/learnharness-study-hub-spec/02-architecture.md](file:///home/joel/learnharness/docs/learnharness-study-hub-spec/02-architecture.md): Confini di ownership (Host vs Plugin vs Teaching Agent), sottosistemi e ciclo di vita.
4. [docs/learnharness-study-hub-spec/03-api-contracts.md](file:///home/joel/learnharness/docs/learnharness-study-hub-spec/03-api-contracts.md): Contratti Plugin API v1 estesa con `PluginModeDefinition` opzionale e `WorkspaceContext`.
5. [docs/learnharness-study-hub-spec/04-data-model.md](file:///home/joel/learnharness/docs/learnharness-study-hub-spec/04-data-model.md): Modello dati persistente, schema directory unificata, azioni di organizzazione, migrazioni v1/v2.
6. [docs/learnharness-study-hub-spec/05-ux-specification.md](file:///home/joel/learnharness/docs/learnharness-study-hub-spec/05-ux-specification.md): Interfaccia utente Study Hub, sidebar mista, routing `/workspaces/[id]`, gestione archivio e accessibilità.
7. [docs/learnharness-study-hub-spec/06-visual-explanation-engine.md](file:///home/joel/learnharness/docs/learnharness-study-hub-spec/06-visual-explanation-engine.md): Visual Explanation Engine, envelope versionata, modello di sicurezza, SVG dichiarativo MVP.
8. [docs/learnharness-study-hub-spec/07-implementation-plan.md](file:///home/joel/learnharness/docs/learnharness-study-hub-spec/07-implementation-plan.md): Fasi di implementazione.
9. [docs/learnharness-study-hub-spec/08-testing-and-acceptance.md](file:///home/joel/learnharness/docs/learnharness-study-hub-spec/08-testing-and-acceptance.md): Matrice di testing, criteri di accettazione ed end-to-end scenario a 23 passi.
10. [docs/learnharness-study-hub-spec/09-t3-code-operating-brief.md](file:///home/joel/learnharness/docs/learnharness-study-hub-spec/09-t3-code-operating-brief.md): Istruzioni operative.

Sono stati inoltre letti e integrati i documenti operativi del runbook in [docs/agent-runbook/](file:///home/joel/learnharness/docs/agent-runbook):
- `00-orchestration-contract.md`
- `01-gemini-38-flash-operating-rules.md`
- `02-repository-and-feature-context.md`
- `03-workstream-plan.md`
- `04-verification-and-acceptance.md`
- `06-findings-and-open-decisions.md`

---

## 3. Architettura Attuale Verificata

L'ispezione analitica del codice sorgente ha confermato che l'implementazione su `feat/study-hub` ha già completato gran parte delle fasi del piano di sviluppo originale (Phases 1-7). Di seguito la mappa dei moduli verificati:

```
[UI Layer]
  components/sidebar.tsx                 <- Navigazione globale, bottone Study Hub, gestione albero misto
  components/chat-folder-tree.tsx        <- Rendering cartelle, righe sessioni (SessionRow) e workspace (WorkspaceRow)
  components/workspace-row.tsx           <- Righe workspace nel tree con icone, tempi relativi, indicatori indisponibilità
  components/study-hub-catalog.tsx       <- Catalogo modalità, filtri categoria/difficoltà, launcher
  components/workspace-screen.tsx        <- Shell host per /workspaces/[id], stato disponibilità, montaggio plugin
  components/archive-page.tsx            <- Archivio misto chat e workspace, restore e delete
  components/artifacts/visual-explanation-card.tsx <- Card artefatti visivi, espansione panel, controlli step
  components/artifacts/declarative-svg-renderer.tsx <- Renderer React nativo per primitive SVG dichiarative

[Core Contracts & Validation Layer]
  src/core/workspaces.ts                 <- Tipi WorkspaceRecord, WorkspaceIndex, validazione ID e availability
  src/core/plugin-modes.ts               <- Validazione PluginModeDefinition e metadata
  src/core/organization.ts               <- OrganizationV2, chiavi tipizzate (chat: / workspace:), azioni unificate
  src/core/directory.ts                  <- SharedDirectory model, discriminated union DirectoryEntry
  src/core/contracts/visual-explanation.ts <- Envelope VisualArtifact, schema learnharness.visual.svg.v1
  src/core/visual-explanation-validator.ts <- Validatore deterministico anti-injection, limiti e primitive SVG

[Server & Services Layer]
  src/server/workspaces.ts               <- Servizio CRUD workspace
  src/server/directory.ts                <- DirectoryService aggregatore per chats e workspaces
  src/server/plugin-host.ts              <- Host plugin, ciclo di vita, journal cancellazione a 3 fasi
  src/server/plugins.ts                  <- Bootstrap host e wiring resolver disponibilità

[Storage & Persistence Layer]
  src/store/workspaces.ts                <- Persistenza host-owned (index.json + <id>.json)
  src/store/plugin-workspace-state.ts    <- Storage privato del plugin per istanza (plugin-data/.../workspaces/<id>/)
  src/store/plugin-data-paths.ts         <- Separazione dati plugin e package code contro cancellazioni
  src/store/chat-organization.ts         <- Store chat-organization.json con migrazione lazy v1 -> v2
```

---

## 4. Matrice di Conformità per Area

### A. Workspace e Persistenza
- **Creazione e apertura**: CONFORME. `createWorkspace()` genera ID stabili con prefisso `workspace_`, scrive il metadata atomico e inserisce l'ID nell'indice.
- **Persistenza e separazione**: CONFORME. I metadata dell'host risiedono in `workspaces/<id>.json`. Lo stato privato del plugin risiede in `plugin-data/<plugin-id>/workspaces/<workspace-id>/<key>.json` con limite di 1 MiB e validazione delle chiavi.
- **Plugin disabilitato/mancante**: CONFORME. Non provoca la cancellazione di metadata o storage. L'availability degrada a `plugin-disabled` o `plugin-missing`.
- **Riattivazione**: CONFORME. Riabilitare il plugin o reinstallarlo ricollega i workspace esistenti restituendo lo stato `available`.
- **Eliminazione e recovery**: CONFORME. Eliminazione transazionale a tre stadi (stato plugin -> metadata -> placement directory) con journal `deletions.json` e ripresa automatica al riavvio.
- **Aggiornamento pacchetto**: CONFORME. Il codice dei plugin risiede in `plugins/<id>`, mentre i dati risiedono nel sibling `plugin-data/<id>`, proteggendo i dati persistenti dalla sovrascrittura durante gli aggiornamenti.

### B. Plugin Modes
- **Registrazione**: CONFORME. API opzionale non rompente per Plugin API v1.
- **Identificazione**: CONFORME. Scoping univoco `(pluginId, modeId)` tramite helper `getModeKey`.
- **Disponibilità**: CONFORME. Risolta dinamicamente interrogando l'host attivo.
- **Compatibilità v1**: CONFORME. I plugin v1 legacy continuano ad attivarsi senza registrare mode e usano normalmente `registerView()`.
- **Inizializzazione**: CONFORME. Hook `initializeWorkspace` eseguito prima del commit. Eventuali eccezioni attivano il rollback dei metadati e dello storage con diagnostica dettagliata.

### C. Directory Condivisa
- **Identificatori tipizzati**: CONFORME. Formato `chat:<id>` e `workspace:<id>` (`ItemKey`).
- **Cartelle condivise**: CONFORME. Le cartelle ospitano elementi misti senza divisioni rigide.
- **Ordinamento e spostamento**: CONFORME. Ordinamento numerico con tie-breaker deterministico; spostamenti validati contro cicli e inserimenti in cartelle archiviate.
- **Migrazione v1/v2**: CONFORME. Migrazione lazy in memoria su lettura, persistenza atomica al primo write; endpoint legacy `/api/chats/organization` preserva i placement dei workspace.
- **Integrità dati**: CONFORME. `folderIsEmpty` verifica l'assenza sia di chat che di workspace prima di consentire l'eliminazione di una cartella.

### D. Sidebar e Archivio
- **Elementi misti**: CONFORME. Rendering unificato in `chat-folder-tree.tsx` con righe visivamente allineate.
- **Drag and Drop**: CONFORME. Supportato per chat e workspace tra cartelle e tra fratelli.
- **Archivio/Ripristino**: CONFORME. Cartelle miste e singoli workspace possono essere archiviati e ripristinati mantenendo lo stato.
- **Navigazione da tastiera**: **NON CONFORME (BUG CONFIRMED)**. Esistono difetti critici nel passaggio del focus e nella navigazione con tasto Invio dalla barra di ricerca.

### E. Study Hub
- **Catalogo**: CONFORME. Presente su `/study-hub`, posizionato sotto "New session" nella sidebar.
- **Ricerca e filtri**: CONFORME. Filtro testuale fuzzy, categorie e difficoltà.
- **Creazione workspace**: CONFORME. Genera una nuova istanza indipendente posizionata alla radice (unorganized) e reindirizza a `/workspaces/[id]`.
- **Gestione errori**: CONFORME. Stati vuoti, loading skeleton e gestione renderer mancanti.

### F. Visual Explanation Engine
- **Schema dichiarativo**: CONFORME. `learnharness.visual.svg.v1` con primitive SVG educative.
- **Validazione e sicurezza**: CONFORME. Validatore rigoroso che scarta XML arbitrario, tag script, protocolli remoti, iframe non dichiarati e injection CSS.
- **Isolamento chat**: CONFORME. Registro e aggiornamenti isolati per `chatId`.
- **Aggiornamento artefatti**: CONFORME. Azione `update` atomica con fallback allo stato valido precedente in caso di errore.
- **Controlli**: **DISCREPANZA SPECIFICA/CONTRATTO**. Il contratto espone slider/toggle/select, mentre il tool e il renderer MVP accettano solo pulsanti di step navigation.
- **Compatibilità legacy HTML**: **CONFLITTO/CODICE RESIDUO**. Card UI mantiene un branch `iframe` legacy mentre l'agent tool lo proibisce e non esistono fixture legacy.

---

## 5. Finding Confermati

### Finding F-07: Discrepanze nella Navigazione da Tastiera per i Workspace nella Sidebar
- **ID**: `LH-BUG-01`
- **Area**: `D. Sidebar e archivio`
- **Gravità**: `P1`
- **Requisito originale**: Spec 05 Sez. 4 & 9 (tutte le azioni di lancio/apertura devono essere accessibili da tastiera e avere parità di interazione con le chat).
- **Evidenza nel codice**:
  1. [`components/chat-folder-tree.tsx:726`](file:///home/joel/learnharness/components/chat-folder-tree.tsx#L726):
     ```tsx
     const isKbd = isWorkspace ? false : kbdChatId === item.id;
     ```
     L'evidenziazione da tastiera (`isKbd`) è forzata a `false` per qualunque workspace, impedendo l'applicazione dello stile `kbdSelected` e di `data-testid="workspace-row-kbd"`.
  2. [`components/sidebar.tsx:1362`](file:///home/joel/learnharness/components/sidebar.tsx#L1362):
     ```tsx
     const row = listRef.current?.querySelector<HTMLElement>(`[data-session-id="${targetChat.id}"]`);
     row?.scrollIntoView({ block: "nearest" });
     ```
     La ricerca dell'elemento attivo per lo scroll scorre solo `data-session-id`, ignorando `data-workspace-id` di `WorkspaceRow`.
  3. [`components/sidebar.tsx:1547-1554`](file:///home/joel/learnharness/components/sidebar.tsx#L1547-L1554):
     ```tsx
     if (e.key === "Enter") {
         const target = shown![kbdIndex !== null && kbdIndex < n ? kbdIndex : 0];
         if (!target) return;
         e.preventDefault();
         router.push(`/chat/${target.id}`); // BUG: forza rotta /chat/ anche per i workspace
         setKbdIndex(null);
         e.currentTarget.blur();
     }
     ```
     Premere Invio durante la selezione da tastiera naviga incondizionatamente a `/chat/${target.id}` anziché a `/workspaces/${target.id}` quando l'elemento selezionato è un workspace.
- **Comportamento attuale**: Navigando la sidebar o i risultati di ricerca con le frecce su/giù, i workspace non vengono evidenziati graficamente e premendo Invio si apre un URL `/chat/workspace_...` inesistente.
- **Comportamento atteso**: I workspace devono ricevere il focus grafico da tastiera, scorrere in vista e l'Invio deve reindirizzare a `/workspaces/${target.id}`.
- **Possibile causa**: Implementazione iniziale focalizzata sulle sole sessioni chat con adapter incompleto per gli item di tipo workspace.
- **File da modificare**:
  - `components/chat-folder-tree.tsx`
  - `components/sidebar.tsx`
- **Test necessario**: Test componente in `tests/sidebar-workspace-keyboard.test.tsx` che simuli freccia giù fino a un workspace, verifichi `data-testid="workspace-row-kbd"` e simuli `Enter` verificando `router.push('/workspaces/...')`.
- **Dipendenze**: Nessuna.

---

## 6. Finding Non Riprodotti

### Finding F-05 (Precedente): Perdita di Risoluzione della Disponibilità del Workspace tra i Moduli di Routing
- **Stato**: `NOT_REPRODUCED`
- **Evidenza**: Nel file [`src/server/directory.ts:255-272`](file:///home/joel/learnharness/src/server/directory.ts#L255-L272), `resolveCurrentAvailability()` interroga `globalThis.__lhWorkspaceAvailabilityResolver` o `(globalThis).__lhPlugins.host.workspaceAvailability()`, e ricade sul fallback sicuro `"plugin-missing"`. Il test dedicato `tests/study-hub-workspace-availability.test.ts` è stato eseguito e passa al 100% (8/8 test). Nessuna regressione riscontrata.

---

## 7. Conflitti tra Specifica e Implementazione

### Finding F-01: Branch Residuo Legacy HTML Iframe in Visual Explanation Card
- **ID**: `SPEC-CONFLICT-01`
- **Area**: `F. Visual Explanation Engine`
- **Gravità**: `P2`
- **Requisito originale**: Spec 06 Sez. 6 & 10 (MVP dichiarativo SVG JSON senza esecuzione di codice JavaScript non vincolato).
- **Evidenza nel codice**:
  - [`components/artifacts/visual-explanation-card.tsx:724-735`](file:///home/joel/learnharness/components/artifacts/visual-explanation-card.tsx#L724-L735): renderizza un `<iframe>` con `sandbox="allow-scripts"` per `renderer === "html"`.
  - In [`src/agent/tools/visual-explanation.ts:58-62, 109-113`](file:///home/joel/learnharness/src/agent/tools/visual-explanation.ts#L58-L62): il tool dell'agente rifiuta tassativamente `renderer !== "svg"`.
  - In `tests/fixtures/golden-data/chats`: nessuna chat contiene artefatti legacy in formato HTML.
- **Conflitto**: Il contratto frontend e il renderer supportano ancora un runtime HTML non richiesto dall'MVP, mentre il trust boundary dell'agente lo rifiuta a monte.
- **Azione richiesta**: Decisione dell'orchestrazione. Si raccomanda di mantenere il codice isolato senza permetterne la creazione o rimuoverlo esplicitamente se dichiarato deprecato.

### Finding F-02: Discrepanza nei Contratti dei Controlli Interattivi Visivi
- **ID**: `SPEC-CONFLICT-02`
- **Area**: `F. Visual Explanation Engine`
- **Gravità**: `P2`
- **Requisito originale**: Spec 06 Sez. 4 & 7.
- **Evidenza nel codice**:
  - [`src/core/contracts/visual-explanation.ts:26-60`](file:///home/joel/learnharness/src/core/contracts/visual-explanation.ts#L26-L60): definisce `VisualSliderControl`, `VisualToggleControl`, `VisualSelectControl`.
  - [`src/agent/tools/visual-explanation.ts:36-42`](file:///home/joel/learnharness/src/agent/tools/visual-explanation.ts#L36-L42): accetta unicamente controlli di tipo `button` con azioni predefinite (`play`, `pause`, `reset`, `step-forward`, `step-backward`).
  - [`src/core/visual-explanation-validator.ts:243-247`](file:///home/joel/learnharness/src/core/visual-explanation-validator.ts#L243-L247): in modalità `strictDeclarative`, scarta esplicitamente slider, toggle e select.
- **Conflitto**: I tipi pubblici promettono controlli continui (slider, toggle, select), ma l'agente e il validatore MVP accettano solo pulsanti deterministici per la navigazione degli step.
- **Azione richiesta**: Allineare la documentazione dell'MVP confermando che per la v1 i soli controlli abilitati sono i pulsanti di simulazione a step, rimandando i controlli parametrici continui a una fase successiva.

---

## 8. Questioni Non Verificabili (Unverified)

### Finding F-06: Esecuzione Completa della Test Suite Globale del Repository
- **ID**: `UNVERIFIED-01`
- **Area**: `Integrazione di sistema`
- **Gravità**: `P3`
- **Evidenza**: L'esecuzione di `npm test` sul repository completo tenta di lanciare oltre 250 file di test in concorrenza (con simulazione di DOM React/JSDOM, streaming ed effetti temporizzati), causando rallentamenti estremi e time-out in test non correlati (es. `tests/chat-plugin-action-refresh.test.tsx` sulle notifiche di draft delle chat native).
- **Stato**: `UNVERIFIED` per l'intero repository, ma **VERIFICATO AL 100%** per l'intero perimetro Study Hub, Directory, Workspace e Visual Explanation (281 test eseguiti con esito positivo).

---

## 9. Piano delle Run Successive

Organizzazione rigorosa in run indipendenti e serializzate per prevenire sovrapposizioni di file:

### Run 1: Correzione Keyboard Navigation Sidebar e Workspace Routing (`LH-BUG-01`)
- **Obiettivo**: Garantire la parità completa di navigazione da tastiera tra chat e workspace nella sidebar.
- **Finding inclusi**: `LH-BUG-01`.
- **File coinvolti**:
  - `components/chat-folder-tree.tsx`
  - `components/sidebar.tsx`
  - `tests/sidebar-workspace-keyboard.test.tsx` (nuovo test di regressione)
- **Modifiche previste**:
  - Rimozione della clausola `isWorkspace ? false` in `chat-folder-tree.tsx:726` per abilitare `kbdSelected`.
  - Estensione del query selector in `sidebar.tsx:1362` per supportare `[data-workspace-id="${target.id}"]`.
  - Condizionale in `sidebar.tsx:1551` per navigare a `/workspaces/${target.id}` se `target.kind === "workspace"`.
- **Test di accettazione**: Navigazione con frecce e selezione Invio su item misti.
- **Rischi di regressione**: Nessuno sulle chat; impatto circoscritto al solo router handler della sidebar.

### Run 2: Razionalizzazione del Confine di Sicurezza di Visual Explanation (`SPEC-CONFLICT-01` & `SPEC-CONFLICT-02`)
- **Obiettivo**: Riconciliare i contratti pubblici, il prompt dell'agente e la documentazione del motore visivo.
- **Finding inclusi**: `SPEC-CONFLICT-01`, `SPEC-CONFLICT-02`.
- **File coinvolti**:
  - `src/core/contracts/visual-explanation.ts`
  - `src/agent/prompts/teacher/56-visual-explanation.md`
  - `docs/learnharness-study-hub-spec/06-visual-explanation-engine.md` (o documentazione d'uso)
  - `tests/visual-explanation-controls.test.tsx`
- **Modifiche previste**:
  - Documentare esplicitamente i vincoli di supporto dell'MVP (pulsanti step per SVG dichiarativo).
  - Verificare che nessun percorso possa iniettare artefatti HTML non autorizzati.
- **Test di accettazione**: Suite `tests/visual-explanation-*.test.*` verde.
- **Rischi di regressione**: Minimi.

### Run 3: Verifica e Hardening del Ciclo di Vita Workspace e Persistenza
- **Obiettivo**: Consolidare la diagnostica di disinstallazione e la robustezza delle directory dei dati dei plugin.
- **Finding inclusi**: `F-03` / `F-04`.
- **File coinvolti**:
  - `src/server/plugin-host.ts`
  - `src/store/plugin-data-paths.ts`
  - `tests/study-hub-phase7-lifecycle.test.ts`
- **Test di accettazione**: Suite completa di recovery e lifecycle verificata.

### Run 4: Verifica Finale e Release Gate
- **Obiettivo**: Typecheck, lint, build e suite mirate aggregate prima della chiusura del branch.
- **File coinvolti**: Nessuno (sola verifica ed eventuale report finale).

---

## 10. Comandi di Test Consigliati

Per verificare e riprodurre i comportamenti documentati durante le run:

```bash
# 1. Typecheck TypeScript del repository
npm run typecheck

# 2. Test del Directory Service e migrazione v1/v2 (48 test)
NODE_ENV=test npx tsx --test tests/directory-*.test.ts

# 3. Test dello store e journal dei Workspace (22 test)
NODE_ENV=test npx tsx --test tests/workspaces.test.ts

# 4. Test di Plugin Modes e Plugin Workspace State (11 test)
NODE_ENV=test npx tsx --test tests/plugin-workspace-state.test.ts tests/plugin-modes.test.ts

# 5. Test di Study Hub UI, Hardening, Lifecycle e Acceptance (97 test)
NODE_ENV=test npx tsx --test tests/study-hub-*.test.*

# 6. Test di Visual Explanation Engine, Validatore e Sicurezza (103 test)
NODE_ENV=test npx tsx --test tests/visual-explanation-*.test.*
```

Tutti i comandi sopra indicati sono stati eseguiti con successo nella Run 0 con esito positivo per un totale di **281 test passati su 281**.
