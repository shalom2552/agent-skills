---
name: docs-sync
description: Find and fix drift between docs and code.
argument-hint: "(optional) file or section to focus on, e.g. 'install section' or 'docs/API.md'"
---

The docs make claims, the code is the evidence. Read both, report the drift, and change docs only.

Static reading throughout. Confirm a documented command against the build files rather than running it, and leave the code untouched whatever a finding says about it.

Fire this at the end of work that changed code the docs describe, never partway through it.

## 1. Scope

The README is in scope every run. Widen to the other tracked markdown when `$ARGUMENTS` names it, or when the README comes back clean. A file or section named in `$ARGUMENTS` goes deep and the rest stays a quick pass.

Where there is no README and none is named, offer to write one from the code. A declined offer ends the run.

Seed TodoWrite with one item per step 2 area, plus "resolve findings".

Done when every doc in scope has a todo and the areas are on the list.

## 2. Check

A **claim** is any sentence in the docs that the repo can settle. Take each one to the code that would make it true, not to the last doc that repeated it.

The areas are the floor, not the ceiling:

- **commands**: install, build, run and test invocations against the real build files and entry points.
- **features**: each "it does X" traced to the code that does X.
- **paths**: directory trees, file names and repo-internal links naming something that still exists.
- **interfaces**: documented ports, endpoints, routes, flags and config keys against what the code binds, registers and reads.
- **metadata**: versions, dependency lists, badges and the license claim against the files carrying them.

A **gap** counts too: something the code makes true that the docs never state, and a section a reader of this repo would expect to find and cannot.

Tag every finding:

- `wrong`: a claim the code contradicts.
- `missing`: a gap.
- `unverified`: a claim static reading cannot settle.

Done when every claim in scope is either confirmed or tagged.

## 3. Report the drift

One line per finding, worst first: tag, `file:line`, the claim, and what the code says instead. Keep each on one line so the whole drift reads at a glance.

## 4. Resolve

Put the findings to the user with AskUserQuestion, up to four findings per card, one question each. Three choices per finding:

- **fix the doc**: rewrite the claim, or write the missing section, to match the code.
- **the code is wrong**: the doc stands, the finding is recorded for step 5.
- **skip**: neither side changes and the finding is dropped.

Apply the accepted doc fixes. Recorded and skipped findings change nothing on disk.

Done when every finding has an answer and the accepted fixes are written.

## 5. Close

Report to the user: what was edited, then every recorded finding as work the code still owes, then anything left `unverified`. A recorded finding lives only in this report, so name the file and the claim it rests on.
