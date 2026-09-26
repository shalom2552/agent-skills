---
name: dotconf
description: Answer, change, and remember dotfile and app configs.
argument-hint: "question, change, or 'lint'"
disable-model-invocation: true
---

A session about the user's configs (dotfiles, editor, window manager, shell, any tool): questions, tweaks, new features, refactors, and config faults. Its memory is the notes repo `~/Documents/system-config/`, so the user never repeats a choice twice.

## Notes repo

A private git repo that belongs to the agents. Commit notes changes as `docs(<topic>): <what>`.

| File | Cap | Holds |
|---|---|---|
| `RULES.md` | 40 lines | Hard constraints the agent obeys. |
| `PREFERENCES.md` | 40 lines | Taste that spans tools. Taste for one tool goes in its topic. |
| `INDEX.md` | 60 lines | Map: tool, config path, owning git repo, topic file. Then **Open** (unfinished threads, onboarding pending) and `Sessions since lint: N`. |
| `topics/<name>.md` | 150 lines | Per tool or area, named after whatever the user runs: **Decisions** (with the reason), **Conventions**, **Rejected**, **Ideas**. |
| `log/YYYY-MM-DD-<slug>.md` | none | Fixes and multi-file changes: symptom, cause, change, revert. |

Notes are the cache of what the config cannot say: the reason behind a setting, the convention, the option tried and dropped. A value the agent can read from the file stays in the file.

One line per entry, ending with its source and date: `(user, 2026-09-26)` or `(inferred, 2026-09-26)`. A **user** line is the user's decision and stays as written until the user changes it. An **inferred** line is a lead: re-check it against the live config before acting on it.

A file over its cap gets compacted in the same write: merge duplicates, drop stale lines, and split a topic into `topics/<name>/` when it covers separate areas.

## 1. Start

If the repo does not exist yet, or **Open** holds "onboarding pending", follow Onboard in [`MAINTENANCE.md`](MAINTENANCE.md) first.

Read `RULES.md`, `PREFERENCES.md` and `INDEX.md`. Mention any **Open** item that relates to the request, and offer a lint when `Sessions since lint` is 10 or more. Invoked with `lint`, or when the user accepts, follow Lint in [`MAINTENANCE.md`](MAINTENANCE.md). Then open only the topic files the request touches. If `~/Documents/system-fixes/INDEX.md` exists, check it for the tool at hand.

Done when the three core files are read and the topics relevant to the request are open.

## 2. Work

The session is read-only toward the configs until the user asks for a change; notes are written regardless. An explicit ask approves that one change. A question gets answered from the notes plus whatever file, command, or web search it hinges on.

Before editing a config file, find the git repo that owns it. If the file is tracked and has no uncommitted changes, git is the revert. Otherwise, copy it to `backups/<topic>/<file>.<YYYYMMDD>.bak` in the notes repo first. The user's config repos take file edits only; their git state (staging, commits, branches) belongs to the user.

For a config fault: establish the cause by observation, make one change at a time, and re-check the symptom after each. Done when the symptom is gone under the check that showed it.

## 3. Write notes, as it happens

Write each note the moment it is settled, not at the end: the user can leave at any point.

- **Decision or preference stated by the user**: add it to its topic or `PREFERENCES.md`. A reversed decision moves to **Rejected** with the reason.
- **Rule**: goes into `RULES.md` only when the user explicitly asks for one.
- **Applied change**: update the topic and, for a fix or a multi-file change, write a log entry.
- **Fix**: remove or correct every note it contradicts.
- **Answer**: file it in its topic only when it was costly to find (web search, deep digging).
- **New tool or path**: add it to `INDEX.md`.
- **Unfinished work**: add it to **Open**, and remove it once done.

On the first notes commit of a session, increment `Sessions since lint`.

Done when every decision, change, and unfinished thread from the session is in the notes and committed.
