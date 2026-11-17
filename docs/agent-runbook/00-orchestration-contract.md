# Orchestration contract

## 1. Roles

### Orchestrator ("the head")

The orchestrator is responsible for:
- interpreting the original specification and the audit findings;
- deciding which finding is real, relevant, and in scope;
- assigning one bounded workstream to one agent run;
- defining the allowed files and forbidden areas;
- resolving conflicts between agents;
- reviewing diffs and test evidence;
- deciding whether a change is accepted, revised, or reverted.

The orchestrator does not delegate architectural judgment implicitly. Every agent receives a written task contract.

### Gemini 3.8 Flash ("the worker")

Gemini is responsible for:
- inspecting the assigned code path efficiently;
- confirming the issue against actual code and tests;
- proposing the smallest safe correction;
- implementing only the approved correction;
- adding or updating focused tests;
- running the assigned verification commands;
- returning exact files changed, commands run, outputs, and unresolved risks.

Gemini is not authorized to:
- redefine product requirements;
- change architecture outside the assigned boundary;
- broaden scope because it notices unrelated cleanup;
- claim a test passed without executing it;
- claim a behavior is fixed because code looks plausible;
- silently alter tests to match a broken implementation;
- commit, push, rebase, reset, clean, or force-push unless the task explicitly authorizes that exact operation.

## 2. Authority order

When instructions conflict, use this order:

1. User's explicit instruction in the current task.
2. Original Study Hub specification checked into or supplied with the repository.
3. Accepted architecture and contracts already present in the codebase.
4. This runbook.
5. Agent suggestions.

An agent suggestion never overrides a requirement. If the source specification and current implementation disagree, stop and report the conflict. Do not silently choose one.

## 3. Required run lifecycle

Every run follows these steps.

### Step A: establish reality

Run once at the beginning:

```bash
pwd
git rev-parse --show-toplevel
git branch --show-current
git rev-parse HEAD
git status --short
```

If the branch, commit, or working tree differs from the task assumptions, report it before editing.

### Step B: inspect in one planned pass

Before opening files, list the exact files needed and why. Use one grouped command to inspect related files. Do not repeatedly reopen the same files because the agent has not formed a plan.

Inspect:
- the implementation owner;
- its direct caller(s);
- the relevant contract/type;
- the closest tests;
- the relevant route/store boundary, if applicable.

Do not inspect the whole repository unless the assigned issue requires it.

### Step C: state the diagnosis

Before editing, report:
- observed behavior;
- exact code path;
- violated invariant or acceptance criterion;
- minimal proposed change;
- expected tests;
- files expected to change;
- files explicitly out of scope.

For a small, unambiguous defect, this diagnosis can be concise. For a cross-boundary change, obtain orchestrator approval before editing.

### Step D: implement in a bounded batch

Group related edits. Do not alternate one-file read, one-file write, one-file read, one-file write indefinitely.

After implementation, inspect the complete diff once:

```bash
git diff --check
git diff --stat
git diff -- <assigned paths>
```

If the diff touches an unassigned path, explain why and request approval before continuing.

### Step E: verify

Run the smallest relevant tests first, then broader checks required by the task. Record exact commands and exit codes.

### Step F: hand off

Return the handoff report defined in `05-agent-task-template.md`. Do not mark the task complete based on intent or a successful typecheck alone.

## 4. Multi-agent coordination

- One workstream owns a file at a time.
- Do not assign two agents overlapping write scopes concurrently.
- Parallelize only independent work: for example, one agent can inspect workspace lifecycle while another inspects the visual engine, provided their write scopes do not overlap.
- The orchestrator integrates changes sequentially.
- After each integration, rerun tests that cover the combined boundary.
- If two workstreams need the same shared file, serialize them or appoint one owner.
- Agents must not merge one another's branches or cherry-pick without explicit instruction.

## 5. Stop conditions

Stop and report instead of improvising if:
- the expected branch or commit is different;
- the issue cannot be reproduced or supported by source evidence;
- the fix requires changing a public contract or persisted format;
- the fix would touch files outside the assignment;
- an existing test contradicts the stated requirement;
- a test fails for a reason that may predate the task;
- a migration, destructive operation, or data deletion is involved;
- the original specification is ambiguous.

## 6. Definition of done

A run is complete only when:
1. the issue is tied to a concrete invariant;
2. the minimal implementation is present;
3. focused regression tests cover the failure and relevant neighboring behavior;
4. tests were actually executed;
5. `git diff --check` passes;
6. the diff contains no unrelated changes;
7. the handoff report states evidence and remaining uncertainty.
