# RUN 3.1 — Visual Explanation: Contract Consistency Fix

Data: 17 Novembre 2026
Autore: Gemini 3.8 Flash (Agente Tecnico Singolo)
Orchestratore: ChatGPT
Repository: `MrJoelao/learnharness`
Branch: `feat/study-hub`
Commit di riferimento: `96d11fff203ccadf9de6ab1dc972abc0ddf0e81a`

---

## 1. Baseline Git e Preflight

- **HEAD iniziale:** `96d11fff203ccadf9de6ab1dc972abc0ddf0e81a`
- **Branch:** `feat/study-hub`
- **Stato del working tree all'avvio:** Pulito (`nothing to commit, working tree clean`).
- **Commit / Push eseguiti in RUN 3.1:** Commit `8d870a2b5af77183651b27277864839945a730ef` eseguito e pushato su `origin/feat/study-hub` previa autorizzazione esplicita dell'utente.

---

## 2. Finding iniziali

### Finding A — Incoerenza su `MAX_CONTROLS`
- **Osservazione:** In `src/core/contracts/visual-explanation.ts`, la costante `VISUAL_ARTIFACT_LIMITS.MAX_CONTROLS` era impostata su `8`.
- **Incoerenza:** La specifica `06-visual-explanation-engine.md` e il report della RUN 3 dichiaravano un massimo di 5 controlli per artefatto.
- **Impatto:** Sia lo schema TypeBox del tool agente (`visual_explanation`) sia il validatore server-side ereditavano `MAX_CONTROLS = 8`, accettando fino a 8 controlli invece del limite approvato di 5.

### Finding B — Validazione SVG non uniforme tra backend e frontend
- **Osservazione:** Il tool agente `visual_explanation` invocava `validateDeclarativeVisualArtifact()`, che applica rigidamente la modalità stretta `{ strictDeclarative: true }` richiedendo documenti JSON conformi allo schema `learnharness.visual.svg.v1`. Al contrario, `VisualExplanationCard` invocava `validateVisualArtifact()` in modalità permissiva, accettando stringhe SVG XML statiche tramite `validateSvgSource()`.
- **Incoerenza:** Rischio di asimmetria contrattuale: la card frontend era potenzialmente in grado di accettare SVG XML grezzi non conformi allo schema dichiarativo MVP v1, mentre il backend produceva e validava esclusivamente documenti JSON dichiarativi.

---

## 3. Ispezione dati persistiti e dipendenze reali

1. **Persistenza locale (`data/chats/`):**
   - Ispezionati tutti i record di chat con artefatti visivi:
     - `data/chats/chat_mwjjrzdj_3e0c1417.json` (ID: `vis-n116d5ly`)
     - `data/chats/chat_mwj9gg4r_83c4b4c1.json` (ID: `vis-C2vkkUZK`)
     - `data/chats/chat_mwj4hk3n_1d66dcff.json` (ID: `vis-jGpACAOK`)
     - `data/chats/chat_mwj4if2p_21959065.json` (ID: `vis-1FdsPc29`)
   - **Risultato:** Il 100% degli artefatti persistiti (4 su 4) possiede `renderer: "svg"`, payload sorgente JSON con schema `learnharness.visual.svg.v1` e `controls: undefined`.
   - **Esito:** Zero artefatti SVG XML statici o HTML persistiti; non sussiste alcun fabbisogno di retrocompatibilità su dati reali.
2. **Fixture e consumatori interni:**
   - I soli consumatori del percorso permissivo per SVG XML erano fixture di test locali che utilizzavano markup SVG inline per simulare il rendering grafico.
   - Non esistono dipendenze in produzione verso SVG XML grezzo o verso HTML.

---

## 4. Decisioni applicate

### Correzione Finding A (`MAX_CONTROLS = 5`)
1. Impostato `VISUAL_ARTIFACT_LIMITS.MAX_CONTROLS = 5` in `src/core/contracts/visual-explanation.ts`.
2. Verificato che lo schema TypeBox in `src/agent/tools/visual-explanation.ts` (`maxItems: VISUAL_ARTIFACT_LIMITS.MAX_CONTROLS`) e il validatore in `src/core/visual-explanation-validator.ts` ereditano entrambi dalla costante senza ridondanze hardcoded.
3. Aggiornati i test di boundary in `tests/visual-explanation-envelope.test.ts` e `tests/visual-explanation-tool.test.ts`:
   - 5 controlli button validi vengono esplicitamente accettati.
   - 6 controlli button vengono esplicitamente rifiutati (`controls count exceeds limit of 5`).

