# dotconf maintenance

## Onboard

If the notes repo does not exist, create it, `git init` it, and add `RULES.md` and `PREFERENCES.md` empty, and `INDEX.md` with an empty map, an empty **Open** list and `Sessions since lint: 0`.

Offer onboarding: scan the configs and their git repos to fill `INDEX.md`, and ask the user about their rules and preferences. If the user declines, add "onboarding pending" to **Open** and go on with the request. Remove it once onboarding is done.

## Lint

Check:

- notes that contradict each other or the live config
- `INDEX.md` entries whose path or topic is gone, and topics missing from it
- files over their cap
- notes invalidated by a later fix or change
- **Open** items that are already done

Fix each finding the notes alone can settle. A finding that touches a **user** line goes to the user. Reset `Sessions since lint` to 0, and commit as `chore(lint): <summary>`.
