---
name: setup-sh25-skills
description: Install, manage and wire up shalom2552's agent-skills assets.
argument-hint: "(optional) status | install | remove | setup [entry]"
disable-model-invocation: true
---

`install` puts assets on disk and applies their settings. This skill covers the rest: reporting what landed where, removing it, and whatever wiring `install` does not do.

Bare invocation runs `status` and changes nothing. Every write is confirmed with the user first.

## Find the checkout

`install` lives in the repo, not in the installed copy. Take the first hit:

1. `./install` in the current directory
2. `$AGENT_SKILLS_HOME`, else `~/.local/share/agent-skills`
3. the `source=` line in any marker file under the assets root, which records the checkout an entry came from

No hit anywhere: confirm with the user, then run `curl -fsSL shalom2552.github.io/agent-skills/install | bash`, which fetches a checkout into `~/.local/share/agent-skills` and installs from it.

Read `./install --help` for its flags. It is the source of truth and it changes; the script body is long and reading it wastes the budget this skill exists to protect.

## Verbs

### status

Print one row per entry, then the checkout path:

```
entry                        scope   mode  wired
skills/system-fix            global  copy  -
themes/catppuccin.json       global  copy  yes
settings/tmux-truecolor.json global  -     yes
mods/tape                    global  -     -

checkout: ~/.local/share/agent-skills
```

`./install --list` names the entries that exist in the repo. Everything else comes from the assets root: presence at `<root>/<type>/<entry>`, mode from whether it is a symlink, ownership from the marker, and `wired` from the table and settings fragments below. Report an entry whose marker names a different repo as such: on disk, but not ours.

Mods are not on disk under the root. Read them from `claude plugin list --json`: ours have an `id` ending in `@shalom2552`, and `scope` is `user` for global or `project` (with its `projectPath`).

Do not compare an installed copy against the checkout. `./install -u` pulls the checkout and refreshes what is installed, so the answer to any difference is to run it.

### install

Ask the user for scope and mode, then run with explicit flags and `--yes`:

```
./install --scope global --mode link --yes
```

An agent cannot use the interactive menu. `install` checks for a terminal, finds none, and silently takes its defaults (global scope, copy). To get the menu, the user runs `./install` themselves in their terminal.

### setup

Apply the wiring for an entry. If the entry is not installed yet, install it first, then wire it. One verb, whole job.

Wiring goes in the settings file for the scope the entry was installed at: global install writes `~/.claude/settings.json`, project install writes `<project>/.claude/settings.json`. Never `settings.local.json`.

Edit JSON with `jq`, writing to a temp file and moving it into place. Show the user the change before writing.

### remove

Delete the entry and strip its wiring, so nothing is left pointing at a file that no longer exists.

Only remove entries whose marker carries `repo=` matching the repo you installed from. Anything else belongs to another installer or to the user. Strip a wiring key only when its value points at the path being removed.

Remove a mod with `claude plugin uninstall <mod>@shalom2552 --scope <user|project>`, run from the project directory for project scope.

## Wiring table

One row per asset that needs configuration beyond being on disk. Assets not listed here need nothing.

| entry | wiring |
| --- | --- |

## Settings fragments

`install` merges `settings/<name>.json`, and the `<stem>.settings.json` beside an entry, into the scope's `settings.json`. It records each under `<root>/settings/`, as `<name>.json`, or `<type>/<stem>.json` for one bound to an entry, with a sidecar marker.

Themes carry one: `themes/catppuccin.settings.json` sets `theme`. Themes install only at global scope, since Claude Code loads custom themes from `~/.claude/themes`.

- `status`: an entry with a bound fragment is `wired` when its record exists and its marker is ours.
- `remove`: after deleting the entry, unapply its bound record. For each top-level key in the record, when every value under it still matches `settings.json`, delete those values and any object left empty; a key with any value changed by hand stays whole. Then delete the record and its marker.

## Marker files

`install` proves ownership with a marker beside every entry it created. Read them; do not write them.

- A copied directory carries `.agent-skills-install` inside it.
- A copied file gets `.<filename>.agent-skills-install` next to it.
- A symlinked entry has no marker, since the link target is the proof.

Contents:

```
repo=https://github.com/shalom2552/agent-skills.git
source=/home/user/.local/share/agent-skills/skills/system-fix
installed=2026-08-27T17:16:01Z
```

`repo=` answers whether an entry is ours. `source=` locates the checkout.

## Assets roots

- global: `$CLAUDE_CONFIG_DIR`, else `~/.claude`
- project: `<project>/.claude`

Entries sit under a subdirectory per type: `skills/`, `themes/`, and whatever types the repo grows. Settings records sit under `settings/`, and mods live in Claude Code's plugin cache. `./install --list` groups its output by type, which is where to learn the current set.
