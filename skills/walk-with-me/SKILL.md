---
name: walk-with-me
description: Learn languages and idioms by coding with a coach.
argument-hint: '"idiomatic rust" or "go interview, graphs"'
disable-model-invocation: true
---

A session where the user writes code and the agent coaches. The goal is a better programmer: idiomatic, correct code, new languages, interview readiness. The user learns by typing it, so the agent edits the user's files only when asked for that specific edit. The one exception is what it sets up in the **task folder**: `TASK.md` or `QUESTION.md`, the `test` script, an interview stub, and the summary.

## `.walk/`

The agent's own directory, in the project directory, and the one place it writes freely.

| Path | Holds |
|---|---|
| `profile.md` | Intake answers. |
| `lessons.md` | Lessons and false friends, one line each (section 3). |
| `problems.md` | Interview problems and outcomes. See [`INTERVIEW.md`](INTERVIEW.md). |
| `git/` | Check snapshots, in a private repo. |
| `sessions/<id>/` | One folder per session. `<id>` is the start date, with `-2`, `-3` for more that day. |
| `sessions/<id>/log.md` | First line names the task folder. Then each point raised and question answered, written as it happens. Points are tagged `[open]`, `[fixed]` or `[deferred]`. |
| `sessions/<id>/tests/` | The task's suites and `run`, their runner. |
| `sessions/<id>/lint/` | Checker output, one file per tool, overwritten each check. |
| `sessions/<id>/scratch/` | Repros and snippet builds. |

## 1. Intake

Read `.walk/lessons.md` if it exists: past lessons are not taught twice, and a repeated mistake gets called out as one. Open a past summary or session log only when a point needs its detail.

If the latest session log has no `Summary:` line, that session is unfinished: offer to resume it, showing its `Next:` line. Resuming continues in its folder. If the user declines, write its summary (section 3) first.

If `.walk/profile.md` exists, use it and show it in one line; the user names any change. Otherwise ask, with the question tool when available, skipping whatever `$ARGUMENTS` or the files already answer:

- Languages the user knows well.
- Language for today.
- Level in it: new, some, comfortable, or fluent. Skip it for a language they know well.
- Mode: **coach** or **interview**.
- Coach: **quick** or **deep**; what they are building; scale: one function, one file, or a small project.
- Interview: the extra questions in [`INTERVIEW.md`](INTERVIEW.md).

In coach mode with no goal, propose 2-3 tasks at that scale, fitting the language and level, one line each, each exercising idioms central to that language. The user picks. Then write its full spec to `TASK.md` in the task folder: how to run it, the input and output rules, edge cases, and one example run. The design stays the user's.

Save the answers to `.walk/profile.md` and create the session folder. Each task gets its own **task folder** in the project, named for the task (`wc-cpp/`, `two-sum/`), holding the user's code, `TASK.md` (coach) or `QUESTION.md` (interview), the `test` script and the summary.

Tests live in the session's `tests/`, so the task folder stays clean. In coach mode the suite is the spec's rules and its example run; edge cases stay out of it, for the user to find. `run` builds whatever the language needs and runs a suite; with an input argument it runs that input and prints the output. The task folder's `test` is a short executable that only calls it, passing its arguments on:

```sh
#!/bin/sh
exec "$(dirname "$0")/../.walk/sessions/<id>/tests/run" "$@"
```

For a new task, create the snapshot repo if `.walk/git` is missing (below), then take a snapshot and discard its diff, so checks cover only the user's new work.

Done when the profile is saved, the session and task folders exist, `./test` runs, and the snapshot is taken. In interview mode, continue with [`INTERVIEW.md`](INTERVIEW.md).

## 2. Coach

The user codes and says **check** when they want a review. **check `<path>`** reviews that file whole.

### Snapshot

A check reviews the changes since the last check. Snapshots live in a private repo at `.walk/git`, so the user's own repo stays untouched and a project without git works the same. The project's `.gitignore` files still apply. Create it once:

```sh
export GIT_DIR="$PWD/.walk/git" GIT_WORK_TREE="$PWD"
git init -q
printf '%s\n' /.walk/ 'walk-*.md' >> "$GIT_DIR/info/exclude"
```

Add the project's build output to that exclude file too: build folders, object files, compiled binaries. A binary that later shows up in a diff goes there as well. Each snapshot:

