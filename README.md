# Agent Skills

Skills for coding agents.

## Install

```sh
curl -fsSL shalom2552.github.io/agent-skills/install | bash
```

Or clone and run `./install`. See `./install --help` for options.

## Skills

| Skill | Description |
| --- | --- |
| `docs-sync` | Find and fix drift between docs and code. |
| `dotconf` | Answer, change, and remember dotfile and app configs. |
| `read-only` | Lock the session to read-only; change nothing. |
| `setup-sh25-skills` | Install, manage and wire up shalom2552's agent-skills assets. |
| `system-audit` | Read-only health, security and cleanliness audit of this machine. |
| `system-fix` | Diagnose, fix, and document a system or config fault on this machine. |
| `to-prompt` | Write a handoff prompt for a fresh agent. |
| `walk-with-me` | Learn languages and idioms by coding with a coach. |

## Scripts

`scripts/statusline.sh` - status line for Claude Code.

Installing it also sets `statusLine`, from `scripts/statusline.settings.json`.

## Settings

Small JSON files that `./install` merges into the scope's `settings.json`, so no hand edits.

- `settings/<name>.json` stands alone.
- `<stem>.settings.json` beside a skill or script is bound to it and applies each time that entry installs. `{{path}}` in it becomes the entry's installed path.

```sh
./install settings --scope global -y
```

To add a setting, add a file. To remove one, delete the file and re-run `./install`. Only settings still holding the installed values are removed; one you changed by hand stays. Needs `jq`.

| Setting | Description |
| --- | --- |
| `tmux-truecolor` | Truecolor inside tmux, so mod hex colors render right. |

## Mods

Claude Code plugins in `mods/`. `./install mods` adds this repo as the `shalom2552` marketplace and installs them; without the installer:

```
/plugin install <mod> --marketplace shalom2552/agent-skills
```

| Mod | Description |
| --- | --- |
| `spinner-words` | Swap the spinner verbs for dev ones. |
| `tape` | `/tape` pane of tool calls per turn. |
| `frame` | Rounded frame around your prompts. |
| `beat` | Turn time and usage as pills. |
