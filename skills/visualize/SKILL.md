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
| `showcase.html` | Every block live, each in a `<section class="demo" id="...">` holding a note on when and how to use it, then its markup. |
| `kit.css`, `kit.js` | The styles and behavior, whose whole interface the showcase notes cover. A page never links them; `inline` pastes them in. |
| `inline` | `inline PAGE...` swaps each page's kit tags for the kit itself. |
| `check` | `check [-o DIR] PAGE...` checks each page as text and in a headless browser, one line per finding. |

kit.js adds the theme toggle, a contents list once a page has four or more `h2`s, and copy buttons, and loads Mermaid, KaTeX, highlight.js or Chart.js from a CDN only when a block on the page needs one.

## Invariants

These hold on every page, whatever the subject. Everything else here is a default.

1. **One file.** Nothing local is linked: the kit is inlined and images are inline SVG or `data:` URIs. The only network requests are CDN libraries and web fonts.
2. **Tokens only.** Every color is a kit custom property (`var(--accent)`, `var(--c3)`) or a `color-mix()` of them, in markup, page CSS and page scripts alike. `kit.color('name')` hands a token to canvas code and libraries. No hex, rgb, hsl or named colors outside the kit.
3. **No sideways page scroll** at 375px. Wide content scrolls inside its own box (`.scroll`).
4. **Readable offline.** A block that needs a library carries its content as text first: Mermaid source, TeX, plain code, a data table under a chart.
5. **Accessible.** Every control works by keyboard, every figure has a text alternative (its own text, an `aria-label`, or a caption), every state shows in words or signs as well as color, and text contrast passes in both themes. Token text on token backgrounds already passes; check anything custom (Build your own has a safe tint).

## 1. Shape

Read what the prompt points at: a repo, a doc, a research file, or only the topic. Then find the **shape** of each part, because a block fits a shape, not a topic. Blocks go by their showcase ids:

| shape | try first |
| --- | --- |
| a sequence or process | `flow`, `stepper`; `scrub` from about 5 steps |
| parts of a system | `layers`, `tree` |
| shares of a whole | `parts` |
| change over time | `timeline`, `chart` |
| a trade-off or choice | `compare`, `matrix` |
| a decision with outcomes | `paths` |
| steps that repeat | `cycle` |
| states or a protocol | `mermaid` state or sequence diagram |
| a layout in memory or on disk | `cells` |
| what a change does | `ba`, `diff` for code |
| cases or scenarios | `cases` |
| a result that surprises | `predict` |
| how a knob changes an outcome | `reactive`, `playground` |
| key quantities | `stats` |
| a thing with parts to point at | `annotated`, `mock`; `linked` when prose names the parts |
| screens a user moves through | `mock` in a `flow` or `stepper` |
| alternatives a reader picks one of | `tabs` up to about 4, since a phone scrolls the rest out of view; past that, one `more` per choice |
| a side detail | `popover`, `term` for one word, `more` for a long one |
| none of these | `custom` |

`grep -o 'demo" id="[^"]*' <this skill's folder>/showcase.html` lists every block id, including ones the table leaves out. These are starting points. When the table misses a shape, or a block would bend the content to fit, build a custom block (step 2). Pick each block for its content alone: one block used five times beats five blocks chosen for variety or coverage.

Outline the page. The top screen says what this is and why it matters: the title, a brief, then the one visual or set of numbers a reader should leave with. Each `h2` states its section's point.

Done when every section has a heading and a planned block, and every planned visual shows something prose could not.

## 2. Write

Start from `template.html` and write the page to the current directory, or to the path the user named. Name it after the subject in kebab case (`raft-consensus.html`); pages of a set share a stem (`raft-1-min.html`, `raft-5-min.html`). A file already at that path is the user's: choose another name or ask before replacing it.

Print each planned block by its id rather than reading the whole showcase: `sed -n '/demo" id="flow"/,/^<\/section>/p' <this skill's folder>/showcase.html` gives its note and markup. Keep what the note asks for and adapt the rest to your content. Print `api` too before writing a page script, and `custom` and `helpers` before a custom block. Leave the template's `kit.css` link and `kit.js` script tag as they are. Page CSS goes in a `<style>` after the kit link, page scripts after the kit.js tag; only a `window.kitLabels` script goes before it, since kit.js reads that once. A demo's own script waits for `DOMContentLoaded`, so it works where it lands when copied with its block.

