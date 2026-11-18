# Report RUN 7 — Next.js Security Advisory Investigation & Isolated Upgrade

**Data**: 18 Novembre 2026  
**Autore**: Gemini 3.8 Flash (Agente unico tecnico)  
**Repository**: `MrJoelao/learnharness`  
**Base Branch**: `feat/study-hub` (HEAD `d0cb9fd42aa354da269c8eaea2df64ca41ca388a`)  
**Worktree Branch**: `fix/nextjs-security-advisory`  
**Worktree Directory**: `.git/worktrees-checkout/fix-nextjs-security-advisory`  

---

## 1. Executive Summary

Durante la RUN 6 (Final Release Gate), l'esecuzione di `npm run build` su Next.js `16.4.3` aveva sollevato l'errore:
```
Error [SecurityFatalError]: Your version of Next.js is affected by a known security vulnerability.
**We strongly recommend you upgrade Next.js.**
```
La presente RUN 7 ha investigato formalmente l'origine dell'avviso di sicurezza, identificato le vulnerabilità ufficiali registrate nei registri CVE/GHSA e implementato l'upgrade minimale in un **Git worktree completamente separato e isolato**, preservando al 100% l'integrità del branch `feat/study-hub` e delle sue modifiche uncommitted.

L'aggiornamento ha allineato `next` e `@next/eslint-plugin-next` dalla versione `16.4.3` alla versione minima patch stabile **`16.4.6`** (dist-tag `latest` su npm).  
A valle dell'upgrade nel worktree isolato:
- **Zero vulnerabilità Next.js** in `npm audit` (la voce `next` è completamente rimossa dalle advisory attive).
- **Typecheck TypeScript (`npm run typecheck`)**: completato con successo (0 errori).
- **Production Build Turbopack (`npm run build`)**: compilato ed eseguito con successo al primo colpo **senza alcun blocco o avviso di sicurezza** (`exit code 0`).
- **Test suite pertinenti**: 103 test eseguiti su 103 superati (0 fail).
- **L'upgrade è pronto per essere integrato** tramite merge o cherry-pick quando l'utente lo deciderà.

---

## 2. Phase 1 — Advisory Identification

Dall'ispezione dei file di configurazione (`package.json`, `package-lock.json`), del codice di runtime Next.js (`node_modules/next/dist/lib/upgrade/nudge.js` e `prepare-upgrade.js`) e delle risposte dell'endpoint ufficiale npm advisories (`https://registry.npmjs.org/-/npm/v1/security/advisories/bulk`), sono state identificate con precisione le seguenti advisory di sicurezza:

