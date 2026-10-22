(() => {
  const d = document, root = d.documentElement;
  const $$ = (sel, el = d) => [...el.querySelectorAll(sel)];
  const run = fn => { try { fn(); } catch (e) { console.error('kit:', e); } };
  root.classList.add('js');

  const L = Object.assign({
    contents: 'Contents', back: 'Back', next: 'Next', step: 'Step {n} of {total}', steps: 'Steps', play: 'Play', pause: 'Pause',
    copy: 'Copy', copied: 'Copied', right: 'Correct', wrong: 'Not quite', data: 'Data',
    toDark: 'Switch to dark theme', toLight: 'Switch to light theme',
  }, window.kitLabels);

  const CDN = 'https://cdn.jsdelivr.net/npm/';
  const LIBS = {
    hljs: { js: '@highlightjs/cdn-assets@11/highlight.min.js', global: 'hljs' },
    katex: { js: 'katex@0.19/dist/katex.min.js', css: 'katex@0.19/dist/katex.min.css', global: 'katex' },
    chart: { js: 'chart.js@4/dist/chart.umd.min.js', global: 'Chart' },
    mermaid: { esm: 'mermaid@12/dist/mermaid.esm.min.mjs' },
  };
  const script = src => new Promise((ok, fail) => {
    const s = d.createElement('script');
    s.src = src; s.onload = ok; s.onerror = fail;
    d.head.append(s);
  });
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
    Promise.all([family('--font'), family('--mono')].map(f => d.fonts.load('1em ' + f.split(',')[0]))).catch(() => {}),
    new Promise(ok => setTimeout(ok, 3000)),
  ]);

  const probe = d.createElement('i');
  probe.hidden = true;
  d.body.append(probe);
  const px = d.createElement('canvas').getContext('2d', { willReadFrequently: true });
  const color = (name, scheme = '') => {
    probe.style.colorScheme = scheme;
    probe.style.color = `var(--${name.replace(/^--/, '')})`;
    px.clearRect(0, 0, 1, 1);
    px.fillStyle = getComputedStyle(probe).color;
    px.fillRect(0, 0, 1, 1);
    return '#' + [...px.getImageData(0, 0, 1, 1).data.slice(0, 3)].map(v => v.toString(16).padStart(2, '0')).join('');
  };

  const dark = matchMedia('(prefers-color-scheme: dark)');
  const theme = () => root.dataset.theme || (dark.matches ? 'dark' : 'light');
  const themed = [];
  const changed = () => {
    themed.forEach(fn => run(fn));
    d.dispatchEvent(new CustomEvent('kit:theme', { detail: theme() }));
  };
  try { const saved = sessionStorage.getItem('kit-theme'); if (saved) root.dataset.theme = saved; } catch {}
  run(() => {
    const ICON = {
      dark: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>',
      light: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>',
    };
    const btn = Object.assign(d.createElement('button'), { type: 'button', className: 'theme' });
    const paint = () => {
      const next = theme() === 'dark' ? 'light' : 'dark';
      btn.innerHTML = ICON[next];
      btn.setAttribute('aria-label', next === 'dark' ? L.toDark : L.toLight);
      btn.title = btn.getAttribute('aria-label');
    };
    btn.addEventListener('click', () => {
      root.dataset.theme = theme() === 'dark' ? 'light' : 'dark';
      try { sessionStorage.setItem('kit-theme', root.dataset.theme); } catch {}
      paint();
      changed();
    });
    dark.addEventListener('change', () => { if (!root.dataset.theme) { paint(); changed(); } });
    paint();
    (d.querySelector('.page-head') || d.body).append(btn);
  });

  run(() => {
    const main = d.querySelector('main');
    const heads = $$('main h2');
    const taken = new Set($$('[id]').map(el => el.id));
    heads.forEach(h => {
      if (h.id) return;
      const base = h.textContent.trim().toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '') || 'section';
      let id = base, n = 2;
      while (taken.has(id)) id = `${base}-${n++}`;
      taken.add(id);
      h.id = id;
    });
    if (!main || heads.length < 4) return;
    const nav = Object.assign(d.createElement('nav'), { className: 'toc' });
    nav.setAttribute('aria-label', L.contents);
    nav.innerHTML = '<details><summary></summary><ol></ol></details>';
    nav.querySelector('summary').textContent = L.contents;
    const links = heads.map(h => {
      const a = Object.assign(d.createElement('a'), { href: '#' + h.id, textContent: h.textContent });
      const li = d.createElement('li');
      li.append(a);
      nav.querySelector('ol').append(li);
      return a;
    });
    main.before(nav);
    const details = nav.querySelector('details');
    const wide = matchMedia('(min-width: 76rem)');
    const fit = () => { details.open = wide.matches; };
    fit();
    wide.addEventListener('change', fit);
    links.forEach(a => a.addEventListener('click', () => { if (!wide.matches) details.open = false; }));
    let ticking = false;
    const spy = () => {
      ticking = false;
      let at = -1;
      heads.forEach((h, i) => { if (h.getBoundingClientRect().top < innerHeight * 0.3) at = i; });
      links.forEach((a, i) => i === at ? a.setAttribute('aria-current', 'true') : a.removeAttribute('aria-current'));
    };
    addEventListener('scroll', () => { if (!ticking) { ticking = true; requestAnimationFrame(spy); } }, { passive: true });
    spy();
  });

  run(() => $$('main table').forEach(t => {
    if (t.closest('.scroll, .chart')) return;
    const box = Object.assign(d.createElement('div'), { className: 'scroll' });
    t.before(box);
    box.append(t);
  }));

  run(() => {
    $$('main pre > code').forEach(code => {
      const pre = code.parentElement;
      if (pre.closest('.code') || pre.matches('.mermaid, .terminal')) return;
      const fig = Object.assign(d.createElement('figure'), { className: 'code' });
      pre.before(fig);
      fig.append(pre);
    });
    $$('.code').forEach(fig => {
      const src = fig.querySelector('pre');
      if (!src) return;
      const text = src.textContent.replace(/\n$/, '');
      const btn = Object.assign(d.createElement('button'), { type: 'button', className: 'copy', textContent: L.copy });
      btn.addEventListener('click', async () => {
        try { await navigator.clipboard.writeText(text); } catch {
          const ta = Object.assign(d.createElement('textarea'), { value: text });
          ta.style.cssText = 'position:fixed;opacity:0';
          d.body.append(ta); ta.select(); d.execCommand('copy'); ta.remove();
        }
        btn.textContent = L.copied;
        setTimeout(() => { btn.textContent = L.copy; }, 1500);
      });
      fig.append(btn);
    });
  });

  const ranges = (spec = '', max = Infinity) => {
    const out = [];
    for (const part of String(spec).split(/[\s,]+/)) {
      const m = part.match(/^(\d*)(-?)(\d*)$/);
      if (!m || (!m[1] && !m[3])) continue;
      const a = m[1] ? +m[1] : 1, b = m[2] ? (m[3] ? +m[3] : max) : a;
      for (let n = a; n <= Math.min(b, max); n++) out.push(n);
    }
    return out;
  };
  const inRange = (spec, n) => ranges(spec, n).includes(n);

  const numberLines = fig => {
    const code = fig.querySelector('pre code') || fig.querySelector('pre');
    const notes = $$(':scope > .code-notes > li', fig);
    const diff = fig.classList.contains('diff');
    if (!code || (!notes.length && !diff && !fig.classList.contains('numbered'))) return;
    if (notes.length) fig.classList.add('numbered');
    const lines = [];
    let open = [], cur = '';
    for (const m of code.innerHTML.replace(/\n$/, '').matchAll(/(<\/?span[^>]*>)|([^<]+)|(<[^>]*>)/g)) {
      if (m[1]) { if (m[1][1] === '/') open.pop(); else open.push(m[1]); cur += m[1]; }
      else if (m[2]) m[2].split('\n').forEach((part, i) => {
        if (i) { lines.push(cur + '</span>'.repeat(open.length)); cur = open.join(''); }
        cur += part;
      });
      else cur += m[3];
    }
    lines.push(cur + '</span>'.repeat(open.length));
    code.innerHTML = lines.map((l, i) => `<span class="line" data-n="${i + 1}">${l || ' '}</span>`).join('');
    if (diff) [...code.children].forEach(l => l.classList.add({ '+': 'add', '-': 'del' }[l.textContent[0]] || 'same'));
    const row = n => code.children[n - 1];
    notes.forEach((li, k) => {
      const rows = ranges(li.dataset.lines, lines.length);
      rows.forEach(n => row(n)?.classList.add('mark'));
      row(rows[0])?.insertAdjacentHTML('beforeend', `<span class="badge" aria-hidden="true">${k + 1}</span>`);
      li.addEventListener('mouseenter', () => rows.forEach(n => row(n)?.classList.add('hot')));
      li.addEventListener('mouseleave', () => rows.forEach(n => row(n)?.classList.remove('hot')));
    });
  };

  run(() => $$('.tabs').forEach((tabs, t) => {
    const panels = $$(':scope > section[data-tab]', tabs);
    if (!panels.length) return;
    const list = d.createElement('div');
    list.setAttribute('role', 'tablist');
    const btns = panels.map((p, i) => {
      const b = Object.assign(d.createElement('button'), { type: 'button', id: `tab-${t}-${i}`, textContent: p.dataset.tab });
      p.id ||= `panel-${t}-${i}`;
      b.setAttribute('role', 'tab');
      b.setAttribute('aria-controls', p.id);
      p.setAttribute('role', 'tabpanel');
      p.setAttribute('aria-labelledby', b.id);
      p.tabIndex = 0;
      b.addEventListener('click', () => pick(i));
      list.append(b);
      return b;
    });
    const pick = (i, focus) => {
      btns.forEach((b, j) => {
        b.setAttribute('aria-selected', String(i === j));
        b.tabIndex = i === j ? 0 : -1;
        panels[j].hidden = i !== j;
      });
      if (focus) btns[i].focus();
      d.dispatchEvent(new Event('kit:shown'));
    };
    list.addEventListener('keydown', e => {
      const i = btns.indexOf(d.activeElement), rtl = getComputedStyle(tabs).direction === 'rtl';
      const step = { ArrowRight: rtl ? -1 : 1, ArrowLeft: rtl ? 1 : -1 }[e.key];
      const to = e.key === 'Home' ? 0 : e.key === 'End' ? btns.length - 1 : step ? (i + step + btns.length) % btns.length : null;
      if (to === null) return;
      e.preventDefault();
      pick(to, true);
    });
    tabs.prepend(list);
    pick(0);
  }));

  run(() => $$('.stepper').forEach(st => {
    const steps = $$('.stepper-steps > li', st);
    if (steps.length < 2) return;
    const lit = $$('[data-at]', st);
    const bar = Object.assign(d.createElement('div'), { className: 'stepper-bar' });
    bar.innerHTML = '<button type="button"></button><output aria-live="polite"></output><button type="button"></button>';
    const [prev, out, next] = bar.children;
    prev.textContent = L.back;
    next.textContent = L.next;
    let cur = 0, timer = 0, scrub, play;
    const stop = () => { clearInterval(timer); timer = 0; if (play) play.textContent = L.play; };
    if (st.hasAttribute('data-scrub')) {
      scrub = Object.assign(d.createElement('input'), { type: 'range', min: 1, max: steps.length, value: 1 });
      scrub.setAttribute('aria-label', L.steps);
      scrub.addEventListener('input', () => { stop(); show(scrub.value - 1); });
      play = Object.assign(d.createElement('button'), { type: 'button', textContent: L.play });
      play.addEventListener('click', () => {
        if (timer) return stop();
        if (cur === steps.length - 1) show(0);
        play.textContent = L.pause;
        timer = setInterval(() => { show(cur + 1); if (cur === steps.length - 1) stop(); }, 1800);
      });
      bar.prepend(scrub);
      next.before(play);
    }
    const show = i => {
      cur = Math.max(0, Math.min(i, steps.length - 1));
      if (scrub) { scrub.value = cur + 1; scrub.setAttribute('aria-valuetext', L.step.replace('{n}', cur + 1).replace('{total}', steps.length)); }
      steps.forEach((s, j) => s.classList.toggle('now', j === cur));
      lit.forEach(el => el.classList.toggle('lit', inRange(el.dataset.at, cur + 1)));
      st.dataset.step = cur + 1;
      out.textContent = L.step.replace('{n}', cur + 1).replace('{total}', steps.length);
      const lost = d.activeElement === prev || d.activeElement === next;
      prev.disabled = cur === 0;
      next.disabled = cur === steps.length - 1;
      if (lost && d.activeElement.disabled) (prev.disabled ? next : prev).focus();
      d.dispatchEvent(new Event('kit:shown'));
    };
    prev.addEventListener('click', () => { stop(); show(cur - 1); });
    next.addEventListener('click', () => { stop(); show(cur + 1); });
    st.addEventListener('keydown', e => {
      if (e.target.closest('input, select, textarea, [role="tab"]')) return;
      const rtl = getComputedStyle(st).direction === 'rtl';
      const step = { ArrowRight: rtl ? -1 : 1, ArrowLeft: rtl ? 1 : -1 }[e.key];
      if (!step) return;
      e.preventDefault();
      stop();
      show(cur + step);
    });
    st.append(bar);
    show(0);
  }));

  run(() => {
    const terms = $$('.term[data-tip]');
    if (!terms.length) return;
    const tip = Object.assign(d.createElement('div'), { className: 'tip', id: 'kit-tip', hidden: true });
    tip.setAttribute('role', 'tooltip');
    d.body.append(tip);
    let owner = null, shownAt = 0;
    const place = () => {
      if (!owner) return;
      const r = owner.getBoundingClientRect(), t = tip.getBoundingClientRect();
      const x = Math.max(8, Math.min(r.left + r.width / 2 - t.width / 2, innerWidth - t.width - 8));
      const y = r.bottom + 8 + t.height > innerHeight - 8 ? r.top - t.height - 8 : r.bottom + 8;
      tip.style.left = x + 'px';
      tip.style.top = y + 'px';
    };
    const show = el => {
      if (owner === el) return;
      hide();
      owner = el;
      shownAt = Date.now();
      tip.textContent = el.dataset.tip;
      tip.hidden = false;
      el.setAttribute('aria-describedby', 'kit-tip');
      place();
    };
    const hide = () => {
      if (!owner) return;
      owner.removeAttribute('aria-describedby');
      owner = null;
      tip.hidden = true;
    };
    terms.forEach(el => {
      el.tabIndex = 0;
      el.addEventListener('mouseenter', () => show(el));
      el.addEventListener('mouseleave', () => { if (d.activeElement !== el) hide(); });
      el.addEventListener('focus', () => show(el));
      el.addEventListener('blur', hide);
      el.addEventListener('click', () => { if (owner === el && Date.now() - shownAt > 400) hide(); else show(el); });
    });
    d.addEventListener('keydown', e => { if (e.key === 'Escape') hide(); });
    addEventListener('scroll', place, { passive: true });
    addEventListener('resize', place);
  });

  run(() => $$('.check').forEach(c => {
    const list = c.querySelector(':scope > ul');
    const opts = list ? $$('button', list) : [];
    if (!opts.length) return;
    const answer = c.querySelector(':scope > details');
    const verdict = Object.assign(d.createElement('p'), { className: 'verdict' });
    verdict.setAttribute('aria-live', 'polite');
    list.after(verdict);
    opts.forEach(b => {
      b.type = 'button';
      b.addEventListener('click', () => {
        const ok = b.hasAttribute('data-correct');
        opts.forEach(o => o.classList.remove('right', 'wrong'));
        b.classList.add(ok ? 'right' : 'wrong');
        verdict.className = 'verdict ' + (ok ? 'right' : 'wrong');
        verdict.textContent = ok ? L.right : L.wrong;
        if (ok && answer) answer.open = true;
      });
    });
  }));

  run(() => $$('.predict > fieldset').forEach(set => {
    const verdict = Object.assign(d.createElement('p'), { className: 'verdict' });
    verdict.setAttribute('aria-live', 'polite');
    set.after(verdict);
    set.addEventListener('change', e => {
      const ok = e.target.hasAttribute('data-correct');
      verdict.className = 'verdict ' + (ok ? 'right' : 'wrong');
      verdict.textContent = ok ? L.right : L.wrong;
    });
  }));

  run(() => {
    $$('.ref[data-ref]').forEach(el => {
      if (el.matches('a, button, input, [tabindex]')) return;
      el.tabIndex = 0;
      if (!el.role) el.role = 'button';
    });
    const on = { hover: null, focus: null };
    const light = key => e => {
      const ref = e.type.endsWith('out') ? null : e.target.closest?.('[data-ref]')?.dataset.ref ?? null;
      if (on[key] === ref) return;
      on[key] = ref;
      $$('[data-ref]').forEach(el => el.classList.toggle('on', el.dataset.ref === on.hover || el.dataset.ref === on.focus));
    };
    d.addEventListener('mouseover', light('hover'));
    d.addEventListener('mouseout', e => { if (!e.relatedTarget) light('hover')(e); });
    ['focusin', 'focusout'].forEach(t => d.addEventListener(t, light('focus')));
  });

  const model = (box, fn) => {
    const inputs = $$('input:is([name], [id]), select:is([name], [id])', box);
    const update = () => run(() => {
      const v = Object.fromEntries(inputs.map(i => [i.name || i.id, i.type === 'range' || i.type === 'number' ? +i.value : i.type === 'checkbox' ? i.checked : i.value]));
      for (const [k, x] of Object.entries(fn(v) || {})) {
        if (typeof x === 'number') box.style.setProperty('--' + k, x);
        $$(`[data-out="${k}"]`, box).forEach(el => { el.textContent = typeof x === 'number' ? x.toLocaleString(root.lang || undefined) : x; });
      }
    });
    $$('output', box).forEach(o => o.setAttribute('aria-live', 'off'));
    const say = Object.assign(d.createElement('span'), { className: 'say' });
    say.setAttribute('aria-live', 'polite');
    box.append(say);
    inputs.forEach(i => {
      i.addEventListener('input', update);
      i.addEventListener('change', () => { say.textContent = ''; say.textContent = box.innerText; });
    });
    update();
    return update;
  };

  run(() => $$('.parts').forEach(p => {
    const items = $$(':scope > ol > li', p);
    const values = items.map(li => parseFloat(String(li.dataset.value ?? li.querySelector('b')?.textContent ?? '').replace(/[^\d.eE+-]/g, '')) || 0);
    const total = values.reduce((a, b) => a + b, 0);
    if (!total) return;
    const fmt = new Intl.NumberFormat(root.lang || undefined, { style: 'percent', maximumFractionDigits: 0 });
    const fine = new Intl.NumberFormat(root.lang || undefined, { style: 'percent', maximumFractionDigits: 1 });
    const bar = Object.assign(d.createElement('div'), { className: 'parts-bar' });
    bar.setAttribute('aria-hidden', 'true');
    items.forEach((li, i) => {
      if (!li.dataset.c && !li.dataset.tone) li.dataset.c = (i % 8) + 1;
      const seg = d.createElement('i');
      seg.style.flex = values[i];
      if (li.dataset.tone) seg.dataset.tone = li.dataset.tone; else seg.dataset.c = li.dataset.c;
      bar.append(seg);
      if (!/%/.test(li.textContent)) {
        const share = values[i] / total;
        li.append(Object.assign(d.createElement('span'), { className: 'pct', textContent: share > 0 && share < 0.001 ? '<' + fine.format(0.001) : (share < 0.1 ? fine : fmt).format(share) }));
      }
    });
    p.prepend(bar);
  }));

  run(() => $$('.cycle').forEach(c => {
    const items = $$(':scope > li', c), n = items.length;
    if (n < 3 || n > 6) return;
    const R = 37, NS = 'http://www.w3.org/2000/svg';
    c.classList.add('ring');
    items.forEach((li, i) => {
      const a = -Math.PI / 2 + i * 2 * Math.PI / n;
      li.style.setProperty('--x', 50 + R * Math.cos(a) + '%');
      li.style.setProperty('--y', 50 + R * Math.sin(a) + '%');
    });
    const svg = d.createElementNS(NS, 'svg');
    svg.setAttribute('class', 'cycle-ring');
    svg.setAttribute('viewBox', '0 0 100 100');
    svg.setAttribute('aria-hidden', 'true');
    c.prepend(svg);
    const draw = () => {
      const size = c.getBoundingClientRect().width;
      svg.innerHTML = '';
      if (!size || getComputedStyle(svg).display === 'none') return;
      const scale = 100 / size;
      const pad = items.map((li, i) => {
        const a = -Math.PI / 2 + i * 2 * Math.PI / n;
        const ext = li.offsetWidth / 2 * Math.abs(Math.sin(a)) + li.offsetHeight / 2 * Math.abs(Math.cos(a));
        return (ext * scale + 2.5) / R;
      });
      for (let i = 0; i < n; i++) {
        const a0 = -Math.PI / 2 + i * 2 * Math.PI / n + pad[i];
        const a1 = -Math.PI / 2 + (i + 1) * 2 * Math.PI / n - pad[(i + 1) % n];
        if (a1 - a0 < 0.12) continue;
        const pt = a => [50 + R * Math.cos(a), 50 + R * Math.sin(a)];
        const [x0, y0] = pt(a0), [x1, y1] = pt(a1);
        const path = d.createElementNS(NS, 'path');
        path.setAttribute('d', `M${x0} ${y0}A${R} ${R} 0 0 1 ${x1} ${y1}`);
        const tx = -Math.sin(a1), ty = Math.cos(a1), nx = Math.cos(a1), ny = Math.sin(a1);
        const head = d.createElementNS(NS, 'path');
        head.setAttribute('class', 'head');
        head.setAttribute('d', `M${x1 + tx * 0.6} ${y1 + ty * 0.6}L${x1 - tx * 2.4 + nx * 1.5} ${y1 - ty * 2.4 + ny * 1.5}L${x1 - tx * 2.4 - nx * 1.5} ${y1 - ty * 2.4 - ny * 1.5}Z`);
        svg.append(path, head);
      }
    };
    new ResizeObserver(draw).observe(c);
  }));

  run(() => $$('.fields').forEach(f => {
    const items = $$(':scope > li', f), w = items.map(li => parseFloat(getComputedStyle(li).getPropertyValue('--w')) || 1);
    const sum = w.reduce((a, b) => a + b, 0);
    items.forEach((li, i) => li.style.setProperty('--share', w[i] / sum));
  }));

  addEventListener('beforeprint', () => $$('details:not([open])').forEach(el => { if (!el.closest('.toc, .chart')) { el.open = true; el.dataset.printOpen = ''; } }));
  addEventListener('afterprint', () => $$('details[data-print-open]').forEach(el => { el.open = false; delete el.dataset.printOpen; }));

  run(() => $$('.mock :is(button, input, select, textarea)').forEach(el => { el.tabIndex = -1; }));

  run(() => $$('input[type="range"]').forEach(r => {
    const out = r.closest('label')?.querySelector('output');
    if (!out) return;
    const show = () => { out.textContent = Number(r.value).toLocaleString(root.lang || undefined) + (r.dataset.unit || ''); };
    r.addEventListener('input', show);
    show();
  }));

  const codes = $$('pre code[class*="language-"]');
  (codes.length ? load('hljs').then(async hljs => {
    for (const code of codes) {
      const lang = code.className.match(/language-([\w+#.-]+)/)?.[1];
      if (lang && !hljs.getLanguage(lang)) await script(`${CDN}@highlightjs/cdn-assets@11/languages/${lang}.min.js`).catch(() => {});
      if (lang && hljs.getLanguage(lang)) hljs.highlightElement(code);
    }
  }).catch(() => {}) : Promise.resolve()).then(() => $$('.code').forEach(fig => run(() => numberLines(fig))));

  const scrollable = el => { if (el.scrollWidth > el.clientWidth + 1 && !el.hasAttribute('tabindex')) el.tabIndex = 0; };
  const maths = $$('.math');
  if (maths.length) load('katex').then(katex => maths.forEach(el => run(() => {
    el.dataset.tex ??= el.textContent.trim();
    katex.render(el.dataset.tex, el, { displayMode: el.tagName !== 'SPAN', throwOnError: false });
    el.classList.add('rendered');
    if (el.tagName !== 'SPAN') fontsReady().then(() => scrollable(el));
  }))).catch(() => {});

  const graphs = $$('pre.mermaid');
  graphs.forEach(g => { g.dataset.src ??= g.textContent; });
  const fitGraph = g => {
    const svg = g.querySelector('svg');
    if (!svg || !g.clientWidth) return;
    const natural = svg.viewBox.baseVal?.width || svg.getBoundingClientRect().width;
    svg.style.maxWidth = 'none';
    svg.style.width = (natural <= g.clientWidth ? natural : Math.max(g.clientWidth, natural / 1.5)) + 'px';
  };
  let drawing = Promise.resolve();
  const drawGraphs = () => drawing = drawing.then(async () => {
    let todo = graphs.filter(g => g.getClientRects().length && g.dataset.theme !== theme());
    if (!todo.length) return;
    const mermaid = await load('mermaid');
    await fontsReady();
    todo = todo.filter(g => g.getClientRects().length);
    if (!todo.length) return;
    const c = color, isDark = theme() === 'dark';
    mermaid.initialize({
      startOnLoad: false, securityLevel: 'strict', theme: 'base', fontFamily: family('--font'),
      themeVariables: {
        darkMode: isDark, fontFamily: family('--font'), fontSize: '14px', background: c('bg'), dropShadow: 'none',
        primaryColor: c('card'), primaryTextColor: c('text'), primaryBorderColor: c('line-strong'),
        secondaryColor: c('accent-soft'), secondaryTextColor: c('text'), secondaryBorderColor: c('accent'),
        tertiaryColor: c('sunk'), tertiaryTextColor: c('text'), tertiaryBorderColor: c('line'),
        mainBkg: c('card'), nodeBorder: c('line-strong'), lineColor: c('line-strong'), textColor: c('text'), titleColor: c('text'),
        clusterBkg: c('sunk'), clusterBorder: c('line'), edgeLabelBackground: c('bg'),
        noteBkgColor: c('warn-soft'), noteTextColor: c('text'), noteBorderColor: c('warn'),
        actorBkg: c('card'), actorBorder: c('line-strong'), actorTextColor: c('text'), actorLineColor: c('line-strong'),
        signalColor: c('text'), signalTextColor: c('text'), labelBoxBkgColor: c('card'), labelBoxBorderColor: c('line-strong'),
        labelTextColor: c('text'), loopTextColor: c('text'), activationBkgColor: c('accent-soft'), activationBorderColor: c('accent'),
        sequenceNumberColor: c('on-accent'), altBackground: c('sunk'), compositeBackground: c('card'), compositeTitleBackground: c('sunk'),
        attributeBackgroundColorOdd: c('card'), attributeBackgroundColorEven: c('sunk'),
        pieStrokeColor: c('bg'), pieOuterStrokeColor: c('line'), pieTitleTextColor: c('text'), pieSectionTextColor: c('on-accent'), pieLegendTextColor: c('text'),
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
    todo.forEach(g => {
      g.dataset.theme = theme();
      if (g.querySelector('svg')) { g.classList.add('rendered'); fitGraph(g); scrollable(g); }
    });
  }).catch(() => {});
  if (graphs.length) {
    drawGraphs();
    themed.push(drawGraphs);
    d.addEventListener('kit:shown', drawGraphs);
    d.addEventListener('toggle', () => d.dispatchEvent(new Event('kit:shown')), true);
    let t;
    addEventListener('resize', () => { clearTimeout(t); t = setTimeout(() => graphs.forEach(fitGraph), 150); });
  }

  const charts = [];
  const paintChart = (ch, c = color) => { ch.inst?.destroy(); ch.inst = new window.Chart(ch.canvas, ch.make(c)); return ch.inst; };
  const styleCharts = (Chart, c = color) => {
    Chart.defaults.font.family = family('--font');
    Chart.defaults.font.size = 13;
    Chart.defaults.color = c('muted');
    Chart.defaults.borderColor = c('line');
    Object.assign(Chart.defaults.plugins.legend.labels, { color: c('text'), boxWidth: 12, boxHeight: 12 });
  };
  const gap = s => /^[\s—–?−-]*$|^n\/?a$/i.test(s);
  const isNum = s => /^\D{0,3}?[−+-]?\d[\d,.\s]*(e[+-]?\d+)?\s*\D{0,4}$/i.test(s);
  const numCols = rows => (rows[0] || []).map((_, j) => {
    const v = rows.map(r => r[j] ?? '').filter(s => !gap(s));
    return v.length > 0 && v.every(isNum);
  });
  const num = s => parseFloat(s.replace(/−/g, '-').replace(/[^\d.eE+-]/g, ''));
  const val = s => gap(s) ? null : num(s);
  const fromTable = fig => {
    const table = fig.querySelector('table');
    if (!table) return null;
    const headRow = table.tHead?.rows[0] || table.rows[0];
    const ths = [...headRow.cells];
    const head = ths.map(c => c.textContent.trim());
    const rows = [...table.rows].filter(r => r !== headRow && r.parentElement.tagName !== 'TFOOT').map(r => [...r.cells].map(c => c.textContent.trim()));
    const type = fig.dataset.type || 'bar', round = type === 'pie' || type === 'doughnut', scatter = type === 'scatter';
    const ds = fig.dataset, logs = (ds.log || '').split(/\s+/);
    const cols = numCols(rows);
    const series = head.map((_, j) => j).filter(j => j > 0 && cols[j]);
    const names = head.findIndex((_, j) => j > 0 && !cols[j]);
    const xNum = scatter || (type === 'line' && rows.length > 0 && rows.every(r => /^[−+-]?\d[\d,]*(\.\d+)?$/.test(r[0])));
    const xSmall = rows.every(r => Math.abs(num(r[0])) < 1e4);
    const ints = series.every(j => rows.every(r => { const v = val(r[j] ?? ''); return v === null || Number.isInteger(v); }));
    const horizontal = ds.horizontal !== undefined;
    const compact = new Intl.NumberFormat(root.lang || undefined, { notation: 'compact' });
    return c => {
      const pick = (j, k) => ths[j].dataset.tone ? c(ths[j].dataset.tone) : c('c' + (ths[j].dataset.c || (k % 8) + 1));
      const axis = (title, log) => ({
        type: log ? 'logarithmic' : 'linear',
        stacked: ds.stacked !== undefined,
        title: { display: !!title, text: title, color: c('muted') },
        grid: { color: c('line') }, border: { color: c('line-strong') }, ticks: { color: c('muted') },
      });
      const cat = axis(ds.x, logs.includes('x'));
      if (!xNum) cat.type = 'category';
      else {
        if (xSmall) cat.ticks.format = { useGrouping: false };
        if (logs.includes('x')) Object.assign(cat.ticks, { maxRotation: 0, callback(v) { const l = Math.log10(v); return Math.abs(l - Math.round(l)) < 1e-9 ? compact.format(v) : ''; } });
      }
      const value = { ...axis(ds.y, logs.includes('y')), beginAtZero: type === 'bar' };
      if (logs.includes('y')) value.ticks.callback = function (v, i, t) { return window.Chart.Ticks.formatters.logarithmic.call(this, v, i, t) && compact.format(v); };
      if (ints) value.ticks.precision = 0;
      return {
        type,
        data: {
          labels: xNum ? undefined : rows.map(r => r[0]),
          datasets: series.map((j, k) => ({
            label: head[j],
            data: xNum ? rows.map(r => ({ x: num(r[0]), y: val(r[j] ?? '') })) : rows.map(r => val(r[j] ?? '')),
            backgroundColor: round ? rows.map((_, i) => c('c' + ((i % 8) + 1))) : pick(j, k),
            borderColor: round ? c('bg') : pick(j, k),
            borderWidth: round ? 2 : type === 'line' ? 2.5 : 0,
            borderRadius: type === 'bar' ? 4 : 0,
            pointRadius: type === 'line' ? 3 : 4,
          })),
        },
        options: {
          responsive: true, maintainAspectRatio: false, animation: false,
          indexAxis: horizontal ? 'y' : 'x',
          plugins: {
            legend: { display: round || series.length > 1 },
            tooltip: {
              backgroundColor: c('card'), titleColor: c('text'), bodyColor: c('text'), borderColor: c('line-strong'), borderWidth: 1,
              callbacks: names < 0 ? {} : { title: items => [items[0].label, rows[items[0].dataIndex][names]].filter(Boolean).join(' · ') },
            },
          },
          scales: round ? {} : horizontal ? { y: cat, x: value } : { x: cat, y: value },
        },
      };
    };
  };
  const figs = $$('.chart');
  figs.forEach(fig => run(() => {
    const table = fig.querySelector('table');
    if (!table) return;
    if (!table.closest('.scroll')) {
      const box = Object.assign(d.createElement('div'), { className: 'scroll' });
      table.before(box);
      box.append(table);
    }
    const body = [...table.tBodies].flatMap(b => [...b.rows]);
    numCols(body.map(r => [...r.cells].map(c => c.textContent.trim()))).forEach((n, j) => {
      if (n && j > 0) [...table.rows].forEach(r => r.cells[j]?.classList.add('num'));
    });
  }));
  if (figs.length) load('chart').then(async Chart => {
    await fontsReady();
    styleCharts(Chart);
    figs.forEach(fig => run(() => {
      const make = fromTable(fig);
      if (!make) return;
      const box = Object.assign(d.createElement('div'), { className: 'chart-box' });
      if (fig.dataset.horizontal !== undefined) box.style.setProperty('--bars', fig.querySelector('tbody')?.rows.length || 0);
      const canvas = d.createElement('canvas');
      canvas.setAttribute('role', 'img');
      canvas.setAttribute('aria-label', fig.querySelector('figcaption')?.textContent.trim() || L.data);
      box.append(canvas);
      fig.prepend(box);
      const data = d.createElement('details');
      data.append(Object.assign(d.createElement('summary'), { textContent: L.data }), fig.querySelector('table').closest('.scroll'));
      fig.append(data);
      const ch = { canvas, make };
      charts.push(ch);
      paintChart(ch);
    }));
  }).catch(() => {});
  const repaint = (c = color) => { if (!window.Chart || !charts.length) return; styleCharts(window.Chart, c); charts.forEach(ch => paintChart(ch, c)); };
  themed.push(() => repaint());
  addEventListener('beforeprint', () => {
    if (theme() !== 'dark') return;
    run(() => repaint(n => color(n, 'light')));
  });
  addEventListener('afterprint', () => {
    if (theme() !== 'dark') return;
    run(() => repaint());
  });

  fontsReady().then(() => $$('.scroll, main pre, .tree, .terminal, div.math').forEach(scrollable));

  window.kit = {
    color, load, theme, model, labels: L,
    chart: (canvas, make) => load('chart').then(async Chart => {
      await fontsReady();
      styleCharts(Chart);
      const ch = { canvas, make };
      charts.push(ch);
      return paintChart(ch);
    }),
  };
})();
