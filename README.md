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

## Mods

Claude Code plugins.

```
/plugin install <mod> --marketplace shalom2552/agent-skills
```

| Mod | Description |
| --- | --- |
| `spinner-words` | Swap the spinner verbs for dev ones. |
| `tape` | `/tape` pane of tool calls per turn. |
| `frame` | Rounded frame around your prompts. |
| `beat` | Turn time and usage as pills. |
| `statusline` | Bottom status line for claude. |

## Settings

Small JSON files that `./install` merges into the scope's `settings.json`.

```sh
./install settings --scope global -y
```

| Setting | Description |
| --- | --- |
| `tmux-truecolor` | Truecolor inside tmux, so mod hex colors render right. |

