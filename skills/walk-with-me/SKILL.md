---
name: walk-with-me
description: Learn languages and idioms by coding with a coach.
argument-hint: '"idiomatic rust" or "go interview, graphs"'
disable-model-invocation: true
allowed-tools: Edit(./.walk/**) Bash(*/walk-with-me/snap) Bash(*/walk-with-me/snap -q) Bash(./*/run) Bash(./*/run *) Bash(./*/submit) Bash(./*/submit *)
---

A session where the user writes code and the agent coaches. The goal is a better programmer: idiomatic, correct code, new languages, interview readiness. The user learns by typing it, so the agent edits the user's files only when asked for that specific edit. The one exception is what it sets up in the **task folder** (section 2): the spec, the scripts, an interview stub, and the summaries.

## `.walk/`

The agent's own directory, in the project directory, and the one place it writes freely. Writes here are bookkeeping: make them without mentioning them, and name a file only when the user needs to open it.

| Path | Holds |
|---|---|
| `profile.md` | Intake answers. |
| `lessons.md` | Lessons and gotchas, one line each (section 4). |
| `problems.md` | Interview problems and outcomes. See [`INTERVIEW.md`](INTERVIEW.md). |
| `git/` | Check snapshots, in a private repo. |
| `sessions/<id>/` | One folder per session. `<id>` is the start date, with `-2`, `-3` for more that day. |
| `sessions/<id>/log.md` | First line names the task folder. Then each point raised and question answered, written as it happens. Points are tagged `[open]`, `[fixed]` or `[deferred]`. |
| `sessions/<id>/tests/` | The task's suites and their `run` and `submit` scripts (section 2). |
| `sessions/<id>/lint/` | Checker output, one file per tool, overwritten each check. |
| `sessions/<id>/scratch/` | Repros, snippet builds, and the solutions that prove the suites. |

## 1. Intake

1. Read `.walk/lessons.md` if it exists: past lessons are not taught twice, and a repeated mistake gets called out as one. Open a past summary or session log only when a point needs its detail.
2. If the latest session log has no `Summary:` line, that session is unfinished: offer to resume it, showing its last `Next:` line, or its last logged point if it has none. Resuming continues in its folder and skips to step 8. If the user declines, write its summary (section 4) first.
3. If `.walk/profile.md` exists, show it in one line; the user names any change. Ask the rest in two rounds, with the question tool when available, skipping whatever `$ARGUMENTS`, the profile or the files already answer:
   - Round 1: mode, **coach** or **interview**; language for today; level in it, new, some, comfortable, or fluent, skipped for a language they know well; languages the user knows well.
   - Round 2, by mode. Coach: **quick** or **deep**; what they are building; scale: one function, one file, or a small project. Interview: the extra questions in [`INTERVIEW.md`](INTERVIEW.md).
