# Agent Skills

Skills and mods for Claude-Code.

## Install

```sh
curl -fsSL shalom2552.github.io/agent-skills/install | bash
```
Or clone and run `./install`. See `./install --help` for options.

To update, run `./install -u`. It pulls the checkout and refreshes what is already installed.

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
| `visualize` | Turn any subject into a visual HTML page. |
| `walk-with-me` | Learn languages and idioms by coding with a coach. |

## Mods

Claude Code plugins.

```sh
claude plugin install <mod> --marketplace shalom2552/agent-skills
```
`./install mods` does this for every mod.

| Mod | Description |
| --- | --- |
| `spinner-words` | Swap the spinner verbs for dev ones. |
| `tape` | `/tape`: a live pane of every tool call, grouped by turn, with status, target and duration. |
| `frame` | Rounded frame around your prompts. |
| `beat` | Turn time and usage as pills. |
| `statusline` | Status line as live pills under the prompt. |
| `badges` | Badge above the prompt for each active session skill. |
| `tdiff` | `/tdiff`: a live pane of every file Claude changed this session, with net diffs that survive resume. |

## Themes

Claude Code color themes. `./install themes` copies them to `~/.claude/themes` and sets `theme`. Global scope only, since Claude Code loads custom themes from there.

| Theme | Description |
| --- | --- |
| `catppuccin` | Catppuccin Mocha. |

## Settings

Small JSON files that `./install` merges into the scope's `settings.json`. An entry can carry its own as `<stem>.settings.json`, applied with it.

```sh
./install settings -y
```

| Setting | Description |
| --- | --- |
| `tmux-truecolor` | Truecolor inside tmux, so mod hex colors render right. |

