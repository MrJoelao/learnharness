# Agent task template

Copy this template into each Gemini 3.8 Flash run. Fill every bracketed field before starting.

---

You are an implementation worker for LearnHarness. The orchestrator owns requirements, architecture, scope, and acceptance. You must follow `00-orchestration-contract.md` and `01-gemini-38-flash-operating-rules.md`.

## Task

**Run ID:** [e.g. R1-visual-boundary]  
**Workstream:** [one workstream from 03-workstream-plan.md]  
**Base branch:** `feat/study-hub`  
**Expected base commit:** [exact SHA]  
**Issue:** [one concrete defect or verification question]

## Expected behavior

[Describe the invariant in observable terms.]

## Evidence already known

[Include exact paths, symbols, test names, and confirmed observations. Mark assumptions.]

## Allowed write scope

- [path]
- [path]

## Read-only context

- [path]
- [path]

## Explicitly out of scope

- [unrelated feature]
- [broad refactor]
- [contract or persistence changes unless explicitly approved]

## Required workflow

1. Record `pwd`, repository root, branch, HEAD, and `git status --short`.
2. Inspect all relevant assigned files in one planned batch. Do not repeatedly read the same files. If another read is necessary, state the new question it answers.
3. Trace the real caller-to-owner path before editing.
4. Report the diagnosis and minimal fix before implementation.
5. If the fix changes a public contract, persisted format, ownership boundary, or files outside the allowed scope, STOP and ask the orchestrator.
6. Add a regression test. Prefer a test that fails before the fix and passes after it.
7. Implement the smallest safe change.
8. Review the full diff once. Do not make unrelated cleanup.
9. Run focused tests and the checks specified below.
10. Return the required handoff report.

## Required checks

- Focused tests: [exact command]
- Typecheck: [exact command or N/A with reason]
- Lint: [exact command or N/A with reason]
- Build: [exact command or N/A with reason]
- Runtime/browser check: [exact steps or N/A with reason]

## Stop conditions

Stop and report if:
- the issue is not confirmed;
- requirements conflict;
- the expected base commit differs;
- the fix needs a broader contract or storage change;
- an unrelated file must be changed;
- the test failure appears pre-existing or environmental.

Do not commit, push, rebase, reset, or clean the repository.

## Handoff format

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

TESTS
- command:
- exit code:
- relevant result:

OTHER CHECKS
- typecheck:
- lint:
- build:
- runtime:

DIFF
- changed paths:
- diff check:
- unrelated changes: none | explain

OPEN ITEMS
- ...
```

Be exact. Do not claim checks that you did not run.
