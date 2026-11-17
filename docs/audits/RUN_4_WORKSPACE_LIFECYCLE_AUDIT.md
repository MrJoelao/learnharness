# LearnHarness — Study Hub & Workspace Lifecycle Audit
## RUN 4 — Read-only Audit, Architecture Verification & Gap Analysis

Data: 2026-11-17  
Autore: Gemini 3.8 Flash (Technical Implementation Agent)  
Riferimento: `MrJoelao/learnharness` — Branch `feat/study-hub`  
Commit di riferimento verificato: `2de5fa223ae76539618a7ddfd1876c62a11b8d73`  
Ambito: Read-only audit del ciclo di vita dei workspace, persistenza, isolamento, contratti e copertura test.

---

## 1. Executive Summary

La presente analisi costituisce l'audit tecnico approfondito del sottosistema **Workspace Lifecycle** introdotto sul branch `feat/study-hub`.
L'obiettivo primario è accertare se un workspace in LearnHarness costituisca una **vera istanza persistente, indipendente e recuperabile**, ovvero un'entità con propria identità univoca, storage isolato e ciclo di vita autonomo, oppure se sia una mera vista di plugin indicizzata per ID.

L'ispezione analitica del codice sorgente, dei contratti pubblici, dei percorsi filesystem e della suite di test ha evidenziato quanto segue:

1. **Autentica natura di istanza persistente e isolata**:
   - Ogni workspace possiede un UUID v4 host-owned immutabile (`workspace_<uuid>`).
   - I metadati host sono memorizzati fisicamente in `<learning-data>/workspaces/<workspace-id>.json` e tracciati in un indice atomico `index.json`.
   - Lo stato specifico del plugin (*plugin-owned state*) risiede in uno spazio storage segregato fisicamente per plugin e per istanza in `<plugin-data>/<plugin-id>/workspaces/<workspace-id>/<key>.json`.
   - Due o più workspace creati dalla medesima modalità (*mode*) mantengono record host distinti, namespace di persistenza completamente separati e non condividono stato mutabile.
2. **Integrazione unificata e non distruttiva nella Directory**:
   - I workspace sono integrati come *peer* delle chat all'interno della struttura organizzativa condivisa (`OrganizationV2`), con chiavi tipizzate `workspace:<id>`.
   - La creazione posiziona deterministicamente i workspace come *root/unorganized* senza richiedere una placement persistente preliminare (sintetizzata on-the-fly).
   - Le operazioni di archiviazione (`archivedAt`), spostamento tra cartelle e riordino tra fratelli (*sibling ordering*) operano esclusivamente sui metadati organizzativi, senza alterare né i record né i file di stato del plugin.
3. **Resilienza e Atomic Deletion Journal**:
   - La cancellazione di un workspace adotta un protocollo a tre fasi tracciato su disco (`deletions.json`), garantendo che eventuali crash o errori di I/O (fase 1: rimozione stato plugin, fase 2: rimozione record host, fase 3: rimozione placement directory) siano rilevabili e riprendibili in modo idempotente all'avvio dell'applicazione.
4. **Discrepanze e Gaps riscontrati**:
   - **F-01 (P1)**: Nel singleton di produzione `workspaceService` in `src/server/workspaces.ts`, la callback `onDelete` non è stata collegata (`workspaceKey` e `directoryService` risultano importati ma non passati alle opzioni). Di conseguenza, una chiamata diretta a `workspaceService.delete(id)` omette la pulizia della placement in `directoryService`. Le chiamate via API HTTP utilizzano invece `pluginHost.deleteWorkspace`, che esegue correttamente la fase 3.
   - **F-02 (P2)**: La specifica `04-data-model.md` prevedeva in `WorkspaceRecord` i campi `state: "ready" | "creating" | "error"` e `lastError?`. L'implementazione ha adottato la creazione atomica con rollback immediato in memoria/disco e ha omesso tali campi, con `parseWorkspaceRecord` che convalida in modo rigido l'esatto set di 7 chiavi (rifiutando record con campi aggiuntivi).
   - **F-03 (P2)**: Gli endpoint HTTP `/api/workspaces/[id]/state/[key]` validano l'esistenza del workspace e lo stato attivo del plugin titolare, ma non dispongono di un token di autenticazione per verificare che il chiamante sia effettivamente il renderer di quel plugin e non un altro script in esecuzione nel renderer host.
   - **F-04 (P3)**: In `components/workspace-screen.tsx`, la sincronizzazione ottimistica del titolo verso la sidebar riutilizza l'evento finestra `lh:chat-renamed`, rappresentando un debito di denominazione ereditato dal dominio chat.

**Verdetto dell'Audit**: **PASS WITH GAPS** (l'architettura implementata soddisfa pienamente i requisiti di isolamento, persistenza e recuperabilità, con lacune circoscritte non bloccanti).

---

## 2. Baseline Git

