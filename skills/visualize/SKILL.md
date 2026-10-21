---
name: visualize
description: Turn any subject into a visual HTML page.
argument-hint: "what to show, e.g. 'this repo in 1 minute'"
disable-model-invocation: true
---

Explain `$ARGUMENTS` as one HTML page the user owns: a project, a concept, a system, a process, anything. The page is a single file that opens in any browser, offline included, with no build step and no service behind it.

The prompt decides the length, the depth, and whether to research or verify first. When it says nothing, size the page to the subject and work from what is at hand. A request for several depths ("1, 5 and 15 minutes") is several pages, each one standalone.

## The kit

This skill's folder holds the house kit:

| File | Role |
| --- | --- |
| `template.html` | The skeleton every page starts from: head, fonts, header with title and brief. |
| `showcase.html` | Every block live, with a note on what it is for and how to use it. Read its source to copy a block's markup. |
| `kit.css`, `kit.js` | The styles and behavior. A page never links them; `inline` pastes them in. |
| `inline` | `inline PAGE...` swaps each page's kit tags for the kit itself. |

kit.js adds the theme toggle, a contents list once a page has four or more `h2`s, and copy buttons, and loads Mermaid, KaTeX, highlight.js or Chart.js from a CDN only when a block on the page needs one.

## Invariants

These hold on every page, whatever the subject. Everything else here is a default.

1. **One file.** Nothing local is linked: the kit is inlined and images are inline SVG or `data:` URIs. The only network requests are CDN libraries and web fonts.
2. **Tokens only.** Every color is a kit custom property (`var(--accent)`, `var(--c3)`) or a `color-mix()` of them, in markup, page CSS and page scripts alike. `kit.color('name')` hands a token to canvas code and libraries. No hex, rgb, hsl or named colors outside the kit.
3. **No sideways page scroll** at 375px. Wide content scrolls inside its own box (`.scroll`).
4. **Readable offline.** A block that needs a library carries its content as text first: Mermaid source, TeX, plain code, a data table under a chart.
5. **Accessible.** Every control works by keyboard, every figure has a text alternative (its own text, an `aria-label`, or a caption), and text contrast passes in both themes. Token text on token backgrounds already passes; check anything custom (Build your own has a safe tint).

## 1. Shape

Read what the prompt points at: a repo, a doc, a research file, or only the topic. Then find the **shape** of each part, because a block fits a shape, not a topic:

| shape | try first |
| --- | --- |
| a sequence or process | flow, step-through |
| parts of a system | layer stack, tree |
| shares of a whole | proportion bar |
| change over time | timeline, chart |
| a trade-off or choice | comparison, 2x2 matrix |
| a decision with outcomes | branches |
| steps that repeat | cycle |
| states or a protocol | Mermaid state or sequence diagram |
| a layout in memory or on disk | cells and fields |
| how a knob changes an outcome | playground |
| key quantities | stat tiles |
| a thing with parts to point at | annotated figure, UI mock |
| screens a user moves through | UI mocks in a flow or step-through |
| none of these | a custom block |

These are starting points. When the table misses a shape, or a block would bend the content to fit, build a custom block (step 2).

Outline the page. The top screen says what this is and why it matters: the title, a brief, then the one visual or set of numbers a reader should leave with. Each `h2` states its section's point.

Done when every section has a heading and a planned block, and every planned visual shows something prose could not.

## 2. Write

Start from `template.html` and write the page to the current directory, or to the path the user named. Name it after the subject in kebab case (`raft-consensus.html`); pages of a set share a stem (`raft-1-min.html`, `raft-5-min.html`). A file already at that path is the user's: choose another name or ask before replacing it.

Copy block markup from `showcase.html` and change anything about it. Leave the template's `kit.css` link and `kit.js` script tag as they are. Page CSS goes in a `<style>` after the kit link, page scripts after the kit.js tag; only a `window.kitLabels` script goes before it, since kit.js reads that once.

A **custom block** is built from the kit's parts so it looks like it came with the kit: a box of `var(--card)`, `var(--border) solid var(--line)` and `var(--radius)`; the kit's type sizes (0.875rem for detail, weight 650 for names); tokens for every color and `color-mix()` for tints; inline SVG when geometry carries the meaning. The showcase has one under Build your own.

Interactivity is static first, since a static page can be scanned. Use a step-through, playground or self-check where interacting teaches what reading cannot: watching a mechanism advance, feeling how a parameter moves a result, testing recall.

Copy defaults, which the user's own style or instructions override: plain words; concrete names and numbers over adjectives; headings that state the point; one idea per block; no intro, recap or filler. The same thing keeps the same name everywhere on the page.

Mermaid, KaTeX, highlight.js and Chart.js arrive through their kit blocks. When none of them fits, another library is fine: load it from a CDN with its major version pinned, color it with `kit.color()`, redraw it on the `kit:theme` event, and keep its content as text first.

A page in another language sets `lang` on `<html>`, plus `dir="rtl"` for right-to-left scripts; its `window.kitLabels` translates the kit's labels (keys in the showcase's Page scripts).

The page may leave the machine, so secrets, tokens and credentials from source material stay out of it.

Done when the page holds every planned block.

## 3. Inline

Run `<this skill's folder>/inline <page>`. It replaces the kit tags with the kit itself, so the page stands alone. A page rewritten from scratch gets inlined again; edits to an inlined page do not need it.

Done when it prints `inlined <page>`.

## 4. Render check

Render the page with whatever browser tool exists, at desktop width (about 1280px) and phone width (375px), each in light and dark. With only a shell, Chrome or Chromium can do it: `--headless --window-size=375,4000 --screenshot=out.png file:///abs/page.html`, adding `--force-dark-mode` for dark. Render 375px once more offline (Chromium: add `--host-resolver-rules='MAP * ~NOTFOUND'`), since fallback fonts run wider and library blocks stay text. When the tool runs script, also compare `document.documentElement.scrollWidth` to the viewport width at 375px, since sideways overflow can sit outside the screenshot.

Look at every render and fix what is wrong: overlap, clipping, bad wraps, empty bands, a library block that failed to draw. Fix bad wraps in the content: shorter labels, a no-break space between number and unit, `<wbr>` at natural breaks, `.nowrap` on a CLI flag, rather than `word-break`.

With no way to render, say plainly that the page is unverified.

Done when every render looks right, or the page is reported unverified.

## 5. Checklist

Judge the rendered page, not the process, and fix until each point holds:

1. The top screen says what this is and why it matters.
2. Every visual shows something prose could not. No decorative diagrams.
3. Each block fits the shape of its content.
4. Nothing overlaps, clips or wraps badly at any checked size or theme.
5. No walls of text, no empty bands.
6. Same thing, same name, everywhere.
7. Custom blocks look like kit blocks.

## 6. Hand off

Open the page when the environment allows (`xdg-open`, `open`, `start`). Reply with its path, and with "unverified" when step 4 could not render it.
