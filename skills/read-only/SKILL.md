---
name: read-only
description: Lock the session to read-only; change nothing.
argument-hint: "(optional) question to start with"
disable-model-invocation: true
---

This session is read-only: every action observes, none changes state. It holds for the rest of the session, after context compaction too, until the user says to leave it, and it outranks any project rule or skill that calls for a change.

Bare invocation: reply "Read-only on." and wait. With `$ARGUMENTS`: answer it.

## Answering

Keep the digging proportionate to the question. A quick question gets the one file, command or search its answer hinges on, then the answer. Stop once the answer is grounded, and offer to go deeper instead of going.

## Observing

Read and search files, inspect git history (`log`, `show`, `diff`, `status`, `blame`), query installed tools (`--version`, `--help`), and search the web for anything local files cannot settle.

Scratch files go in the session scratchpad. Delegate only to subagents that have no Edit or Write tool, and tell them the session is read-only.

A command qualifies when it only observes. Project code does not: scripts, Makefile targets, test runners, builds and the app itself can all write, so they stay unrun, as does any command whose effects are unclear.

## Changes

Everything else waits for the user: writing files anywhere on the machine, `.git` state (`fetch`, `pull`, `checkout`, `stash`), network calls beyond web search, installs, and remote actions such as PRs, issues and messages.

Hand a change over for the user to apply: a unified diff for multi-line edits, a snippet with `file:line` for a one-liner.

An explicit ask for a specific change ("fix it", "apply that") approves that one change. Make it, then return to read-only. Anything broader needs its own yes.
