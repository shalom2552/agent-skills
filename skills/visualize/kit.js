/* visualize kit.js */
(() => {
  'use strict';
  const d = document, root = d.documentElement;
  const $$ = (sel, node = d) => [...node.querySelectorAll(sel)];
  const run = fn => { try { return fn(); } catch (e) { console.error('kit:', e); } };
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const NS = 'http://www.w3.org/2000/svg';

  const L = Object.assign({
    contents: 'Contents', back: 'Back', next: 'Next', step: 'Step {n} of {total}', copy: 'Copy', copied: 'Copied', replay: 'Replay',
    right: 'Correct.', wrong: 'Not quite.', data: 'Data', toDark: 'Switch to dark theme', toLight: 'Switch to light theme',
    present: 'Present as slides', exitPresent: 'Leave slides', slides: 'Slides', prevSlide: 'Previous slide', nextSlide: 'Next slide', trend: 'Trend from {a} to {b}', up: 'up', down: 'down', repeat: 'repeats',
    filter: 'Filter rows', rows: '{n} of {total} rows', all: 'All', done: 'done', todo: 'to do', doing: 'in progress', blocked: 'blocked',
    progress: '{n} of {total} done', pros: 'Pros', cons: 'Cons', params: 'Parameters', responses: 'Responses', example: 'Example',
    files: '{n} files changed', enlarge: 'Enlarge', close: 'Close', scroll: 'Scrollable content', yes: 'yes', no: 'no', partial: 'partial',
    note: 'Note', tip: 'Tip', warn: 'Warning', bad: 'Danger', ok: 'Done', info: 'Info', key: 'Key point',
    likelihood: 'Likelihood', impact: 'Impact', low: 'low', medium: 'medium', high: 'high', critical: 'critical', other: 'Other', from: 'From', to: 'To', value: 'Value',
    field: 'Field', offset: 'Offset', size: 'Size', ofPrev: '{p} of previous',
  }, window.kitLabels);
  const say = (key, vals) => L[key].replace(/\{(\w+)\}/g, (_, k) => vals[k]);
  const fmt = n => Number(n).toLocaleString(root.lang || undefined, { maximumFractionDigits: 2 });

  /* ---------- small helpers ---------- */
  const slots = [];
  const slot = nodes => `<i data-slot="${slots.push([].concat(nodes)) - 1}"></i>`;
  const fill = node => {
    for (const s of [...(node.matches?.('[data-slot]') ? [node] : []), ...$$('[data-slot]', node)]) s.replaceWith(...slots[s.dataset.slot]);
    return node;
  };
  const el = html => { const t = d.createElement('template'); t.innerHTML = String(html).trim(); return fill(t.content.firstElementChild); };
  const fail = msg => { console.error('kit: ' + msg); return `<p class="viz-error" role="alert">${esc(msg)}</p>`; };
  const tonal = t => t ? ` data-tone="${t}"` : '';
  const TONE = /\s*\{(ok|warn|bad|info|accent|muted|c[1-8])\}\s*$/;
  const tone = s => { const m = TONE.exec(s); return m ? [s.slice(0, m.index), m[1]] : [s, '']; };
  const pipes = s => { s = s.trim(); if (s.length > 1 && s[0] === '|') s = s.slice(1).replace(/\|\s*$/, ''); return s.split(/(?<!\\)\|/).map(x => x.trim().replace(/\\\|/g, '|')); };
  const row = raw => { const [t, tn] = tone(raw); return { raw, f: pipes(t), tone: tn, indent: raw.match(/^\s*/)[0].replace(/\t/g, '  ').length }; };
  const rows = body => body.split('\n').filter(l => l.trim()).map(row);
  const items = body => /\n[ \t]*\n/.test(body.trim())
    ? body.trim().split(/\n[ \t]*\n/).map(chunk => { const [first, ...rest] = chunk.split('\n'); return Object.assign(row(first), { more: rest.join('\n') }); })
    : rows(body);
  const sections = body => {
    const out = []; let cur = { title: '', tone: '', lines: [] };
    for (const ln of body.split('\n')) {
      const m = /^==+\s*(.*?)\s*=*$/.exec(ln);
      if (m) { if (cur.title || cur.lines.some(x => x.trim())) out.push(cur); const [t, tn] = tone(m[1]); cur = { title: t, tone: tn, lines: [] }; }
      else cur.lines.push(ln);
    }
    if (cur.title || cur.lines.some(x => x.trim())) out.push(cur);
    return out;
  };
  const num = s => {
    const m = /([−-]?[\d,]*\.?\d+(?:e[+-]?\d+)?)\s*([kKmMbB](?![a-zA-Z]))?/.exec(String(s).replace(/−/g, '-'));
    if (!m) return NaN;
    return parseFloat(m[1].replace(/,/g, '')) * ({ k: 1e3, m: 1e6, b: 1e9 }[(m[2] || '').toLowerCase()] || 1);
  };
  const isSeries = s => /^-?[\d.]+(?:[\s,]+-?[\d.]+){2,}$/.test(s.trim());
  const opts = str => {
    const o = { _: [] };
    for (const m of String(str || '').matchAll(/([\w-]+)=(?:"([^"]*)"|(\S+))|"([^"]*)"|(\S+)/g)) {
      if (m[1]) o[m[1]] = m[2] ?? m[3]; else { const v = m[4] ?? m[5]; o._.push(v); o[v] = true; }
    }
    return o;
  };
  const onSize = (node, fn) => {
    let w = -1;
    new ResizeObserver(() => { const n = Math.round(node.clientWidth); if (n && n !== w) { w = n; run(() => fn(n)); } }).observe(node);
  };
  const svgEl = (tag, attrs = {}, text) => {
    const n = d.createElementNS(NS, tag);
    for (const k in attrs) n.setAttribute(k, attrs[k]);
    if (text != null) n.textContent = text;
    return n;
  };
  const dataTable = (head, body, open) => `<details class="data"${open ? ' open' : ''}><summary>${esc(L.data)}</summary><div class="scroll"><table><thead><tr>${head.map(h => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${body.map(r => `<tr>${r.map((c, i) => `<td${i && !isNaN(num(c)) && /^[\d\s.,%$€£kKmMbB+−-]+$/.test(c) ? ' class="num"' : ''}>${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div></details>`;
  const copyBtn = (getText, label = L.copy) => {
    const btn = Object.assign(d.createElement('button'), { type: 'button', className: 'copy', textContent: label });
    btn.addEventListener('click', async () => {
      const text = getText();
      try { await navigator.clipboard.writeText(text); } catch {
        const ta = Object.assign(d.createElement('textarea'), { value: text });
        ta.style.cssText = 'position:fixed;opacity:0';
        d.body.append(ta); ta.select(); d.execCommand('copy'); ta.remove();
      }
      btn.textContent = L.copied;
      setTimeout(() => { btn.textContent = label; }, 1500);
    });
    return btn;
  };
  const ICON = {
    dark: '<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>',
    light: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
    present: '<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M12 16v4M8 20h8"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.5"/>',
    ok: '<circle cx="12" cy="12" r="9"/><path d="m8 12 3 3 5-6"/>',
    warn: '<path d="M12 3 2 20h20L12 3z"/><path d="M12 10v4M12 17v.5"/>',
    bad: '<path d="M8 3h8l5 5v8l-5 5H8l-5-5V8l5-5z"/><path d="m9 9 6 6M15 9l-6 6"/>',
    accent: '<path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-4 10.5c.7.7 1 1.5 1 2.5h6c0-1 .3-1.8 1-2.5A6 6 0 0 0 12 3z"/>',
    dir: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z"/>',
    file: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5z"/><path d="M14 3v5h5"/>',
    left: '<path d="m15 6-6 6 6 6"/>',
    right: '<path d="m9 6 6 6-6 6"/>',
    down: '<path d="m6 9 6 6 6-6"/>',
    close: '<path d="M6 6l12 12M18 6 6 18"/>',
    list: '<path d="M4 6h16M4 12h16M4 18h10"/>',
  };
  const icon = (name, cls = '') => `<svg${cls ? ` class="${cls}"` : ''} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON[name]}</svg>`;

  const spark = (s, tn) => {
    const v = String(s).split(/[\s,]+/).map(Number).filter(n => !isNaN(n));
    if (v.length < 2) return '';
    const lo = Math.min(...v), hi = Math.max(...v), W = 96, H = 28, p = 5;
    const pts = v.map((n, i) => [p + i * (W - 2 * p) / (v.length - 1), hi === lo ? H / 2 : H - p - (n - lo) * (H - 2 * p) / (hi - lo)]);
    const line = pts.map((q, i) => (i ? 'L' : 'M') + q[0].toFixed(1) + ' ' + q[1].toFixed(1)).join('');
    const [ex, ey] = pts[pts.length - 1];
    return `<svg class="spark" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(say('trend', { a: v[0], b: v[v.length - 1] }))}"${tonal(tn)}><path class="wash" d="${line}L${ex} ${H}L${pts[0][0]} ${H}Z"/><path d="${line}"/><circle cx="${ex.toFixed(1)}" cy="${ey.toFixed(1)}" r="3.5"/></svg>`;
  };

  /* ---------- inline markdown ---------- */
  const HTML_OK = /^<\/?(a|b|i|em|strong|u|s|br|wbr|kbd|sub|sup|small|mark|span|code|abbr|del|ins|img|q|cite|time|var|samp)(\s[^<>]*)?\/?>$/i;
  const inline = (src, keep) => {
    const stash = html => `\u0001${keep.push(html) - 1}\u0002`;
    let s = String(src);
    s = s.replace(/\\([\\`*_{}[\]()#+\-.!|:<>~=])/g, (_, c) => stash(esc(c)));
    s = s.replace(/(`+)(.+?)\1/g, (_, t, c) => stash(`<code>${esc(c.trim())}</code>`));
    s = s.replace(/:(ok|warn|bad|info|accent|muted|tag|kbd|term|math|spark|hl)\[((?:[^[\]]|\[[^\]]*\])*)\]/g, (_, n, body) => {
      if (n === 'kbd') return stash(body.split('+').map(k => `<kbd>${esc(k.trim())}</kbd>`).join('+'));
      if (n === 'math') return stash(`<span class="math">${esc(body)}</span>`);
      if (n === 'spark') return stash(spark(body));
      if (n === 'hl') return stash(`<mark>${inline(body, keep)}</mark>`);
      if (n === 'term') { const i = body.indexOf('|'); return stash(`<span class="term" tabindex="0" data-tip="${esc(body.slice(i + 1).trim())}">${inline(i < 0 ? body : body.slice(0, i), keep)}</span>`); }
      return stash(`<span class="badge"${n === 'tag' ? '' : tonal(n)}>${inline(body, keep)}</span>`);
    });
    s = s.replace(/<[^<>]*>|[&<>"]/g, m => m.length > 1 && HTML_OK.test(m) ? stash(m) : esc(m));
    s = s.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (_, a, u) => stash(`<img alt="${a}" src="${u}">`));
    s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, t, u) => `<a href="${u}">${t}</a>`);
    s = s.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/(^|[^*\w])\*([^*\s](?:[^*]*[^*\s])?)\*(?![*\w])/g, '$1<em>$2</em>').replace(/~~(.+?)~~/g, '<del>$1</del>');
    return s;
  };
  const md = src => {
    const keep = [];
    let s = inline(src, keep);
    while (/\u0001\d+\u0002/.test(s)) s = s.replace(/\u0001(\d+)\u0002/g, (_, i) => keep[i]);
    return s;
  };

  /* ---------- block parser ---------- */
  const B = {};
  const ALIAS = { stats: 'kpi', compare: 'table', glossary: 'kv', files: 'filetree', jsontree: 'json', term: 'terminal', shell: 'terminal', seq: 'sequence', progress: 'meter', roadmap: 'kanban', tex: 'math', latex: 'math', graphviz: 'graph', deps: 'graph', matrix: 'quadrant' };
  const LANGS = new Set('viz html text txt plain js javascript mjs cjs ts typescript jsx tsx py python rb ruby go rust rs java kotlin kt swift c cpp h hpp cs csharp php scala dart lua r sql sh bash zsh fish powershell ps1 bat yaml yml toml ini conf env properties xml svg css scss sass less md markdown dockerfile docker makefile make cmake nginx graphql gql proto protobuf hcl tf terraform nix elixir ex erlang haskell hs clojure clj ocaml fsharp zig vue svelte astro http jsonc json5 ndjson csv tsv regex asm wasm solidity sol perl pl julia jl groovy gradle objc vim diffstat prisma jinja handlebars ejs pseudo pseudocode console output'.split(' '));
  const CALLOUT = { note: 'info', info: 'info', tip: 'accent', important: 'accent', key: 'accent', warning: 'warn', warn: 'warn', caution: 'warn', danger: 'bad', bad: 'bad', error: 'bad', success: 'ok', ok: 'ok', done: 'ok' };
  const BLOCK_TAG = /^<(\/?(div|section|article|aside|figure|figcaption|table|thead|tbody|tr|details|summary|svg|p|ul|ol|dl|pre|form|iframe|video|audio|canvas|style|header|footer|nav|h[1-6]|blockquote|button|input|label|select|textarea|picture|template|main)\b|!--)/i;
  const fenceEnd = m => new RegExp('^\\s*' + m[1][0] + '{' + m[1].length + ',}\\s*$');
  const FENCE = /^(`{3,}|~{3,})\s*([^\s`]*)\s*(.*)$/;

  const block = (name, optStr, body, line) => {
    const o = opts(optStr);
    name = name.toLowerCase();
    const key = ALIAS[name] || name, fn = Object.hasOwn(B, key) ? B[key] : null;
    let node;
    try {
      if (!fn && name && !LANGS.has(name)) console.error(`kit: line ${line}: unknown block or language "${name}"`);
      if (fn && !body.trim()) node = fail(`line ${line}: ${name} block is empty`);
      else node = fn ? fn(body, o, name) : B.code(body, o, name);
    } catch (e) { node = fail(`line ${line}: ${name}: ${e.message}`); }
    if (typeof node === 'string') node = el(node);
    if (fn && o.title && !fn.ownTitle) {
      const fig = el('<figure class="fig"></figure>');
      fig.append(node, el(`<figcaption>${md(o.title)}</figcaption>`));
      node = fig;
    }
    return node;
  };

  const topLevel = (lines, fn) => {
    let fence = null, depth = 0;
    lines.forEach((ln, i) => {
      if (fence) { if (fence.test(ln)) fence = null; return; }
      const f = FENCE.exec(ln);
      if (f) { fence = fenceEnd(f); return; }
      if (/^:::\s*\w/.test(ln)) depth++;
      else if (/^:::\s*$/.test(ln)) depth--;
      else if (!depth) fn(ln, i);
    });
  };
  const parts = (lines, line0) => {
    const cuts = [];
    topLevel(lines, (ln, i) => { if (/^==+(\s|$)/.test(ln)) cuts.push(i); });
    const out = [];
    const take = (from, to, head) => {
      const [t, tn] = tone(head.replace(/^==+\s*/, '').replace(/\s*=+\s*$/, ''));
      const text = lines.slice(from, to).join('\n');
      if (t || text.trim()) out.push({ title: t, tone: tn, nodes: render(text, line0 + from) });
    };
    take(0, cuts.length ? cuts[0] : lines.length, '');
    cuts.forEach((c, k) => take(c + 1, cuts[k + 1] ?? lines.length, lines[c]));
    return out;
  };

  const listHtml = ls => {
    let i = 0;
    const build = indent => {
      const ordered = ls[i].ordered;
      let h = '';
      while (i < ls.length && ls[i].indent >= indent) {
        if (ls[i].indent > indent) { h = h.replace(/<\/li>$/, '') + build(ls[i].indent) + '</li>'; continue; }
        const it = ls[i++];
        const t = /^\[([ xX~!])\]\s+(.*)$/.exec(it.text);
        const s = t && { ' ': 'todo', x: 'done', X: 'done', '~': 'doing', '!': 'blocked' }[t[1]];
        h += t ? `<li class="task"><span class="box" data-s="${s}" role="img" aria-label="${esc(L[s])}">${{ done: '✓', doing: '–', blocked: '!', todo: '' }[s]}</span><span>${md(t[2])}</span></li>` : `<li>${md(it.text)}</li>`;
      }
      return (ordered ? '<ol>' : '<ul>') + h + (ordered ? '</ol>' : '</ul>');
    };
    return build(ls[0].indent);
  };

  const render = (text, line0 = 0) => {
    const lines = String(text).replace(/\r/g, '').split('\n');
    const out = [];
    const push = x => { if (x == null || x === '') return; if (typeof x === 'string') { const t = d.createElement('template'); t.innerHTML = x.trim(); out.push(...[...t.content.children].map(fill)); } else out.push(x); };
    const isStart = ln => !ln.trim() || /^(#{1,4}\s|>|`{3,}|~{3,}|:::|\||---+\s*$|!\[)/.test(ln) || /^\s*([-*+]|\d+[.)])\s+/.test(ln) || BLOCK_TAG.test(ln);
    let i = 0;
    while (i < lines.length) {
      const ln = lines[i], at = line0 + i + 1;
      let m;
      if (!ln.trim()) { i++; continue; }
      if ((m = FENCE.exec(ln))) {
        const close = fenceEnd(m);
        let j = i + 1;
        while (j < lines.length && !close.test(lines[j])) j++;
        if (j >= lines.length) push(fail(`line ${at}: ${m[1]}${m[2]} block is never closed`));
        push(block(m[2], m[3], lines.slice(i + 1, j).join('\n'), at));
        i = j + 1; continue;
      }
      if ((m = /^:::\s*(\w[\w-]*)\s*(.*)$/.exec(ln))) {
        let depth = 1, j = i + 1, fence = null;
        for (; j < lines.length; j++) {
          const t = lines[j];
          if (fence) { if (fence.test(t)) fence = null; continue; }
          const f = FENCE.exec(t);
          if (f) { fence = fenceEnd(f); continue; }
          if (/^:::\s*\w/.test(t)) depth++;
          else if (/^:::\s*$/.test(t) && !--depth) break;
        }
        if (j >= lines.length) push(fail(`line ${at}: ::: ${m[1]} is never closed`));
        const name = m[1].toLowerCase();
        if (!Object.hasOwn(C, name)) push(fail(`line ${at}: unknown container "${name}"`));
        else push(run(() => C[name](parts(lines.slice(i + 1, j), at), opts(m[2]), m[2])));
        i = j + 1; continue;
      }
      if ((m = /^(#{1,4})\s+(.*?)\s*#*$/.exec(ln))) {
        const id = /\s*\{#([\w-]+)\}$/.exec(m[2]);
        push(`<h${m[1].length}${id ? ` id="${id[1]}"` : ''}>${md(id ? m[2].slice(0, id.index) : m[2])}</h${m[1].length}>`);
        i++; continue;
      }
      if (/^---+\s*$/.test(ln)) { push('<hr>'); i++; continue; }
      if (/^>/.test(ln)) {
        const q = [];
        while (i < lines.length && /^>/.test(lines[i])) q.push(lines[i++].replace(/^>\s?/, ''));
        if ((m = /^\[!(\w+)\]\s*(.*)$/.exec(q[0]))) {
          const kind = m[1].toLowerCase(), tn = CALLOUT[kind] || 'info';
          const label = { info: L.note, accent: kind === 'tip' ? L.tip : L.key, warn: L.warn, bad: L.bad, ok: L.ok }[tn];
          push(`<aside class="callout" data-tone="${tn}"><div class="callout-title">${icon(tn)}<span>${m[2] ? md(m[2]) : esc(label)}</span></div>${slot(render(q.slice(1).join('\n'), at))}</aside>`);
        } else {
          const by = /^(?:—|--)\s*(.+)$/.exec(q[q.length - 1]);
          if (by) q.pop();
          push(`<figure class="quote"><blockquote>${slot(render(q.join('\n'), at - 1))}</blockquote>${by ? `<figcaption>${md(by[1])}</figcaption>` : ''}</figure>`);
        }
        continue;
      }
      if (/^\s*([-*+]|\d+[.)])\s+/.test(ln)) {
        const ls = [];
        for (; i < lines.length && lines[i].trim(); i++) {
          const t = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/.exec(lines[i]);
          if (t) ls.push({ indent: t[1].replace(/\t/g, '  ').length, ordered: /\d/.test(t[2]), text: t[3] });
          else if (/^\s+\S/.test(lines[i])) ls[ls.length - 1].text += ' ' + lines[i].trim();
          else break;
        }
        push(listHtml(ls)); continue;
      }
      if (/^\|/.test(ln)) {
        const t = [];
        while (i < lines.length && /^\|/.test(lines[i])) t.push(lines[i++]);
        push(block('table', '', t.join('\n'), at)); continue;
      }
      if ((m = /^!\[([^\]]*)\]\((\S+?)(?:\s+"([^"]*)")?\)\s*$/.exec(ln))) {
        push(`<figure class="fig-img"><img alt="${esc(m[1])}" src="${esc(m[2])}">${m[3] ? `<figcaption>${md(m[3])}</figcaption>` : ''}</figure>`);
        i++; continue;
      }
      if (BLOCK_TAG.test(ln)) {
        const h = [];
        while (i < lines.length && lines[i].trim()) h.push(lines[i++]);
        push(h.join('\n')); continue;
      }
      const p = [ln];
      for (i++; i < lines.length && !isStart(lines[i]); i++) p.push(lines[i]);
      push(`<p>${md(p.join('\n'))}</p>`);
    }
    return out;
  };

  /* ---------- containers ---------- */
  const C = {};
  let uid = 0;
  C.tabs = ps => {
    const t = ++uid, box = el('<div class="tabs"><div role="tablist"></div></div>'), list = box.firstElementChild;
    const panels = ps.map((p, i) => {
      const s = el(`<section role="tabpanel" id="tabp-${t}-${i}" aria-labelledby="tab-${t}-${i}" tabindex="0"></section>`);
      s.append(...p.nodes); box.append(s); return s;
    });
    const btns = ps.map((p, i) => {
      const b = el(`<button type="button" role="tab" id="tab-${t}-${i}" aria-controls="tabp-${t}-${i}">${md(p.title || String(i + 1))}</button>`);
      b.addEventListener('click', () => pick(i));
      list.append(b); return b;
    });
    const pick = (i, focus) => {
      btns.forEach((b, j) => { b.setAttribute('aria-selected', String(i === j)); b.tabIndex = i === j ? 0 : -1; panels[j].hidden = i !== j; });
      if (focus) btns[i].focus();
      d.dispatchEvent(new Event('kit:shown'));
    };
    list.addEventListener('keydown', e => {
      const i = btns.indexOf(d.activeElement), rtl = getComputedStyle(box).direction === 'rtl';
      const step = { ArrowRight: rtl ? -1 : 1, ArrowLeft: rtl ? 1 : -1 }[e.key];
      const to = e.key === 'Home' ? 0 : e.key === 'End' ? btns.length - 1 : step ? (i + step + btns.length) % btns.length : null;
      if (to === null) return;
      e.preventDefault(); pick(to, true);
    });
    pick(0);
    return box;
  };
  C.cols = (ps, o) => {
    const box = el(`<div class="cols" style="--cols:${+o._[0] || ps.length || 1}"></div>`);
    ps.forEach(p => { const c = el(`<div class="col"${tonal(p.tone)}>${p.title ? `<h4>${md(p.title)}</h4>` : ''}</div>`); c.append(...p.nodes); box.append(c); });
    return box;
  };
  C.details = (ps, o, raw) => {
    const title = raw.replace(/(^|\s)open(\s|$)/, ' ').trim() || 'Details';
    const box = el(`<details class="more"${o.open ? ' open' : ''}><summary>${md(title)}</summary></details>`);
    ps.forEach(p => box.append(...p.nodes));
    return box;
  };
  C.window = (ps, o, raw) => {
    const title = o.title || raw.replace(/\b(url|title)=("[^"]*"|\S+)/g, '').trim();
    const box = el(`<figure class="window"><div class="window-bar">${o.url ? `<span class="url">${esc(o.url)}</span>` : `<span>${md(title)}</span>`}</div><div class="window-body"></div></figure>`);
    ps.forEach(p => box.lastElementChild.append(...p.nodes));
    return box;
  };
  C.stepper = ps => {
    const box = el(`<div class="stepper"><div class="stepper-bar"><button type="button">${esc(L.back)}</button><output aria-live="polite"></output><button type="button">${esc(L.next)}</button></div></div>`);
    const [prev, out, next] = box.firstElementChild.children;
    const panes = ps.map(p => { const s = el(`<div class="stepper-pane">${p.title ? `<h4>${md(p.title)}</h4>` : ''}</div>`); s.append(...p.nodes); box.firstElementChild.before(s); return s; });
    let cur = 0;
    const show = i => {
      cur = Math.max(0, Math.min(i, panes.length - 1));
      panes.forEach((p, j) => { p.hidden = j !== cur; });
      out.textContent = say('step', { n: cur + 1, total: panes.length });
      const lost = d.activeElement === prev || d.activeElement === next;
      prev.disabled = cur === 0; next.disabled = cur === panes.length - 1;
      if (lost && d.activeElement.disabled) (prev.disabled ? next : prev).focus();
      d.dispatchEvent(new Event('kit:shown'));
    };
    prev.addEventListener('click', () => show(cur - 1));
    next.addEventListener('click', () => show(cur + 1));
    show(0);
    return box;
  };
  B.demo = body => {
    const box = el('<div class="demo"><div class="demo-out"></div></div>');
    box.firstElementChild.append(...render(body));
    box.append(B.code(body, { _: [] }, 'viz'));
    return box;
  };

  /* ---------- libraries, theme, color ---------- */
  const CDN = 'https://cdn.jsdelivr.net/npm/';
  const LIBS = {
    katex: { js: 'katex@0.16/dist/katex.min.js', css: 'katex@0.16/dist/katex.min.css', global: 'katex' },
    chart: { js: 'chart.js@4/dist/chart.umd.min.js', global: 'Chart' },
    mermaid: { esm: 'mermaid@11/dist/mermaid.esm.min.mjs' },
  };
  const script = src => new Promise((ok, no) => { const s = d.createElement('script'); s.src = src; s.onload = ok; s.onerror = no; d.head.append(s); });
  const libs = {};
  const load = name => libs[name] ||= (async () => {
    const lib = LIBS[name];
    if (lib.css) d.head.append(Object.assign(d.createElement('link'), { rel: 'stylesheet', href: CDN + lib.css }));
    if (lib.esm) return (await import(CDN + lib.esm)).default;
    await script(CDN + lib.js);
    return window[lib.global];
  })();
  const family = name => getComputedStyle(root).getPropertyValue(name).trim();
  const fontsReady = () => Promise.race([
    Promise.all([family('--font'), family('--display'), family('--mono')].map(f => d.fonts.load('1em ' + f.split(',')[0]))).catch(() => {}),
    new Promise(ok => setTimeout(ok, 2500)),
  ]);
  const probe = d.createElement('i');
  probe.hidden = true;
  const px = d.createElement('canvas').getContext('2d', { willReadFrequently: true });
  const rgbOf = css => { px.clearRect(0, 0, 1, 1); px.fillStyle = css; px.fillRect(0, 0, 1, 1); return [...px.getImageData(0, 0, 1, 1).data.slice(0, 3)]; };
  const color = (name, scheme = '') => {
    if (!probe.isConnected) d.body.append(probe);
    probe.style.colorScheme = scheme;
    probe.style.color = `var(--${name.replace(/^--/, '')})`;
    return '#' + rgbOf(getComputedStyle(probe).color).map(v => v.toString(16).padStart(2, '0')).join('');
  };
  const lum = css => { const [r, g, b] = rgbOf(css).map(v => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
  const dark = matchMedia('(prefers-color-scheme: dark)');
  const theme = () => root.dataset.theme || (dark.matches ? 'dark' : 'light');
  const themed = [];
  const changed = () => { themed.forEach(fn => run(fn)); d.dispatchEvent(new CustomEvent('kit:theme', { detail: theme() })); };

  /* ---------- numbers ---------- */
  B.kpi = body => `<ul class="kpi">${rows(body).map(r => {
    const [label, value = '', ...rest] = r.f;
    let delta = '', sp = '', note = '';
    rest.forEach(x => { if (!x) return; if (!sp && isSeries(x)) sp = x; else if (!delta && /^[+\-−▲▼±]/.test(x)) delta = x; else note = x; });
    const dir = /^[-−▼]/.test(delta) ? 'down' : /^±/.test(delta) ? '' : 'up';
    return `<li><span class="kpi-label">${md(label)}</span><span class="kpi-value">${md(value)}</span>` +
      (delta || sp ? `<span class="kpi-row">${delta ? `<span class="kpi-delta"${tonal(r.tone)}>${{ up: '↑', down: '↓', '': '→' }[dir]} ${esc(delta.replace(/^[+\-−▲▼±]\s*/, ''))}${dir ? `<span class="sr"> ${esc(L[dir])}</span>` : ''}</span>` : '<span></span>'}${sp ? spark(sp, r.tone) : ''}</span>` : '') +
      (note ? `<span class="kpi-note">${md(note)}</span>` : '') + '</li>';
  }).join('')}</ul>`;

  const barList = (body, o, meter) => {
    const rs = rows(body).map(r => {
      const [label, value = '', a = '', b = ''] = r.f;
      const frac = /^(.+?)\s*\/\s*(.+)$/.exec(value);
      return { label, value, note: meter && !frac && a && !isNaN(num(a)) ? b : a, v: num(frac ? frac[1] : value), cap: frac ? num(frac[2]) : meter && a && !isNaN(num(a)) ? num(a) : /%/.test(value) ? 100 : NaN, tone: r.tone };
    });
    const top = +o.max || Math.max(...rs.map(r => r.v).filter(v => !isNaN(v)), 0) || 1;
    return `<ul class="bars${meter ? ' meter' : ''}">${rs.map(r => {
      const cap = meter ? (isNaN(r.cap) ? top : r.cap) : top, v = Math.max(0, Math.min(1, (r.v || 0) / cap));
      return `<li${tonal(r.tone)}><span class="bars-label">${md(r.label)}${r.note ? `<small>${md(r.note)}</small>` : ''}</span><span class="bars-track"${meter ? ` role="meter" aria-valuemin="0" aria-valuemax="${cap}" aria-valuenow="${r.v || 0}" aria-label="${esc(r.label)}"` : ''}><i style="--v:${v.toFixed(4)}"></i></span><span class="bars-val">${md(r.value)}</span></li>`;
    }).join('')}</ul>`;
  };
  B.bars = (body, o) => barList(body, o, false);
  B.meter = (body, o) => barList(body, o, true);

  B.parts = body => {
    let rs = rows(body).map(r => ({ label: r.f[0], text: r.f[1] ?? '', v: num(r.f[1] ?? r.f[0]) || 0, tone: r.tone }));
    if (rs.length > 8) { const rest = rs.slice(7); rs = [...rs.slice(0, 7), { label: L.other, v: rest.reduce((s, r) => s + r.v, 0), text: '', tone: 'muted' }]; rs[7].text = fmt(rs[7].v); }
    const total = rs.reduce((s, r) => s + r.v, 0) || 1;
    const pct = v => { const p = v / total * 100; return (p > 0 && p < 1 ? '<1' : Math.round(p)) + '%'; };
    rs.forEach((r, i) => { r.tone ||= 'c' + (i + 1); });
    const fig = el(`<figure class="parts"><div class="parts-bar" role="img" aria-label="${esc(rs.map(r => `${r.label} ${pct(r.v)}`).join(', '))}">${rs.map(r => `<i style="--v:${r.v}"${tonal(r.tone)} data-t="${pct(r.v)}" title="${esc(r.label)}: ${esc(r.text)} (${pct(r.v)})"></i>`).join('')}</div><ul class="legend">${rs.map(r => `<li><i${tonal(r.tone)}></i>${md(r.label)} <span>${md(r.text)} · ${pct(r.v)}</span></li>`).join('')}</ul></figure>`);
    const bar = fig.firstElementChild;
    onSize(bar, () => [...bar.children].forEach(s => { s.textContent = s.dataset.t; if (s.scrollWidth > s.clientWidth) s.textContent = ''; }));
    return fig;
  };

  B.funnel = body => {
    const rs = rows(body).map(r => ({ label: r.f[0], text: r.f[1] ?? '', v: num(r.f[1]) || 0, note: r.f[2] || '' }));
    const top = Math.max(...rs.map(r => r.v)) || 1;
    return `<ol class="funnel">${rs.map((r, i) => `<li><span class="funnel-bar" style="--v:${(r.v / top).toFixed(4)}"></span><span class="funnel-text"><b>${md(r.label)}</b> ${md(r.text)}${i && rs[i - 1].v ? ` <span>${esc(say('ofPrev', { p: Math.round(r.v / rs[i - 1].v * 100) + '%' }))}</span>` : ''}${r.note ? ` <span>${md(r.note)}</span>` : ''}</span></li>`).join('')}</ol>`;
  };

  B.kv = body => `<dl class="kv">${rows(body).map(r => `<div><dt>${md(r.f[0])}</dt><dd>${md(r.f.slice(1).join(' | '))}</dd></div>`).join('')}</dl>`;

  /* ---------- tables and charts ---------- */
  const GAP = /^[\s—–?−-]*$|^n\/?a$/i;
  const NUMISH = /^\D{0,3}?[−+-]?\d[\d,.\s]*(e[+-]?\d+)?\s*\D{0,5}$/i;
  const SEP = r => !/^[\s|:-]+$/.test(r.raw);
  const grid = body => {
    const rs = rows(body).filter(SEP);
    if (rs.length < 2) throw new Error('needs a header row and at least one data row');
    const head = rs.shift().f.map(h => { const key = /\*$/.test(h); const [t, tn] = tone(key ? h.slice(0, -1).trim() : h); return { text: t, key, tone: tn }; });
    const cells = rs.map(r => head.map((_, j) => r.f[j] ?? ''));
    const isNum = head.map((_, j) => { const v = cells.map(r => r[j]).filter(s => !GAP.test(s)); return v.length > 0 && v.every(s => NUMISH.test(s)); });
    return { head, cells, isNum, tones: rs.map(r => r.tone) };
  };
  const mark = s => /^(✓|✔|yes)$/i.test(s) ? ['yes', '✓'] : /^(✗|✘|no)$/i.test(s) ? ['no', '✗'] : /^(~|partial|partly)$/i.test(s) ? ['partial', '~'] : null;
  B.table = (body, o) => {
    const { head, cells, isNum, tones } = grid(body);
    const bars = String(o.bar || '').split(',').map(s => s.trim()).filter(Boolean).map(s => /^\d+$/.test(s) ? s - 1 : head.findIndex(h => h.text.toLowerCase() === s.toLowerCase()));
    const max = head.map((_, j) => Math.max(...cells.map(r => Math.abs(num(r[j])) || 0)));
    const cell = (s, j) => {
      const k = mark(s);
      if (k) return `<span class="${k[0]}">${k[1]}${s.length > 1 ? ' ' + esc(s) : `<span class="sr"> ${esc(L[k[0]])}</span>`}</span>`;
      if (bars.includes(j) && isNum[j]) return `<span class="cellbar"><span>${md(s)}</span><i style="--v:${(Math.abs(num(s)) / (max[j] || 1)).toFixed(3)}"></i></span>`;
      return md(s);
    };
    const cls = j => { const c = [isNum[j] && j > 0 ? 'num' : '', head[j].key ? 'key-col' : ''].filter(Boolean).join(' '); return c ? ` class="${c}"` : ''; };
    const box = el(`<div class="table">${o.filter ? `<div class="table-tools"><input type="search" placeholder="${esc(L.filter)}" aria-label="${esc(L.filter)}"><span aria-live="polite"></span></div>` : ''}<div class="scroll"><table><thead><tr>${head.map((h, j) => `<th scope="col"${cls(j)}>${o.sort ? `<button type="button">${md(h.text)}</button>` : md(h.text)}</th>`).join('')}</tr></thead><tbody>${cells.map((r, i) => `<tr${tonal(tones[i])}>${r.map((c, j) => `<td${cls(j)}>${cell(c, j)}</td>`).join('')}</tr>`).join('')}</tbody></table></div></div>`);
    const tbody = box.querySelector('tbody'), trs = [...tbody.rows];
    trs.forEach((tr, i) => { tr.kitRow = cells[i]; });
    if (o.sort) $$('th', box).forEach((th, j) => th.firstElementChild.addEventListener('click', () => {
      const dir = th.getAttribute('aria-sort') === 'ascending' ? -1 : 1;
      $$('th', box).forEach(x => x.removeAttribute('aria-sort'));
      th.setAttribute('aria-sort', dir > 0 ? 'ascending' : 'descending');
      tbody.append(...[...tbody.rows].sort((a, b) => dir * (isNum[j] ? (num(a.kitRow[j]) || 0) - (num(b.kitRow[j]) || 0) : a.kitRow[j].localeCompare(b.kitRow[j], root.lang || undefined, { numeric: true }))));
    }));
    if (o.filter) {
      const input = box.querySelector('input'), count = input.nextElementSibling;
      input.addEventListener('input', () => {
        const q = input.value.trim().toLowerCase();
        let n = 0;
        trs.forEach(tr => { tr.hidden = !!q && !tr.textContent.toLowerCase().includes(q); if (!tr.hidden) n++; });
        count.textContent = q ? say('rows', { n, total: trs.length }) : '';
      });
    }
    return box;
  };

  B.heatmap = (body, o) => {
    const { head, cells } = grid(body);
    const vals = cells.flatMap(r => r.slice(1).map(num)).filter(v => !isNaN(v));
    const lo = Math.min(...vals), hi = Math.max(...vals), mid = +o.mid || 0;
    const span = (o.diverging ? Math.max(hi - mid, mid - lo) : hi - lo) || 1;
    const box = el(`<div class="scroll"><table class="heat" style="--cols:${head.length - 1}"><thead><tr>${head.map((h, j) => j ? `<th scope="col">${md(h.text)}</th>` : `<td>${md(h.text)}</td>`).join('')}</tr></thead><tbody>${cells.map(r => `<tr><th scope="row">${md(r[0])}</th>${r.slice(1).map(c => { const v = num(c); return isNaN(v) ? `<td style="--v:0">${esc(c)}</td>` : `<td style="--v:${(o.diverging ? Math.abs(v - mid) / span : (v - lo) / span).toFixed(3)}"${o.diverging && v < mid ? ' class="neg"' : ''}>${esc(c)}</td>`; }).join('')}</tr>`).join('')}</tbody></table></div>`);
    const ink = () => $$('tbody td', box).forEach(td => td.classList.toggle('hot', lum(getComputedStyle(td).backgroundColor) < 0.18));
    onSize(box, ink);
    themed.push(ink);
    return box;
  };

  const charts = [];
  const styleCharts = (Chart, c = color) => {
    Chart.defaults.font.family = family('--font');
    Chart.defaults.font.size = 13;
    Chart.defaults.color = c('muted');
    Chart.defaults.borderColor = c('line');
  };
  const paintChart = (ch, c = color) => { ch.inst?.destroy(); ch.inst = new window.Chart(ch.canvas, ch.make(c)); return ch.inst; };
  const chartConfig = (type, { head, cells, isNum }, o) => c => {
    const round = type === 'pie' || type === 'donut', liney = type === 'line' || type === 'area', radar = type === 'radar';
    const series = head.map((_, j) => j).filter(j => j > 0 && isNum[j]);
    const names = head.findIndex((_, j) => j > 0 && !isNum[j]);
    const xNum = type === 'scatter' || (liney && cells.every(r => /^[−+-]?\d[\d,]*(\.\d+)?$/.test(r[0])));
    const val = s => GAP.test(s) ? null : num(s);
    const hue = (j, k) => c(head[j].tone || 'c' + (k % 8 + 1));
    const surface = c('card'), logs = o.log === true ? ['y'] : String(o.log || '').split(',');
    const compact = new Intl.NumberFormat(root.lang || undefined, { notation: 'compact' });
    const axis = (title, log) => ({
      type: log ? 'logarithmic' : 'linear', stacked: !!o.stacked,
      title: { display: !!title, text: title, color: c('muted') },
      grid: { color: c('line') }, border: { color: c('line-strong') }, ticks: { color: c('muted') },
    });
    const cat = axis(o.x, logs.includes('x'));
    if (!xNum) { cat.type = 'category'; cat.grid.display = false; }
    else { if (cells.every(r => Math.abs(num(r[0])) < 1e4)) cat.ticks.format = { useGrouping: false }; if (cells.every(r => Number.isInteger(num(r[0])))) cat.ticks.precision = 0; }
    const value = { ...axis(o.y, logs.includes('y')), beginAtZero: type === 'bar' };
    value.ticks.callback = v => Math.abs(v) >= 1e4 ? compact.format(v) : fmt(v);
    return {
      type: { area: 'line', donut: 'doughnut' }[type] || type,
      data: {
        labels: xNum ? undefined : cells.map(r => r[0]),
        datasets: series.map((j, k) => ({
          label: head[j].text,
          data: xNum ? cells.map(r => ({ x: num(r[0]), y: val(r[j]) })) : cells.map(r => val(r[j])),
          backgroundColor: round ? cells.map((_, i) => c('c' + (i % 8 + 1))) : type === 'area' || radar ? hue(j, k) + '1f' : hue(j, k),
          borderColor: round || (type === 'bar' && o.stacked) ? surface : hue(j, k),
          borderWidth: round ? 2 : type === 'bar' ? (o.stacked ? 1 : 0) : 2,
          borderRadius: type === 'bar' ? 4 : 0, maxBarThickness: 24, fill: type === 'area' || radar,
          pointRadius: type === 'scatter' ? 4.5 : cells.length > 14 ? 0 : 4, pointHoverRadius: 6, pointBackgroundColor: hue(j, k), pointBorderColor: surface, pointBorderWidth: 2, tension: 0,
        })),
      },
      options: {
        responsive: true, maintainAspectRatio: false, animation: false,
        indexAxis: o.horizontal ? 'y' : 'x', cutout: type === 'donut' ? '62%' : undefined,
        interaction: round || type === 'scatter' ? { mode: 'nearest', intersect: true } : { mode: 'index', intersect: false },
        plugins: {
          legend: { display: round || series.length > 1, position: round ? 'right' : 'top', align: round ? 'center' : 'end', labels: { color: c('text'), boxWidth: 10, boxHeight: 10, useBorderRadius: true, borderRadius: 2 } },
          tooltip: {
            backgroundColor: c('card'), titleColor: c('text'), bodyColor: c('text'), borderColor: c('line-strong'), borderWidth: 1, padding: 10, boxPadding: 4,
            callbacks: names < 0 ? {} : { title: its => [its[0].label, cells[its[0].dataIndex][names]].filter(Boolean).join(' · ') },
          },
        },
        scales: round ? {} : radar ? { r: { grid: { color: c('line') }, angleLines: { color: c('line') }, pointLabels: { color: c('text'), font: { size: 12 } }, ticks: { color: c('muted'), backdropColor: surface } } } : o.horizontal ? { y: cat, x: value } : { x: cat, y: value },
      },
    };
  };
  B.chart = (body, o) => {
    const type = ['bar', 'line', 'area', 'scatter', 'pie', 'donut', 'radar'].find(t => o[t]) || 'bar';
    const g = grid(body);
    const fig = el(`<figure class="chart"><div class="scroll">${dataTable(g.head.map(h => h.text), g.cells)}</div>${o.title ? `<figcaption>${md(o.title)}</figcaption>` : ''}</figure>`);
    const data = fig.querySelector('details');
    fig.firstElementChild.replaceWith(data);
    load('chart').then(async Chart => {
      await fontsReady();
      styleCharts(Chart);
      const box = el(`<div class="chart-box"><canvas role="img" aria-label="${esc(o.title || g.head.map(h => h.text).join(', '))}"></canvas></div>`);
      if (o.h) box.style.setProperty('--h', o.h + 'rem');
      else if (o.horizontal) box.style.setProperty('--h', g.cells.length * (g.head.length > 2 && !o.stacked ? 2.6 : 1.9) + 4 + 'rem');
      fig.prepend(box);
      const ch = { canvas: box.firstElementChild, make: chartConfig(type, g, o) };
      charts.push(ch);
      paintChart(ch);
    }).catch(() => { data.open = true; });
    return fig;
  };
  B.chart.ownTitle = true;
  const repaint = (c = color) => { if (!window.Chart || !charts.length) return; styleCharts(window.Chart, c); charts.forEach(ch => paintChart(ch, c)); };
  themed.push(() => repaint());
  addEventListener('beforeprint', () => { if (theme() === 'dark') run(() => repaint(n => color(n, 'light'))); });
  addEventListener('afterprint', () => { if (theme() === 'dark') run(() => repaint()); });

  /* ---------- cards and lists ---------- */
  const more = r => r.more ? slot(render(r.more)) : '';
  B.cards = (body, o) => `<ul class="cards"${o.cols ? ` style="--min:${Math.round(60 / o.cols - 2)}rem"` : ''}>${items(body).map(r => {
    const [title, text = '', meta = ''] = r.f;
    return `<li class="card"${tonal(r.tone)}><h4>${md(title)}</h4>${text || r.more ? `<div class="card-body">${text ? `<p>${md(text)}</p>` : ''}${more(r)}</div>` : ''}${meta ? `<div class="card-meta">${md(meta)}</div>` : ''}</li>`;
  }).join('')}</ul>`;
  B.steps = body => `<ol class="steps">${items(body).map(r => `<li${tonal(r.tone)}><h4>${md(r.f[0])}</h4>${r.f[1] || r.more ? `<div>${r.f[1] ? `<p>${md(r.f.slice(1).join(' | '))}</p>` : ''}${more(r)}</div>` : ''}</li>`).join('')}</ol>`;
  B.timeline = body => `<ol class="timeline">${items(body).map(r => `<li${tonal(r.tone)}><time>${md(r.f[0])}</time><h4>${md(r.f[1] || '')}</h4>${r.f[2] || r.more ? `<div>${r.f[2] ? `<p>${md(r.f.slice(2).join(' | '))}</p>` : ''}${more(r)}</div>` : ''}</li>`).join('')}</ol>`;
  B.checklist = body => {
    const rs = rows(body).map(r => {
      const m = /^(?:[-*]\s+)?\[([ xX~!])\]\s*(.*)$/.exec(r.f[0]) || [0, ' ', r.f[0]];
      return { s: { ' ': 'todo', x: 'done', X: 'done', '~': 'doing', '!': 'blocked' }[m[1]], text: m[2], note: r.f[1] || '' };
    });
    const done = rs.filter(r => r.s === 'done').length;
    return `<figure class="checklist"><div class="checklist-head"><span>${esc(say('progress', { n: done, total: rs.length }))}</span><i style="--v:${(done / rs.length).toFixed(3)}"></i></div><ul>${rs.map(r => `<li data-s="${r.s}"><span class="box" data-s="${r.s}" role="img" aria-label="${esc(L[r.s])}">${{ done: '✓', doing: '–', blocked: '!', todo: '' }[r.s]}</span><span>${md(r.text)}</span>${r.note ? `<small>${md(r.note)}</small>` : ''}</li>`).join('')}</ul></figure>`;
  };
  B.proscons = body => `<div class="proscons">${sections(body).map(s => {
    const pick = re => s.lines.filter(l => re.test(l.trim())).map(l => md(l.trim().slice(1).trim()));
    const pros = pick(/^\+/), cons = pick(/^[-−]/);
    const list = (xs, sign, tn, label) => xs.length ? `<ul aria-label="${esc(label)}">${xs.map(x => `<li${tonal(tn)}><b aria-hidden="true">${sign}</b><span>${x}</span></li>`).join('')}</ul>` : '';
    return s.title ? `<section><h4>${md(s.title)}</h4>${list(pros, '+', 'ok', L.pros)}${list(cons, '−', 'bad', L.cons)}</section>`
      : `<section><h4>${esc(L.pros)}</h4>${list(pros, '+', 'ok', L.pros)}</section><section><h4>${esc(L.cons)}</h4>${list(cons, '−', 'bad', L.cons)}</section>`;
  }).join('')}</div>`;
  B.kanban = body => `<div class="kanban scroll">${sections(body).map(s => {
    const cards = s.lines.filter(l => l.trim()).map(l => row(l.trim().replace(/^[-*]\s+/, '')));
    return `<section${tonal(s.tone)}><h4>${md(s.title)} <span>${cards.length}</span></h4><ul>${cards.map(c => `<li class="card"${tonal(c.tone)}>${md(c.f[0])}${c.f[1] ? `<div class="card-meta">${md(c.f.slice(1).join(' · '))}</div>` : ''}</li>`).join('')}</ul></section>`;
  }).join('')}</div>`;
  B.quiz = body => {
    const qs = []; let q;
    for (const ln of body.split('\n').map(l => l.trim()).filter(Boolean)) {
      if (ln[0] === '?') qs.push(q = { text: ln.slice(1).trim(), opts: [], why: '' });
      else if (!q) continue;
      else if (ln[0] === '>') q.why += ln.slice(1).trim() + ' ';
      else if (/^[+\-−]/.test(ln)) { const f = pipes(ln.slice(1)); q.opts.push({ ok: ln[0] === '+', text: f[0], why: f[1] || '' }); }
    }
    const box = el(`<div class="quiz">${qs.map(q => `<fieldset><legend>${md(q.text)}</legend><div class="opts">${q.opts.map(o => `<button type="button">${md(o.text)}</button>`).join('')}</div><p class="verdict" aria-live="polite"></p></fieldset>`).join('')}</div>`);
    $$('fieldset', box).forEach((fs, k) => {
      const btns = $$('button', fs), verdict = fs.querySelector('.verdict');
      btns.forEach((b, i) => b.addEventListener('click', () => {
        const o = qs[k].opts[i];
        btns.forEach(x => x.classList.remove('right', 'wrong'));
        b.classList.add(o.ok ? 'right' : 'wrong');
        verdict.innerHTML = `<b class="${o.ok ? 'right' : 'wrong'}">${esc(o.ok ? L.right : L.wrong)}</b> ${md(o.why || (o.ok ? qs[k].why : ''))}`;
      }));
    });
    return box;
  };
  B.calc = body => {
    const [top, ...rest] = body.split(/^---+\s*$/m);
    const ins = rows(top).map(r => {
      const m = /^([A-Za-z_]\w*)\s*=\s*(-?[\d.]+)$/.exec(r.f[0]);
      if (!m) throw new Error(`input "${r.f[0]}" should read name = number`);
      const range = /(-?[\d.]+)\s*\.\.\s*(-?[\d.]+)(?:\s+step\s+([\d.]+))?/.exec(r.f[2] || '') || [0, 0, m[2] * 2 || 100];
      return { name: m[1], value: +m[2], label: r.f[1] || m[1], min: +range[1], max: +range[2], step: range[3] || 'any', unit: r.f[3] || '' };
    });
    const exprs = [];
    const tpl = rest.join('---').replace(/\{([^{}]+)\}/g, (_, x) => { const [e, dp] = x.split(/\|(?!\|)/); exprs.push({ fn: new Function('v', `with (Math) with (v) return (${e});`), dp: dp === undefined ? 2 : +dp }); return `\u0003${exprs.length - 1}\u0004`; });
    const box = el(`<div class="calc"><div class="calc-in">${ins.map(i => `<label><span>${md(i.label)}</span><input type="range" name="${i.name}" min="${i.min}" max="${i.max}" step="${i.step === 'any' && Number.isInteger(i.value) && i.max - i.min >= 10 ? 1 : i.step}" value="${i.value}"><output></output></label>`).join('')}</div><div class="calc-out">${slot(render(tpl))}</div></div>`);
    const outs = [];
    const tw = d.createTreeWalker(box.lastElementChild, 4), texts = [];
    for (let t; (t = tw.nextNode());) if (/\u0003/.test(t.data)) texts.push(t);
    texts.forEach(node => {
      const f = d.createDocumentFragment();
      node.data.split(/\u0003(\d+)\u0004/).forEach((p, i) => { if (i % 2) { const out = d.createElement('output'); outs.push([out, exprs[p]]); f.append(out); } else if (p) f.append(p); });
      node.replaceWith(f);
    });
    const inputs = $$('input', box);
    const update = () => run(() => {
      const v = Object.fromEntries(inputs.map(i => [i.name, +i.value]));
      inputs.forEach((i, k) => { i.nextElementSibling.textContent = fmt(i.value) + (ins[k].unit ? ' ' + ins[k].unit : ''); });
      outs.forEach(([o, x]) => { const r = x.fn(v); o.textContent = typeof r === 'number' ? r.toLocaleString(root.lang || undefined, { maximumFractionDigits: x.dp, minimumFractionDigits: 0 }) : r; });
    });
    inputs.forEach(i => i.addEventListener('input', update));
    update();
    return box;
  };
  B.gallery = body => {
    const pics = rows(body).map(r => { const m = /^!\[([^\]]*)\]\((\S+?)\)\s*(.*)$/.exec(r.f[0]); return m ? { alt: m[1], src: m[2], cap: m[3] || r.f[1] || '' } : { src: r.f[0], cap: r.f[1] || '', alt: r.f[2] || r.f[1] || '' }; });
    const box = el(`<ul class="gallery">${pics.map(p => `<li><figure><button type="button" aria-label="${esc(L.enlarge + ': ' + (p.alt || p.cap))}"><img alt="${esc(p.alt)}" src="${esc(p.src)}" loading="lazy"></button>${p.cap ? `<figcaption>${md(p.cap)}</figcaption>` : ''}</figure></li>`).join('')}</ul>`);
    $$('button', box).forEach((b, i) => b.addEventListener('click', () => {
      const dlg = el(`<dialog class="lightbox"><img alt="${esc(pics[i].alt)}" src="${esc(pics[i].src)}"><p><span>${md(pics[i].cap || pics[i].alt)}</span><button type="button" class="btn">${esc(L.close)}</button></p></dialog>`);
      dlg.querySelector('button').addEventListener('click', () => dlg.close());
      dlg.addEventListener('click', e => { if (e.target === dlg) dlg.close(); });
      dlg.addEventListener('close', () => dlg.remove());
      d.body.append(dlg); dlg.showModal();
    }));
    return box;
  };

  /* ---------- diagrams ---------- */
  const nodeHtml = (text, tn, cls = '') => {
    const [a, ...b] = text.split(/:\s+/);
    return `<div class="node${cls}"${tonal(tn)}><b>${md(a)}</b>${b.length ? `<small>${md(b.join(': '))}</small>` : ''}</div>`;
  };
  B.flow = (body, o) => {
    const lines = body.split('\n').map(l => l.trim()).filter(Boolean);
    const chains = lines.some(l => /-+>/.test(l)) ? lines.map(l => l.split(/\s*-+>\s*/)) : [lines];
    return `<div class="plate">${chains.map(ch => `<ol class="flow${o.vertical ? ' vertical' : ''}">${ch.filter(Boolean).map(s => `<li>${nodeHtml(...tone(s))}</li>`).join('')}</ol>`).join('')}${o.loop ? `<div class="flow-loop"><span>${esc(o.loop === true ? L.repeat : o.loop)}</span></div>` : ''}</div>`;
  };

  const graphView = (nodes, edges, o) => {
    const ids = [...nodes.keys()], out = new Map(ids.map(k => [k, []])), state = {}, back = new Set();
    edges.forEach(e => { if (e.a !== e.b) out.get(e.a).push(e); });
    const visit = k => { state[k] = 1; for (const e of out.get(k)) { if (state[e.b] === 1) back.add(e); else if (!state[e.b]) visit(e.b); } state[k] = 2; };
    ids.forEach(k => state[k] || visit(k));
    const fwd = edges.filter(e => e.a !== e.b && !back.has(e)), rank = new Map(ids.map(k => [k, 0]));
    for (let pass = 0; pass < ids.length; pass++) {
      let moved = false;
      fwd.forEach(e => { if (rank.get(e.b) < rank.get(e.a) + 1) { rank.set(e.b, rank.get(e.a) + 1); moved = true; } });
      if (!moved) break;
    }
    ids.forEach(k => { const outs = fwd.filter(e => e.a === k); if (outs.length && !fwd.some(e => e.b === k)) rank.set(k, Math.min(...outs.map(e => rank.get(e.b))) - 1); });
    const ranks = [];
    ids.forEach(k => (ranks[rank.get(k)] ||= []).push(k));
    const layers = ranks.filter(Boolean), pos = new Map();
    const place = () => layers.forEach(l => l.forEach((k, i) => pos.set(k, (i + 0.5) / l.length)));
    place();
    for (let sweep = 0; sweep < 4; sweep++) {
      (sweep % 2 ? [...layers].reverse() : layers).forEach(l => {
        const bary = new Map(l.map(k => { const near = fwd.filter(e => sweep % 2 ? e.a === k : e.b === k).map(e => pos.get(sweep % 2 ? e.b : e.a)); return [k, near.length ? near.reduce((a, b) => a + b, 0) / near.length : pos.get(k)]; }));
        l.sort((a, b) => bary.get(a) - bary.get(b));
        l.forEach((k, i) => pos.set(k, (i + 0.5) / l.length));
      });
    }
    const id = 'kit-arrow-' + ++uid;
    const plate = el(`<div class="plate"><div class="graph${o.LR || o.lr ? ' lr' : ''}"><svg class="wires" aria-hidden="true"><defs><marker id="${id}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z"/></marker></defs><g></g></svg>${layers.map(l => `<div class="rank">${l.map(k => `<i data-n="${esc(k)}"></i>`).join('')}</div>`).join('')}</div></div>`);
    const g = plate.firstElementChild, wires = g.querySelector('g'), els = new Map();
    $$('i[data-n]', g).forEach(i => { const n = el(nodes.get(i.dataset.n).html); els.set(i.dataset.n, n); i.replaceWith(n); });
    const labels = [];
    const draw = () => run(() => {
      const box = g.getBoundingClientRect();
      if (!box.width) return;
      const R = new Map(ids.map(k => { const r = els.get(k).getBoundingClientRect(); return [k, { l: r.left - box.left, t: r.top - box.top, r: r.right - box.left, b: r.bottom - box.top, cx: (r.left + r.right) / 2 - box.left, cy: (r.top + r.bottom) / 2 - box.top }]; }));
      const ports = new Map();
      edges.forEach(e => {
        const a = R.get(e.a), b = R.get(e.b);
        [e.sa, e.sb] = e.a === e.b ? ['r', 'r'] : b.t >= a.b - 2 ? ['b', 't'] : b.b <= a.t + 2 ? ['t', 'b'] : b.l >= a.r ? ['r', 'l'] : ['l', 'r'];
        if (e.a === e.b) return;
        [['a', e.sa, b], ['b', e.sb, a]].forEach(([end, side, other]) => { const k = e[end] + '\n' + side; (ports.get(k) || ports.set(k, []).get(k)).push({ e, end, at: 'tb'.includes(side) ? other.cx : other.cy }); });
      });
      ports.forEach(list => { list.sort((x, y) => x.at - y.at); list.forEach((p, i) => { p.e['f' + p.end] = 0.5 + ((i + 1) / (list.length + 1) - 0.5) * 0.7; }); });
      const pt = (r, side, f) => side === 't' ? [r.l + (r.r - r.l) * f, r.t] : side === 'b' ? [r.l + (r.r - r.l) * f, r.b] : side === 'l' ? [r.l, r.t + (r.b - r.t) * f] : [r.r, r.t + (r.b - r.t) * f];
      wires.replaceChildren();
      labels.splice(0).forEach(n => n.remove());
      const tag = (text, x, y, cls = '') => { const n = el(`<span class="edge-label${cls}" style="left:${x.toFixed(1)}px;top:${y.toFixed(1)}px">${md(text)}</span>`); labels.push(n); g.append(n); };
      const off = { t: [10, -11], b: [10, 11], l: [-11, -10], r: [11, -10] };
      edges.forEach(e => {
        const a = R.get(e.a), b = R.get(e.b);
        let x1, y1, x2, y2, c;
        if (e.a === e.b) { x1 = x2 = a.r; y1 = a.cy - 7; y2 = a.cy + 7; c = [x1 + 34, y1 - 16, x1 + 34, y2 + 16]; }
        else {
          [x1, y1] = pt(a, e.sa, e.fa); [x2, y2] = pt(b, e.sb, e.fb);
          c = 'tb'.includes(e.sa) ? [x1, (y1 + y2) / 2, x2, (y1 + y2) / 2] : [(x1 + x2) / 2, y1, (x1 + x2) / 2, y2];
        }
        const path = `M${x1} ${y1}C${c.join(' ')} ${x2} ${y2}`, t = 0.6, u = 1 - t;
        const bez = (p0, p1, p2, p3) => u * u * u * p0 + 3 * u * u * t * p1 + 3 * u * t * t * p2 + t * t * t * p3;
        const p = svgEl('path', { d: path });
        if (e.dash) p.setAttribute('class', 'dash');
        if (e.heads !== 'none') p.setAttribute('marker-end', `url(#${id})`);
        if (e.heads === 'both') p.setAttribute('marker-start', `url(#${id})`);
        wires.append(p);
        if (e.label) tag(e.label, bez(x1, c[0], c[2], x2), bez(y1, c[1], c[3], y2));
        if (e.la) tag(e.la, x1 + off[e.sa][0], y1 + off[e.sa][1], ' end');
        if (e.lb) tag(e.lb, x2 + off[e.sb][0], y2 + off[e.sb][1], ' end');
      });
    });
    new ResizeObserver(draw).observe(g);
    d.fonts.ready.then(draw);
    return plate;
  };
  const parseGraph = body => {
    const nodes = new Map(), edges = [];
    const need = id => { if (!nodes.has(id)) nodes.set(id, { label: id }); return nodes.get(id); };
    for (const raw of body.split('\n')) {
      const ln = raw.trim();
      if (!ln) continue;
      const p = ln.split(/\s+(<-+>|<-+|-+>|-{2,})\s+/);
      if (p.length < 3) {
        const [t, tn] = tone(ln), [head, sub] = pipes(t), m = /^(.+?):\s+(.*)$/.exec(head);
        Object.assign(need(m ? m[1] : head), { label: m ? m[2] : head, sub, tone: tn });
        continue;
      }
      const last = /^(.*?):\s+(.*)$/.exec(p[p.length - 1]);
      if (last) p[p.length - 1] = last[1];
      for (let i = 0; i + 2 < p.length; i += 2) {
        const ar = p[i + 1], rev = ar[0] === '<' && !ar.endsWith('>');
        need(p[i]); need(p[i + 2]);
        edges.push({ a: rev ? p[i + 2] : p[i], b: rev ? p[i] : p[i + 2], label: last && i + 3 >= p.length ? last[2] : '', dash: /^<?-{2,}>$/.test(ar), heads: /^-+$/.test(ar) ? 'none' : ar[0] === '<' && ar.endsWith('>') ? 'both' : 'end' });
      }
    }
    return { nodes, edges };
  };
  B.graph = (body, o) => {
    const { nodes, edges } = parseGraph(body);
    nodes.forEach(n => { n.html = `<div class="node"${tonal(n.tone)}><b>${md(n.label)}</b>${n.sub ? `<small>${md(n.sub)}</small>` : ''}</div>`; });
    return graphView(nodes, edges, o);
  };
  B.erd = (body, o) => {
    const ents = new Map(), edges = [];
    const need = id => { if (!ents.has(id)) ents.set(id, { fields: [] }); return ents.get(id); };
    let cur;
    for (const raw of body.split('\n')) {
      if (!raw.trim()) continue;
      const rel = /^(\S+)\s+(\S*?)-{2,}(\S*?)\s+(\S+?)(?::\s*(.*))?$/.exec(raw.trim());
      if (rel && !/^\s/.test(raw)) { need(rel[1]); need(rel[4]); edges.push({ a: rel[1], b: rel[4], la: rel[2], lb: rel[3], label: rel[5] || '', heads: 'none' }); cur = null; continue; }
      if (/^\s/.test(raw) && cur) {
        const [def, note] = pipes(raw), tok = def.split(/\s+/), keys = tok.slice(1).filter(t => /^(PK|FK|UK|UQ|NN|IDX)$/i.test(t));
        cur.fields.push({ name: tok[0], type: tok.slice(1).filter(t => !keys.includes(t)).join(' '), keys, note });
      } else { const [t, tn] = tone(raw.trim()); cur = need(t); cur.tone = tn; }
    }
    ents.forEach((e, name) => { e.html = `<div class="node entity"${tonal(e.tone)}><b>${esc(name)}</b>${e.fields.length ? `<ul>${e.fields.map(f => `<li${f.note ? ` title="${esc(f.note)}"` : ''}><span class="f-name">${esc(f.name)}</span>${f.keys.map(k => `<span class="f-key">${esc(k.toUpperCase())}</span>`).join('')}<span class="f-type">${esc(f.type)}</span></li>`).join('')}</ul>` : ''}</div>`; });
    return graphView(ents, edges, o);
  };
  B.sequence = (body, o) => {
    const actors = [], steps = [];
    const idx = n => { n = n.trim(); let i = actors.indexOf(n); if (i < 0) i = actors.push(n) - 1; return i; };
    for (const ln of body.split('\n').map(l => l.trim()).filter(Boolean)) {
      let m;
      if ((m = /^actors?:\s*(.+)$/i.exec(ln))) m[1].split(',').forEach(idx);
      else if ((m = /^==+\s*(.*?)\s*=*$/.exec(ln))) steps.push({ div: m[1] });
      else if ((m = /^note(?:\s+[^:]*)?:\s*(.+)$/i.exec(ln))) steps.push({ note: m[1] });
      else if ((m = /^(.+?)\s+(<-+|-+>)\s+(.+?)(?::\s+(.*))?$/.exec(ln))) {
        const rev = m[2][0] === '<', a = idx(rev ? m[3] : m[1]), b = idx(rev ? m[1] : m[3]);
        steps.push({ a, b, text: m[4] || '', dash: /-{2,}/.test(m[2]) });
      } else throw new Error(`cannot read "${ln}"`);
    }
    let n = 0;
    return `<div class="plate scroll"><div class="seq" style="--n:${actors.length}">${actors.map((a, i) => `<div class="node seq-actor" style="grid-column:${i + 1}"><b>${md(a)}</b></div>`).join('')}${steps.map((s, k) => {
      if (s.div !== undefined) return `<div class="seq-div" style="grid-row:${k + 2}"><span>${md(s.div)}</span></div>`;
      if (s.note) return `<div class="seq-note" style="grid-row:${k + 2}">${md(s.note)}</div>`;
      const lo = Math.min(s.a, s.b), hi = Math.max(s.a, s.b), tag = o.nums ? `<b>${++n}</b>` : '';
      if (lo === hi) return `<div class="seq-msg self" style="grid-row:${k + 2};grid-column:${lo + 1};--span:1"><span class="seq-text">${tag}${md(s.text)}</span></div>`;
      return `<div class="seq-msg${s.b < s.a ? ' rev' : ''}${s.dash ? ' dash' : ''}" style="grid-row:${k + 2};grid-column:${lo + 1} / ${hi + 2};--span:${hi - lo + 1}"><span class="seq-text">${tag}${md(s.text)}</span><i class="seq-line"></i><span class="sr">${esc(actors[s.a])} → ${esc(actors[s.b])}</span></div>`;
    }).join('')}</div></div>`;
  };
  B.layers = body => `<ol class="layers">${rows(body).map(r => `<li${tonal(r.tone)}><b>${md(r.f[0])}</b>${r.f[1] ? `<ul class="chips">${r.f[1].split(/\s*,\s*/).map(c => `<li>${md(c)}</li>`).join('')}</ul>` : '<span></span>'}${r.f[2] ? `<small>${md(r.f[2])}</small>` : ''}</li>`).join('')}</ol>`;

  const nest = body => {
    const roots = [], stack = [];
    for (const raw of body.split('\n')) {
      if (!raw.trim()) continue;
      const lead = raw.match(/^[\s│├└─|`+\u00a0-]*(?=\S)/)[0], drawn = /[│├└]/.test(lead);
      const node = { raw: (drawn ? raw.slice(lead.length) : raw.trim().replace(/^[-*]\s+/, '')).trim(), kids: [], indent: drawn ? lead.length : raw.match(/^\s*/)[0].replace(/\t/g, '  ').length };
      while (stack.length && stack[stack.length - 1].indent >= node.indent) stack.pop();
      (stack.length ? stack[stack.length - 1].kids : roots).push(node);
      stack.push(node);
    }
    return roots;
  };
  B.tree = body => {
    const ul = (ns, top) => `<ul${top ? ' class="tree"' : ''}>${ns.map(n => { const r = row(n.raw); return `<li><span class="tree-label"${tonal(r.tone)}>${md(r.f[0])}</span>${r.f[1] ? `<small>${md(r.f[1])}</small>` : ''}${n.kids.length ? ul(n.kids) : ''}</li>`; }).join('')}</ul>`;
    return ul(nest(body), true);
  };
  B.filetree = (body, o) => {
    const meta = (raw, paths) => {
      let s = raw, add = null, del = null, note = '', tag = '', tn, m;
      [s, tn] = tone(s);
      if ((m = /^(\d+|-)\s+(\d+|-)\t(.+)$/.exec(s))) { add = +m[1] || 0; del = +m[2] || 0; s = m[3]; }
      else if ((m = /^(.*?)\s*\|\s*(\d+)\s*([+-]*)\s*$/.exec(s))) { const p = (m[3].match(/\+/g) || []).length, q = (m[3].match(/-/g) || []).length; add = p + q ? Math.round(m[2] * p / (p + q)) : +m[2]; del = m[2] - add; s = m[1]; }
      s = s.replace(/\s+#\s+(.*)$/, (_, n) => (note = n, ''));
      s = s.replace(/\s\+(\d+)\b/, (_, n) => (add = +n, '')).replace(/\s[-−](\d+)\b/, (_, n) => (del = +n, ''));
      s = s.replace(/\s*\((new|added|deleted|removed|renamed|moved|modified|changed)\)/i, (_, t) => (tag = t.toLowerCase(), ''));
      if (paths && (m = /^([AMDR?])\s+(\S.*)$/.exec(s.trim()))) { tag = { A: 'new', M: 'modified', D: 'deleted', R: 'renamed', '?': 'new' }[m[1]]; s = m[2]; }
      return { name: s.trim(), add, del, note, tag, tone: tn, kids: [] };
    };
    const lines = body.split('\n').filter(l => l.trim());
    const paths = lines.every(l => !/^[\s│├└]/.test(l) || /^\d+\s+\d+\t/.test(l)) && lines.some(l => /\S\/\S/.test(l));
    let roots;
    if (paths) {
      roots = [];
      for (const l of lines) {
        const f = meta(l, true), segs = f.name.split('/').filter(Boolean);
        let level = roots;
        segs.forEach((seg, i) => {
          let n = level.find(x => x.name === seg && (i < segs.length - 1) === !!x.dir);
          if (!n) { n = i < segs.length - 1 ? { name: seg, kids: [], dir: true } : Object.assign(f, { name: seg, dir: /\/$/.test(f.name) }); level.push(n); }
          level = n.kids;
        });
      }
      const squash = n => { while (n.dir && n.kids.length === 1 && n.kids[0].dir) { n.name += '/' + n.kids[0].name; n.kids = n.kids[0].kids; } n.kids.forEach(squash); };
      roots.forEach(squash);
    } else {
      const conv = n => Object.assign(meta(n.raw), { kids: n.kids.map(conv) });
      roots = nest(body).map(conv);
    }
    let files = 0, adds = 0, dels = 0;
    const sum = n => {
      n.dir ||= n.kids.length > 0 || /\/$/.test(n.name);
      if (n.dir && n.kids.length) { n.add = n.del = null; n.kids.forEach(k => { sum(k); if (k.add != null || k.del != null) { n.add += k.add || 0; n.del += k.del || 0; } }); }
      else if (n.add != null || n.del != null) { files++; adds += n.add || 0; dels += n.del || 0; }
    };
    roots.forEach(sum);
    const TAG = { new: 'ok', added: 'ok', deleted: 'bad', removed: 'bad', modified: 'info', changed: 'info', renamed: 'warn', moved: 'warn' };
    const stat = n => {
      if (n.add == null && n.del == null) return '';
      const a = n.add || 0, b = n.del || 0, k = a + b ? Math.max(a ? 1 : 0, Math.min(b ? 4 : 5, Math.round(5 * a / (a + b)))) : 0;
      return `<span class="ft-stat"><span class="add">+${a}</span><span class="del">−${b}</span><span class="ft-bar" aria-hidden="true">${[0, 1, 2, 3, 4].map(i => `<i class="${a + b ? (i < k ? 'a' : 'd') : ''}"></i>`).join('')}</span></span>`;
    };
    const line = n => `${n.dir ? icon('dir') : icon('file')}<span class="ft-name">${esc(n.name.replace(/\/$/, ''))}</span>${n.tag ? `<span class="badge" data-tone="${TAG[n.tag]}">${esc(n.tag)}</span>` : ''}${n.note ? `<span class="ft-note">${md(n.note)}</span>` : ''}${stat(n)}`;
    const ul = (ns, depth) => `<ul>${ns.map(n => n.dir && n.kids.length ? `<li><details${depth < (+o.depth || 99) ? ' open' : ''}><summary class="ft-row"${tonal(n.tone)}>${line(n)}</summary>${ul(n.kids, depth + 1)}</details></li>` : `<li><div class="ft-row${n.dir ? ' ft-dir' : ''}"${tonal(n.tone)}>${line(n)}</div></li>`).join('')}</ul>`;
    return `<figure class="filetree">${ul(roots, 1)}${files ? `<p class="ft-total ft-stat">${esc(say('files', { n: files }))} <span class="add">+${adds}</span><span class="del">−${dels}</span></p>` : ''}${o.title ? `<figcaption class="ft-total">${md(o.title)}</figcaption>` : ''}</figure>`;
  };
  B.filetree.ownTitle = true;

  B.cells = (body, o) => {
    const rs = rows(body).map(r => ({ name: r.f[0], size: Math.max(1, num(r.f[1]) || 1), text: r.f[1] || '', note: r.f[2] || '', tone: r.tone }));
    const total = rs.reduce((s, r) => s + r.size, 0), unit = o.unit || '';
    const scale = !o.per && total > 96 ? 96 / total : 1, per = +o.per || Math.round(total * scale) || 1;
    let at = 0, col = 0, html = '';
    rs.forEach(r => {
      r.at = at; at += r.size;
      let left = Math.max(1, Math.round(r.size * scale)), first = true;
      while (left > 0) {
        const w = Math.min(left, per - col);
        html += `<div class="cell${first ? '' : ' cont'}" style="--w:${w}"${tonal(r.tone)} title="${esc(`${r.name}: ${r.text} ${unit}`)}"><b>${first ? md(r.name) : '…'}</b>${first ? `<span>${esc(r.text)}</span>` : ''}</div>`;
        left -= w; col = (col + w) % per; first = false;
      }
    });
    const fig = el(`<figure class="cells"><div class="cells-strip" style="--per:${per}" aria-hidden="true">${html}</div><details class="data"${rs.some(r => r.note) ? ' open' : ''}><summary>${esc(L.data)}</summary><div class="scroll"><table><thead><tr><th>${esc(L.field)}</th><th class="num">${esc(L.offset)}</th><th class="num">${esc(L.size)}</th><th></th></tr></thead><tbody>${rs.map(r => `<tr><td><i class="sw"${tonal(r.tone || 'c1')}></i> ${md(r.name)}</td><td class="num">${fmt(r.at)}</td><td class="num">${esc(r.text)}${unit ? ' ' + esc(unit) : ''}</td><td>${md(r.note)}</td></tr>`).join('')}</tbody></table></div></details></figure>`);
    onSize(fig, () => $$('.cell', fig).forEach(c => c.classList.toggle('tiny', c.clientWidth < 30)));
    return fig;
  };

  B.quadrant = (body, o) => {
    const max = +o.max || 10, q = String(o.q || '').split(/\s*,\s*/), ax = s => String(s || '').split(/\s*->\s*/);
    const [xl, xh = ''] = ax(o.x), [yl, yh = ''] = ax(o.y);
    const pts = rows(body).map(r => ({ label: r.f[0], x: Math.max(0, Math.min(1, num(r.f[1]) / max)), y: Math.max(0, Math.min(1, num(r.f[2]) / max)), tone: r.tone }));
    return `<figure class="quad"><div class="quad-wrap"><div class="quad-y"><span>${md(yl)}</span><span>${md(yh)}</span></div><div class="quad-box">${['top:0;left:0', 'top:0;right:0;text-align:end', 'bottom:0;left:0', 'bottom:0;right:0;text-align:end'].map((p, i) => q[i] ? `<span class="quad-q" style="${p}">${md(q[i])}</span>` : '').join('')}${pts.map(p => `<span class="quad-pt${p.x > 0.62 ? ' flip' : ''}" style="--x:${(0.04 + p.x * 0.92).toFixed(3)};--y:${(0.05 + p.y * 0.9).toFixed(3)}"${tonal(p.tone)}><i></i><span>${md(p.label)}</span></span>`).join('')}</div><div class="quad-x"><span>${md(xl)}</span><span>${md(xh)}</span></div></div></figure>`;
  };
  B.risk = body => {
    const rs = rows(body).map((r, i) => ({ n: i + 1, label: r.f[0], l: Math.max(1, Math.min(5, Math.round(num(r.f[1])) || 1)), i: Math.max(1, Math.min(5, Math.round(num(r.f[2])) || 1)), note: r.f[3] || '' }));
    const level = s => s >= 15 ? ['bad', L.critical] : s >= 10 ? ['warn', L.high] : s >= 5 ? ['c4', L.medium] : ['ok', L.low];
    return `<figure class="risk"><table><thead><tr><td></td><th colspan="5" scope="colgroup">${esc(L.impact)} →</th></tr></thead><tbody>${[5, 4, 3, 2, 1].map(l => `<tr><th scope="row"><span class="sr">${esc(L.likelihood)} </span>${l}</th>${[1, 2, 3, 4, 5].map(i => `<td data-tone="${level(l * i)[0]}">${rs.filter(r => r.l === l && r.i === i).map(r => `<b>${r.n}</b>`).join('')}</td>`).join('')}</tr>`).join('')}</tbody><tfoot><tr><th scope="row">↑</th>${[1, 2, 3, 4, 5].map(i => `<th scope="col"><span class="sr">${esc(L.impact)} </span>${i}</th>`).join('')}</tr></tfoot></table><ol class="risk-list">${rs.map(r => `<li><b>${md(r.label)}</b> <span class="badge" data-tone="${level(r.l * r.i)[0] === 'c4' ? 'warn' : level(r.l * r.i)[0]}">${esc(level(r.l * r.i)[1])} ${r.l * r.i}</span><small>${esc(L.likelihood)} ${r.l} × ${esc(L.impact)} ${r.i}${r.note ? '. ' + md(r.note) : ''}</small></li>`).join('')}</ol></figure>`;
  };

  B.sankey = (body, o) => {
    const { nodes, edges } = parseGraph(body.split('\n').map(l => l.replace(/:\s*([^:]+)$/, ': $1')).join('\n'));
    const links = edges.map(e => ({ a: e.a, b: e.b, v: num(e.label) || 0, text: e.label })).filter(l => l.v > 0);
    if (!links.length) throw new Error('needs lines like "From -> To: 30"');
    const ids = [...nodes.keys()], layer = new Map(ids.map(k => [k, 0]));
    for (let pass = 0; pass < ids.length; pass++) links.forEach(l => { if (layer.get(l.b) < layer.get(l.a) + 1) layer.set(l.b, layer.get(l.a) + 1); });
    const depth = Math.max(...layer.values()) + 1, cols = Array.from({ length: depth }, () => []);
    ids.forEach((k, i) => { const n = nodes.get(k); n.id = k; n.c = i < 8 ? 'c' + (i + 1) : 'muted'; n.in = links.filter(l => l.b === k); n.out = links.filter(l => l.a === k); n.v = Math.max(n.in.reduce((s, l) => s + l.v, 0), n.out.reduce((s, l) => s + l.v, 0)); cols[layer.get(k)].push(n); });
    const fig = el(`<figure class="sankey"><div class="plate"><svg role="img" aria-label="${esc(o.title || links.map(l => `${l.a} to ${l.b}: ${l.text}`).join('; '))}"></svg></div>${dataTable([L.from, L.to, L.value], links.map(l => [l.a, l.b, l.text]))}${o.title ? `<figcaption>${md(o.title)}</figcaption>` : ''}</figure>`);
    const svg = fig.querySelector('svg'), plate = svg.parentElement;
    onSize(plate, () => {
      const cs = getComputedStyle(plate), W = plate.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight), gap = 14, nw = 10;
      const H = Math.max(200, Math.min(460, Math.max(...cols.map(c => c.length)) * 54)), ky = Math.min(...cols.map(c => (H - (c.length - 1) * gap) / c.reduce((s, n) => s + n.v, 0)));
      svg.setAttribute('width', W); svg.setAttribute('height', H); svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
      svg.replaceChildren();
      cols.forEach((c, i) => {
        let y = (H - c.reduce((s, n) => s + n.v * ky, 0) - (c.length - 1) * gap) / 2;
        c.forEach(n => { n.x = depth > 1 ? i * (W - nw) / (depth - 1) : 0; n.y = y; n.h = Math.max(2, n.v * ky); n.oy = n.iy = y; y += n.h + gap; });
      });
      cols.flat().forEach(n => { n.out.sort((p, q) => nodes.get(p.b).y - nodes.get(q.b).y); n.in.sort((p, q) => nodes.get(p.a).y - nodes.get(q.a).y); });
      links.forEach(l => { l.w = Math.max(1, l.v * ky); });
      cols.flat().forEach(n => n.out.forEach(l => { l.y1 = n.oy + l.w / 2; n.oy += l.w; }));
      cols.flat().forEach(n => n.in.forEach(l => { l.y2 = n.iy + l.w / 2; n.iy += l.w; }));
      links.forEach(l => {
        const a = nodes.get(l.a), b = nodes.get(l.b), x1 = a.x + nw, x2 = b.x, mx = (x1 + x2) / 2;
        const p = svgEl('path', { class: 'link', d: `M${x1} ${l.y1}C${mx} ${l.y1} ${mx} ${l.y2} ${x2} ${l.y2}`, 'stroke-width': l.w, 'data-tone': a.c });
        p.append(svgEl('title', {}, `${l.a} → ${l.b}: ${l.text}`));
        svg.append(p);
      });
      cols.flat().forEach(n => {
        const end = layer.get(n.id) === depth - 1 && depth > 1;
        svg.append(svgEl('rect', { x: n.x, y: n.y, width: nw, height: n.h, rx: 2, 'data-tone': n.c }));
        const tx = end ? n.x - 6 : n.x + nw + 6, tight = depth > 1 && (W - nw) / (depth - 1) < 170;
        const t = svgEl('text', { x: tx, y: n.y + n.h / 2, dy: tight ? '-0.25em' : '0.35em', 'text-anchor': end ? 'end' : 'start' }, n.id + ' ');
        t.append(svgEl('tspan', tight ? { class: 'v', x: tx, dy: '1.15em' } : { class: 'v' }, fmt(n.v)));
        svg.append(t);
      });
    });
    return fig;
  };
  B.sankey.ownTitle = true;

  const squarify = (list, x, y, w, h) => {
    const total = list.reduce((s, i) => s + i.v, 0);
    if (!total || w <= 0 || h <= 0) return;
    const scale = w * h / total;
    let rest = [...list].sort((a, b) => b.v - a.v);
    while (rest.length) {
      const short = Math.min(w, h);
      let n = 0, sum = 0, best = Infinity;
      while (n < rest.length) {
        const s2 = sum + rest[n].v * scale;
        const worst = Math.max(...rest.slice(0, n + 1).map(r => { const a = r.v * scale; return Math.max(short * short * a / (s2 * s2), s2 * s2 / (short * short * a)); }));
        if (worst > best) break;
        best = worst; sum = s2; n++;
      }
      const thick = sum / short;
      let off = 0;
      rest.slice(0, n).forEach(r => { const len = r.v * scale / thick; Object.assign(r, w >= h ? { x, y: y + off, w: thick, h: len } : { x: x + off, y, w: len, h: thick }); off += len; });
      if (w >= h) { x += thick; w -= thick; } else { y += thick; h -= thick; }
      rest = rest.slice(n);
    }
  };
  B.treemap = (body, o) => {
    const conv = n => { const r = row(n.raw), kids = n.kids.map(conv); return { label: r.f[0], text: r.f[1] || '', kids, v: kids.length ? kids.reduce((s, k) => s + k.v, 0) : num(r.f[1]) || 0, tone: r.tone }; };
    const roots = nest(body).map(conv).filter(n => n.v > 0), grouped = roots.some(n => n.kids.length);
    roots.forEach((n, i) => { n.c = n.tone || (grouped ? (i < 8 ? 'c' + (i + 1) : 'muted') : 'c1'); n.kids.forEach(k => { k.c = k.tone || n.c; }); });
    const shown = n => !n.text || /^[\d.]+$/.test(n.text) ? fmt(n.v) : n.text;
    const flat = roots.flatMap(n => n.kids.length ? n.kids.map(k => [n.label + ' / ' + k.label, shown(k)]) : [[n.label, shown(n)]]);
    const fig = el(`<figure class="treemap"><div class="tm-box" role="img" aria-label="${esc(o.title || flat.map(r => r.join(' ')).join(', '))}"></div>${dataTable(['', L.value], flat)}${o.title ? `<figcaption>${md(o.title)}</figcaption>` : ''}</figure>`);
    const box = fig.firstElementChild;
    onSize(box, W => {
      const H = box.clientHeight;
      squarify(roots, 0, 0, W, H);
      let html = '';
      const cell = (n, lab) => { const w = n.w - 2, h = n.h - 2; if (w < 3 || h < 3) return ''; return `<div class="tm-cell" style="left:${n.x + 1}px;top:${n.y + 1}px;width:${w}px;height:${h}px"${tonal(n.c)} title="${esc(lab + ': ' + shown(n))}">${w > 52 && h > 22 ? `<b>${md(n.label)}</b>` : ''}${w > 52 && h > 40 ? `<span>${esc(shown(n))}</span>` : ''}</div>`; };
      roots.forEach(n => {
        if (!n.kids.length) { html += cell(n, n.label); return; }
        const head = n.h > 60 && n.w > 60 ? 18 : 0;
        if (head) html += `<div class="tm-group" style="left:${n.x + 1}px;top:${n.y}px;width:${n.w - 2}px">${md(n.label)} · ${esc(shown(n))}</div>`;
        squarify(n.kids, n.x, n.y + head, n.w, n.h - head);
        n.kids.forEach(k => { html += cell(k, n.label + ' / ' + k.label); });
      });
      box.innerHTML = html;
    });
    return fig;
  };
  B.treemap.ownTitle = true;

  B.gantt = (body, o) => {
    const DAY = 864e5;
    const parseT = s => {
      s = String(s || '').trim();
      let m;
      if ((m = /^(\d{4})-(\d\d)-(\d\d)$/.exec(s))) return { t: Date.UTC(m[1], m[2] - 1, m[3]), date: 1, span: DAY };
      if ((m = /^(\d{4})-(\d\d)$/.exec(s))) return { t: Date.UTC(m[1], m[2] - 1, 1), date: 1, span: Date.UTC(m[1], m[2], 1) - Date.UTC(m[1], m[2] - 1, 1) };
      if ((m = /^(\d{4})-?Q([1-4])$/i.exec(s))) return { t: Date.UTC(m[1], (m[2] - 1) * 3, 1), date: 1, span: Date.UTC(m[1], m[2] * 3, 1) - Date.UTC(m[1], (m[2] - 1) * 3, 1) };
      return isNaN(num(s)) ? null : { t: num(s), span: 0 };
    };
    const tasks = [];
    sections(body).forEach(s => {
      if (s.title) tasks.push({ group: s.title });
      s.lines.filter(l => l.trim()).forEach(l => {
        const r = row(l), a = parseT(r.f[1]);
        if (!a) throw new Error(`"${r.f[0]}" needs a start: a date (2026-03-01, 2026-03, 2026-Q1) or a number`);
        let end = null;
        const rel = /^\+\s*([\d.]+)\s*([dwm]?)$/i.exec(r.f[2] || ''), b = rel ? null : parseT(r.f[2]);
        if (rel) end = a.t + rel[1] * (a.date ? { d: DAY, w: 7 * DAY, m: 30.44 * DAY }[rel[2].toLowerCase() || 'd'] : 1);
        else if (b) end = b.t + b.span;
        tasks.push({ label: r.f[0].trim(), indent: Math.floor(r.indent / 2), start: a.t, end, date: a.date, tone: r.tone, text: [r.f[1], r.f[2]].filter(Boolean).join(' → ') });
      });
    });
    const real = tasks.filter(t => !t.group), isDate = real.some(t => t.date);
    let lo = Math.min(...real.map(t => t.start)), hi = Math.max(...real.map(t => t.end ?? t.start));
    const today = o.today === true ? Date.now() : o.today ? parseT(o.today)?.t : null;
    if (hi === lo) hi = lo + (isDate ? 30 * DAY : 1);
    const pad = (hi - lo) * 0.02; hi += pad; if (real.some(t => t.end == null && t.start === lo)) lo -= pad;
    const X = t => ((t - lo) / (hi - lo)).toFixed(4);
    const ticks = [];
    if (isDate) {
      const days = (hi - lo) / DAY, loc = root.lang || undefined, f = opt => new Intl.DateTimeFormat(loc, { timeZone: 'UTC', ...opt });
      const dt = new Date(lo);
      if (days <= 100) {
        const step = days <= 16 ? 1 : days <= 45 ? 7 : 14;
        for (let t = Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth(), dt.getUTCDate()); t <= hi; t += step * DAY) if (t >= lo) ticks.push([t, f({ month: 'short', day: 'numeric' }).format(t)]);
      } else {
        const step = days <= 400 ? 1 : days <= 1100 ? 3 : 12;
        for (let y = dt.getUTCFullYear(), m = Math.floor(dt.getUTCMonth() / step) * step; ; m += step) { const t = Date.UTC(y, m, 1); if (t > hi) break; if (t >= lo) { const jan = new Date(t).getUTCMonth() === 0; ticks.push([t, step === 12 ? f({ year: 'numeric' }).format(t) : f(jan || !ticks.length ? { month: 'short', year: '2-digit' } : { month: 'short' }).format(t)]); } }
      }
    } else {
      const raw = (hi - lo) / 6, mag = 10 ** Math.floor(Math.log10(raw)), step = [1, 2, 5, 10].find(s => s * mag >= raw) * mag;
      for (let t = Math.ceil(lo / step) * step; t <= hi; t += step) ticks.push([t, fmt(+t.toPrecision(10)) + (o.unit ? ' ' + o.unit : '')]);
    }
    const every = Math.ceil(ticks.length / 7);
    const bg = [...ticks.map(([t]) => `linear-gradient(var(--line),var(--line)) ${(X(t) * 100).toFixed(2)}% 0 / 1px 100% no-repeat`), ...(today != null && today >= lo && today <= hi ? [`linear-gradient(var(--bad),var(--bad)) ${(X(today) * 100).toFixed(2)}% 0 / 2px 100% no-repeat`] : [])];
    return `<figure class="gantt"><div class="gantt-grid" style="--ticks:${bg.length ? bg.reverse().join(',') : 'none'}"><div class="gantt-axis" aria-hidden="true">${ticks.map(([t, text], i) => i % every ? '' : `<span${X(t) > 0.82 ? ' class="end"' : ''} style="--x:${X(t)}">${esc(text)}</span>`).join('')}</div>${tasks.map(t => t.group ? `<div class="gantt-group">${md(t.group)}</div>` : `<div class="gantt-label" style="--in:${t.indent}">${md(t.label)}<span class="sr"> ${esc(t.text)}</span></div><div class="gantt-track"><i class="gantt-bar${t.end == null ? ' mile' : ''}" style="--x:${X(t.start)};--w:${t.end == null ? 0 : X(t.end) - X(t.start)}"${tonal(t.tone)} title="${esc(t.label + ': ' + t.text)}"></i></div>`).join('')}</div></figure>`;
  };

  /* ---------- code ---------- */
  const KW = 'abstract as async await break case catch class const continue def default defer del delete do elif else enum except export extends final finally fn for from func function go if impl implements import in instanceof interface is let match mod module mut new not of or and package pass private protected pub public raise return select self static struct super switch this throw trait try type typeof use var void when where while with yield lambda null nil None true false True False undefined';
  const SQL = 'select from where insert into values update set delete create table index view drop alter add column primary key foreign references join left right inner outer on group by order having limit offset union all distinct as and or not null is in like between exists case when then else end begin commit rollback with returning default unique constraint cascade';
  const highlight = (code, lang) => {
    if (!lang || /^(text|txt|plain|viz|output|console|csv|tsv|md|markdown)$/.test(lang)) return esc(code);
    const hash = /^(py|python|rb|ruby|sh|bash|zsh|fish|yaml|yml|toml|ini|conf|env|properties|dockerfile|docker|makefile|make|cmake|r|perl|pl|nginx|tf|hcl|terraform|elixir|ex|ps1|powershell|graphql|gql|nix|julia|jl)$/.test(lang);
    const sql = lang === 'sql', markup = /^(html|xml|svg|vue|svelte|astro)$/.test(lang), yaml = /^(yaml|yml)$/.test(lang);
    const kw = sql ? SQL + ' ' + SQL.toUpperCase() : KW;
    const re = new RegExp([
      markup ? '<!--[^]*?-->' : hash ? '(?<=^|\\s)#.*' : sql || /^(lua|haskell|hs)$/.test(lang) ? '--.*|/\\*[^]*?\\*/' : '(?<![:\\w\\\\])//.*|/\\*[^]*?\\*/',
      '"(?:\\\\.|[^"\\\\\\n])*"|\'(?:\\\\.|[^\'\\\\\\n])*\'|`(?:\\\\.|[^`\\\\])*`',
      '\\b(?:0x[\\da-fA-F_]+|\\d[\\d_]*(?:\\.\\d+)?(?:e[+-]?\\d+)?)\\b',
      markup ? '</?[\\w:-]+|/?>' : '\\b(?:' + kw.split(' ').join('|') + ')\\b',
      markup ? '[\\w:@-]+(?==)' : yaml ? '^[ \\t-]*[\\w./-]+(?=:(?: |$))' : '\\b[A-Za-z_]\\w*(?=\\()',
      '\\b[A-Z][a-z0-9]+[A-Za-z0-9]*\\b',
    ].map(p => '(' + p + ')').join('|'), 'gm');
    const cls = ['cmt', 'str', 'num', 'kw', 'fn', 'type'];
    let out = '', last = 0;
    for (const m of code.matchAll(re)) {
      let k = m.slice(1).findIndex(x => x !== undefined);
      if (k === 1 && /^json/.test(lang) && /^\s*:/.test(code.slice(m.index + m[0].length))) k = 4;
      out += esc(code.slice(last, m.index)) + m[0].split('\n').map(p => `<span class="t-${cls[k]}">${esc(p)}</span>`).join('\n');
      last = m.index + m[0].length;
    }
    return out + esc(code.slice(last));
  };
  const ranges = (spec, max) => {
    const out = new Set();
    for (const part of String(spec || '').split(/[\s,]+/)) {
      const m = /^(\d+)(?:-(\d+))?$/.exec(part);
      if (m) for (let n = +m[1]; n <= Math.min(+(m[2] || m[1]), max); n++) out.add(n);
    }
    return out;
  };
  B.code = (body, o, name) => {
    const lang = name === 'code' ? String(o.lang || o._[0] || '') : name;
    let src = body.replace(/\n+$/, ''), notes = [];
    if (o.notes) { const cut = src.split(/^---+\s*$/m); if (cut.length > 1) { notes = cut.pop().trim().split('\n').map(l => /^([\d,\s-]+):\s*(.*)$/.exec(l.trim())).filter(Boolean); src = cut.join('---').replace(/\n+$/, ''); } }
    const lines = highlight(src, lang).split('\n'), hl = ranges(o.hl, lines.length), marks = new Map();
    notes.forEach((n, k) => { const r = [...ranges(n[1], lines.length)]; r.forEach(x => hl.add(x)); if (r.length) marks.set(r[0], k + 1); });
    const fig = el(`<figure class="code${o.nums || notes.length ? ' nums' : ''}">${o.title || lang ? `<figcaption>${esc(o.title || lang)}</figcaption>` : ''}<pre><code>${lines.map((l, i) => `<span class="ln${hl.has(i + 1) ? ' hl' : ''}" data-n="${i + 1}">${l || ' '}${marks.has(i + 1) ? `<span class="mark" aria-hidden="true">${marks.get(i + 1)}</span>` : ''}</span>`).join('')}</code></pre>${notes.length ? `<ol class="code-notes">${notes.map(n => `<li>${md(n[2])}</li>`).join('')}</ol>` : ''}</figure>`);
    fig.querySelector('pre').before(copyBtn(() => src));
    return fig;
  };
  B.code.ownTitle = true;
  B.diff = (body, o) => {
    const lines = body.replace(/\n+$/, '').split('\n'), kind = l => /^@@/.test(l) ? 'hunk' : /^\+(?!\+\+ )/.test(l) ? 'add' : /^-(?!-- )/.test(l) ? 'del' : '';
    const add = lines.filter(l => kind(l) === 'add').length, del = lines.filter(l => kind(l) === 'del').length;
    const fig = el(`<figure class="code diff"><figcaption><span>${esc(o.title || 'diff')}</span><span class="add">+${add}</span><span class="del">−${del}</span></figcaption><pre><code>${lines.map(l => `<span class="ln ${kind(l)}">${esc(l) || ' '}</span>`).join('')}</code></pre></figure>`);
    fig.querySelector('pre').before(copyBtn(() => body));
    return fig;
  };
  B.diff.ownTitle = true;
  B.terminal = (body, o) => {
    const lines = body.replace(/\n+$/, '').split('\n').map(l => {
      const m = /^([$#>%❯])\s(.*)$/.exec(l);
      if (m && m[1] !== '#') return { cmd: m[2], html: `<span class="prompt">${esc(m[1])} </span><span class="cmd">${esc(m[2])}</span>` };
      if (m) return { html: `<span class="cmt">${esc(l)}</span>` };
      const c = /^\s*(✓|✔|ok\b|pass(ed)?\b|success)/i.test(l) ? 'good' : /^\s*(✗|✘|error|ERR!|fail(ed)?\b|fatal|panic)/i.test(l) ? 'fail' : /^\s*(warn(ing)?\b|⚠)/i.test(l) ? 'caution' : '';
      return { html: c ? `<span class="${c}">${esc(l)}</span>` : esc(l) };
    });
    const fig = el(`<figure class="terminal"><figcaption>${esc(o.title || 'terminal')}</figcaption><pre><code>${lines.map(l => `<span class="ln">${l.html || ' '}</span>`).join('')}</code></pre></figure>`);
    const pre = fig.querySelector('pre'), rowsEl = $$('.ln', fig);
    pre.before(copyBtn(() => lines.filter(l => l.cmd).map(l => l.cmd).join('\n') || body));
    if (o.replay) {
      let token = 0;
      const again = el(`<button type="button" class="copy">${esc(L.replay)}</button>`);
      again.addEventListener('click', async () => {
        const mine = ++token, wait = ms => new Promise(ok => setTimeout(ok, ms));
        if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
        pre.style.minHeight = pre.offsetHeight + 'px';
        rowsEl.forEach(r => { r.hidden = true; });
        for (let i = 0; i < lines.length && mine === token; i++) {
          const r = rowsEl[i], cmd = r.querySelector('.cmd');
          r.hidden = false;
          if (cmd) {
            cmd.textContent = ''; cmd.classList.add('typing');
            for (const ch of lines[i].cmd) { if (mine !== token) break; cmd.textContent += ch; await wait(28); }
            cmd.classList.remove('typing'); cmd.textContent = lines[i].cmd;
            await wait(320);
          } else await wait(70);
        }
        if (mine === token) rowsEl.forEach(r => { r.hidden = false; });
      });
      pre.before(again);
    }
    return fig;
  };
  B.terminal.ownTitle = true;
  B.log = (body, o) => {
    const LV = { fatal: 'error', error: 'error', err: 'error', crit: 'error', critical: 'error', warn: 'warn', warning: 'warn', info: 'info', notice: 'info', debug: 'debug', trace: 'debug' };
    const lines = body.replace(/\n+$/, '').split('\n').map(l => {
      const ts = /^\[?\d{4}-\d\d-\d\d[T ][\d:.,]+(?:Z|[+-]\d\d:?\d\d)?\]?|^\[?\d\d:\d\d:\d\d(?:[.,]\d+)?\]?/.exec(l);
      const rest = ts ? l.slice(ts[0].length) : l, lv = /\b(FATAL|ERROR|ERR|CRIT(?:ICAL)?|WARN(?:ING)?|INFO|NOTICE|DEBUG|TRACE)\b|\blevel=(\w+)/.exec(rest);
      const level = lv ? LV[(lv[1] || lv[2]).toLowerCase()] || '' : '';
      return { level, html: (ts ? `<span class="ts">${esc(ts[0])}</span>` : '') + (lv && level ? esc(rest.slice(0, lv.index)) + `<span class="lv">${esc(lv[0])}</span>` + esc(rest.slice(lv.index + lv[0].length)) : esc(rest)) };
    });
    const levels = ['error', 'warn', 'info', 'debug'].filter(v => lines.some(l => l.level === v));
    const fig = el(`<figure class="log">${levels.length > 1 ? `<div class="log-bar"><button type="button" aria-pressed="true" data-lv="">${esc(L.all)} ${lines.length}</button>${levels.map(v => `<button type="button" aria-pressed="false" data-lv="${v}">${v} ${lines.filter(l => l.level === v).length}</button>`).join('')}</div>` : ''}<div class="log-lines" tabindex="0" role="log" aria-label="${esc(o.title || 'log')}">${lines.map(l => `<div class="ll" data-lv="${l.level}">${l.html || ' '}</div>`).join('')}</div>${o.title ? `<figcaption style="padding:0 0.9rem 0.6rem">${md(o.title)}</figcaption>` : ''}</figure>`);
    $$('.log-bar button', fig).forEach(b => b.addEventListener('click', () => {
      $$('.log-bar button', fig).forEach(x => x.setAttribute('aria-pressed', String(x === b)));
      $$('.ll', fig).forEach(l => { l.hidden = !!b.dataset.lv && l.dataset.lv !== b.dataset.lv; });
    }));
    return fig;
  };
  B.log.ownTitle = true;
  B.json = (body, o, name) => {
    let data;
    try { data = JSON.parse(body); } catch (e) { if (name === 'json') return B.code(body, o, 'jsonc'); throw new Error('invalid JSON: ' + e.message); }
    const open = o.open === true ? 99 : +(o.open ?? 2);
    const node = (key, v, depth, last) => {
      const k = key === null ? '' : `<span class="j-key">${esc(JSON.stringify(key))}</span>: `, comma = last ? '' : ',';
      if (v === null || typeof v !== 'object') return `<div class="jl jk">${k}<span class="j-${v === null ? 'null' : typeof v}">${esc(JSON.stringify(v))}</span>${comma}</div>`;
      const arr = Array.isArray(v), keys = Object.keys(v), [a, b] = arr ? '[]' : '{}';
      if (!keys.length) return `<div class="jl jk">${k}${a}${b}${comma}</div>`;
      return `<details${depth < open ? ' open' : ''}><summary>${k}${a}<span class="j-count">${keys.length} ${arr ? 'items' : 'keys'} ${b}${comma}</span></summary>${keys.map((x, i) => node(arr ? null : x, v[x], depth + 1, i === keys.length - 1)).join('')}<div class="jl j-end">${b}${comma}</div></details>`;
    };
    const fig = el(`<figure class="fig"><div class="json" tabindex="0" role="group" aria-label="${esc(o.title || 'JSON')}">${node(null, data, 0, true)}</div>${o.title ? `<figcaption>${md(o.title)}</figcaption>` : ''}</figure>`);
    return fig;
  };
  B.json.ownTitle = true;
  B.api = (body, o) => {
    const eps = [];
    let cur, code = false;
    for (const raw of body.split('\n')) {
      const m = /^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS|WS|SSE|RPC|GRPC|EVENT|QUERY|MUTATION)\s+(\S+)\s*(?:\|\s*(.*))?$/.exec(raw);
      if (m) { eps.push(cur = { method: m[1], path: m[2], sum: m[3] || '', meta: [], params: [], resp: [], code: [] }); code = false; continue; }
      if (!cur) continue;
      if (code) { cur.code.push(raw); continue; }
      if (/^---+\s*$/.test(raw)) { code = true; continue; }
      if (!raw.trim()) continue;
      const f = pipes(raw), kv = /^([\w -]+):\s+(.*)$/.exec(raw.trim());
      if (/^[1-5](\d\d|xx)$/i.test(f[0])) cur.resp.push(f);
      else if (f.length === 1 && kv) cur.meta.push([kv[1], kv[2]]);
      else cur.params.push(f);
    }
    if (!eps.length) throw new Error('needs a line like "GET /path | summary"');
    const M = { GET: 'info', POST: 'ok', PUT: 'warn', PATCH: 'warn', DELETE: 'bad' }, S = { 1: 'info', 2: 'ok', 3: 'info', 4: 'warn', 5: 'bad' };
    const pcell = c => /^required$/i.test(c) ? `<span class="badge" data-tone="bad">${esc(c)}</span>` : /^(optional|path|query|body|header|cookie)$/i.test(c) ? `<span class="badge">${esc(c)}</span>` : md(c);
    return `<div class="api">${eps.map((e, i) => {
      const ex = e.code.join('\n').trim();
      const inner = (e.meta.length ? `<dl class="kv">${e.meta.map(([k, v]) => `<div><dt>${md(k)}</dt><dd>${md(v)}</dd></div>`).join('')}</dl>` : '') +
        (e.params.length ? `<div><h5>${esc(L.params)}</h5><div class="scroll"><table><tbody>${e.params.map(p => `<tr>${p.map((c, j) => `<td>${j ? pcell(c) : esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div></div>` : '') +
        (e.resp.length ? `<div><h5>${esc(L.responses)}</h5><div class="scroll"><table><tbody>${e.resp.map(r => `<tr><td><span class="badge" data-tone="${S[r[0][0]]}">${esc(r[0])}</span></td><td>${md(r.slice(1).join(' | '))}</td></tr>`).join('')}</tbody></table></div></div>` : '') +
        (ex ? `<div><h5>${esc(L.example)}</h5><pre tabindex="0"><code>${highlight(ex, 'json').split('\n').map(l => `<span class="ln">${l || ' '}</span>`).join('')}</code></pre></div>` : '');
      return `<details class="endpoint"${!i || o.open ? ' open' : ''}><summary><span class="method" data-tone="${M[e.method] || 'muted'}">${e.method}</span><code class="path">${esc(e.path)}</code><span class="api-sum">${md(e.sum)}</span></summary>${inner ? `<div class="api-body">${inner}</div>` : ''}</details>`;
    }).join('')}</div>`;
  };
  B.commits = (body, o) => {
    const cs = rows(body).map(r => {
      const hashed = /^[0-9a-f]{6,40}$/i.test(r.f[0]), f = hashed ? r.f : ['', ...r.f];
      const [branch, from] = (f[2] || 'main').split(/\s*<\s*/);
      return { hash: f[0], msg: f[1] || '', branch: branch || 'main', from, meta: f[3] || '' };
    });
    const lanes = [];
    cs.forEach(c => { if (!lanes.includes(c.branch)) lanes.push(c.branch); });
    cs.forEach(c => { if (c.from && !lanes.includes(c.from)) lanes.push(c.from); });
    const base = lanes.includes('main') ? 'main' : lanes.includes('master') ? 'master' : cs[cs.length - 1].branch;
    lanes.splice(lanes.indexOf(base), 1); lanes.unshift(base);
    const H = 36, G = 18, X = c => 10 + lanes.indexOf(c.branch) * G, Y = i => i * H + H / 2, W = 20 + (lanes.length - 1) * G;
    let svg = '';
    const curve = (i, j) => `<path d="M${X(cs[i])} ${Y(i)}C${X(cs[i])} ${(Y(i) + Y(j)) / 2} ${X(cs[j])} ${(Y(i) + Y(j)) / 2} ${X(cs[j])} ${Y(j)}" data-tone="${lanes.indexOf(cs[i].branch) ? 'c' + (lanes.indexOf(cs[i].branch) % 8 + 1) : 'c1'}"/>`;
    lanes.forEach((b, k) => {
      const idx = cs.map((c, i) => c.branch === b ? i : -1).filter(i => i >= 0);
      if (!idx.length) return;
      const tn = 'c' + (k % 8 + 1), first = idx[0], last = idx[idx.length - 1];
      if (last > first) svg += `<line x1="${10 + k * G}" y1="${Y(first)}" x2="${10 + k * G}" y2="${Y(last)}" data-tone="${tn}"/>`;
      if (k) { const parent = cs.findIndex((c, i) => i > last && c.branch === base); if (parent >= 0) svg += curve(last, parent); }
    });
    cs.forEach((c, i) => { if (!c.from) return; const src = cs.findIndex((x, j) => j > i && x.branch === c.from); if (src >= 0) svg += curve(src, i).replace(/data-tone="[^"]*"/, `data-tone="c${lanes.indexOf(c.from) % 8 + 1}"`); });
    cs.forEach((c, i) => { svg += `<circle cx="${X(c)}" cy="${Y(i)}" r="${c.from ? 5.5 : 4.5}" data-tone="c${lanes.indexOf(c.branch) % 8 + 1}"/>`; });
    const seen = new Set();
    return `<figure class="commits" style="--pad:${W}px"><svg width="${W}" height="${cs.length * H}" aria-hidden="true">${svg}</svg><ol>${cs.map(c => { const tip = !seen.has(c.branch); seen.add(c.branch); return `<li>${c.hash ? `<span class="c-hash">${esc(c.hash.slice(0, 7))}</span>` : ''}${tip ? `<span class="c-ref" data-tone="c${lanes.indexOf(c.branch) % 8 + 1}">${esc(c.branch)}</span>` : `<span class="sr">${esc(c.branch)}: </span>`}<span class="c-msg">${md(c.msg)}</span>${c.meta ? `<span class="c-meta">${md(c.meta)}</span>` : ''}</li>`; }).join('')}</ol></figure>`;
  };

  B.raw = body => { const box = d.createElement('div'); box.className = 'raw'; box.innerHTML = body; return box; };
  B.math = body => `<div class="math">${esc(body.trim())}</div>`;
  B.mermaid = body => { const pre = d.createElement('pre'); pre.className = 'mermaid'; pre.textContent = body; pre.dataset.src = body; return pre; };

  /* ---------- lazy libraries: math, mermaid ---------- */
  const scrollable = node => { if (node.scrollWidth > node.clientWidth + 1 && !node.hasAttribute('tabindex')) { node.tabIndex = 0; if (!node.hasAttribute('role')) { node.setAttribute('role', 'region'); node.setAttribute('aria-label', L.scroll); } } };
  const doMath = () => {
    const maths = $$('.math:not([data-tex])');
    maths.forEach(m => { m.dataset.tex = m.textContent.trim(); });
    if (maths.length) load('katex').then(katex => maths.forEach(m => run(() => {
      katex.render(m.dataset.tex, m, { displayMode: m.tagName !== 'SPAN', throwOnError: false });
      m.classList.add('rendered');
      if (m.tagName !== 'SPAN') fontsReady().then(() => scrollable(m));
    }))).catch(() => {});
  };
  const fitGraph = g => {
    const svg = g.querySelector('svg');
    if (!svg || !g.clientWidth) return;
    const natural = svg.viewBox.baseVal?.width || svg.getBoundingClientRect().width;
    svg.style.maxWidth = 'none';
    svg.style.width = (natural <= g.clientWidth ? natural : Math.max(g.clientWidth - 32, natural / 1.5)) + 'px';
  };
  let drawing = Promise.resolve();
  const drawGraphs = () => drawing = drawing.then(async () => {
    let todo = $$('pre.mermaid').filter(g => g.getClientRects().length && g.dataset.theme !== theme());
    if (!todo.length) return;
    const mermaid = await load('mermaid');
    await fontsReady();
    todo = todo.filter(g => g.getClientRects().length);
    if (!todo.length) return;
    const c = color;
    mermaid.initialize({
      startOnLoad: false, securityLevel: 'strict', theme: 'base', fontFamily: family('--font'),
      themeVariables: {
        darkMode: theme() === 'dark', fontFamily: family('--font'), fontSize: '14px', background: c('plate'), dropShadow: 'none',
        primaryColor: c('card'), primaryTextColor: c('text'), primaryBorderColor: c('line-strong'),
        secondaryColor: c('accent-soft'), secondaryTextColor: c('text'), secondaryBorderColor: c('accent'),
        tertiaryColor: c('sunk'), tertiaryTextColor: c('text'), tertiaryBorderColor: c('line'),
        mainBkg: c('card'), nodeBorder: c('line-strong'), lineColor: c('line-strong'), textColor: c('text'), titleColor: c('text'),
        clusterBkg: c('sunk'), clusterBorder: c('line'), edgeLabelBackground: c('plate'),
        noteBkgColor: c('warn-soft'), noteTextColor: c('text'), noteBorderColor: c('warn'),
        actorBkg: c('card'), actorBorder: c('line-strong'), actorTextColor: c('text'), actorLineColor: c('line-strong'),
        signalColor: c('text'), signalTextColor: c('text'), labelBoxBkgColor: c('card'), labelBoxBorderColor: c('line-strong'),
        labelTextColor: c('text'), loopTextColor: c('text'), activationBkgColor: c('accent-soft'), activationBorderColor: c('accent'),
        sequenceNumberColor: c('on-accent'), altBackground: c('sunk'), compositeBackground: c('card'), compositeTitleBackground: c('sunk'),
        attributeBackgroundColorOdd: c('card'), attributeBackgroundColorEven: c('sunk'),
        pieStrokeColor: c('card'), pieOuterStrokeColor: c('line'), pieTitleTextColor: c('text'), pieSectionTextColor: c('text'), pieLegendTextColor: c('text'),
        ...Object.fromEntries([1, 2, 3, 4, 5, 6, 7, 8].flatMap(i => [[`pie${i}`, c('c' + i)], [`git${i - 1}`, c('c' + i)], [`cScale${i - 1}`, c('c' + i)]])),
      },
    });
    for (const g of todo) {
      g.removeAttribute('data-processed');
      g.classList.remove('rendered');
      g.textContent = g.dataset.src;
      if (await mermaid.parse(g.dataset.src, { suppressErrors: true }) === false) g.dataset.processed = 'invalid';
    }
    await mermaid.run({ nodes: todo.filter(g => !g.dataset.processed), suppressErrors: true });
    todo.forEach(g => { g.dataset.theme = theme(); if (g.querySelector('svg')) { g.classList.add('rendered'); fitGraph(g); scrollable(g); } });
  }).catch(() => {});
  themed.push(drawGraphs);
  d.addEventListener('kit:shown', drawGraphs);
  d.addEventListener('toggle', () => d.dispatchEvent(new Event('kit:shown')), true);
  let resizeTimer;
  addEventListener('resize', () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(() => $$('pre.mermaid').forEach(fitGraph), 150); });

  /* ---------- page ---------- */
  const tips = () => {
    const tip = el('<div class="tip" id="kit-tip" role="tooltip" hidden></div>');
    d.body.append(tip);
    let owner = null, shownAt = 0;
    const place = () => {
      if (!owner) return;
      const r = owner.getBoundingClientRect(), t = tip.getBoundingClientRect();
      tip.style.left = Math.max(8, Math.min(r.left + r.width / 2 - t.width / 2, innerWidth - t.width - 8)) + 'px';
      tip.style.top = (r.bottom + 8 + t.height > innerHeight - 8 ? r.top - t.height - 8 : r.bottom + 8) + 'px';
    };
    const hide = () => { if (!owner) return; owner.removeAttribute('aria-describedby'); owner = null; tip.hidden = true; };
    const show = node => { if (owner === node) return; hide(); owner = node; shownAt = Date.now(); tip.textContent = node.dataset.tip; tip.hidden = false; node.setAttribute('aria-describedby', 'kit-tip'); place(); };
    const term = e => e.target.closest?.('.term[data-tip]');
    d.addEventListener('mouseover', e => { const t = term(e); if (t) show(t); else if (owner && d.activeElement !== owner) hide(); });
    d.addEventListener('focusin', e => { const t = term(e); if (t) show(t); else hide(); });
    d.addEventListener('click', e => { const t = term(e); if (!t) return hide(); if (owner === t && Date.now() - shownAt > 400) hide(); else show(t); });
    d.addEventListener('keydown', e => { if (e.key === 'Escape') hide(); });
    addEventListener('scroll', place, { passive: true });
  };
  const refresh = () => {
    doMath();
    drawGraphs();
    fontsReady().then(() => $$('.scroll, main pre, .json, div.math').forEach(scrollable));
  };
  const slug = (text, taken) => {
    const base = text.trim().toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '') || 'section';
    let id = base, n = 2;
    while (taken.has(id)) id = `${base}-${n++}`;
    taken.add(id);
    return id;
  };
  const boot = () => {
    root.classList.add('js');
    try { const saved = sessionStorage.getItem('kit-theme'); if (saved && !root.dataset.theme) root.dataset.theme = saved; } catch {}
    const srcs = $$('script[type="text/viz"]');
    let head = d.querySelector('.page-head'), main = d.querySelector('main');
    if (srcs.length) {
      const nodes = srcs.flatMap((s, k) => {
        const lines = s.textContent.replace(/^\n/, '').replace(/<\\\/script/gi, '</script').split('\n'), cut = Math.min(...lines.filter(l => l.trim()).map(l => l.match(/^\s*/)[0].length));
        return render(lines.map(l => l.slice(cut)).join('\n'), k ? 0 : +window.kitLine0 || 0);
      });
      if (!head) { head = el('<header class="page-head"></header>'); srcs[0].before(head); }
      if (!main) { main = d.createElement('main'); head.after(main); }
      if (nodes[0]?.tagName === 'H1') {
        head.append(nodes.shift());
        if (nodes[0]?.matches('figure.quote')) { const b = el('<div class="brief"></div>'); b.append(...nodes.shift().querySelector('blockquote').childNodes); $$('p', b).forEach(p => { p.style.margin = 0; }); head.append(b); }
      }
      let sec = el('<section class="lead"></section>');
      for (const n of nodes) {
        if (n.tagName === 'H2') { if (sec.childNodes.length) main.append(sec); sec = d.createElement('section'); }
        sec.append(n);
      }
      if (sec.childNodes.length) main.append(sec);
      if (!main.children.length) console.error('kit: the viz source rendered nothing');
    } else if (!main) console.error('kit: no <script type="text/viz"> source and no <main> found');
    if (!head) { head = el('<header class="page-head"></header>'); (main || d.body.firstChild).before(head); }
    const h1 = d.querySelector('h1');
    if (h1 && (!d.title.trim() || d.title === 'Title')) d.title = h1.textContent;
    const taken = new Set($$('[id]').map(n => n.id));
    const heads = $$('main h2');
    $$('main h2, main h3').forEach(h => { if (!h.id) h.id = slug(h.textContent, taken); });

    const tools = el('<div class="tools"></div>');
    const themeBtn = el('<button type="button"></button>');
    const paint = () => {
      const next = theme() === 'dark' ? 'light' : 'dark';
      themeBtn.innerHTML = icon(next);
      themeBtn.setAttribute('aria-label', next === 'dark' ? L.toDark : L.toLight);
      themeBtn.title = themeBtn.getAttribute('aria-label');
    };
    themeBtn.addEventListener('click', () => {
      root.dataset.theme = theme() === 'dark' ? 'light' : 'dark';
      try { sessionStorage.setItem('kit-theme', root.dataset.theme); } catch {}
      paint(); changed();
    });
    dark.addEventListener('change', () => { if (!root.dataset.theme) { paint(); changed(); } });
    paint();
    tools.append(themeBtn);
    head.append(tools);

    const sectionsEl = $$('main > section');
    if (sectionsEl.length > 1) {
      const btn = el(`<button type="button">${icon('present')}</button>`);
      const nav = el(`<nav class="slide-nav" aria-label="${esc(L.slides)}" hidden><button type="button" aria-label="${esc(L.prevSlide)}" title="${esc(L.prevSlide)}">${icon('left', 'flip')}</button><span class="slide-count" aria-live="polite"></span><button type="button" aria-label="${esc(L.nextSlide)}" title="${esc(L.nextSlide)}">${icon('right', 'flip')}</button><button type="button" class="exit" aria-label="${esc(L.exitPresent)}" title="${esc(L.exitPresent)}">${icon('close')}</button></nav>`);
      const [prev, count, next, exit] = nav.children, bar = el('<div class="slide-progress" hidden></div>');
      const deck = () => [head, ...sectionsEl];
      const at = () => { const s = deck(); let best = 0; s.forEach((n, i) => { if (Math.abs(n.getBoundingClientRect().top) < Math.abs(s[best].getBoundingClientRect().top)) best = i; }); return best; };
      let goal = null, timer;
      const mark = () => {
        const i = at(), n = deck().length;
        count.textContent = `${i + 1} / ${n}`;
        prev.setAttribute('aria-disabled', String(i === 0));
        next.setAttribute('aria-disabled', String(i === n - 1));
        bar.style.setProperty('--p', (i + 1) / n);
      };
      const go = (step, to) => {
        const s = deck();
        goal = Math.max(0, Math.min(to ?? (goal ?? at()) + step, s.length - 1));
        s[goal].scrollIntoView();
        clearTimeout(timer);
        timer = setTimeout(() => { goal = null; }, 600);
      };
      const set = on => {
        root.classList.toggle('slides', on);
        nav.hidden = bar.hidden = !on;
        btn.setAttribute('aria-pressed', String(on));
        btn.setAttribute('aria-label', on ? L.exitPresent : L.present);
        btn.title = btn.getAttribute('aria-label');
        if (on) mark();
        d.dispatchEvent(new Event('kit:shown'));
      };
      btn.addEventListener('click', () => set(!root.classList.contains('slides')));
      prev.addEventListener('click', () => go(-1));
      next.addEventListener('click', () => go(1));
      exit.addEventListener('click', () => { set(false); btn.focus(); });
      addEventListener('scroll', () => { if (!nav.hidden) mark(); }, { passive: true });
      d.addEventListener('keydown', e => {
        if (!root.classList.contains('slides') || e.target.closest('input, select, textarea, [role="tab"], [contenteditable]') || e.altKey || e.ctrlKey || e.metaKey) return;
        if (e.key === 'Escape') return set(false);
        const step = { ArrowRight: 1, PageDown: 1, ArrowLeft: -1, PageUp: -1 }[e.key], to = { Home: 0, End: deck().length - 1 }[e.key];
        if (!step && to === undefined) return;
        e.preventDefault();
        go(step, to);
      });
      tools.prepend(btn);
      d.body.append(bar, nav);
      set(root.classList.contains('slides'));
    }

    if (main && heads.length >= 4) run(() => {
      const nav = el(`<nav class="toc" aria-label="${esc(L.contents)}"><details><summary>${icon('list')}<span>${esc(L.contents)}</span><small></small>${icon('down', 'toc-chev')}</summary><ol></ol></details></nav>`);
      const links = heads.map(h => { const li = el(`<li><a href="#${h.id}"></a></li>`); li.firstChild.textContent = h.textContent; nav.querySelector('ol').append(li); return li.firstChild; });
      main.before(nav);
      const details = nav.firstElementChild, wide = matchMedia('(min-width: 80rem)'), where = nav.querySelector('small');
      const fit = () => { details.open = wide.matches; details.firstElementChild.tabIndex = wide.matches ? -1 : 0; };
      fit();
      wide.addEventListener('change', fit);
      links.forEach(a => a.addEventListener('click', () => { if (!wide.matches) details.open = false; }));
      let ticking = false;
      const spy = () => {
        ticking = false;
        let cur = -1;
        heads.forEach((h, i) => { if (h.getBoundingClientRect().top < innerHeight * 0.3) cur = i; });
        links.forEach((a, i) => i === cur ? a.setAttribute('aria-current', 'true') : a.removeAttribute('aria-current'));
        where.textContent = cur < 0 ? heads.length : `${cur + 1} / ${heads.length}`;
      };
      addEventListener('scroll', () => { if (!ticking) { ticking = true; requestAnimationFrame(spy); } }, { passive: true });
      spy();
    });

    run(tips);
    refresh();
    d.dispatchEvent(new Event('kit:ready'));
  };

  addEventListener('beforeprint', () => $$('details:not([open])').forEach(n => { if (!n.closest('.toc, .data')) { n.open = true; n.dataset.printOpen = ''; } }));
  addEventListener('afterprint', () => $$('details[data-print-open]').forEach(n => { n.open = false; delete n.dataset.printOpen; }));

  window.kit = { render, md, blocks: B, containers: C, color, theme, load, refresh, labels: L };
  if (d.readyState === 'loading') d.addEventListener('DOMContentLoaded', boot); else boot();
})();
