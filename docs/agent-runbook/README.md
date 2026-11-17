# LearnHarness agent runbook

**Purpose:** coordinate several implementation runs on `MrJoelao/learnharness`, branch `feat/study-hub`, using Gemini 3.8 Flash as an implementation worker and a separate orchestrator as the decision-maker.

This package is an execution guide for fixing and verifying the existing Study Hub and Visual Explanation work. It is not permission to redesign the feature set.

## Files

- `00-orchestration-contract.md`: roles, authority, run lifecycle, and handoff protocol.
- `01-gemini-38-flash-operating-rules.md`: model-specific working discipline, including batched reads/writes and anti-loop rules.
- `02-repository-and-feature-context.md`: known project contracts and boundaries.
- `03-workstream-plan.md`: independent agent runs, dependencies, ownership, and stop conditions.
- `04-verification-and-acceptance.md`: evidence required before calling a fix complete.
- `05-agent-task-template.md`: copyable prompt template for each run.
- `06-findings-and-open-decisions.md`: current audit findings, evidence status, and unresolved decisions.

## Important source limitation

The original `learnharness-study-hub-spec-v1.zip` was referenced in the conversation, but its archive contents were not available for direct reopening when this runbook was assembled. The package therefore uses the previously inspected implementation/audit context and the available Study Hub / Visual Explanation implementation reports. It deliberately labels uncertain points as open decisions. Before treating a requirement as authoritative, the orchestrator must compare it against the original specification files in the repository, if present, and resolve any discrepancy.

## Starting point

Repository: `https://github.com/MrJoelao/learnharness`  
Branch: `feat/study-hub`  
Upstream: `https://github.com/amosblomqvist/learnharness`

Never assume the branch HEAD is unchanged. Every run must record `git rev-parse HEAD`, `git status --short`, and the target branch before editing.

## Non-negotiable rule

**Gemini implements only the explicitly assigned workstream. The orchestrator owns scope, architecture, priorities, acceptance, and merge decisions.** Gemini must not turn a focused repair into a broad refactor.
