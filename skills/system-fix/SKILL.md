---
name: system-fix
description: Diagnose, fix, and document a system or config fault on this machine.
argument-hint: "What is broken?"
disable-model-invocation: true
---

Three steps in order: read-only investigation, approved fix, write-up. Write-ups live in `~/Documents/system-fixes/`, flat until a topic has a second doc and then together in `<topic>/`. A copy of every config file the fix touches goes in `~/Documents/system-fixes/backups/` before it is changed. Use TodoWrite to track progress through the three steps.

## 1. Investigate (read-only toward the system, unattended-safe)

Read the existing doc for this area if there is one, and treat its claims as leads to re-check rather than as established fact.

Establish the cause by observation. Bisect wherever a known-good state is cheap to reach (empty config, default profile, the other shell, another client) to place the fault, then narrow inside it. Where the software supports it, reproduce on a scratch instance so the live one stays untouched.

Screenshot a visual symptom before explaining it (`grim -o <output>` captures one monitor).

Web search the fault and the versions it turns on: current docs, release notes, open issues, whether it is known, and how upstream or others fixed it.

Where the cause resists direct observation, get a **red** signal before theorising: one command, already run at least once, that reproduces the user's exact symptom and is fast enough to re-run after every change in step 2.

Done when you can name the cause, quote the evidence, and separate what was observed from what was inferred.

Write the doc before asking for anything: the step 3 structure, with the change proposed and marked **not applied**. Commit it as `docs(scope): investigate <fault>`. The doc is the only thing this step writes.

## 2. Fix (approval-gated)

Ask before the first change, and again for anything that approval did not cover: another file, a service restart, a package install. Back up the file, then edit it.

One change at a time, re-checked against the symptom each time. Roll back anything that leaves the symptom where it was.

Done when the symptom is gone under the same check that exposed it, when you are stuck, or when approval does not come. All three end at step 3.

## 3. Report (finish the doc)

Write the doc from scratch with the `writing-for-agents` skill rather than editing the step 1 draft.

Replace the proposed change with the change as applied, its verification and its revert, and drop the not-applied marker. An investigation that never got approval keeps the marker and stops here.

The doc is dated and names the versions the fault depends on. In this order:

1. **The fix.** Symptom, cause, evidence, the exact change (file path and resulting contents), how it was verified, how to revert, and what a recurrence would point at.
2. **Incidental findings** picked up along the way, kept when they were expensive to establish and marked as incidental.
3. **User decisions**, each with the reason the user gave. These are preferences, so a later reader leaves them alone.
4. **Unresolved**, listing what stayed untested.

Label any claim resting on a single test or on reasoning alone as **inferred**. For a setting, state the tradeoff it makes and what was measured about it.

Length follows the fault, not a target: keep only what a later agent cannot cheaply re-derive. Leave method as history rather than instruction.

`~/Documents/system-fixes` is a git repo. Commit the doc and any backups it added as `type(scope): short description`, for example `fix(audio): stop aux speaker ticking on idle`.
