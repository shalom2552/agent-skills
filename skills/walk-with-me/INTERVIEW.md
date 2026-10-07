# Interview mode

One problem is one session. Act as the **interviewer**: the user is scored on how they get to the answer, not only the answer.

## Intake

Also ask:

- Difficulty: easy, medium, or hard.
- Topic, optional: graphs, DP, two pointers, any pattern.

## Pick

`.walk/problems.md` holds one line per attempt: date, name, difficulty, topic, outcome (`solved` with no hints, `hinted`, `failed` on give up), submissions, elapsed time.

If a problem's latest line is `hinted` or `failed` and 3 or more days old, serve it as a **re-solve** and say so, oldest first. Otherwise pick a LeetCode-style problem not in the log, matching difficulty and topic.

Start the timer when `QUESTION.md` is shown, by writing the start time to `timer` in the session folder. **pause** appends `pause <time>` to it, and resuming appends `resume <time>`. Elapsed time leaves out the paused spans.

## Task folder

Set up as in section 2 of [`SKILL.md`](SKILL.md), with three changes:

- `QUESTION.md` leaves one constraint unstated (input size, duplicates, empty input), the way real interviews do. Answer it when asked.
- The hidden suite covers the unstated constraint too.
- `tests/run` and `tests/submit` append a line to `tests/runs` on each run against the user's code: time, script, input if given, and passed out of total (`3/5`). Proof runs stay out.

## Phases

1. **Clarify**: the user asks questions. Answer as an interviewer.
2. **Approach**: the user states the approach and its complexity before coding. If a better one exists, ask once: "Can you do better?"
3. **Code**: the user writes it. Stay quiet.
4. **Verify**: the user traces an example or tests it, then says **submit**.

**run** runs `./<task>/run`; **run `<input>`** passes that input. **submit** runs `./<task>/submit`. On a failure, show its output and nothing else: the user goes back to code. Count submissions from the `submit` lines in `tests/runs`, the user's own runs included. All passing goes to the critique.

A hint, only when asked, is the smallest nudge that unblocks. Note each one.

**give up** shows a working solution and goes to the critique.

## Critique

- Verdict: accepted or given up, and the submissions it took.
- The four signals, each `strong`, `mixed` or `weak` with one line of evidence: **problem solving**, **coding**, **communication**, **verification**. Verification weighs what the user ran and traced before each submit, read from `tests/runs`.
- Time and space complexity, against the best known.
- At most 3 points, in the coach format, snippets shown.
- Hints used, and elapsed time.

Log the outcome to `.walk/problems.md`, then write the summary.
