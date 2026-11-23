# Wiki rules

Rules version 2.0.0. Everything above "Project rules" is replaced on upgrade; this project's own rules go under that heading.

The wiki is memory across sessions. It holds what the sources cannot say and points at the sources for everything else.

## The test

A **source** is wherever the truth lives: code, configs, docs, data, an external system, or the user. The index lists this project's sources.

A line belongs in the wiki only when no source can tell the next agent the same thing in one lookup. That leaves:

- reasons: why a thing is the way it is
- decisions that meet the bar under "decisions" below, with the options rejected and why
- traps: what went wrong or surprised, and the way around it
- conventions no tool enforces
- terms and what they mean here
- open threads: questions, unverified work, next steps
- pointers: where the truth for something lives

Values, versions, counts, signatures, defaults, layouts and usage steps stay in their source. Write a **pointer** instead: a file, symbol, command, heading or URL. Pointers name stable things; line numbers and copied values go stale. A page listing what the code contains is a copy too: a search finds it.

A request carried out lives in its result. "Move the button down" is in the code once done. Write a line only when the next agent would likely undo it without knowing why, and record the reason, not the change. A preference that holds across the project is a convention; one about a single place lives in that place.

A fact about something outside the project that cannot be re-checked cheaply (a measurement, a service's behaviour, a person's preference) ends with `(as of YYYY-MM-DD)`.

## Pages

The index is the registry: a page exists for agents once it has an index row (page, read when). A page type lives where the index says, even outside the wiki (a glossary in `CONTEXT.md`, decisions in `docs/adr/`); write there in that place's format.

Pages hold what is true now. Edit a line in the same task that makes it false, and delete it once it stops being true. Each page opens with a `#` title and an italic line naming its cap.

Create a page when a topic has about 5 lines of its own, or crowds its page past cap. Names are lowercase kebab-case. A cluster that grows past about 6 pages moves into a folder with its own `index.md`, which takes one row in the top index.

A page past its cap needs compacting: drop what stopped mattering, merge true duplicates, or split a topic out. Lines stay short through compaction.

## Page types

### index (cap 60)
Purpose in one line, reading notes, then three sections:
- `## Sources`: table of what | where, one row per source of truth.
- `## Pages`: table of page | read when.
- `## Open`: at most 10 one-line items. Delete an item once closed; a durable outcome goes to its page.

### decisions (cap 150)
```
## D<n> <the decision, as a statement>
- Why: <reason>
- Rejected: <option>, because <reason>
```
Record a decision only when it is hard to reverse, would surprise a later reader, and came from a real trade-off. Number it highest existing plus one; never reuse a number. A reversed decision is rewritten or deleted.

### gotchas (cap 60)
Traps actually hit, grouped under `##` areas. One bullet each: trap, symptom, way around, pointer. Delete a bullet once the source no longer has the trap.

### glossary (cap 80)
`**Term**: what it is, in one or two sentences. _Avoid_: synonyms.` Only terms specific to this project.

### overview (cap 80)
How the parts fit and why: boundaries, flows, ownership. The contents of each part stay in the part.

### topic pages (cap 80)
Anything else that passes the test, one topic per page.

## Writing

The reader is an agent with a token budget.

- One fact per bullet, one line, about 25 words at most. Claim first, reason after.
- Lead with the thing the line is about (symbol, file, term) so a grep finds it.
- Plain words, and the glossary's terms where it has them.
- Each fact lives on one page. Elsewhere, refer to it by page and ID (`decisions D12`).
- Bullets and tables over paragraphs. Record outcomes, not the story of the session.
- Cut what a competent agent would do unprompted.
- Tag a line `(user)` when the user stated it and it passes the test. Update it when the user's new words change it.
- Untagged lines were checked against a source or the work. A guess goes to Open as a question.
- Secrets, credentials and personal data stay out.

The same fact, two ways:
- Bad: `- While debugging we found out that the payments API seems to block clients that fail too often, so we lowered the retries in retry() to 3 to be safe.`
- Good: `- retry() caps at 3: payments API bans a client after 5 failures a minute (as of 2026-11-23).`

## When to write

Write when something durable settles: a decision that meets the bar, a trap hit, a term pinned, a thread opened or closed. Write it then, not at session end. Most sessions write nothing. With subagents, the coordinator writes; the others report what settled.

## Conflicts

- A source and an untagged line disagree: the source wins. Fix the line in the same task.
- A source and a `(user)` line or decision disagree: stop and ask the user. It is a bug or a reversal, and only they know which.
- Two wiki lines disagree: check the source and keep the true one.

## Lint

Offer the user a lint when a page passes its cap or the index's `Linted` date is a month old.

A lint checks:
- lines against their source: still true, a pointer and not a copy, on one page only. With git, the lines changed since `Linted`; otherwise, or when the user asks, every line.
- every page against its cap
- Open items already closed
- index rows against files: dead rows, unregistered pages

Fix untagged lines directly. Findings on `(user)` lines and decisions go to the user. Then set `Linted` to today.

## Project rules