### Correzione Finding B (Validazione stretta e uniforme)
1. In `components/artifacts/visual-explanation-card.tsx`, uniformata la validazione frontend invocando `validateDeclarativeVisualArtifact(rawOutput)`.
2. Qualsiasi sorgente non conforme allo schema JSON dichiarativo `learnharness.visual.svg.v1` (inclusi SVG XML statici `<svg>...</svg>`) viene ora rifiutata fail-closed a livello di card con messaggio diagnostico esplicito (`"Raw SVG XML is not permitted. Artifact source must be a declarative JSON document matching schema 'learnharness.visual.svg.v1'."`), mostrando l'alert di errore senza montare SVG né iframe.
3. Preservata la funzione di sanitizzazione `validateSvgSource()` e l'opzione `strictDeclarative` nel modulo validatore per garantire la continuità dei test di sicurezza avversaria XML (`tests/visual-explanation-security.test.ts`), evitando rimozioni arbitrarie prive di giustificazione.
4. Aggiornate le fixture dei test frontend (`visual-explanation-card.test.tsx`, `visual-explanation-controls.test.tsx`, `study-hub-phase7-accessibility-perf.test.tsx`) convertendole in documenti JSON conformi a `learnharness.visual.svg.v1`.
5. Aggiunto test esplicito in `tests/visual-explanation-card.test.tsx` che accerta il rifiuto fail-closed di SVG XML grezzi con rendering del relativo banner di errore.

---

## 5. File modificati

| File | Modifica apportata |
|---|---|
| `src/core/contracts/visual-explanation.ts` | Impostato `VISUAL_ARTIFACT_LIMITS.MAX_CONTROLS = 5`. |
| `components/artifacts/visual-explanation-card.tsx` | Importato e utilizzato `validateDeclarativeVisualArtifact` per validare strettamente i payload nella card prima del rendering. |
| `tests/visual-explanation-tool.test.ts` | Aggiornato il test BUG P2 per verificare l'accettazione a 5 controlli e il rifiuto a 6 controlli. |
| `tests/visual-explanation-envelope.test.ts` | Aggiornato il test di envelope su `MAX_CONTROLS` per verificare l'accettazione di 5 controlli e il rifiuto di 6 controlli. |
| `tests/visual-explanation-card.test.tsx` | Convertite le fixture da SVG XML a JSON dichiarativo `learnharness.visual.svg.v1`. Aggiunto test esplicito per la reiezione di raw SVG XML nella card. |
| `tests/visual-explanation-controls.test.tsx` | Convertite le fixture di test reattivi e di in-place update a JSON dichiarativo conforme allo schema. |
| `tests/study-hub-phase7-accessibility-perf.test.tsx` | Convertita la fixture dell'artefatto di cleanup da SVG XML a JSON dichiarativo conforme a `learnharness.visual.svg.v1`. |

---

## 6. Comandi eseguiti ed esiti reali

1. **TypeScript Typecheck (`npm run typecheck`):**
   - Comando: `tsc --noEmit`
   - **Esito:** `Exit code 0` (0 errori).
2. **Visual Explanation Test Suite:**
   - Comando: `NODE_ENV=test npx tsx --test tests/visual-explanation-*.test.*`
   - **Esito:** `tests 105, suites 12, pass 105, fail 0` (`4.58s`).
3. **Phase 7 Acceptance Regression Suite:**
   - Comando: `NODE_ENV=test npx tsx --test tests/study-hub-phase7-*.test.*`
   - **Esito:** `tests 18, suites 0, pass 18, fail 0` (`3.42s`).
4. **ESLint su tutti i file modificati:**
   - Comando: `npx eslint src/core/contracts/visual-explanation.ts components/artifacts/visual-explanation-card.tsx tests/visual-explanation-card.test.tsx tests/visual-explanation-controls.test.tsx tests/visual-explanation-envelope.test.ts tests/visual-explanation-tool.test.ts`
   - **Esito:** `Exit code 0` (0 errori, 0 warning).
5. **Git Diff Check (`git diff --check`):**
   - **Esito:** `Exit code 0` (nessun whitespace issue o conflitto).
6. **Plugin Authoring Skill Build (`npm run plugins:build-authoring`):**
   - **Esito:** `Exit code 0` (dichiarazioni e zip generati con successo).
7. **Production Build (`npm run build`):**
   - **Esito:** `Exit code 0` (Next.js 16.4.3 Turbopack compilato con successo in 1.99s, TypeScript terminato in 7.0s, pagine statiche generate 10/10).

---

## 7. Problemi residui e note

1. **Nessun debito tecnico introdotto:**
   - Tutti i contratti (specifica, tipi core, schema TypeBox, validatore server-side e validatore frontend) sono ora perfettamente allineati su `MAX_CONTROLS = 5` e sullo schema `learnharness.visual.svg.v1`.
2. **Next.js Security Advisory:**
   - Segnalato avviso di sicurezza su Next.js 16.4.3 durante la build di produzione (come da policy, le dipendenze non sono state toccate e viene rimessa all'utente l'opzione di upgrade).
3. **Stato Git:**
   - Commit `8d870a2` consolidato e sincronizzato sul branch remoto `feat/study-hub`.
   - Il repository si trova nello stato pulito e allineato, pronto per la revisione indipendente dell'orchestratore ChatGPT.
