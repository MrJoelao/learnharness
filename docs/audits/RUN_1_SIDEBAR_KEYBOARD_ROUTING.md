# Report Tecnico Run 1 — LearnHarness: Fix Keyboard Navigation & Workspace Routing in Sidebar

Data: 2026-11-17  
Autore: Gemini 3.8 Flash (Technical Implementation Agent)  
Riferimento: `MrJoelao/learnharness` — Branch `feat/study-hub`  
Finding: `LH-BUG-01` (Finding F-07 in `STUDY_HUB_REPAIR_BASELINE.md`)  
Stato Finding: **RESOLVED**

---

## 1. Diagnosi Iniziale

L'audit tecnico (`STUDY_HUB_REPAIR_BASELINE.md`) e l'ispezione della specifica UX (`docs/learnharness-study-hub-spec/05-ux-specification.md`, Sezioni 4 e 9) richiedono piena parità di interazione e accessibilità da tastiera tra normali sessioni chat e workspace nella Sidebar.

Dall'analisi del flusso di esecuzione prima delle modifiche:

1. **Rappresentazione e Focus da Tastiera nella Sidebar**:
   - `components/sidebar.tsx` gestisce l'indice di selezione virtuale da tastiera (`kbdIndex`) quando l'input di ricerca è attivo.
   - Con i tasti freccia `ArrowDown`/`ArrowUp`, `kbdIndex` viene incrementato/decrementato scorrendo l'elenco `shown` che unifica chat e workspace.
   - L'ID dell'elemento selezionato viene passato a `ChatFolderTree` come `kbdChatId`.
   - In `components/chat-folder-tree.tsx` (riga 726):
     ```tsx
     const isKbd = isWorkspace ? false : kbdChatId === item.id;
     ```
     Il valore `isKbd` veniva forzato a `false` per qualunque elemento di tipo workspace (`isWorkspace === true`), impedendo l'applicazione della classe di selezione visiva (`kbdSelected`) e dell'attributo `data-testid="workspace-row-kbd"` su `WorkspaceRow`.

2. **Scorrimento tramite `scrollIntoView`**:
   - In `components/sidebar.tsx` (righe 1358–1364), un `useEffect` su `[kbdIndex, shown]` cerca nel DOM l'elemento corrispondente all'elemento selezionato per portarlo in vista:
     ```tsx
     const row = listRef.current?.querySelector<HTMLElement>(`[data-session-id="${targetChat.id}"]`);
     row?.scrollIntoView({ block: "nearest" });
     ```
   - Poiché le righe `WorkspaceRow` espongono l'attributo `data-workspace-id` anziché `data-session-id`, `querySelector` restituiva `null` per i workspace, impedendo l'esecuzione di `scrollIntoView`.

3. **Routing con Tasto Invio**:
   - Nel gestore `onKeyDown` dell'input di ricerca in `components/sidebar.tsx` (righe 1547–1554), alla pressione di `Enter`:
     ```tsx
     router.push(`/chat/${target.id}`);
     ```
     La navigazione instradava incondizionatamente a `/chat/${target.id}`, anche quando l'elemento selezionato era un workspace (`target.kind === "workspace"`), generando un URL non valido (es. `/chat/workspace_...`) anziché indirizzare a `/workspaces/${target.id}`.

---

## 2. Root Cause Verificata

Le cause radice confermate nel codice sorgente erano:

1. **Inibizione forzata del focus kbd per i workspace**: in [chat-folder-tree.tsx:726](/home/joel/learnharness/components/chat-folder-tree.tsx:726), l'operatore ternario `isWorkspace ? false : ...` escludeva esplicitamente i workspace dall'evidenziazione da tastiera.
2. **Selettore DOM incompleto per lo scroll**: in [sidebar.tsx:1362](/home/joel/learnharness/components/sidebar.tsx:1362), `querySelector` cercava unicamente `[data-session-id="${targetChat.id}"]`, ignorando l'attributo `[data-workspace-id]` dei componenti `WorkspaceRow`.
3. **Mancanza di discriminazione del tipo di entità nell'handler Enter**: in [sidebar.tsx:1551](/home/joel/learnharness/components/sidebar.tsx:1551), il routing assumeva che qualsiasi elemento in `shown` fosse una sessione chat, omettendo il branching verso `/workspaces/${target.id}`.

