---
name: system-audit
description: Full read-only health/security/cleanliness audit of this Linux system.
argument-hint: "(optional) area to focus on, e.g. 'security' or 'packages'"
disable-model-invocation: true
---

Read-only toward the system. No fixes, no file edits outside the audit doc itself.

## Scope
Dotfiles/config integrity, package health (orphans/updates/conflicts), system health
(disk, journal, failed services, memory/swap), security (ports, SUID, exposed services),
performance (boot time, heavy processes), cleanup opportunities (cache, old kernels,
orphaned dirs). If $ARGUMENTS names an area, scope to that; otherwise cover all.

## Method
Read the previous audit doc if one exists — treat its findings as leads to re-check,
not established fact. Also check `~/Documents/system-fixes/` for recent fixes that
might explain changes (recovered disk space, a service now stable). Run the standard
checks per area (below). Prefer commands safe to re-run unattended.

## Write with `writing-for-agents`
Dated doc in `~/Documents/system-audits/<date>.md`. Short and concise — a status
report, not a transcript. Keep only what a later agent can't cheaply re-derive.
Leave method as history, not instruction. Label single-test/reasoning-based
findings **inferred**.

Structure:
1. **Critical / Warning / Info** — each: symptom, evidence (one-line command output,
   not full dumps), suggested fix (not applied).
2. **Changed since last audit** — diff against previous doc, if one exists.
3. **Unresolved** — anything not checked.

Commit: `chore(audit): system audit <date>`.

## Commands by area
[fill in]
