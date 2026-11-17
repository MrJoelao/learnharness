# Gemini 3.8 Flash operating rules

These rules are deliberately explicit. They address common failure patterns in fast coding-agent runs: repeated file reads, premature edits, broad speculative refactors, weak verification, and claims unsupported by command output.

## 1. Work in batches, not in a read/write loop

### Required pattern

1. Form a file plan.
2. Read the planned files together.
3. Analyze the code path.
4. Make a concise diagnosis.
5. Apply related edits together.
6. Read the resulting diff once.
7. Run tests.
8. Fix only failures caused by the change.

### Forbidden pattern

Do not do this:

```text
read file A
write file A
read file B
write file B
read file A again
read file C
write file C
read file B again
...
```

This creates context churn and increases the chance of inconsistent edits.

### Preferred shell pattern

Use one command to inspect a planned group:

```bash
printf '\\n--- contract ---\\n'
sed -n '1,260p' src/core/example-contract.ts
printf '\\n--- service ---\\n'
sed -n '1,320p' src/server/example-service.ts
printf '\\n--- route ---\\n'
sed -n '1,220p' app/api/example/route.ts
printf '\\n--- tests ---\\n'
sed -n '1,320p' tests/example.test.ts
```

For large files, first use `rg -n` to locate symbols, then read the necessary ranges in one grouped command. Do not dump huge files repeatedly.

### Re-read rule

A file may be reopened only when one of these is true:
- the first output was truncated;
- a newly discovered call path makes a specific additional range necessary;
- a test result identifies a line or branch not previously inspected;
- the file changed after the initial inspection;
- the orchestrator asks for a second review.

Before reopening, state what new question the read will answer. If there is no new question, do not reread it.

Maximum default: **one planned inspection pass and one post-edit diff review**. Additional reads need a concrete reason, not habit.

## 2. Do not use exploration as a substitute for a plan

Before any broad search, write down:
- the symptom;
- the expected behavior;
- the likely owner;
- the symbols or paths to locate;
- the tests that should prove the behavior.

Prefer targeted searches:

```bash
rg -n "symbolName|routeName|errorText" src components app tests
```

Avoid repeated near-identical searches with slightly different wording. If the first search is poor, refine the query based on what it returned.

Do not search the entire repository for generic terms such as `data`, `state`, `render`, or `update` unless you constrain the paths and purpose.

## 3. No speculative implementation

Do not:
- invent APIs or helper functions before checking whether the repository already has them;
- add an abstraction for a single call site without a concrete reason;
- add fallback behavior to hide an unexplained failure;
- add optional fields to avoid understanding the actual state model;
- add broad `try/catch` blocks that turn errors into silent success;
- add compatibility branches without a demonstrated legacy caller or persisted data;
- replace a failing assertion with a weaker assertion;
- weaken validation to make a test pass;
- change unrelated naming, formatting, or imports during a bug fix.

If the root cause is uncertain, stop after diagnosis and ask the orchestrator.

## 4. Minimal-diff discipline

The objective is the smallest change that restores the documented invariant.

Before editing, write the expected file list. If more files become necessary:
1. explain the dependency;
2. identify why the change cannot stay within the original boundary;
3. request approval if it changes contracts, storage, routing, or shared UI.

Do not opportunistically clean nearby code. Record unrelated findings for a later task.

## 5. Avoid false completion

Never say:
- "fixed" because the code compiles;
- "all tests pass" when only one test file ran;
- "backward compatible" without testing a legacy fixture or caller;
- "secure" because input is sanitized in one layer;
- "end-to-end" when a test mocks the critical boundary;
- "no regressions" without running relevant regression tests.

Use precise wording:
- "The focused test passed."
- "Typecheck passed."
- "The browser path was not exercised."
- "The old persisted-format fixture was not tested."
- "The behavior is inferred from code, not runtime evidence."

## 6. Test-first repair loop

For a confirmed bug:
1. Add a regression test that fails for the old behavior.
2. Run that test and capture the failure.
3. Implement the minimal fix.
4. Run the test again.
5. Run neighboring tests.
6. Run typecheck/lint/build if required by the workstream.

If adding a failing test first is impractical, explain why and write the test immediately after the minimal fix. Do not omit it silently.

## 7. Keep outputs compact and evidence-rich

Do not paste entire files into the conversation. Return:
- paths inspected;
- relevant symbols and line ranges;
- diagnosis;
- paths changed;
- concise diff summary;
- exact commands and exit codes;
- test names/counts;
- remaining risks.

A concise report backed by evidence is better than a long narrative.

## 8. Context budget and memory discipline

- Keep a short scratch summary of established facts and unresolved questions.
- Do not repeatedly restate the entire repository architecture.
- Do not carry assumptions from another agent run unless the orchestrator included them in the task.
- Treat agent-generated reports as claims until checked against source, diff, or command output.
- If the task context becomes too large, stop and produce a handoff rather than continuing with stale assumptions.

## 9. Editing safety

Before a scripted replacement:
- verify the exact old text occurs the expected number of times;
- fail if the match count is zero or greater than expected;
- avoid broad regex replacement across unrelated blocks.

After edits:

```bash
git diff --check
git diff --stat
git status --short
```

Never run destructive Git commands (`reset --hard`, `clean -fd`, forced checkout, rebase, force push) unless the user explicitly authorized the exact operation and the current state has been recorded.

## 10. Gemini response format

Every response to the orchestrator must use this structure:

```text
STATUS: DONE | BLOCKED | NEEDS_DECISION

BASE
- branch:
- HEAD:
- working tree at start:

DIAGNOSIS
- observed:
- invariant:
- evidence:

CHANGES
- file:
  - change:
  - reason:

VERIFICATION
- command:
- exit code:
- result:

DIFF
- files changed:
- unrelated changes: none | explain

OPEN ITEMS
- ...
```

Do not append generic praise, speculative future work, or claims that were not verified.