---

## 3. File Modificati

1. [components/chat-folder-tree.tsx](/home/joel/learnharness/components/chat-folder-tree.tsx)
2. [components/sidebar.tsx](/home/joel/learnharness/components/sidebar.tsx)
3. [tests/sidebar-workspace-keyboard.test.tsx](/home/joel/learnharness/tests/sidebar-workspace-keyboard.test.tsx) *(nuovo test di regressione dedicato)*

Nessun file al di fuori dell'assegnazione è stato toccato.

---

## 4. Descrizione delle Correzioni

### A. Focus da tastiera nei workspace ([chat-folder-tree.tsx:726](/home/joel/learnharness/components/chat-folder-tree.tsx:726))
Rimossa la condizione discriminatoria `isWorkspace ? false`:
```tsx
// Prima:
const isKbd = isWorkspace ? false : kbdChatId === item.id;

// Dopo:
const isKbd = kbdChatId === item.id;
```
Quando `kbdChatId` coincide con l'ID di un workspace, `isKbd` vale `true`, abilitando `kbdSelected` su `<WorkspaceRow>` con la corretta classe di anello visivo (`ring-1 ring-border/80`) e `data-testid="workspace-row-kbd"`.

### B. Scroll automatico per elementi misti ([sidebar.tsx:1359–1365](/home/joel/learnharness/components/sidebar.tsx:1359-1365))
Esteso il selettore DOM per includere entrambi gli attributi:
```tsx
const row = listRef.current?.querySelector<HTMLElement>(
    `[data-session-id="${targetChat.id}"], [data-workspace-id="${targetChat.id}"]`,
);
row?.scrollIntoView({ block: "nearest" });
```
In questo modo `row` individua correttamente sia `SessionRow` (`data-session-id`) sia `WorkspaceRow` (`data-workspace-id`), invocando `scrollIntoView({ block: "nearest" })` in modo uniforme.

### C. Risoluzione corretta della destinazione su `Enter` ([sidebar.tsx:1547–1558](/home/joel/learnharness/components/sidebar.tsx:1547-1558))
Aggiunto il controllo su `target.kind`:
```tsx
if (e.key === "Enter") {
    const target = shown![kbdIndex !== null && kbdIndex < n ? kbdIndex : 0];
    if (!target) return;
    e.preventDefault();
    if (target.kind === "workspace") {
        router.push(`/workspaces/${target.id}`);
    } else {
        router.push(`/chat/${target.id}`);
    }
    setKbdIndex(null);
    e.currentTarget.blur();
}
```
Se il target selezionato è un workspace, la navigazione reindirizza a `/workspaces/${target.id}`. Se è una chat normale, continua a reindirizzare a `/chat/${target.id}`. Al termine, il focus sul campo di ricerca viene rimosso (`blur()`) e `kbdIndex` viene resettato.

---

## 5. Test Aggiunti o Aggiornati

È stato creato il file di test dedicato [tests/sidebar-workspace-keyboard.test.tsx](/home/joel/learnharness/tests/sidebar-workspace-keyboard.test.tsx) con 5 scenari:

1. **`ChatFolderTree: workspace receives kbdSelected and renders data-testid='workspace-row-kbd' when kbdChatId matches`**:
   - Verifica che un workspace riceva lo stato `kbdSelected` e il testid `workspace-row-kbd` quando `kbdChatId` corrisponde al suo ID.
   - Verifica che una chat normale riceva `session-row-kbd` quando selezionata.
2. **`Sidebar: ArrowDown navigates to workspace, triggers scrollIntoView on data-workspace-id, and Enter routes to /workspaces/[id]`**:
   - Simula `ArrowDown` dall'input di ricerca passando da chat a workspace.
   - Verifica che `scrollIntoView({ block: "nearest" })` venga invocato sull'elemento con `data-workspace-id`.
   - Verifica la presenza dell'evidenziazione grafica `workspace-row-kbd`.
   - Simula `Enter` e verifica che `router.push` navighi a `/workspaces/${sampleWorkspace.id}` e che il campo perda il focus.
3. **`Sidebar: Enter on a normal chat continues to route to /chat/[id]`**:
   - Verifica che la navigazione delle chat normali tramite `ArrowDown` ed `Enter` rimanga invariata verso `/chat/${sampleChat.id}`.
