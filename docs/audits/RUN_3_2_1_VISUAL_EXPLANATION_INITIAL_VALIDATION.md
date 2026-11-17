# RUN 3.2.1 — Visual Explanation: Complete Initial Artifact Validation

Data: 17 Novembre 2026  
Autore: Gemini 3.8 Flash (Agente Tecnico Singolo)  
Orchestratore / Revisore: ChatGPT  
Repository: `MrJoelao/learnharness`  
Branch: `feat/study-hub`  
Commit di riferimento: `f5a8927203c1a1958da00e221e25bd5f7ee49b15`

---

## 1. Baseline Git e Preflight

- **Branch attivo:** `feat/study-hub`
- **HEAD di partenza:** `f5a8927203c1a1958da00e221e25bd5f7ee49b15` (`f5a8927`)
- **Stato del working tree all'avvio:** Pulito (`nothing to commit, working tree clean`).
- **Nessuna delega o subagente:** Implementazione condotta interamente e direttamente da Gemini 3.8 Flash.
- **Commit e Push:** Nessun commit o push effettuato, in rispetto dei vincoli di pre-autorizzazione.

---

## 2. Analisi e Finding

### Finding A — Validazione Envelope Incompleta all'Ingresso di `VisualExplanationInstance`
- **Criticità rilevata:** Nella RUN 3.2, `VisualExplanationInstance` utilizzava `parseDeclarativeSvg(initialArtifact.source)` unitamente al controllo `initialArtifact.renderer !== "svg"`. Sebbene ciò bloccasse stringhe SVG XML statiche o JSON grafici malformati, l'envelope complessivo (`version`, `id`, `title`, proprietà privilegiate, limiti di controlli, `initialState.step`) non veniva validato formalmente con `validateDeclarativeVisualArtifact(initialArtifact)`.
- **Rischio:** Un chiamante diretto di `VisualExplanationInstance` (o un payload non transitato dal wrapper `VisualExplanationCard`) poteva fornire proprietà privilegiate (`token`, `filesystem`), versioni non supportate o ID malformati che raggiungevano l'istanza interna.

### Finding B — Registry Trust Boundary
- **Criticità rilevata:**
  1. `registerVisualArtifact()` memorizzava direttamente l'oggetto ricevuto nel `Map` del registry e notificava i listener senza validarne previamente la conformità all'envelope e allo schema `learnharness.visual.svg.v1`.
  2. `getRegisteredVisualArtifact()` restituiva l'oggetto memorizzato senza validazione al recupero.
  3. `VisualExplanationInstanceInner` inizializzava il proprio `useState` leggendo dal registry (`getRegisteredVisualArtifact(initialArtifact.id, chatId) ?? initialArtifact`), rischiando di assumere come attendibile un dato non sanitizzato presente nel registry.

---

## 3. Modifiche Implementate

### Modifica 1: Validazione Completa all'Ingresso (`VisualExplanationInstance`)
- In `components/artifacts/visual-explanation-card.tsx`, `VisualExplanationInstance` esegue ora la validazione integrale fail-closed tramite `validateDeclarativeVisualArtifact(initialArtifact)`.
- Se `validation.valid === false` o `validation.sanitized === undefined`:
  - Viene renderizzato il messaggio diagnostico accessibile con `role="alert"`, `data-testid="visual-explanation-failed"` e l'elenco dei problemi riscontrati (`validation.problems.join("; ")`).
  - `VisualExplanationInstanceInner` **non viene montato**.
  - Nessun timer di simulazione, observer (`IntersectionObserver`), listener di finestra o registrazione a eventi viene avviato.
- Se la validazione ha successo, all'istanza interna `VisualExplanationInstanceInner` viene passato **esclusivamente `validation.sanitized`**, garantendo che l'istanza riceva un `VisualArtifact` rigorosamente tipizzato e sanitizzato.

### Modifica 2: Protezione del Trust Boundary del Registry
- **`registerVisualArtifact(artifact, chatId): boolean`**:
  - Valida l'artefatto in ingresso tramite `validateDeclarativeVisualArtifact(artifact)`.
  - Se non valido, restituisce immediatamente `false`: **nessun artefatto non conforme viene scritto nel registry e nessun listener viene notificato**.
  - Se valido, memorizza `validation.sanitized` e notifica i listener con l'oggetto sanitizzato, restituendo `true`.
- **`getRegisteredVisualArtifact(id, chatId): VisualArtifact | undefined`**:
  - Al recupero dell'entry, riesegue `validateDeclarativeVisualArtifact(entry.artifact)`. Se non valido o corrotto, restituisce `undefined`.
- **`VisualExplanationInstanceInner` Inizializzazione**:
  - In `useState`, l'eventuale artefatto recuperato dal registry viene verificato tramite `validateDeclarativeVisualArtifact(registered)`. Solo se valido e sanitizzato viene utilizzato come stato iniziale; altrimenti ricade su `initialArtifact` (anch'esso già sanitizzato all'ingresso).
