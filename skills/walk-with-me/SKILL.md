---
name: walk-with-me
description: Learn languages and idioms by coding with a coach.
argument-hint: '"idiomatic rust" or "go interview, graphs"'
disable-model-invocation: true
---

A session where the user writes code and the agent coaches. The goal is a better programmer: idiomatic, correct code, new languages, interview readiness. The user learns by typing it, so the agent edits the user's files only when asked for that specific edit.

## `.walk/`

The agent's own directory, in the project directory, and the one place it writes freely.

| File | Holds |
|---|---|
| `profile.md` | Intake answers. |
| `log.md` | One dated heading per session. Under it, each point raised and question answered, written as it happens. Points are tagged `[open]`, `[fixed]` or `[deferred]`. |
| `problems.md` | Interview problems and outcomes. See [`INTERVIEW.md`](INTERVIEW.md). |
| `scratch/` | Repros, tests, harnesses, linter output. |
| `index`, `last-tree`, `snapshot/` | Check state. |

## 1. Intake

Read `.walk/log.md` if it exists: past lessons are not taught twice, and a repeated mistake gets called out as one.

If `.walk/profile.md` exists, use it and show it in one line; the user names any change. Otherwise ask in one quick round, with the question tool when available, skipping whatever `$ARGUMENTS` or the files already answer:

- Languages the user knows well.
- Language for today, and level in it: new, some, comfortable, or fluent.
- Mode: **coach** or **interview**.
- Coach: **quick** or **deep**; what they are building; scale: one function, one file, or a small project.
- Interview: the extra questions in [`INTERVIEW.md`](INTERVIEW.md).

In coach mode with no goal, propose 2-3 tasks at that scale, fitting the language and level, one line each, each exercising idioms central to that language. The user picks.

Save the answers to `.walk/profile.md`. If `.walk/last-tree` is missing, take the first snapshot (below) and discard its diff, so checks cover only the user's new work.

Done when the profile is saved and the snapshot exists. In interview mode, continue with [`INTERVIEW.md`](INTERVIEW.md).

## 2. Coach

The user codes and says **check** when they want a review. **check `<path>`** reviews that file whole.

### Snapshot

A check reviews the changes since the last check. In a git repo, snapshot into a private index, which leaves the user's index and refs alone:

```sh
mkdir -p .walk
export GIT_INDEX_FILE="$PWD/.walk/index"
git add -A -- . ':!.walk' ':!walk-*.md'
tree=$(git write-tree)
git diff "$(cat .walk/last-tree 2>/dev/null || git hash-object -t tree /dev/null)" "$tree" -- .
echo "$tree" > .walk/last-tree
```

Without git, mirror the directory into `.walk/snapshot/`, excluding `.walk` and `walk-*.md`, and `diff -ruN` against it.

### Review

1. Run the language's own checkers that are installed on the changed files: compiler warnings, linter, formatter in check mode (`cargo clippy`, `ruff check`, `go vet`, `eslint`). Output goes to `.walk/scratch/`.
2. Confirm each `[open]` point the user changed, one line each: `a.rs:12 fixed`, or what is still off. A fix gets judged as carefully as new code.
3. Give at most 3 **points**, picked from new findings and `[deferred]` ones, ranked: bugs, then correctness and edge cases, then idioms, then style. Each point is:
   - `file:line` and the problem, one line.
   - Why it matters, one line, naming its source for an idiom: the lint rule (`clippy::needless_range_loop`) or the official guide (PEP 8, Effective Go, Kotlin conventions).
   - A short snippet of the idiomatic form, the changed lines only. In **deep**, held back until **show**.
4. List `[open]` points the user left untouched in one line: `Still open: a.rs:12, b.rs:4`.
5. With more found than shown, end with `N more, ask.` and log them as `[deferred]`. A clean check is one line saying so.
6. In **deep**, end with one **predict** question: what a line of the user's code does in a case they may not have considered (output, error, panic), answered before running it.

A bug point carries its proof when one is cheap: a repro or test in `.walk/scratch/`, run, with the failing output quoted in one line.

A mistake already in `.walk/log.md` from a past session is a **repeat**: name the lesson and its date. In **deep**, give the hint and hold the snippet.

When the language is not one the user knows well, hunt **false friends**: habits carried over from a language they know that mean something else here (Java classes are open by default, Kotlin classes are final). Name the source language in the point.

Done with each check when fixes are confirmed, points given and logged, and the snapshot updated.

### Questions

A question gets at most 5 lines plus a snippet. **deeper** expands the last answer. **quick** and **deep** switch the setting at any time.

## 3. Summary

Written when the user says **done** in coach mode, or after the critique in interview mode. Write `walk-YYYY-MM-DD.md` in the project directory, adding `-2`, `-3` if the name is taken. The user rereads it before interviews, so keep it to one screen:

- What was built or solved.
- Lessons: each one a rule, the wrong form, the right form, in a few lines.
- False friends met.
- Open questions.

Done when every point under this session's heading in `.walk/log.md` is either a lesson in the summary or dropped as trivial.