4. **`Sidebar: ArrowUp from idle wraps around to last item (workspace) and activates it`**:
   - Verifica la navigazione circolare dal primo elemento verso l'ultimo (workspace) con `ArrowUp`, lo scroll corretto e l'attivazione con `Enter`.
5. **`Sidebar: Direct Enter without arrow keys selects first shown item and routes workspace to /workspaces/[id]`**:
   - Verifica che premere `Enter` direttamente senza previa navigazione con frecce (fallback `shown[0]`) instradi correttamente al workspace quando questo è in cima ai risultati.

---

## 6. Comandi Effettivamente Eseguiti e Risultati

| Comando | Esito | Dettaglio |
|---------|-------|-----------|
| `git status && git branch --show-current` | Codice 0 | Branch `feat/study-hub` confermato |
| `NODE_ENV=test npx tsx --test tests/sidebar-workspace-keyboard.test.tsx` *(pre-fix)* | Codice 1 | Fallimento riprodotto su focus forzato a false e mancato scroll su workspace |
| `NODE_ENV=test npx tsx --test tests/sidebar-workspace-keyboard.test.tsx` *(post-fix)* | Codice 0 | 5/5 test passati |
| `npm run typecheck` (`tsc --noEmit`) | Codice 0 | 0 errori TypeScript |
| `npx eslint components/chat-folder-tree.tsx components/sidebar.tsx tests/sidebar-workspace-keyboard.test.tsx` | Codice 0 | 0 errori, 0 warning ESLint |
| `NODE_ENV=test npx tsx --test tests/study-hub-phase4.test.tsx tests/study-hub-phase7-accessibility-perf.test.tsx tests/render-sidebar.test.tsx tests/sidebar-ux-refinement.test.tsx` | Codice 0 | 47/47 test passati |
| `NODE_ENV=test npx tsx --test tests/sidebar-workspace-keyboard.test.tsx tests/study-hub-*.test.* tests/directory-*.test.ts tests/workspaces.test.ts tests/plugin-modes.test.ts tests/render-sidebar.test.tsx tests/sidebar-ux-refinement.test.tsx tests/keyboard-*.test.*` | Codice 0 | 238/238 test passati |
| `NODE_ENV=test npx tsx --test tests/visual-explanation-*.test.*` | Codice 0 | 103/103 test passati |
| `npm run build` | Codice 0 | Compilazione Next.js, worker plugin e generazione statica 10/10 completate |
| `git diff --check` | Codice 0 | Nessun whitespace o sintassi non valida |

---

## 7. Eventuali Test Non Eseguiti e Motivazione

- **Global test suite (`npm test`) su tutti i 250+ file del repo**: non eseguita per intero a causa dei noti timeout dovuti alla concorrenza di JSDOM/timer su test legacy non correlati (già documentato in `STUDY_HUB_REPAIR_BASELINE.md` come finding `UNVERIFIED-01`).
- **Verifica interattiva manuale nel browser**: non eseguibile nell'ambiente di test headless; completamente coperta dai test DOM con simulazione di eventi e rendering linkedom.

---

## 8. Regressioni Individuate o Escluse

- **Navigazione chat ordinarie**: ESCLUSA regressione. I test mirati (test 3 di `sidebar-workspace-keyboard.test.tsx` e la suite completa `study-hub-phase4.test.tsx`) confermano che `router.push(`/chat/${id}`)` continua a operare senza modifiche per tutti gli elementi con `kind !== "workspace"`.
- **Drag-and-Drop e selezione mouse**: ESCLUSA regressione. `onSelectWorkspace` e `onSelectChat` mantengono i callback originari.
- **Accessibilità e focus loop**: ESCLUSA regressione. Gli attributi `aria-label`, `data-testid="workspace-row-kbd"` e `data-testid="session-row-kbd"` rispettano la semantica del design system.

---

## 9. Problemi Rimasti Aperti

- Nessun problema aperto per l'area `LH-BUG-01`.
- Come da vincolo della Run 1, i finding `SPEC-CONFLICT-01` e `SPEC-CONFLICT-02` rimangono intatti e rimandati alla Run 2.

---

## 10. Classificazione Finale

**`LH-BUG-01`**: **`RESOLVED`**