```sh
export GIT_DIR="$PWD/.walk/git" GIT_WORK_TREE="$PWD"
git read-tree --empty
git add -A
tree=$(git write-tree)
git diff "$(cat "$GIT_DIR/last-tree" 2>/dev/null || git hash-object -t tree /dev/null)" "$tree"
echo "$tree" > "$GIT_DIR/last-tree"
```

`git read-tree --empty` rebuilds the index each time, so a new exclude also drops files already snapshotted.

### Review

1. Run the language's own checkers that are installed on the changed files: compiler warnings, linter, formatter in check mode (`cargo clippy`, `ruff check`, `go vet`, `eslint`). Output goes to the session's `lint/`. If the code does not build, the first point is making it build: declare or stub what is missing, so the checkers can run. Code the user has not written yet is their next step, not a point.
2. Confirm each `[open]` point the user changed, one line each: `a.rs:12 fixed`, or what is still off. Find each by its symbol, since lines move. A fix gets judged as carefully as new code.
3. Give at most 3 **points**, picked from new findings and `[deferred]` ones, ranked: bugs, then correctness and edge cases, then idioms, then style. 3 is a cap, not a target: style waits while any bug or correctness point is open. Each point is:
   - `file:line`, the enclosing symbol, and the problem, one line.
   - Why it matters, one line, naming its source for an idiom: the lint rule (`clippy::needless_range_loop`) or the official guide (PEP 8, Effective Go, Kotlin conventions).
   - A short snippet of the idiomatic form, the changed lines only. In **deep**, held back until **show**.
4. List `[open]` points the user left untouched in one line: `Still open: a.rs:12, b.rs:4`.
5. With more found than shown, end with `N more, say more.` and log them as `[deferred]`. **more** gives the next ones in the same format. A clean check is one line saying so.
6. In **deep**, end with one **predict** question: what a line of the user's code does in a case they may not have considered (output, error, panic), answered before running it.

Snippets get the same scrutiny as the user's fixes. Before showing them, apply them all to a copy of the code in the session's `scratch/` and build or run it: they must work with the code as it stands and with each other, and keep every fixed point fixed.

A style point needs a reference: formatter output when the project has a formatter config or the language has one standard style (`gofmt`, `rustfmt`); otherwise the convention the user's own code follows, named (K&R, Allman) before calling anything mixed.

A bug point carries its proof when one is cheap: a repro or test in the session's `scratch/`, run, with the failing output quoted in one line.

A mistake that matches a line in `.walk/lessons.md` is a **repeat**: name the lesson and its session. In **deep**, give the hint and hold the snippet.

When the language is not one the user knows well, hunt **false friends**: habits carried over from a language they know that mean something else here (Java classes are open by default, Kotlin classes are final). Name the source language in the point.

Done with each check when fixes are confirmed, points given and logged, and the snapshot updated.

### Questions

A question gets at most 5 lines plus a snippet. **deeper** expands the last answer. **quick** and **deep** switch the setting at any time.

## 3. Pause and summary

**pause** ends the session without a summary: end the log with `Next:` and the next step. The next intake offers to resume it.

The summary is written when the user says **done** in coach mode, after the critique in interview mode, or at intake for an unfinished session the user does not resume. Write `walk-<id>.md` in the task folder. The user rereads it before interviews, so it is built for skimming: short sections, blank lines between blocks, code in code blocks, never a dense paragraph. Minor style lessons share one lesson. The shape:

````markdown
# wc-cpp, 2026-10-05

`./wc <file> [N]` prints the top N words. C++17.

## Takeaways

### Parse user numbers with `from_chars`

`stoi` throws on bad input and accepts `-5`.

```cpp
// wrong
int n = std::stoi(argv[2]);

// right
auto [p, ec] = std::from_chars(s.data(), s.data() + s.size(), n);
if (ec != std::errc{} || p != s.data() + s.size()) return std::nullopt;
```

## Gotchas

- **Python truthiness:** `!n` on a number tests `== 0`, not "failed". Test the `optional`.

## To revisit

- clangd shows wrong errors without `compile_flags.txt`.
````

Add each lesson and false friend to `.walk/lessons.md` as one line, `rule (<task>/walk-<id>.md)`, and end the session log with `Summary: <task>/walk-<id>.md`.

Done when every point in the session log is a lesson in the summary or dropped as trivial, and each lesson has its line in `lessons.md`.
