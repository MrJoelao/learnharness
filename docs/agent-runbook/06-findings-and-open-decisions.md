# Findings and open decisions

This is a triage register based on the prior code audit and available implementation reports. It is not a statement that every finding still exists on the current HEAD. Reconfirm each one before editing.

## F-01: visual artifact legacy HTML path

**Prior observation:** the agent tool was described as enforcing strict declarative SVG, while the UI validator/component retained a legacy HTML iframe path.

**Risk:** a mismatch between new-artifact input policy and legacy rendering compatibility can create an accidental path for unsupported content or future regression.

**Required investigation:**
- trace tool schema -> validator -> persistence -> renderer;
- determine whether new HTML artifacts can be created or updated;
- locate actual persisted legacy HTML fixtures/data;
- confirm whether legacy support is required by the original spec.

**Decision owner:** orchestrator.  
**Do not:** remove legacy rendering before checking data compatibility.

## F-02: visual control contract mismatch

**Prior observation:** the contract/UI were reported to define button, slider, toggle, and select controls, while the agent tool's accepted set appeared narrower.

**Risk:** documentation and implementation may promise different capabilities.

**Required investigation:**
- compare original spec, types, validator, tool schema, frontend, prompt, tests;
- establish exact MVP acceptance;
- implement only what the spec requires.

**Decision owner:** orchestrator.  
**Do not:** expand scope just because a type exists.

## F-03: plugin uninstall/reinstall lifecycle

**Prior observation:** plugin package data is separated from package code, and local package replacement tests preserve `data`, `src`, and sibling plugin data. A complete uninstall/reinstall path was not established by the prior audit.

**Risk:** package update preservation may be mistaken for uninstall preservation.

**Required investigation:**
- locate the actual uninstall operation, if any;
- determine what files it deletes;
- verify workspace metadata and private plugin state after uninstall/reinstall;
- document unsupported behavior rather than inventing it.

**Decision owner:** orchestrator.  
**Do not:** add an uninstall subsystem without a product requirement.

## F-04: mixed sidebar/archive integration

**Prior observation:** shared directory data feeds chat and workspace rows. The prior audit identified browser-level checks still needed for mixed keyboard selection, folder expansion, drag/drop, archive, and restore.

**Risk:** a component can render mixed entries while one interaction still assumes chat-only data.

**Required investigation:**
- trace all handlers from row to action to API/service;
- test mixed folders and root-level items;
- test keyboard and pointer behavior;
- test archive/restore of nested mixed trees.

**Decision owner:** orchestrator.

## F-05: current branch verification

**Prior observation:** the earlier audit did not execute the branch locally and did not have a verified CI run for the then-current HEAD.

**Risk:** static inspection and historical test reports do not prove the current checkout passes.

**Required investigation:**
- record current HEAD and clean/dirty state;
- run focused suites;
- run project-wide typecheck/lint/build;
- run full test suite if feasible;
- exercise critical browser flows.

**Decision owner:** orchestrator.

## F-06: unrelated changes in the feature branch

**Prior observation:** the branch included changes beyond the two feature groups, including graph/topic/chain areas.

**Risk:** broader regression surface and noisy fixes.

**Required investigation:**
- compare branch against intended baseline;
- identify which unrelated changes are intentional dependencies;
- avoid modifying them during focused repair;
- run regression tests for touched shared navigation or domain boundaries.

**Decision owner:** orchestrator.

## Finding status format

For each finding record:

```text
ID:
Current HEAD:
Status: CONFIRMED | NOT_REPRODUCED | SPEC_CONFLICT | FIXED | DEFERRED
Reproduction:
Source evidence:
Tests:
Files changed:
Remaining uncertainty:
```

Never convert "not checked" into "not a bug".