- **`subscribeVisualArtifact` Listener**:
  - Il gestore di aggiornamento in `VisualExplanationInstanceInner` continua a validare strettamente ogni aggiornamento con `validateDeclarativeVisualArtifact(updated)` prima di applicare modifiche di stato, preservando l'ultimo stato valido se l'aggiornamento è non conforme.

---

## 4. File Modificati

| File | Intervento |
|---|---|
| `components/artifacts/visual-explanation-card.tsx` | Validazione completa dell'envelope in `VisualExplanationInstance` con reiezione fail-closed. Validazione e sanitizzazione in `registerVisualArtifact` e `getRegisteredVisualArtifact`. Validazione difensiva nell'inizializzazione di stato di `VisualExplanationInstanceInner`. |
| `tests/visual-explanation-card.test.tsx` | Aggiunti 8 test obbligatori per la RUN 3.2.1: envelope valido accettato, version non supportata rifiutata, ID non valido rifiutato, titolo vuoto rifiutato, proprietà privilegiate rifiutate, reiezione registrazioni non conformi nel registry, inizializzazione protetta da dati non fidati nel registry, aggiornamenti validi applicati e aggiornamenti non conformi scartati con preservazione dello stato. |
| `tests/visual-explanation-declarative.test.tsx` | Aggiornato il test su `initialState.step` per verificare che `VisualExplanationInstance` respinga fail-closed artefatti con step out-of-bounds o negativi direttamente all'ingresso (data-testid `visual-explanation-failed`). |

---

## 5. Test Obbligatori e Risultati

La suite completa è stata eseguita con successo in ambiente reale:

1. **Documento dichiarativo valido con envelope valido:** Accettato e renderizzato correttamente (`data-testid="visual-explanation-declarative-container"`, 0 iframe).
2. **Documento dichiarativo valido ma `version` non supportata (`version: 2`):** Rifiutato all'ingresso con alert diagnostico `visual-explanation-failed`.
3. **Documento dichiarativo valido ma ID non valido (caratteri non ammessi):** Rifiutato all'ingresso con alert diagnostico `visual-explanation-failed`.
4. **Documento dichiarativo valido ma titolo non valido (vuoto / whitespace):** Rifiutato all'ingresso con alert diagnostico `visual-explanation-failed`.
5. **Artefatto con proprietà privilegiate (`token`, `filesystem`):** Rifiutato all'ingresso con alert diagnostico `visual-explanation-failed`.
6. **Tentativo di registrazione artefatto non valido in `registerVisualArtifact`:** Restituisce `false`, non memorizza nel registry, non notifica listener.
7. **Recupero di artefatto dal registry in `VisualExplanationInstanceInner`:** Dati non validi vengono scartati e non possono corrompere l'inizializzazione dell'istanza.
8. **Aggiornamenti in-place:** Gli aggiornamenti validi si applicano correttamente in-place senza duplicare viste; gli aggiornamenti non validi vengono scartati preservando lo stato e il contenuto precedente con 0 iframe.

---

## 6. Comandi di Verifica Eseguiti

1. **Suite Visual Explanation:**
   - `NODE_ENV=test npx tsx --test tests/visual-explanation-*.test.*`
   - **Risultato:** `tests 117, suites 12, pass 117, fail 0` (`4.61s`).
2. **Suite Study Hub Phase 7:**
   - `NODE_ENV=test npx tsx --test tests/study-hub-phase7-*.test.*`
   - **Risultato:** `tests 18, suites 0, pass 18, fail 0` (`3.50s`).
3. **Suite Completa Integrata:**
   - `NODE_ENV=test npx tsx --test tests/visual-explanation-*.test.* tests/study-hub-phase7-*.test.*`
   - **Risultato:** `tests 135, suites 12, pass 135, fail 0` (`7.29s`).
4. **Typecheck TypeScript:**
   - `npm run typecheck` (`tsc --noEmit`)
   - **Risultato:** `Exit code 0` (0 errori).
5. **ESLint:**
   - `npx eslint components/artifacts/visual-explanation-card.tsx tests/visual-explanation-card.test.tsx tests/visual-explanation-declarative.test.tsx`
   - **Risultato:** `Exit code 0` (0 errori, 0 warning).
6. **Git Diff Check:**
   - `git diff --check`
   - **Risultato:** `Exit code 0`.
7. **Plugin Authoring Skill Build:**
   - `npm run plugins:build-authoring`
   - **Risultato:** `Exit code 0`.
8. **Next.js Production Build:**
   - `npm run build`
   - **Risultato:** `Exit code 0` (Tutti i 59 endpoint e pagine compilati e ottimizzati con successo).

---

## 7. Verdetto Finale

**ESITO: PASS**

L'intero artefatto visivo e il trust boundary del registry client-side sono ora completamente protetti da validazione runtime preventiva fail-closed. Nessun dato non sanitizzato o non conforme può raggiungere l'istanza interna o entrare nello stato attivo della simulazione.
