---
name: system-fix
description: Diagnose, fix, and document a system or config fault on this machine.
argument-hint: "What is broken? (or 'lint')"
disable-model-invocation: true
---

Three steps in order: read-only investigation, approved fix, write-up. Invoked with `lint`, run Lint in [`MAINTENANCE.md`](MAINTENANCE.md) instead. When `INDEX.md` is missing, run Migrate there first.

## Docs repo

`~/Documents/system-fixes` is a git repo:

```
INDEX.md                       one line per doc
<topic>.md                     flat until a topic has a second doc
<topic>/<doc>.md               then together in <topic>/
backups/<topic>/<file>.<YYYYMMDD>.bak
```

`INDEX.md` lines read `<path> | <status> | <YYYY-MM-DD> | <symptom in a few words>`. Moving a doc into `<topic>/` updates its line. Every doc opens with a matching `Status:` line:

- **open**: investigated, change proposed, not applied
- **applied**: change in place and verified
- **reverted**: change rolled back
- **superseded by `<path>`**: a later doc replaced it

## 1. Investigate (read-only toward the system, unattended-safe)

Find the docs for this area through `INDEX.md` and read them, treating their claims as leads to re-check rather than as established fact. An **open** doc for the same fault is where this session resumes. Its **Rejected** lines are approaches not to retry without new evidence.

Establish the cause by observation. Bisect wherever a known-good state is cheap to reach (empty config, default profile, the other shell, another client) to place the fault, then narrow inside it. Where the software supports it, reproduce on a scratch instance so the live one stays untouched.

Screenshot a visual symptom before explaining it (`grim -o <output>` captures one monitor).

Web search the fault and the versions it turns on: current docs, release notes, open issues, whether it is known, and how upstream or others fixed it.

Where the cause resists direct observation, get a **red** signal before theorising: one command, already run at least once, that reproduces the user's exact symptom and is fast enough to re-run after every change in step 2.

Done when you can name the cause, quote the evidence, and separate what was observed from what was inferred.

Write the doc before asking for anything: the step 3 structure, with `Status: open` and the change proposed. Add its `INDEX.md` line. Commit as `docs(scope): investigate <fault>`. The doc and its index line are the only things this step writes.

## 2. Fix (approval-gated)

Ask before the first change, and again for anything that approval did not cover: another file, a service restart, a package install.

Before editing a file, check whether git tracks it. Tracked with no uncommitted changes: git is the revert, so record the repo and file. Otherwise, copy it to `backups/<topic>/` first. The user's own repos take file edits only; their git state belongs to the user.

One change at a time, re-checked against the symptom each time. Roll back anything that leaves the symptom where it was, and note it as rejected.

Done when the symptom is gone under the same check that exposed it, when you are stuck, or when approval does not come. All three end at step 3.

## 3. Report (finish the doc)

Write the doc from scratch with the `writing-for-agents` skill rather than editing the step 1 draft.

Replace the proposed change with the change as applied, its verification and its revert, and set `Status: applied`. An investigation that never got approval, or got stuck with every change rolled back, stays **open** and stops here.

The doc is dated and names the versions the fault depends on. In this order:

1. **The fix.** Symptom, cause, evidence, the exact change (file path and resulting contents), how it was verified, how to revert, and what a recurrence would point at.
2. **Rejected.** One line per approach tried or ruled out, with the reason.
3. **Incidental findings** picked up along the way, kept when they were expensive to establish and marked as incidental.
4. **User decisions**, each with the reason the user gave. These are preferences, so a later reader leaves them alone.
5. **Unresolved**, listing what stayed untested.

Label any claim resting on a single test or on reasoning alone as **inferred**. For a setting, state the tradeoff it makes and what was measured about it.

Length follows the fault, not a target: keep only what a later agent cannot cheaply re-derive. Leave method as history rather than instruction.

A fix makes older docs wrong. Check every doc on this topic: correct a claim the fix contradicts, and mark a doc whose change this fix replaces `superseded by <path>`. Update their `INDEX.md` lines.

Commit the doc, the index and any backups as `type(scope): short description`, for example `fix(audio): stop aux speaker ticking on idle`.