- **Repository**: `MrJoelao/learnharness`
- **Branch**: `feat/study-hub`
- **Commit verificato**: `2de5fa223ae76539618a7ddfd1876c62a11b8d73`
- **Stato Working Tree**: Clean (nessun file modificato, aggiunto o eliminato prima dell'audit)
- **Modalità esecuzione**: Read-only (nessuna modifica al codice applicativo o ai test durante questa RUN).

---

## 3. Architettura Effettivamente Implementata

Il sottosistema Workspace si articola su tre livelli cooperanti ma rigidamente separati nei confini di ownership:

```text
┌────────────────────────────────────────────────────────────────────────────────┐
│ UI Layer (Browser / React)                                                     │
│   • components/study-hub-catalog.tsx (Catalogo modalità, ricerca, launcher)   │
│   • app/workspaces/[id]/page.tsx -> components/workspace-screen.tsx (Shell)   │
│   • components/plugin-manager.ts (Frontend Plugin Manager & Mount Lifecycle)   │
│   • components/sidebar.tsx & chat-folder-tree.tsx (Albero misto chat/workspace)│
└──────────────────────────────────────┬─────────────────────────────────────────┘
                                       │ HTTP API / SSE
┌──────────────────────────────────────▼─────────────────────────────────────────┐
│ Host Server & Service Layer                                                    │
│   • app/api/workspaces/[id]/route.ts & state/[key]/route.ts                    │
│   • src/server/plugin-host.ts (Ciclo di vita plugin/mode, 3-phase deletion)    │
│   • src/server/plugin-transport.ts (HTTP adapter isolato)                     │
│   • src/server/workspaces.ts (WorkspaceService: CRUD e availability)           │
│   • src/server/directory.ts (DirectoryService: aggregatore misto unificato)    │
└──────────────────────────────────────┬─────────────────────────────────────────┘
                                       │ File System Atomico
┌──────────────────────────────────────▼─────────────────────────────────────────┐
│ Persistence Layer (Host vs Plugin Segregation)                                 │
│   • src/store/workspaces.ts (Host Store: workspaces/index.json + <id>.json)    │
│   • src/store/plugin-workspace-state.ts (Plugin State: <data>/workspaces/<id>/)│
│   • src/store/chat-organization.ts (Placements: org.placements[workspace:<id>])│
│   • src/store/plugin-data-paths.ts (Safe origin-aware directory resolver)      │
└────────────────────────────────────────────────────────────────────────────────┘
```

### Confini di Responsabilità Accertati

| Componente | Proprietario | Responsabilità Effettiva |
|---|---|---|
| **Identità Workspace** | Host | Generazione UUID v4 (`workspace_<uuid>`), timestamp ISO 8601, immutabilità di `id`, `pluginId`, `modeId`, `createdAt`. |
| **Metadati Host** | Host | Gestione persistente di `title`, `updatedAt`, schema versioning v1, indice globale `index.json`. |
| **Stato di Dominio Istanza** | Plugin | Chiavi JSON arbitrarie (limitate a 1 MiB per chiave, nome chiave validato da regex) scritte e lette tramite `context.storage`. L'host non interpreta né migra tale payload. |
| **Directory e Organizzazione** | Host | Posizionamento (`folderId`), ordinamento (`order`), archiviazione (`archivedAt`), tracciamento orfani e riferimenti mancanti. |
| **Rendering Interattivo** | Plugin | Montaggio del DOM specifico dell'esperienza didattica all'interno del contenitore fornito dall'host. |

---

## 4. Call Graph del Lifecycle

### 4.1 Creazione Workspace
```text
[User] Click "Launch" su Mode Card
  │
  ▼
StudyHubCatalog.handleLaunch(mode)
  ├─ Verifica presenza modalità in activeModesRef
  ├─ Verifica plugin abilitato e non in stato errore
  ├─ Verifica renderer registrato nel browser
  ├─ Setta launchingModeKeys (anti-double-click)
  ▼
activeManager.createWorkspace(pluginId, modeId, title?)
  │ (POST /api/workspaces)
  ▼
pluginTransport.createWorkspace(request)
  ▼
pluginHost.createWorkspace({ pluginId, modeId, title })
  ├─ Assert host aperto e inizializzato
  ├─ Validazione pluginId e modeId tramite regex
  ├─ Lettura package e verifica activation.ready && live()
  ├─ Estrazione PluginModeDefinition da activation.modes
  ▼
workspaceService.create({ pluginId, modeId, title })
  ▼
workspaceStore.create(record)
  ├─ fs.mkdirSync(root, { recursive: true })
  ├─ writeFileAtomicSync(`${id}.json`, record)
  └─ writeFileAtomicSync("index.json", updatedIndex)
  ▼
[pluginHost] mode.initializeWorkspace({ workspace, signal, storage })
  ├─ storage.open(dataDirectory, workspace.id)
  ├─ Se l'inizializzazione fallisce:
  │    ├─ Rollback stato plugin: workspaceStateStore.remove(...)
  │    ├─ Rollback record host: workspaceStore.delete(...)
  │    └─ Ritorna errore 500 (nessun workspace fantasma residuo)
  └─ Se l'inizializzazione ha successo:
       └─ onWorkspaceChanged() -> emit("workspaces-changed")
  ▼
[Browser] router.push(`/workspaces/${workspace.id}`)
  └─ Sidebar riceve "workspaces-changed" e ricarica DirectoryEntry a root
```

### 4.2 Apertura, Montaggio e Navigazione Route
```text
[Browser] GET /workspaces/[id]
  │
  ▼
app/workspaces/[id]/page.tsx
  ▼
WorkspaceScreen({ workspaceId })
  ├─ fetch(`/api/workspaces/${id}`)
  │    ▼
  │  pluginTransport.readWorkspace(id)
  │    ▼
  │  pluginHost.getWorkspace(id)
  │    ├─ workspaceStore.read(id)
  │    └─ resolveWorkspaceAvailability(workspace, snapshots)
  ▼
WorkspaceScreen valuta screenState:
  ├─ "not-found": UI errore 404, link Home
  ├─ "plugin-disabled": UI esplicita "Plugin is disabled", link Settings
  ├─ "plugin-missing": UI esplicita "Plugin missing", istruzioni reinstallazione
  ├─ "mode-missing": UI esplicita "Mode unavailable"
  ├─ "server-error" / "network-error": UI errore con pulsante Retry
  └─ "available":
       ▼
     manager.mountWorkspace(workspaceSupplier, containerRef.current, onError)
       ├─ registration = getModeRenderer(pluginId, modeId)
       ├─ controller = new AbortController()
       ├─ context = { workspace (getter), signal, storage, setTitle }
       └─ registration.renderer.mount(childDiv, context)
```

### 4.3 Cancellazione Atomica a 3 Fasi
```text
[User] Conferma eliminazione permanente da menu riga o UI
  │
  ▼
DELETE /api/workspaces/[id]
  ▼
pluginTransport.deleteWorkspace(id)
  ▼
pluginHost.deleteWorkspace(id)
  ▼
deleteWorkspaceInternal(id)
  ├─ Scrittura deletions.json: { id, pluginId, stage: "started", startedAt }
  │
  ├─ [FASE 1] Rimozione stato persistente plugin
  │    ├─ workspaceStateStore.remove(dataDirectory, id)
  │    └─ Aggiornamento journal: stage = "state-deleted"
  │
  ├─ [FASE 2] Rimozione metadati e indice host
  │    ├─ workspaceStore.delete(id) [fs.unlinkSync(`${id}.json`) + writeIndex]
  │    ├─ Aggiornamento journal: stage = "metadata-deleted"
  │    └─ onWorkspaceChanged() -> emit("workspaces-changed")
  │
  ├─ [FASE 3] Rimozione placement dalla Directory
  │    ├─ onWorkspaceDeleted(id) -> directoryService.removePlacement(workspaceKey(id))
  │    └─ organizationStore.write(updatedOrg)
  │
  └─ [COMPLETAMENTO] clearJournal(id) (rimozione da deletions.json)
```

---

## 5. Analisi Dettagliata delle Otto Aree

### A. Workspace Metadata e Persistence
- **Schema e Validazione**:
  In [src/core/workspaces.ts:10-18](/home/joel/learnharness/src/core/workspaces.ts:10), l'interfaccia `WorkspaceRecord` impone 7 campi: `version: 1`, `id: WorkspaceId`, `pluginId`, `modeId`, `title`, `createdAt`, `updatedAt`.
  La funzione `parseWorkspaceRecord` adotta una strategia a chiavi chiuse:
  ```ts
  const expectedKeys = ["createdAt", "id", "modeId", "pluginId", "title", "updatedAt", "version"];
  if (keys.length !== expectedKeys.length || keys.some((key, index) => key !== expectedKeys[index])) return invalidWorkspaceRecord();
  ```
  Questo assicura che qualunque dato alterato o contenente versioni successive venga rifiutato, prevenendo sovrascritture distruttive su formati sconosciuti.
- **Store e Indice**:
  In [src/store/workspaces.ts:30-184](/home/joel/learnharness/src/store/workspaces.ts:30), l'indice `index.json` determina l'appartenenza formale dei workspace. Ciascun file `<id>.json` contiene il record completo.
  - Le scritture avvengono con `writeFileAtomicSync` (scrittura su file temporaneo nel medesimo filesystem e rename atomico).
  - Un fallimento durante la scrittura dell'indice lascia il record su disco come *orfano valido*, rilevabile tramite `store.inspect().orphanIds` e recuperabile esplicitamente con `recoverOrphan(id)`.
  - Le letture sono rigorosamente non distruttive: `store.list()` e `store.read()` non eseguono riparazioni silenziose dell'indice se rilevano file mancanti o corrotti, ma li notificano come `issues` (`missing-record`, `invalid-record`, `unreadable-record`).
- **Rename**:
  L'operazione `store.update()` convalida che l'identità (`pluginId`, `modeId`, `createdAt`) sia strettamente invariata, aggiornando unicamente `title` e `updatedAt`. I dati del plugin non vengono manipolati.
- **Valutazione Area A**: **PASS WITH OBSERVATION** (discrepanza schema `state`/`lastError` analizzata in F-02).

### B. Isolamento delle Istanze
- **Identità Distinte**:
  La funzione `newWorkspaceId()` genera UUID v4 randomici crittograficamente sicuri preceduti dal prefisso standardizzato (`workspace_[0-9a-f]{8}-...`). Due lanci della stessa modalità producono sempre due ID differenti.
- **Separazione Filesystem**:
  In [src/store/plugin-workspace-state.ts:10-75](/home/joel/learnharness/src/store/plugin-workspace-state.ts:10), la radice di memorizzazione di un'istanza è:
  `<dataRoot>/workspaces/<workspaceId>/`
  Ciascuna istanza possiede una cartella dedicata. La funzione `ensureRoot` verifica che nessun elemento del percorso sia un symlink (`stat.isSymbolicLink()`).
- **Segregazione nel Contesto del Renderer**:
  In [components/plugin-manager.ts:712-736](/home/joel/learnharness/components/plugin-manager.ts:712), `mountWorkspace` chiude la proprietà `storage` sull'ID immutabile `initialWorkspace.id`. Il codice del plugin riceve solo `storage.get/set/delete(key)` e non può cambiare l'ID bersaglio.
- **Immutabilità dell'Oggetto Workspace**:
  Il riferimento `workspace` fornito al plugin è congelato (`Object.freeze`), impedendo manomissioni a runtime dei campi `id`, `pluginId` o `modeId`.
- **Valutazione Area B**: **PASS**.

### C. Plugin-Owned State e Storage
- **Proprietà del Dato**:
  L'host opera come mero canale di trasporto JSON e memorizzatore a blocchi. Non analizza, non valida la semantica di dominio e non riscrive il contenuto salvato dal plugin.
- **Validazione Chiavi e Dimensioni**:
  Le chiavi di storage sono vincolate da regex rigorosa `/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/`, rendendo impossibili attacchi di path traversal (`../`).
  Ciascun valore memorizzato è serializzato in JSON con un tetto massimo di 1 MiB (`MAX_BYTES = 1_048_576`).
- **Percorsi Origine e Distinzione Core vs Community**:
  In [src/store/plugin-data-paths.ts:9-76](/home/joel/learnharness/src/store/plugin-data-paths.ts:9), `safePluginDataDirectory`:
  - I core plugin memorizzano i dati in `<data>/core-plugin-data/<id>/`.
  - I community plugin memorizzano i dati in `<data>/plugin-data/<id>/`, collocato come *sibling* rispetto a `plugins/<id>`.
  - La rimozione del pacchetto plugin (`plugins/<id>`) non tocca la cartella dei dati (`plugin-data/<id>`), garantendo che reinstallando il plugin tutti i dati dei workspace preesistenti tornino fruibili.
  - Viene eseguito `fs.realpathSync` e verificato che il percorso non evada dalla root (`path.relative`).
- **Valutazione Area C**: **PASS**.

### D. Workspace Creation Lifecycle
- **Verifiche di Ammissione**:
  In [src/server/plugin-host.ts:712-751](/home/joel/learnharness/src/server/plugin-host.ts:712), prima di creare un workspace:
  1. Si verifica che l'host sia aperto e inizializzato.
  2. Si controlla che il plugin esista, sia abilitato, non sia in fase di restart e la sua attivazione sia viva (`live(pkg, activation)`).
  3. Si verifica che la modalità sia attualmente registrata in `activation.modes`.
- **Inizializzazione e Rollback Deterministico**:
  Dopo aver creato il record host, l'host invoca `mode.initializeWorkspace({ workspace, signal, storage })`.
  Se l'inizializzazione fallisce o l'AbortSignal viene interrotto:
  - Viene rimosso lo spazio storage parzialmente scritto (`workspaceStateStore.remove`).
  - Viene cancellato il record host appena allocato (`deps.workspaces.delete`).
  - L'operazione lancia un `PluginHostError(500)` diagnostico. Non viene navigato alcun workspace inesistente e non viene lasciato alcun record fantasma.
  - Se invece la cancellazione dello storage fallisce durante il rollback, il record host viene mantenuto intenzionalmente e notificato via evento per consentire l'ispezione e il recupero dell'orfano.
- **Prevenzione Concorrenza**:
  In `components/study-hub-catalog.tsx:265`, `setLaunchingModeKeys` tiene traccia delle modalità in fase di avvio, disabilitando la card ed evitando doppi click accidentali. Se due richieste concorrenti raggiungono comunque il server, ciascuna genera un UUID indipendente senza conflitti.
- **Valutazione Area D**: **PASS**.

### E. Plugin Lifecycle e Disponibilità
- **Derivazione a Runtime**:
  In [src/core/workspaces.ts:149-158](/home/joel/learnharness/src/core/workspaces.ts:149), `resolveWorkspaceAvailability` confronta il workspace con lo snapshot corrente dei plugin attivi:
  ```ts
  const plugin = plugins.find((candidate) => candidate.id === workspace.pluginId);
  if (!plugin) return "plugin-missing";
  if (!plugin.enabled) return "plugin-disabled";
  if (!plugin.modeIds.includes(workspace.modeId)) return "mode-missing";
  return "available";
  ```
  La disponibilità **non è memorizzata nel record su disco**, ma calcolata dinamicamente.
- **Preservazione dei Record**:
  Disabilitare o disinstallare un plugin revoca le registrazioni attive in memoria, ma **non cancella i record dei workspace né i dati persistenti**.
  All'eventuale riabilitazione del plugin con la stessa `modeId`, i workspace tornano istantaneamente disponibili e accessibili.
- **Valutazione Area E**: **PASS**.

### F. Workspace Route e Renderer
- **Instradamento e Identità**:
  La route Next.js è confinata a `/workspaces/[id]`.
  Non vengono utilizzati parametri di query (`?plugin=...&mode=...`) per determinare l'identità del plugin: l'host interroga il proprio store persistente tramite ID e risolve il proprietario autoritativo.
- **Nessuna Confusione con `registerView`**:
  `registerView()` rimane riservata alle viste plugin fisse globali (`/plugins/[pluginId]/[viewId]`).
  I workspace utilizzano esclusivamente il nuovo contratto dedicato `registerModeRenderer(pluginId, modeId, renderer)` e il mount orchestrato da `manager.mountWorkspace()`.
- **Stati Non Disponibili Recuperabili**:
  `WorkspaceScreen` visualizza layout distinti con indicazioni chiare e rimediabili per 404, server error, network error, plugin-disabled, plugin-missing e mode-missing. In nessuno di questi stati viene eseguita una cancellazione del record.
- **Valutazione Area F**: **PASS**.

### G. Cleanup e Resource Lifecycle
- **Unmount e Gestione Segnali**:
  In [components/plugin-manager.ts:765-792](/home/joel/learnharness/components/plugin-manager.ts:765):
  - Il montaggio alloca un `AbortController` dedicato alla vista.
  - Al disinnesco del componente (unmount), la funzione di release invoca `controller.abort()`, che notifica il segnale al renderer e interrompe le chiamate storage pendenti (`signal.throwIfAborted()`).
  - Viene eseguito l'eventuale callback di cleanup restituito dal plugin (`typeof cleanup === "function"`).
  - Il nodo DOM `child` viene rimosso dal contenitore.
- **Compatibilità con React StrictMode**:
  L'esecuzione del mount all'interno di `mount()` viene posposta a un microtask (`Promise.resolve().then(...)`): durante il probe di montaggio/smontaggio immediato di StrictMode, il cleanup sincrono imposta `alive = false` prima che il microtask esegua il renderer del plugin, rendendo il probe totalmente inerte ed esente da memory leak o doppi montaggi sporchi.
- **Valutazione Area G**: **PASS**.

### H. Integrazione con Directory e Organizzazione
- **Modello Comune Unificato**:
  In [src/core/organization.ts](/home/joel/learnharness/src/core/organization.ts) e [src/server/directory.ts](/home/joel/learnharness/src/server/directory.ts), le entità chat e workspace condividono l'interfaccia `DirectoryEntry`.
- **Creazione e Placement**:
  I nuovi workspace appaiono come elementi *root/unorganized* ordinati per data (`updatedAt` discendente).
  Una riga nella mappa `org.placements` viene creata solo nel momento in cui l'utente esegue uno spostamento in una cartella, un riordino esplicito (`order`) o un'archiviazione (`archivedAt`).
- **Archiviazione Reversibile**:
  L'archiviazione imposta `archivedAt` nel record di placement organizzativo. Il record del workspace e lo storage del plugin restano intatti.
- **Valutazione Area H**: **PASS**.

---

## 6. Tabella di Conformità ai Requisiti di Specifica

| Requisito | Specifica di Riferimento | Stato | Evidenza e Note |
|---|---|---|---|
| **FR-01: Mode registration** | `01-product-requirements.md` §4 | **PASS** | `ctx.registerMode()` in `plugin-host.ts:320`, validato da `preparePluginMode`. |
| **FR-02: Mode metadata** | `01-product-requirements.md` §4 | **PASS** | ID limitato, icone Lucide supportate, categorie, tag e difficoltà validate in `plugin-modes.ts`. |
| **FR-03: Mode catalog** | `01-product-requirements.md` §4 | **PASS** | `StudyHubCatalog` con ricerca fuzzy, filtri categoria/difficoltà, stati empty/loading/error. |
| **FR-04: Create workspace** | `01-product-requirements.md` §4 | **PASS** | Creazione persistente, ID host univoco, collocazione a root, nessuna dipendenza da cartelle attive. |
| **FR-05: Independent instances** | `01-product-requirements.md` §4 | **PASS** | Ogni lancio crea un UUID v4 distinto e una sottocartella dati indipendente. |
| **FR-06: Persistence** | `01-product-requirements.md` §4 | **PASS** | Record in `workspaces/<id>.json`, stato in `<plugin-data>/<id>/workspaces/<wsId>/`. Testati dopo restart. |
| **FR-07: Mixed organization** | `01-product-requirements.md` §4 | **PASS** | Chat e workspace convivono nelle medesime cartelle con sibling ordering deterministico. |
| **FR-08: Archive and restore** | `01-product-requirements.md` §4 | **PASS** | Archiviazione opera su `org.placements` senza cancellare dati host o plugin. |
| **FR-09: Workspace navigation** | `01-product-requirements.md` §4 | **PASS** | Route `/workspaces/[id]` risolve metadati autoritativi; stati non disponibili gestiti ed espliciti. |
| **FR-10: Workspace lifecycle** | `01-product-requirements.md` §4 | **PASS** | Confini host vs plugin rispettati; unmount rilascia risorse senza toccare la persistenza. |
| **NFR: Public API compatibility** | `03-api-contracts.md` §1 | **PASS** | API v1 preserved (`registerView`, `placeAction`, ecc. intatti senza modifiche distruttive). |
| **NFR: Data safety & unknown versions** | `04-data-model.md` §7 | **PASS** | `parseWorkspaceRecord` e `store.update` rifiutano scritture su record con `version > 1` o chiavi sconosciute. |
| **Data model: WorkspaceRecord schema** | `04-data-model.md` §5 | **PARTIAL** | Omissione dei campi `state` e `lastError`; parsing rigido a 7 chiavi fisse (Finding F-02). |
| **Deletion journal recovery** | `02-architecture.md` §9 | **PASS** | Cancellazione a 3 fasi con journal su disco `deletions.json`, verificato al boot. |

---

## 7. Registro dei Finding e Difetti Riscontrati

### Finding P0 — Critico
*Nessun finding critico rilevato.* (L'integrità dei dati, l'isolamento e la persistenza risultano privi di falle bloccanti).

---

### Finding P1 — Alto

#### [LH-WS-01] Callback `onDelete` non collegata nel singleton `workspaceService`
- **File e Righe**: [src/server/workspaces.ts:15-18, 113-115](/home/joel/learnharness/src/server/workspaces.ts:15)
- **Flusso dei dati**:
  La funzione `createWorkspaceService` accetta nelle opzioni una callback opzionale `onDelete?: (id: WorkspaceId) => void`, che invoca al termine di `store.delete(id)`.
  In testa a `src/server/workspaces.ts`:
  ```ts
  import { workspaceKey } from "../core/organization.ts";
  import { stores } from "./stores.ts";
  import { directoryService } from "./directory.ts";
  ```
  Tuttavia, all'istanziamento del singleton esportato:
  ```ts
  export const workspaceService = createWorkspaceService({
      store: stores.workspaceStore,
  });
  ```
  `onDelete` non viene passato e i due import (`workspaceKey`, `directoryService`) rimangono inutilizzati.
- **Impatto concreto**:
  Se un chiamante server o test invoca direttamente `workspaceService.delete(id)` anziché passare da `pluginHost.deleteWorkspace(id)`, il record del workspace viene eliminato da `workspaceStore`, ma la placement in `organizationStore` (`org.placements["workspace:<id>"]`) non viene rimossa, lasciando una placement orfana nella directory.
- **Rischio attuale**:
  Mitigato dal fatto che l'endpoint HTTP DELETE (`app/api/workspaces/[id]/route.ts`) delega a `pluginTransport.deleteWorkspace`, che chiama `pluginHost.deleteWorkspace`, il quale esegue la Fase 3 con `deps.onWorkspaceDeleted`. Resta un difetto architetturale per l'API interna del servizio.
- **Correzione minima proposta**:
  Configurare `onDelete: (id) => directoryService.removePlacement(workspaceKey(id))` nell'opzione di `createWorkspaceService` in `src/server/workspaces.ts`.

---

### Finding P2 — Medio

#### [LH-WS-02] Discrepanza schema `WorkspaceRecord` tra specifica e implementazione
- **File e Righe**: [src/core/workspaces.ts:10-18, 95-125](/home/joel/learnharness/src/core/workspaces.ts:10)
- **Specifica violata**: `docs/learnharness-study-hub-spec/04-data-model.md` §5:
  ```ts
  interface WorkspaceRecord {
    version: 1;
    id: string;
    ...
    state: "ready" | "creating" | "error";
    lastError?: { code: string; message: string; occurredAt: string };
  }
  ```
- **Flusso effettivo**:
  In `src/core/workspaces.ts`, `WorkspaceRecord` omette del tutto i campi `state` e `lastError`.
  Inoltre, `parseWorkspaceRecord` convalida rigidamente:
  ```ts
  const expectedKeys = ["createdAt", "id", "modeId", "pluginId", "title", "updatedAt", "version"];
  if (keys.length !== expectedKeys.length || keys.some((key, index) => key !== expectedKeys[index])) return invalidWorkspaceRecord();
  ```
- **Impatto concreto**:
  1. Durante la creazione del workspace, se l'inizializzazione del plugin fallisce, l'host esegue un rollback transazionale immediato anziché persistere lo stato `"error"`. L'architettura `02-architecture.md` §9 consentiva di "scegliere tra rollback o recoverable failed workspace", ma aver escluso tali campi dal parser fa sì che qualsiasi record preesistente o generato da strumenti esterni con campi `state` o `lastError` venga respinto con errore `Could not read workspace record. Its data is invalid or newer than this app.`.
  2. Mancanza di estendibilità opzionale: il parser fallisce su campi non previsti anche se non confliggenti.
- **Correzione minima proposta**:
  Rendere opzionali `state?: "ready" | "creating" | "error"` e `lastError?: ...` nel tipo `WorkspaceRecord` e ammetterli in `parseWorkspaceRecord` senza rompere la validazione delle 7 chiavi base.

#### [LH-WS-03] Assenza di autenticazione dell'origine del plugin sugli endpoint di stato
- **File e Righe**: [src/server/plugin-host.ts:753-770](/home/joel/learnharness/src/server/plugin-host.ts:753) e [app/api/workspaces/[id]/state/[key]/route.ts](/home/joel/learnharness/app/api/workspaces/%5Bid%5D/state/%5Bkey%5D/route.ts)
- **Flusso dei dati**:
  La route HTTP `/api/workspaces/[id]/state/[key]` riceve l'ID del workspace dall'URL. `pluginHost.workspaceState` legge il record host per determinare `workspace.pluginId` e apre la cartella dati di quel plugin.
- **Impatto concreto**:
  In ambiente browser, se due plugin sono entrambi abilitati, il codice di un plugin A potrebbe teoricamente effettuare un `fetch('/api/workspaces/<id-del-plugin-B>/state/<key>')` e leggere/scrivere lo stato del workspace di B, poiché non vi è una session/capability token che leghi la richiesta HTTP allo specifico renderer del plugin chiamante.
  L'isolamento è garantito a livello cooperativo dall'oggetto `context.storage` in `plugin-manager.ts`, ma non è blindato al confine HTTP di rete locale.
- **Correzione minima proposta**:
  Documentare questo confine architetturale nel modello di sicurezza del Plugin Host oppure introdurre un token volatile di mount generato da `plugin-manager.ts` per autorizzare le chiamate di storage dell'istanza attiva.

---

### Finding P3 — Basso

#### [LH-WS-04] Riuso dell'evento finestra `lh:chat-renamed` per i workspace
- **File e Righe**: [components/workspace-screen.tsx:170, 201](/home/joel/learnharness/components/workspace-screen.tsx:170) e [components/plugin-manager.ts:733](/home/joel/learnharness/components/plugin-manager.ts:733)
- **Flusso dei dati**:
  Al rename di un workspace (`commitRename` o `context.setTitle`), il client scatena:
  `window.dispatchEvent(new CustomEvent("lh:chat-renamed", { detail: { id: workspace.id, title } }))`
  affinché `components/sidebar.tsx:1071` aggiorni il testo nella sidebar senza attendere il refetch di rete.
- **Impatto concreto**:
  Funziona correttamente a runtime, ma costituisce una deviazione semantica e un debito tecnico concettuale (un workspace non è una chat).
- **Correzione minima proposta**:
  Generalizzare l'evento a `lh:entry-renamed` o supportare `lh:workspace-renamed` affiancandolo a `lh:chat-renamed` nei listener della sidebar.

---

## 8. Analisi di Copertura dei Test e Gap Identificati

La suite di test per il lifecycle dei workspace è stata eseguita con esito **70 passati su 70** per la parte core/service e **94 passati su 94** per la parte UI/directory.

### Matrice dei 14 Scenari Obbligatori

| Scenario Richiesto | File di Test Esistente | Comportamento Verificato | Copertura / Gap Rilevati |
|---|---|---|---|
| **1. Create/read workspace** | `tests/workspaces.test.ts:37`, `study-hub-phase7-acceptance.test.ts:34` | Scrittura atomica record e indice; lettura per ID e lista completa. | **COMPLETA**. Verificata su disco reale. |
| **2. Due istanze dello stesso mode** | `tests/study-hub-phase7-recovery.test.ts:98`, `workspaces.test.ts:151` | Lancio ripetuto: ID distinti, metadati indipendenti, storage isolato. | **COMPLETA**. Verificata separazione namespace. |
| **3. Isolamento dei dati** | `tests/plugin-workspace-state.test.ts:9`, `study-hub-phase7-recovery.test.ts:98` | Modifica `storage.set` sull'istanza 1 non altera lo stato dell'istanza 2. | **COMPLETA**. Testati limiti 1 MiB e anti-path traversal. |
| **4. Persistenza dopo navigazione** | `tests/study-hub-phase4.test.tsx:16`, `study-hub-phase7-acceptance.test.ts` | Smontaggio e rimontaggio della shell: stato plugin preservato. | **COMPLETA**. Controller abortito su unmount, stato su disco intatto. |
| **5. Persistenza dopo riavvio** | `tests/study-hub-phase7-recovery.test.ts:37`, `study-hub-workspace-availability.test.ts:466` | Ricostruzione da zero delle classi Store/Service su disco esistente. | **COMPLETA**. Sia metadati host che payload plugin recuperati. |
| **6. Rename senza perdita stato** | `tests/workspaces.test.ts:151`, `study-hub-hardening.test.ts:31` | Modifica `title` e `updatedAt`: identità host immutabile, storage plugin intatto. | **COMPLETA**. |
| **7. Unknown newer schema** | `tests/workspaces.test.ts:29, 124`, `study-hub-phase7-recovery.test.ts:167` | Record o indice con `version: 2` rifiuta la scrittura e preserva il file sul disco. | **COMPLETA**. |
| **8. Plugin disable/uninstall** | `tests/study-hub-phase7-lifecycle.test.ts:58, 160`, `study-hub-workspace-availability.test.ts:200` | Disabilitazione plugin o cancellazione cartella: record preservati, availability "disabled" o "missing". | **COMPLETA**. `plugin-data` preservata all'uninstall del pacchetto. |
| **9. Plugin re-enable/reinstall** | `tests/study-hub-phase7-lifecycle.test.ts:58, 160`, `study-hub-phase7-acceptance.test.ts:260` | Re-installazione/abilitazione ripristina la disponibilità a "available" con dati intatti. | **COMPLETA**. |
| **10. Initialization failure & recovery** | `tests/study-hub-hardening.test.ts:53, 102`, `study-hub-phase7-lifecycle.test.ts:210` | Errore in `initializeWorkspace`: rollback di storage e record host; testati anche rollback parziali. | **COMPLETA**. |
| **11. Concorrenza e async** | `tests/study-hub-phase7-lifecycle.test.ts:260`, `study-hub-catalog.test.tsx:230` | Registrazioni asincrone revocate prima del completamento; lanci paralleli. | **COMPLETA**. |
| **12. Workspace unavailable** | `tests/study-hub-phase4.test.tsx:6, 7`, `study-hub-workspace-availability.test.ts` | Rendering UI dedicato per ciascuno stato di indisponibilità senza crash o perdite. | **COMPLETA**. |
| **13. Cleanup durante unmount** | `tests/study-hub-phase4.test.tsx:16`, `components/plugin-manager.ts:778` | Rilascio listener, abort di AbortController, rimozione container DOM, probe StrictMode. | **COMPLETA**. |
| **14. Archive/restore senza perdita** | `tests/study-hub-phase4.test.tsx:11, 12`, `tests/directory-service.test.ts:16`, `tests/study-hub-hardening.test.ts:19` | Archiviazione e ripristino cartella mista: `archivedAt` aggiornato, record e dati plugin intatti. | **COMPLETA**. |

### Gap di Test Evidenziati
1. **Test E2E Electron Reale**: Come evidenziato nella specifica `08-testing-and-acceptance.md` §8, il test `study-hub-phase7-acceptance.test.ts` simula i 23 passaggi in ambiente sintetico (Node + JSDOM). Non costituisce una prova E2E all'interno del vero binario Electron.
2. **Copertura onDelete su Singleton**: Nessun test verificava la cancellazione tramite l'istanza singleton di `workspaceService` esportata da `src/server/workspaces.ts`, motivo per cui il mancato cablaggio di `onDelete` (Finding F-01) non è stato intercettato dai test unitari dello store.

---

## 9. Rischi di Compatibilità e Persistenza

1. **Rischio di incompatibilità forward-compatible per `WorkspaceRecord`**:
   L'eccessiva rigidità di `parseWorkspaceRecord` (che rifiuta qualunque chiave non presente nella whitelist di 7 chiavi esatte) potrebbe bloccare l'evoluzione dello schema v1 qualora venissero introdotti campi facoltativi o metadati aggiuntivi senza un bump a `version: 2`.
2. **Rischio di lock o contesa su `deletions.json`**:
   Il file di journal di cancellazione `deletions.json` viene scritto atomicamente. Se più cancellazioni concorrenti avvengono in parallelo, l'ultima scrittura atomica prevale sulla base dell'array letto in memoria. Poiché LearnHarness è un'applicazione desktop a singolo utente locale, il rischio di collisione è trascurabile, ma è opportuno serializzare le cancellazioni a livello di processo.
3. **Persistenza e migrazione cartelle legacy**:
   La funzione `safePluginDataDirectory` gestisce la migrazione automatica dalla vecchia cartella interna `plugins/<id>/data` alla nuova cartella esterna `plugin-data/<id>`. Il test `refuses ambiguous migration` dimostra che se entrambe esistono, il sistema si rifiuta di sovrascrivere per sicurezza dei dati dell'utente.

---

## 10. Proposta di Correzione Minima per Ogni Finding

### Correzione F-01 (P1 — Callback `onDelete` in `src/server/workspaces.ts`)
```diff
--- a/src/server/workspaces.ts
+++ b/src/server/workspaces.ts
@@ -112,4 +112,5 @@ export function createWorkspaceService({ store, now = () => new Date().toISOS
 export const workspaceService = createWorkspaceService({
 	store: stores.workspaceStore,
+	onDelete: (id) => directoryService.removePlacement(workspaceKey(id)),
 });
```

### Correzione F-02 (P2 — Campi opzionali in `WorkspaceRecord`)
Estendere l'interfaccia in `src/core/workspaces.ts` ammettendo `state?: "ready" | "creating" | "error"` e `lastError?: { code: string; message: string; occurredAt: string }`, aggiornando la lista delle chiavi ammissibili in `parseWorkspaceRecord` senza renderle obbligatorie.

### Correzione F-03 (P2 — Autenticazione boundary HTTP per lo storage dei plugin)
Associare a ciascun workspace un capability secret o token effimero scambiato tra `mountWorkspace` e gli endpoint `/api/workspaces/[id]/state/[key]`, verificando che la richiesta provenga dalla sessione autorizzata.

### Correzione F-04 (P3 — Ridenominazione semantica evento)
Aggiornare `components/sidebar.tsx` per ascoltare sia `lh:chat-renamed` sia `lh:workspace-renamed`, e scatenare `lh:workspace-renamed` in `workspace-screen.tsx`.

---

## 11. Piano Suggerito per la Successiva RUN di Implementazione

In linea con le istruzioni dell'orchestratore e con il runbook multi-agente, si propone che la successiva RUN (RUN 5) si concentri sui seguenti interventi chirurgici:

1. **Riparazione F-01**:
   - Cablaggio di `onDelete` in `workspaceService` in `src/server/workspaces.ts`.
   - Aggiunta di un test di regressione dedicato che verifichi l'eliminazione della placement in `organizationStore` chiamando direttamente `workspaceService.delete(id)`.
2. **Riconciliazione F-02**:
   - Aggiornamento non distruttivo di `parseWorkspaceRecord` per supportare campi opzionali senza rompere la validazione delle 7 chiavi core.
3. **Pulizia Import e Debito Tecnico**:
   - Rimozione degli unused imports in `src/server/workspaces.ts`.
   - Generalizzazione dell'evento di rename per la sidebar.

---

## 12. Verifiche Non Eseguibili e Relative Motivazioni

1. **Esecuzione in ambiente Electron Nativo (GUI)**:
   - *Motivazione*: L'ambiente corrente è una sandbox Linux priva di display server X11/Wayland interattivo per il runtime Electron. Tutte le verifiche frontend sono state condotte tramite i test runner headless e le fixture JSDOM/React Testing.
2. **Crash fisico dell'alimentazione durante la Fase 2 di cancellazione**:
   - *Motivazione*: Non è possibile provocare un kernel panic o un power-cut reale dell'hardware; la robustezza del journal è stata verificata tramite simulazione di eccezioni di I/O sincrone e asincrone (`t.mock.method(fs, "renameSync")` e `unlinkSync`).

---

## 13. Verdetto Finale

# VERDETTO: PASS WITH GAPS

### Motivazione:
Il ciclo di vita dei workspace già implementato su `feat/study-hub` dimostra un'elevata maturità tecnica:
- I workspace sono **autentiche istanze indipendenti, persistenti e isolate**, non semplici viste plugin associate a un ID.
- L'isolamento dello storage per workspace e per plugin è ermetico e protetto da path traversal e symlink attack.
- La resilienza della cancellazione con journal a 3 fasi impedisce la corruzione dei dati anche a fronte di errori di I/O parziali.
- L'integrazione con la Directory condivisa e l'organizzazione mista delle cartelle è impeccabile e reversibile.
- I gap riscontrati (F-01 e F-02) sono circoscritti, perfettamente documentati e risolvibili con modifiche minime non distruttive.
