---
name: setup-agent-skills
description: Install, manage and wire up shalom2552's agent-skills assets.
argument-hint: "(optional) status | install | remove | setup [entry]"
disable-model-invocation: true
---

`install` puts assets on disk. This skill covers the rest: reporting what landed where, removing it, and the configuration `install` does not do: pointing Claude Code at an installed script, and whatever wiring later assets need.

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
entry               scope   mode  wired
skills/system-fix   global  copy  -
scripts/statusline  global  copy  yes

checkout: ~/.local/share/agent-skills
```

`./install --list` names the entries that exist in the repo. Everything else comes from the assets root: presence at `<root>/<type>/<entry>`, mode from whether it is a symlink, ownership from the marker, and `wired` from the table below. Report an entry whose marker names a different repo as such: on disk, but not ours.

Do not compare an installed copy against the checkout. `install` refreshes copies on every run, so the answer to any difference is to re-run it.

### install

Ask the user for scope and mode, then run with explicit flags and `--yes`:

```
./install --scope global --mode link --yes
```

An agent cannot use the interactive menu. `install` checks for a terminal, finds none, and silently takes its defaults (project scope, copy). To get the menu, the user runs `./install` themselves in their terminal.

### setup

Apply the wiring for an entry. If the entry is not installed yet, install it first, then wire it. One verb, whole job.

Wiring goes in the settings file for the scope the entry was installed at: global install writes `~/.claude/settings.json`, project install writes `<project>/.claude/settings.json`. Never `settings.local.json`.

Edit JSON with `jq`, writing to a temp file and moving it into place. Show the user the change before writing.

### remove

Delete the entry and strip its wiring, so nothing is left pointing at a file that no longer exists.

Only remove entries whose marker carries `repo=` matching the repo you installed from. Anything else belongs to another installer or to the user. Strip a wiring key only when its value points at the path being removed.

## Wiring table

One row per asset that needs configuration beyond being on disk. Assets not listed here need nothing.

| entry | wiring |
| --- | --- |
| `scripts/statusline.sh` | Point `statusLine` in the scope's `settings.json` at the installed script: `{"type": "command", "command": "bash \"<installed path>\""}`. Wired when that command already names the installed path. Needs `jq` on `PATH`, which the script itself requires anyway. |

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

- global: `$CLAUDE_HOME`, else `~/.claude`
- project: `<project>/.claude`

Entries sit under a subdirectory per type: `skills/`, `scripts/`, and whatever types the repo grows. `./install --list` groups its output by type, which is where to learn the current set.