A **custom block** is built from the kit's parts so it looks like it came with the kit: a box of `var(--card)`, `var(--border) solid var(--line)` and `var(--radius)`; the kit's type sizes (0.875rem for detail, weight 650 for names); tokens for every color and `color-mix()` for tints; inline SVG when geometry carries the meaning, colored by the `helpers` classes (`.box`, `.wire`, `.hi`, `.tint`, `.ink`, `.muted`) rather than `style` attributes.

`.key` marks the one item that matters most. A selected or current item takes the accent fill instead (`--box: var(--accent-soft); --box-line: var(--accent)`), the way `stepper` lights a step.

Interactivity is static first, since a static page can be scanned. Use it where interacting teaches what reading cannot: `predict` before a surprising result, since a guess makes the answer stick; `stepper` to watch a mechanism advance; `reactive` or `playground` to feel how a parameter moves a result; `self-check` to test recall. Nothing moves until the reader moves it.

A `reactive` sentence or `playground` has one to three inputs, each starting at the real value, which the markup also holds as text so print and no-script readers get a true page. One `kit.model()` computes everything that moves: the figure (through `--name`), the numbers and the prose. A slider's label reads `<label>Name <input type="range" value="5"><output>5</output></label>`, output last, so the label names the slider.

A page script that hides and shows its own content (a picker, a panel) runs `document.dispatchEvent(new Event('kit:shown'))` after each show, so Mermaid inside gets drawn.

Copy defaults, which the user's own style or instructions override: plain words; concrete names and numbers over adjectives; headings and captions that state the point; one idea per block; no intro, recap or filler. The same thing keeps the same name everywhere on the page.

Mermaid, KaTeX, highlight.js and Chart.js arrive through their kit blocks. When none of them fits, another library is fine: load it from a CDN with its major version pinned, color it with `kit.color()`, redraw it on the `kit:theme` event, and keep its content as text first.

A page in another language sets `lang` on `<html>`, plus `dir="rtl"` for right-to-left scripts; its `window.kitLabels` translates the kit's labels (keys in `api`).

The page may leave the machine, so secrets, tokens and credentials from source material stay out of it.

Done when the page holds every planned block.

## 3. Inline

Run `<this skill's folder>/inline <page>`. It replaces the kit tags with the kit itself, so the page stands alone. A page rewritten from scratch gets inlined again; edits to an inlined page do not need it.

Done when it prints `inlined <page>`.

## 4. Render check

Run `<this skill's folder>/check <page>`. It reads the page for colors outside the tokens, local files, library blocks with no text, and figures with no text alternative. Then it renders the page in headless Chrome, Chromium, Edge or Brave at 375px and 1280px in light and dark, and at 375px offline, and reports sideways overflow with the element that causes it, script errors, library blocks that failed to draw, controls with no accessible name, text cut off by its box, and items in a row or grid that overlap.

Each finding is one line with the page line or the spot on screen. A finding further down the page names a screenshot of that spot, and the last line per page names the top screen of each render. Fix every finding and run it again.

check cannot see bad wraps, empty bands, or overlap and clipping outside those cases, so view the top screens and the shots it names. Fix bad wraps in the content: shorter labels, a no-break space between number and unit, `<wbr>` at natural breaks, `.nowrap` on a CLI flag, rather than `word-break`. Headless Chromium reports `hover: none`, so a code block with no caption shows a blank strip above line 1 for the copy button; that is expected.

Exit 0 is clean, 1 is findings, 3 is unverified. With no browser found it runs the text checks and prints `render: unverified`; `VISUALIZE_BROWSER=/path/to/browser` points it at one. When the render stays unverified, render with whatever browser tool exists, or say plainly that the page is unverified.

Done when check exits 0, or the page is reported unverified.

## 5. Checklist

Judge the rendered page, not the process, and fix until each point holds:

1. The top screen says what this is and why it matters.
2. Every visual shows something prose could not. No decorative diagrams.
3. Each block fits the shape of its content.
4. Every step and every control changes something the reader can see.
5. Nothing overlaps, clips or wraps badly at any checked size or theme.
6. No walls of text, no empty bands.
7. Same thing, same name, everywhere.
8. Custom blocks look like kit blocks.

## 6. Hand off

Open the page when the environment allows (`xdg-open`, `open`, `start`). Reply with its path, and with "unverified" when step 4 could not render it.
