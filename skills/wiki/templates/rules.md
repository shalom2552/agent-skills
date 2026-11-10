# Wiki rules

Rules version 1.0.0. Everything above "Project rules" is replaced on upgrade; this project's own rules go under that heading.

The wiki is memory across sessions. It holds what the sources cannot say and points at the sources for everything else.

## The test

A **source** is wherever the truth lives: code, configs, docs, data, an external system, or the user. The index lists this project's sources.

A line belongs in the wiki only when no source can tell the next agent the same thing in one lookup. That leaves:

- reasons: why a thing is the way it is
- decisions, with the options rejected and why
- traps: what went wrong or surprised, and the way around it
- conventions no tool enforces
- terms and what they mean here
- open threads: questions, unverified work, next steps
- pointers: where the truth for something lives

Values, versions, counts, signatures, defaults, layouts and usage steps stay in their source. Write a **pointer** instead: a file, symbol, command, heading or URL. Pointers name stable things; line numbers and copied values go stale.

A fact about something outside the project that cannot be re-checked cheaply (a measurement, a service's behaviour, a person's preference) ends with `(as of YYYY-MM-DD)`.

## Pages

The index is the registry: a page exists for agents once it has an index row (page, kind, read when). A page type lives where the index says, even outside the wiki (a glossary in `CONTEXT.md`, decisions in `docs/adr/`); write there in that place's format.

Two kinds:

- **current**: true now. Edit in place, in the same task that makes a line false. Delete lines that stopped being true; git and the log keep the history. Capped in lines.
- **history**: append-only and dated. Add entries; touch an old entry only on its `Status:` line. Read by heading.

Each page opens with a `#` title and a header line in italics naming its kind and cap.

Create a page when a topic has about 5 lines of its own, or crowds its page past cap. Names are lowercase kebab-case. A cluster that grows past about 6 pages moves into a folder with its own `index.md`, which takes one row in the top index.

When a write would push a page past its cap, compact in the same write: merge duplicates, drop what stopped mattering, or split a topic out.

## Page types

### index (current, cap 60)
Purpose in one line, reading notes, then three sections:
- `## Sources`: table of what | where, one row per source of truth.
- `## Pages`: table of page | kind | read when.
- `## Open`: at most 10 one-line items. Delete an item once closed; a durable outcome goes to its page.

### log (history)
One entry per session that wrote to the wiki, newest last. Heading `## [YYYY-MM-DD] <op> | <summary>`, op one of `setup`, `work`, `lint`, `upgrade`; up to 3 bullets under it.

### decisions (history)
```
## D<n> <the decision, as a statement>
Date: YYYY-MM-DD · Status: accepted | superseded by D<m> | dropped
- Why: <reason>
- Rejected: <option>, because <reason>
- Supersedes: D<k>
```
`Supersedes` only when it does. Record a decision only when it is hard to reverse, would surprise a later reader, and came from a real trade-off. Number it highest existing plus one; after a merge clash, renumber the newer entry. To reverse one, add a new entry that supersedes it and update the old Status line.

### gotchas (current, cap 60)
Traps actually hit, grouped under `##` areas. One bullet each: trap, symptom, way around, pointer. Delete a bullet once the source no longer has the trap.

### glossary (current, cap 80)
`**Term**: what it is, in one or two sentences. _Avoid_: synonyms.` Only terms specific to this project.

### overview (current, cap 80)
How the parts fit and why: boundaries, flows, ownership. The contents of each part stay in the part.

### topic pages (current, cap 80)
Anything else that passes the test, one topic per page.

## Writing

The reader is an agent with a token budget.

- One fact per bullet. Claim first, reason after.
- Plain words, and the glossary's terms where it has them.
- Each fact lives on one page. Elsewhere, refer to it by page and ID (`decisions D12`).
- Bullets and tables over paragraphs. Record outcomes, not the story of the session.
- Cut what a competent agent would do unprompted.
- Tag a line `(user)` when the user stated it: intent, requirements, preferences, reasons. Only the user changes a `(user)` line.
- Untagged lines were checked against a source or the work. A guess goes to Open as a question.
- Secrets, credentials and personal data stay out.

## When to write

Write when something durable settles: a decision made, a trap hit, a term pinned, a thread opened or closed. Write it then, not at session end. Routine work that settled nothing durable writes nothing.

With your first write in a session, add a log entry.

## Conflicts

- A source and an untagged line disagree: the source wins. Fix the line in the same task.
- A source and a `(user)` line or accepted decision disagree: stop and ask the user. It is a bug or a reversal, and only they know which.
- Two wiki lines disagree: check the source and keep the true one.

## Lint

Count log entries since the last `lint` or `setup` entry. At 10, offer the user a lint.

A lint checks:
- every current line against its source: still true, a pointer and not a copy, on one page only
- every page against its cap
- Open items already closed
- index rows against files: dead rows, unregistered pages
- history pages: Status lines and Supersedes links only

Fix untagged lines directly. Findings on `(user)` lines and decisions go to the user. Log it as `lint`.

## Project rules
