---
name: system-audit
description: Read-only health, security and cleanliness audit of this machine.
argument-hint: "(optional) area to focus on, e.g. 'security' or 'packages'"
disable-model-invocation: true
---

A read-only session. Observe the system, change no state, and write only today's audit doc.

Audits live in `~/Documents/system-audits/`, one per run, named `YYYY-MM-DD.md`. Create and `git init` the directory on the first run. The previous audit is the highest-sorting filename below today's.

## 1. Set up

Read the previous audit if there is one, treating its findings as leads to re-check rather than as established fact. If `~/Documents/system-fixes/` exists, it may explain a change since.

Identify the machine (package manager, init, root filesystem, bootloader, distro) and pick each check from what `command -v` confirms is installed.

Seed TodoWrite with one item per step 2 area plus "write the doc", then extend it with what this machine's own configuration calls for: its filesystem, its graphics stack, whether it is a laptop, what it runs. The six areas are a fixed spine so audits stay comparable; the derived items are where the audit fits the machine.

An area named in `$ARGUMENTS` goes deep, the rest stay quick passes.

Done when the list holds the six areas and every item this machine warrants.

## 2. Sweep

Audit the whole machine. The six areas are the floor, not the ceiling.

- **config**: pending package-manager config merges, failed user services, autostart entries duplicating socket or dbus activation, settings contradicting each other.
- **packages**: updates pending, orphans, foreign or unsupported packages, cache size.
- **health**: failed units, journal errors this boot, disk and inode headroom, memory and swap pressure, disk SMART status.
- **security**: what listens off loopback, SUID binaries outside the expected set, firewall state, permissions on key and credential directories.
- **performance**: boot time and its longest chain, heaviest resident processes.
- **cleanup**: journal size, package cache, superseded kernels and snapshots, stale caches.

The areas are the floor. Follow a lead wherever it goes, and give anything else worth flagging its own heading and its own todo.

Audit secrets by permissions and mtime, never content: private keys, browser profiles, password stores, token files. The doc gets committed.

Unprivileged and unattended-safe by default. Run a check needing root only with the user present, and record it as unchecked otherwise. Keep a filesystem walk cheap enough to re-run, and widen it when a finding warrants the cost.

Done when every area's todo closes on either findings or an explicit clean line. An area skipped for any reason goes in Unresolved.

## 3. Write the doc

Write it with the `writing-for-agents` skill. A status report, not a transcript: keep only what a later agent cannot cheaply re-derive, and leave method as history. Label single-test or reasoning-based findings **inferred**.

1. **Critical / Warning / Info**: per finding, symptom, one line of evidence, suggested fix marked not applied. Omit an empty tier.
2. **Clean**: one line per area that produced no findings.
3. **Changed since last audit**: against the previous doc, if one exists.
4. **Unresolved**: areas skipped, and every root-only check not run.

Commit as `chore(audit): system audit <YYYY-MM-DD>`.

## 4. Report to the user

The doc is for the next agent, the terminal reply is for the user: counts per tier, then the calls to action.

One call to action per Critical, and per Warning only where acting now beats waiting. Each names the fault and the path to today's doc. Where a fix skill is installed, make it a paste-ready invocation of it:

```
/system-fix journald has grown to 4.2G, vacuum settings never applied. See ~/Documents/system-audits/2026-08-27.md
```

Done when the reply fits on a screen and every Critical has its line.
