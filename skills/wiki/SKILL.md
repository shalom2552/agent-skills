---
name: wiki
description: Set up and lint an agent wiki.
argument-hint: "(optional) setup | lint"
disable-model-invocation: true
---

A **wiki** is a folder of markdown pages that agents read at the start of a task and write to as durable facts settle. It holds what the sources cannot say and points at the sources for the rest. The project's copy of [templates/rules.md](templates/rules.md) governs it; this skill installs, seeds and lints it.

`$ARGUMENTS` picks the verb. Bare: `setup` when the project has no wiki, else `lint`.

The project root is the git toplevel, else the current directory. A wiki exists when `AGENTS.md` or `CLAUDE.md` has a `## Wiki` section, or a folder holds `index.md` beside a `rules.md` with a `Rules version` line.

## setup

1. **Survey.** Classify every top-level entry of the root, and note:
   - agent files: `AGENTS.md`, `CLAUDE.md`, and whether `CLAUDE.md` imports `@AGENTS.md`
   - an existing wiki, or notes or memory folders with an index of their own
   - domain docs: `CONTEXT.md`, `CONTEXT-MAP.md`, `docs/adr/`
   - sources of truth: README, docs, specs, build and config files, data folders, git history

   Done when every top-level entry has a class.

2. **Agree the plan.** One message to the user, then wait:
   - location, default `wiki/`
   - the agent-file wiring from step 3
   - the Sources table and the pages you expect to seed
   - an existing wiki: adopt it (keep its pages, register them in the index, swap its rules for ours) or set up beside it
   - the project's purpose in one line, when the sources don't give it
   - anything the user wants recorded as `(user)` lines

3. **Wire the agent files.** Insert [templates/section.md](templates/section.md) with `{{WIKI}}` set to the location:

   | Found | Do |
   | --- | --- |
   | neither | create `AGENTS.md` (`# AGENTS.md` and the section) and `CLAUDE.md` containing `@AGENTS.md` |
   | `AGENTS.md` only | append the section; create `CLAUDE.md` containing `@AGENTS.md` |
   | `CLAUDE.md` only | ask: move its content to `AGENTS.md` and leave `@AGENTS.md` behind (recommended), or append the section to `CLAUDE.md` |
   | both, imported | append the section to `AGENTS.md` |
   | both, separate | append the section to `AGENTS.md`; add `@AGENTS.md` to `CLAUDE.md` |
   | an old wiki section | replace it; carry its project-specific rules to `rules.md` under "Project rules" |

4. **Create the wiki.** Copy [templates/rules.md](templates/rules.md) verbatim. Write the index from [templates/index.md](templates/index.md): purpose, one Sources row per source of truth (pointer only), Pages rows. Write the log from [templates/log.md](templates/log.md).

5. **Seed.** Read the sources from the survey, the last 100 commit subjects when there is git history, and this conversation. Hold every candidate line to the test in `rules.md`, write it in its page type's format, create only pages that receive lines, and register each in the index. Lines the user stated get `(user)`. A new or empty project gets only what step 2 gave.

   Done when every source was read or deliberately skipped, and every written line was checked against its source.

6. **Finish.** Add a `setup` log entry. Report: files created or changed with line counts, one line per seeded page, sources skipped and why.

## lint

1. Read the index and `rules.md`, and list the wiki folder.

2. **Upgrade check.** Compare the `Rules version` line with [templates/rules.md](templates/rules.md). When the project's is older, show what changed and offer to replace everything above `## Project rules`, keeping that section. Log an accepted upgrade as `upgrade`.

3. **Check.** Run the checks under "Lint" in `rules.md` over every page, and confirm the agent files still carry the section with the right path and `CLAUDE.md` still imports `AGENTS.md`.

   Done when every line of every current page was compared against its source.

4. **Resolve.** Fix untagged lines directly. Collect the rest for the user: `(user)` lines and decisions a source contradicts, pages to split or merge.

5. **Finish.** Add a `lint` log entry. Report the fixes as page: change, then the list awaiting the user.