4. Save the answers that hold across sessions to `.walk/profile.md`, and create the session folder. Mode, language, level and goal are per session: they stay out of the profile.
5. Pick the task. Coach with no goal: propose 2-3 tasks at that scale, fitting the language and level, one line each, each exercising idioms central to that language; the user picks. With a goal of their own, use their description. Interview: Pick in [`INTERVIEW.md`](INTERVIEW.md). A task can span sessions: continuing one reuses its task folder and tests, and skips to step 8.
6. Set up the task folder and its tests (section 2).
7. Run `snap -q` (Snapshot, below), so checks cover only the user's new work.
8. Show the scripts in one line, `./run`, `./run <input>`, `./submit`, and the commands in the next. Coach: **check**, **check `<path>`**, **show**, **more**, **deeper**, **quick**/**deep**, **pause**, **done**. Interview: **run**, **run `<input>`**, **submit**, **hint**, **give up**, **pause**.

Done when the profile is saved, the session and task folders exist, the suites are proven, both scripts run, the snapshot is taken, and the scripts and commands are shown. In interview mode, continue with Phases in [`INTERVIEW.md`](INTERVIEW.md).

## 2. Task folder

One per task, in the project, named for it (`wc-cpp/`, `two-sum/`). Interview mode changes a few things: see Task folder in [`INTERVIEW.md`](INTERVIEW.md).

| File | Holds |
|---|---|
| The user's code | Theirs to write. In interview mode it starts as a stub with the function signature. |
| `TASK.md` (coach), `QUESTION.md` (interview) | The spec. |
| `run`, `submit` | The test scripts. |
| `walk-<id>-<task>.md` | One summary per session (section 4). `<task>` is the task folder name. |

### Spec

Four parts. The design stays the user's.

- **Problem**: what to build or solve, with its input and output rules.
- **Examples**: 2-3, LeetCode style: `Input:`, `Output:`, and an `Explanation:` line when the rule behind it is not obvious. At least one goes past the smallest case.
- **Constraints**: sizes and value ranges. Edge cases go unnamed: finding them is the user's job.
- **Run**: `./run`, `./submit`, and one example run of `./run <input>`, all from the task folder.

### Tests

Two suites, in the session's `tests/` so the user never sees them, fixed before the user codes:

- The **run suite**: the examples, and in coach mode cases that stress each rule: several items, chains, nesting, beyond the smallest input that shows it.
- The **hidden suite**: what the spec leaves for the user to find: edge cases, values at the constraint limits, inputs at the size limit.

Two scripts beside them build whatever the language needs, then:

- `run`: the run suite, printing every case. With arguments, it runs them as input instead and prints the output.
- `submit`: the run suite, then the hidden suite, stopping at the first failure. With a folder as argument, it builds the code there instead of the task folder's.

Cases are numbered in suite order, the hidden suite continuing after the run suite. Each result is followed by an empty line. A pass prints the case's input. A failure also prints the expected output and the actual one. Both use the examples' notation. A hidden case prints only when it fails, so its input stays hidden until then:

```
PASS case 1
  input:    [[1,4],[2,3]]

FAIL case 2
  input:    [[1,10],[2,3]]
  expected: [[1,10]]
  got:      [[1,3]]
```

The task folder's `run` and `submit` both hold this wrapper, which calls the `tests/` script of the same name. They work from any folder: the user runs `./run` in the task folder, the agent `./<task>/run` from the project directory.

```sh
#!/bin/sh
exec "$(dirname "$0")/../.walk/sessions/<id>/tests/$(basename "$0")" "$@"
```

Prove the suites before the user codes. In `scratch/`, write a correct solution and 2-3 wrong ones, each a likely mistake for this task, and pass each one's folder to `submit`. The correct one passes. Each wrong one fails, and in coach mode one that breaks a stated rule fails on a run suite case. Add cases until all of this holds.

## 3. Coach

The user codes and says **check** when they want a review. **check `<path>`** reviews that file whole.

### Snapshot

A check reviews the changes since the last check. Snapshots live in a private repo at `.walk/git`, so the user's own repo stays untouched and a project without git works the same. The project's `.gitignore` files still apply.

[`snap`](snap), in this skill's folder, takes a snapshot: run it by its absolute path from the project directory. It creates the repo on first use and prints the diff since the last snapshot; `snap -q` skips the diff.

Add the project's build output to `.walk/git/info/exclude`: build folders, object files, compiled binaries. A binary that later shows up in a diff goes there as well. Each snapshot rebuilds the index, so a new exclude also drops files already snapshotted.

### Review

1. Run the language's own checkers that are installed on the changed files: compiler warnings, linter, formatter in check mode (`cargo clippy`, `ruff check`, `go vet`, `eslint`). Output goes to the session's `lint/`. If code the user wrote does not build, that is the first point. To run the checkers anyway, stub what is missing in a copy in the session's `scratch/`. Code the user has not written yet is their next step, not a point.
2. Confirm each `[open]` point the user changed, one line each: `a.rs:12 fixed`, or what is still off, retagging fixed ones `[fixed]` in the log. Find each by its symbol, since lines move. A fix gets judged as carefully as new code.
3. Give at most 3 **points**, picked from new findings and `[deferred]` ones, ranked: bugs, then correctness and edge cases, then idioms, then style. 3 is a cap, not a target: style waits while any bug or correctness point is open. Each point is:
   - `file:line`, the enclosing symbol, and the problem, one line.
   - Why it matters, one line, naming its source for an idiom: the lint rule (`clippy::needless_range_loop`) or the official guide (PEP 8, Effective Go, Kotlin conventions).
   - A short snippet of the idiomatic form, the changed lines only. In **deep**, held back until **show**.
4. List `[open]` points the user left untouched in one line: `Still open: a.rs:12, b.rs:4`.
5. With more found than shown, end with `N more, say more.` and log them as `[deferred]`. **more** gives the next ones in the same format. A clean check is one line saying so.
6. In **deep**, add one **predict** question before the `N more` line: what a line of the user's code does in a case they may not have considered (output, error, panic). Once the user answers, run it in `scratch/` and show the result.

Snippets get the same scrutiny as the user's fixes. Before showing them, apply them all to a copy of the code in the session's `scratch/` and build or run it: they must work with the code as it stands and with each other, and keep every fixed point fixed.

A style point needs a reference: formatter output when the project has a formatter config or the language has one standard style (`gofmt`, `rustfmt`); otherwise the convention the user's own code follows, named (K&R, Allman) before calling anything mixed.

A bug point carries its proof when one is cheap: a repro or test in the session's `scratch/`, run, with the failing output quoted in one line.

A mistake that matches a line in `.walk/lessons.md` is a **repeat**: name the lesson and its session, and hold the snippet until **show** in both settings.

When the language is not one the user knows well, hunt **gotchas**: habits carried over from a language they know that mean something else here (Java classes are open by default, Kotlin classes are final). Name the source language in the point.

Done with each check when fixes are confirmed, points given and logged, and the snapshot updated.

### Questions

A question gets at most 5 lines plus a snippet. **deeper** expands the last answer. **quick** and **deep** switch the setting at any time.

## 4. Pause and summary

**pause** ends the session without a summary: end the log with `Next:` and the next step. The next intake offers to resume it.

The summary is written when the user says **done** in coach mode, after the critique in interview mode, or at intake for an unfinished session the user does not resume. Write `walk-<id>-<task>.md` in the task folder, e.g. `walk-2026-10-05-wc-cpp.md`. The user rereads it before interviews, so it is built for skimming: short sections, blank lines between blocks, code in code blocks, never a dense paragraph. Minor style lessons share one lesson. The shape:

````markdown
# wc-cpp, 2026-10-05

`./wc <file> [N]` prints the top N words. C++17.

## Complexity

- Time: `O(n log n)` for n distinct words. Best known: `O(n log N)`, since `partial_sort` orders only the top N.
- Space: `O(n)`. Best known: `O(n)`.

## Lessons

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

**Complexity** measures the user's code as it ends the session, time and space, each against the best known. For a small project, measure its core operation.

**To revisit** holds points still `[open]` or `[deferred]`, and setup trouble.

Add each lesson and gotcha to `.walk/lessons.md` as one line, `rule (<task>/walk-<id>-<task>.md)`, and end the session log with `Summary: <task>/walk-<id>-<task>.md`.

Done when the complexity is stated, every point in the session log is a lesson, a gotcha, a to-revisit item, or dropped as trivial, and each lesson and gotcha has its line in `lessons.md`.
