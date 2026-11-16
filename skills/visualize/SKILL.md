---
name: visualize
description: Turn any subject into a visual HTML page.
argument-hint: "what to show, e.g. 'this repo in 1 minute'"
disable-model-invocation: true
---

Explain `$ARGUMENTS` as one HTML page the user owns: a project, a system, a codebase, a dataset, a concept. You write the page as **source**: Markdown plus short text blocks inside one `<script type="text/viz">`. The kit in this skill's folder renders the source in the browser, so the page costs you content and data, and the kit supplies the markup, the style and the behavior.

The prompt decides the length, the depth, and whether to research or verify first. When it says nothing, size the page to the subject and work from what is at hand. A request for several depths ("1, 5 and 15 minutes") is several pages, each one standalone.

## Invariants

1. **One file.** The page is the only output. `check` pastes the kit into it. Images are `data:` URIs or `https:` URLs. Network requests are limited to web fonts and the CDN libraries behind `chart`, `math` and `mermaid`.
2. **Source first.** Everything a block can say goes in a block. Raw HTML is for the rare thing no block covers, and it uses kit tokens for every color (`var(--accent)`, `var(--c3)`, `color-mix()` of tokens).
3. **Fits a phone.** The page has no sideways scroll at 375px. Blocks handle this themselves; wide custom HTML goes inside `<div class="scroll">`.
4. **Accessible.** Blocks are keyboard-operable and carry text alternatives. Every image needs alt text, and custom HTML needs the same care.
5. **Safe to share.** Secrets, tokens and credentials from the source material stay out of the page.

## 1. Plan

Read what the prompt points at: a repo, a doc, a diff, a data file, or only the topic. Then find the **shape** of each part, because a block fits a shape, not a topic.

| Shape | Block |
| --- | --- |
| Headline numbers | `kpi` |
| Sizes to compare | `bars`; `chart bar` for several series; `meter` against a limit |
| Change over time | `chart line`; `timeline` for events; `gantt` for spans |
| Shares of a whole | `parts`; `treemap` when nested |
| Quantities that flow or drop off | `sankey`; `funnel` |
| A grid of values | `heatmap` |
| A pipeline or process | `flow`; `steps` when each step needs prose; `stepper` to walk through |
| Parts of a system and their dependencies | `graph`; `layers` for tiers |
| Who talks to whom, in order | `sequence` |
| A data model | `erd` |
| A hierarchy | `tree`; `filetree` for files |
| What a change did | `filetree` with stats, `diff`, `commits` |
| An API | `api` |
| Code and its output | a language fence with `hl` or `notes`; `terminal`; `log`; `json` |
| Options and trade-offs | `table` with a `*` column; `proscons`; `quadrant` |
| Risks | `risk` |
| Work and its status | `kanban`; `checklist`; `gantt` |
| A binary or memory layout | `cells` |
| A formula | `math`; `calc` when the reader should move the inputs |
| Alternatives the reader picks from | `tabs` |
| A side detail | `details`; `:term[word\|meaning]` for one word |
| States, classes, anything else drawn | `mermaid` |
| None of these | `raw` |

Outline the page. The top screen says what this is and why it matters: the title, a one-sentence brief, then the one visual or set of numbers a reader should leave with. Each `##` heading states its section's point. Pick each block for its content alone: one block used five times beats five blocks chosen for variety.

Done when every section has a heading and a planned block, and every planned visual shows something prose could not.

## 2. Write

Write the page in one pass to the current directory, or to the path the user named. Name it after the subject in kebab case (`raft-consensus.html`); pages of a set share a stem (`raft-1-min.html`, `raft-5-min.html`). A file already at that path is the user's: choose another name or ask before replacing it.

The whole page is this skeleton with your source in the middle. Keep the `kit.css` and `kit.js` lines exactly as they are; `check` swaps them for the kit, below the source, so the source stays at the top of the file.

```html
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Title</title>
</head>
<body>
<script type="text/viz">
# Title
> What this is and why it matters, in a sentence or two.

</script>
<link rel="stylesheet" href="kit.css">
<script src="kit.js"></script>
</body>
</html>
```

Read `BLOCKS.md` in this folder once, whole, before writing: it holds the shared rules and one example per block, and it is the complete interface, so write from it without opening the kit files.

The kit adds the theme toggle, a contents list from four `##` headings up, a slides mode that turns each `##` section into a slide, and copy buttons. `<html lang="he" dir="rtl">` sets language and direction, and a `<script>window.kitLabels = {...}</script>` before `kit.js` translates the kit's own labels.

Copy defaults, which the user's own style or instructions override: plain words; concrete names and numbers over adjectives; headings and captions that state the point; one idea per block; the same thing keeps the same name everywhere on the page.

Done when the file holds every planned section.

## 3. Check

Run `<this skill's folder>/check <page>`. It inlines the kit, reads the source for unknown blocks, unclosed fences and local files, then renders the page in headless Chrome, Chromium, Edge or Brave at 375px and 1280px in light and dark, and at 375px offline. It reports blocks that failed to parse, script errors, sideways overflow with the element that causes it, controls with no accessible name, clipped text, overlapping items, and charts, math or Mermaid that did not draw.

Each finding is one line with the page line or the spot on screen. The last lines name a screenshot of each render's top screen and two full-page screenshots (1280px light, 375px dark); `-o DIR` chooses where they go. Fix every finding in the source and run it again; an inlined page stays inlined.

`check` cannot judge layout taste, so read both full-page shots and any shot a finding names. Fix bad wraps in the content: a shorter label, a no-break space between number and unit.

Exit 0 is clean, 1 is findings, 3 is unverified. With no browser it runs the source checks only and prints `render: unverified`; `VISUALIZE_BROWSER=/path/to/browser` points it at one.

Done when `check` exits 0, or the page is reported unverified.

## 4. Hand off

Judge the rendered page against these, and fix what fails:

1. The top screen says what this is and why it matters.
2. Every visual shows something prose could not.
3. Each block fits the shape of its content.
4. Nothing overlaps, clips or wraps badly in any screenshot.
5. Same thing, same name, everywhere.

Open the page when the environment allows (`xdg-open`, `open`, `start`). Reply with its path, and with "unverified" when step 3 could not render it.

## Changing the kit

Skip this unless the task is to edit the kit itself. `selftest` rebuilds `showcase.html` from `BLOCKS.md`, confirms every block in `kit.js` has an example there and the skeleton here matches `template.html`, then runs `check` on the showcase. `inline <page>` on an already inlined page swaps in the current kit.