### 2.1. Advisory 1: GHSA-mfr8-8qww-v76h
- **ID Ufficiale**: `GHSA-mfr8-8qww-v76h` (npm advisory ID: `1247486`)
- **Titolo**: *Next.js: Information disclosure across root params when a 'use cache' function is called through unstable_cache()*
- **Severità**: Moderate
- **CWE**: CWE-362 (Concurrent Execution using Shared Resource with Improper Synchronization / Race Condition)
- **Versioni vulnerabili**: `>=16.3.0 <=16.4.4`
- **Fonte ufficiale**: [GitHub Advisory Database GHSA-mfr8-8qww-v76h](https://github.com/advisories/GHSA-mfr8-8qww-v76h)

### 2.2. Advisory 2: GHSA-vc7v-qv4w-wrv8
- **ID Ufficiale**: `GHSA-vc7v-qv4w-wrv8` (npm advisory ID: `1247712`)
- **Titolo**: *Next.js: Cache leak across root param values in nested 'use cache' functions via delayed inner stream metadata*
- **Severità**: Moderate
- **CWE**: CWE-362
- **Versioni vulnerabili**: `>=16.2.0 <=16.4.4`
- **Fonte ufficiale**: [GitHub Advisory Database GHSA-vc7v-qv4w-wrv8](https://github.com/advisories/GHSA-vc7v-qv4w-wrv8)

### 2.3. Valutazione della versione installata e delle versioni patch
- **Versione originariamente installata**: `16.4.3` (ricade all'interno di entrambi gli intervalli `>=16.3.0 <=16.4.4` e `>=16.2.0 <=16.4.4`).
- **Minima versione patch risolutiva**: `16.4.5`.
- **Versione stabile raccomandata**: **`16.4.6`** (rilasciata come `latest` su npm dist-tags e raccomandata direttamente da `next upgrade --agent=security`).

### 2.4. Rilevanza effettiva per LearnHarness
- L'applicazione LearnHarness è un software desktop basato su Electron dove Next.js funge da server locale in ascolto esclusivamente su `127.0.0.1`.
- Una ricerca statica sull'intero repository (`grep -rn "unstable_cache"` e `grep -rn "use cache"`) ha restituito **0 occorrenze**: LearnHarness **non fa uso né di `unstable_cache` né della direttiva sperimentale `'use cache'`**.
- Pertanto, la specifica vulnerabilità di cache leakage non era attivamente sfruttabile nell'architettura reale di LearnHarness.
- Tuttavia, la presenza della versione vulnerabile causava l'interruzione interattiva del build di Next.js (`Error [SecurityFatalError]`) al primo tentativo, oltre a comparire nei report di security audit.

---

## 3. Phase 2 — Upgrade Decision

- **Verdetto**: **UPGRADE RECOMMENDED (Minimal Patch Upgrade)**.
- **Strategia di aggiornamento**:
  - Nessun upgrade a major o canali instabili/canary.
  - Upgrade puntuale all'interno della stessa serie minore `16.4`: da `16.4.3` a `16.4.6`.
  - Allineamento coordinato del solo plugin linter devDependency `@next/eslint-plugin-next` a `16.4.6`.
  - Nessuna modifica a dipendenze non correlate (`undici`, `zod`, React `19.2.8`, ecc.).
  - Esecuzione in un **Git worktree isolato**.

---

## 4. Phase 3 & 4 — Isolated Git Worktree e Modifiche Apportate

### 4.1. Protezione del branch originale `feat/study-hub`
Prima di qualsiasi operazione nel worktree, lo stato della repository principale è stato verificato:
- **Working directory**: `/home/joel/Documents/learnharness`
- **Branch**: `feat/study-hub`
- **HEAD Commit**: `d0cb9fd42aa354da269c8eaea2df64ca41ca388a`
- **Modifiche locali**: 9 file modificati non committati dalla RUN 5.1 e 2 report pregressi untracked.
- **Garanzia**: Nessun comando distruttivo è stato eseguito sulla working directory principale.

### 4.2. Creazione del worktree
Il worktree dedicato è stato creato a partire dal commit HEAD `d0cb9fd42aa354da269c8eaea2df64ca41ca388a` sul nuovo branch `fix/nextjs-security-advisory`:
```bash
git worktree add .git/worktrees-checkout/fix-nextjs-security-advisory -b fix/nextjs-security-advisory d0cb9fd42aa354da269c8eaea2df64ca41ca388a
```
La collocazione all'interno di `.git/worktrees-checkout/` assicura che il worktree non sporchi lo stato di `git status` del repository principale (poiché `.git` è escluso dal tracking di Git per definizione).

### 4.3. Modifiche apportate nel worktree
Nel worktree `fix/nextjs-security-advisory`, è stato eseguito:
```bash
npm install next@16.4.6 @next/eslint-plugin-next@16.4.6
```
Il diff risultante tocca esattamente ed esclusivamente due file:

#### `package.json`
```diff
diff --git a/package.json b/package.json
index 7f6f72d5..f9d0c1e3 100644
--- a/package.json
+++ b/package.json
@@ -76,7 +76,7 @@
 		"micromark-extension-math": "3.1.0",
 		"motion": "^13.1.1",
 		"nanoid": "^6.0.1",
-		"next": "^16.4.3",
+		"next": "^16.4.6",
 		"next-themes": "^0.4.6",
 		"pdfjs-dist": "^6.3.289",
 		"puppeteer-core": "^25.8.0",
@@ -100,7 +100,7 @@
 		"katex": "$katex"
 	},
 	"devDependencies": {
-		"@next/eslint-plugin-next": "^16.4.3",
+		"@next/eslint-plugin-next": "^16.4.6",
 		"@tailwindcss/postcss": "^4.3.3",
 		"@types/node": "^24.0.0",
 		"@types/react": "^19.2.18",
```

#### `package-lock.json`
- Aggiornate le voci di `next` e `@next/eslint-plugin-next` alla versione `16.4.6` (46 inserimenti, 46 cancellazioni di checksum e versioni patch corrispondenti).

---

## 5. Phase 5 — Risultati della Verifica

Tutte le verifiche sono state condotte all'interno del worktree isolato `fix/nextjs-security-advisory`:

### 5.1. Dependency Security Audit
- **Comando**: `npm audit --json`
- **Risultato**: La voce `next` è completamente assente dall'elenco delle vulnerabilità (`vulnerabilities.next: undefined`).
- **Assessment Next.js (`prepare-upgrade.js`)**:
  ```json
  {
    "affected": false,
    "upgrade": {
      "status": "unaffected",
      "reason": "No security update is needed for Next.js 16.4.6."
    }
  }
  ```

### 5.2. Typecheck TypeScript
- **Comando**: `npm run typecheck` (`tsc --noEmit`)
- **Exit Code**: **0**
- **Risultato**: Zero errori di compilazione TypeScript su tutto il progetto.

### 5.3. Production Build Turbopack
- **Comando**: `npm run build`
- **Exit Code**: **0**
- **Risultato**:
  - Compilazione Turbopack completata con successo in 25.1s (`Next.js 16.4.6 (Turbopack)`).
  - TypeScript e raccolta pagine completati in 17.6s.
  - Generazione di tutte le 66 route dell'applicazione completata con successo.
  - **Nessun `SecurityFatalError` o blocco di sicurezza** al primo avvio.

### 5.4. Test di Regressione Modulari
- **Comando**:
  ```bash
  NODE_ENV=test npx tsx --test tests/workspaces.test.ts tests/directory-service.test.ts tests/visual-explanation-envelope.test.ts tests/visual-explanation-security.test.ts tests/study-hub-catalog.test.tsx
  ```
- **Exit Code**: **0**
- **Risultato**: **103 test eseguiti, 103 superati, 0 falliti** in 2.61s.

### 5.5. Lint
- **Comando**: `npx eslint next.config.ts`
- **Exit Code**: **0** (0 errori, 0 warning).

---

## 6. Rischi Residui

1. **Vulnerabilità di terze parti non correlate a Next.js**:  
   In `package-lock.json` permangono vulnerabilità note in `undici` e `zod` già presenti prima della RUN 6. In conformità ai vincoli operativi di non allargare lo scope, non sono state aggiornate.
2. **Commit e Merge**:  
   In ossequio ai vincoli assoluti della run, sul branch `fix/nextjs-security-advisory` **non è stato effettuato alcun commit o push automatico**. Le modifiche risiedono nel working tree del branch `fix/nextjs-security-advisory` pronte per revisione.

---

## 7. Stato di Readiness per l'Integrazione

### **VERDETTO: READY FOR INTEGRATION**

L'upgrade a Next.js `16.4.6`:
- È strettamente circoscritto (solo 2 righe in `package.json`).
- Elimina completamente l'errore bloccante del build e le 2 advisory GHSA.
- È stato validato con successo per typecheck, build di produzione e test di regressione.
- Non altera in alcun modo il branch principale `feat/study-hub` né i test preesistenti.
