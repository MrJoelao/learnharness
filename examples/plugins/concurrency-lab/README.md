# Concurrency Lab 0.1.0

Plugin Community per LearnHarness Study Hub.

## Installazione
1. Estrai la cartella `concurrency-lab` nella directory dei Community plugins.
2. Verifica che `manifest.json`, `backend.cjs`, `main.js` e `styles.css` siano direttamente dentro `concurrency-lab/`.
3. Abilita il plugin in Settings e riavvia il server/app se richiesto dal ciclo di vita dei plugin.
4. Apri Study Hub e crea un workspace **Concurrency Lab**.

## Contenuti inclusi
- Semaphore Playground: `sem_wait()` / `sem_post()` e contatore negativo nel modello teorico OSTEP §31.1–31.2.
- Producer / Consumer: sequenza bounded-buffer con `empty`, `full` e `mutex`, OSTEP §31.4.
- Deadlock: due lock acquisiti in ordine opposto e circular wait, OSTEP §32.3.

Il simulatore è deterministico e didattico: non crea thread OS e non esegue codice C.

## Limiti di questa prima versione
Non sono ancora implementati: Reader/Writer, Dining Philosophers, thread throttling, atomicity/order violations interattive, trylock/livelock, CAS/lock-free, deadlock avoidance/recovery, editor di codice e challenge con valutazione. Il log di esecuzione è temporaneo; vengono salvati scenario e configurazione di base.
