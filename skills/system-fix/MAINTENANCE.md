# system-fix maintenance

## Migrate

When `INDEX.md` is missing, offer this before anything else. Build `INDEX.md` from the existing docs, add a `Status:` line to each, move backups into `backups/<topic>/`, and update every doc that names a moved backup's path. Commit as `chore(docs): migrate to index layout`, then continue with the request.

## Lint

Check the whole repo:

- `INDEX.md` lines whose doc is gone, docs missing from it, and statuses that disagree with the doc
- docs that contradict each other, or an older doc a later fix replaced without a supersede mark
- **applied** docs whose change is no longer in place on the system
- **open** docs older than a month: list them for the user to resume or drop
- backups of **applied** docs older than three months: list them and delete only on the user's yes

Fix each finding the docs alone can settle, report the rest, and commit as `chore(lint): <summary>`.
