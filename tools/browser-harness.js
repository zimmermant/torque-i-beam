// Browser verification harness. Load it into the built page, then run the phases:
//
//   eval(await (await fetch('/tools/browser-harness.js')).text());
//   H.install();            // once per page load
//   H.phase1();  H.phase2();  H.phase3();
//
// It drives the REAL pointer handlers with synthetic events (pointer capture is
// stubbed, because a synthetic event has no active pointer to capture), then
// measures real getBBox boxes against the arrows, glyph, labels, beam and the
// viewBox. Every phase returns { states, failures, worst }.
(function () {
  const D = Math.PI / 180;
  const VB = { w: 960, h: 560 };
  const THRESH = { textToLine: 4, ownGlyph: 3, textGap: 2, edge: 4 };   // a glyph's own digits sit beside their triangle
  const BEAM = { x0: 230, y0: 255, x1: 730, y1: 305 };   // the unrotated beam, in viewBox units
  const svg = document.getElementById('scene-svg');

  const ANGLES = [0, 30, 45, 60, 90, 120, 135, 150, 180, 210, 225, 240, 270, 300, 315, 330];
  for (const b of [Math.atan2(3, 4) / D, Math.atan2(4, 3) / D]) {
    for (const a of [b, 180 - b, 180 + b, 360 - b]) ANGLES.push(a);
  }

  const rect = () => svg.getBoundingClientRect();
  const w2c = (wx, wy) => {
    const r = rect(), k = r.width / VB.w;
    return { x: r.left + (480 + wx * 100) * k, y: r.top + (280 - wy * 100) * k };
  };

  function fire(type, wx, wy) {
    const c = w2c(wx, wy);
    const target = type === 'pointerdown' ? (document.elementFromPoint(c.x, c.y) || svg) : svg;
    target.dispatchEvent(new PointerEvent(type, {
      bubbles: true, cancelable: true, pointerId: 7, pointerType: 'mouse',
      clientX: c.x, clientY: c.y, button: 0, buttons: type === 'pointerup' ? 0 : 1
    }));
  }
  function drag(from, to) {
    fire('pointerdown', from.x, from.y);
    fire('pointermove', (from.x + to.x) / 2, (from.y + to.y) / 2);
    fire('pointermove', to.x, to.y);
    fire('pointerup', to.x, to.y);
  }
  const reset = () => document.getElementById('new-problem').click();
  const panelText = () => Array.from(document.querySelectorAll('#panel .row')).map(r => r.textContent);
  const instr = () => document.getElementById('instruction').textContent;
  const tipOf = (fp, a, mag) => ({ x: fp.x + mag * 1.6 / 100 * Math.cos(a * D), y: fp.y + mag * 1.6 / 100 * Math.sin(a * D) });

  function install() {
    Element.prototype.setPointerCapture = function () {};
    Element.prototype.releasePointerCapture = function () {};
    Element.prototype.hasPointerCapture = function () { return true; };
    // reduced motion: the beam jumps to its final pose, so the sweep need not wait 1.2 s a state
    window.matchMedia = q => ({ matches: /reduced-motion/.test(q), addListener() {}, removeListener() {} });
    return 'installed';
  }

  function boxSeg(b, p, q) {
    let m = Infinity;
    for (let i = 0; i <= 120; i++) {
      const t = i / 120, x = p.x + t * (q.x - p.x), y = p.y + t * (q.y - p.y);
      m = Math.min(m, Math.hypot(Math.max(b.x0 - x, 0, x - b.x1), Math.max(b.y0 - y, 0, y - b.y1)));
    }
    return m;
  }
  const gap = (a, b) => Math.max(b.x0 - a.x1, a.x0 - b.x1, b.y0 - a.y1, a.y0 - b.y1);
  const kind = s => s.replace(/[0-9.]+/, '#');

  function snapshot() {
    const texts = Array.from(svg.querySelectorAll('text')).map(t => {
      const b = t.getBBox();
      return { s: t.textContent, x0: b.x, y0: b.y, x1: b.x + b.width, y1: b.y + b.height };
    });
    const segs = [];
    for (const l of svg.querySelectorAll('line')) {
      segs.push({ n: 'line:' + l.getAttribute('stroke'),
        p: { x: +l.getAttribute('x1'), y: +l.getAttribute('y1') }, q: { x: +l.getAttribute('x2'), y: +l.getAttribute('y2') } });
    }
    for (const pg of svg.querySelectorAll('polygon')) {
      const pts = pg.getAttribute('points').trim().split(/\s+/).map(s => s.split(',').map(Number));
      for (let i = 0; i < 3; i++) segs.push({ n: 'glyph', p: { x: pts[i][0], y: pts[i][1] }, q: { x: pts[(i + 1) % 3][0], y: pts[(i + 1) % 3][1] } });
    }
    for (const path of svg.querySelectorAll('path[stroke="#7c3aed"]')) {
      const L = path.getTotalLength();
      let prev = path.getPointAtLength(0);
      for (let i = 1; i <= 24; i++) {
        const pt = path.getPointAtLength(L * i / 24);
        segs.push({ n: 'torque-arc', p: { x: prev.x, y: prev.y }, q: { x: pt.x, y: pt.y } });
        prev = pt;
      }
    }
    return { texts, segs };
  }

  // One state's measurements, folded into `worst` (smallest clearance per kind)
  // and into `failures` when a threshold is broken.
  function audit(tag, worst, failures, opts = {}) {
    const { texts, segs } = snapshot();
    const note = (k, v, thresh) => {
      if (!(k in worst) || v < worst[k][0]) worst[k] = [+v.toFixed(1), tag];
      if (v < thresh) {
        failures.count = (failures.count || 0) + 1;
        failures.byKind = failures.byKind || {};
        failures.byKind[k] = (failures.byKind[k] || 0) + 1;
        if (failures.length < 12) failures.push(`${k} = ${v.toFixed(1)} < ${thresh} @ ${tag}`);
      }
    };
    for (const t of texts) {
      if (t.x0 < THRESH.edge || t.y0 < THRESH.edge || t.x1 > VB.w - THRESH.edge || t.y1 > VB.h - THRESH.edge) {
        note('outside:' + kind(t.s), -1, 0);
      }
      for (const g of segs) note(`text ${kind(t.s)} to ${g.n}`, boxSeg(t, g.p, g.q),
        g.n === 'glyph' && /^\d+$/.test(t.s) ? THRESH.ownGlyph : THRESH.textToLine);
    }
    for (let i = 0; i < texts.length; i++) for (let j = i + 1; j < texts.length; j++) {
      note(`gap ${kind(texts[i].s)} | ${kind(texts[j].s)}`, gap(texts[i], texts[j]), THRESH.textGap);
    }
    // recorded, not enforced: a label on the beam's grey fill is legible (it has a halo),
    // and when r runs along the beam with the force arrow above it, below IS the beam
    for (const t of texts) if (t.s === 'r') note('gap r | beam', gap(t, BEAM), -1e9);
  }

  function phase1() {
    const worst = {}, failures = [];
    let n = 0;
    for (const fx of [-2.5, -1.25, 0, 1.25, 2.5]) for (const fy of [-0.25, 0, 0.25]) for (const a of ANGLES) for (const mag of [10, 55, 100]) {
      reset();
      const fp = { x: fx, y: fy };
      drag(fp, tipOf(fp, a, mag));
      if (panelText()[0] === '|F|—') { failures.push(`force not set @ fp(${fx},${fy}) a=${a.toFixed(1)} m=${mag}`); continue; }
      audit(`fp(${fx},${fy}) a=${a.toFixed(1)} m=${mag}`, worst, failures);
      n++;
    }
    return { states: n, failures, count: failures.count || 0, byKind: failures.byKind || {}, worst };
  }

  function phase2() {
    const worst = {}, failures = [];
    let n = 0, valid = 0, missed = 0;
    const fps = [{ x: -2.5, y: 0.25 }, { x: -0.75, y: -0.25 }, { x: 1.25, y: 0 }, { x: 2.5, y: 0.25 }];
    const pivs = [];
    for (const x of [-2.5, -1.75, -1, -0.25, 0, 0.5, 1.25, 2, 2.5]) for (const y of [-0.25, 0, 0.25]) pivs.push({ x, y });
    for (const fp of fps) for (const a of ANGLES) for (const mag of [10, 100]) for (const pv of pivs) {
      if (pv.x === fp.x && pv.y === fp.y) continue;
      reset();
      drag(fp, tipOf(fp, a, mag));
      drag(pv, fp);
      const ok = panelText().some(t => t.includes('ends at the force point'));
      n++;
      if (!ok) { missed++; if (failures.length < 12) failures.push(`r not valid @ fp(${fp.x},${fp.y}) a=${a.toFixed(1)} m=${mag} piv(${pv.x},${pv.y}): ${instr()}`); continue; }
      valid++;
      audit(`fp(${fp.x},${fp.y}) a=${a.toFixed(1)} m=${mag} piv(${pv.x},${pv.y})`, worst, failures, { rAlongBeam: pv.y === fp.y });
    }
    return { states: n, valid, missed, failures, count: failures.count || 0, byKind: failures.byKind || {}, worst };
  }

  function phase3() {
    const worst = {}, failures = [];
    let n = 0;
    const fps = [{ x: -2.5, y: 0 }, { x: 2.5, y: 0 }, { x: 0, y: 0.25 }, { x: 1.25, y: -0.25 }];
    const pivs = [{ x: -2.5, y: 0 }, { x: 2.5, y: 0 }, { x: 0, y: 0 }, { x: -1.25, y: 0.25 }, { x: 1.75, y: -0.25 }];
    for (const fp of fps) for (const a of ANGLES) for (const mag of [10, 100]) for (const pv of pivs) {
      if (pv.x === fp.x && pv.y === fp.y) continue;
      reset();
      drag(fp, tipOf(fp, a, mag));
      drag(pv, fp);
      const answers = ['cw', 'ccw', 'zero'];
      document.querySelector(`[data-answer="${answers[n % 3]}"]`).click();
      if (!/^(Correct|Not quite)/.test(instr())) { failures.push(`no reveal @ ${fp.x},${fp.y} a=${a.toFixed(1)}`); continue; }
      const tag = `fp(${fp.x},${fp.y}) a=${a.toFixed(1)} m=${mag} piv(${pv.x},${pv.y})`;
      const b = svg.querySelector('.beam').getBoundingClientRect(), r = rect(), k = VB.w / r.width;
      const box = { x0: (b.left - r.left) * k, y0: (b.top - r.top) * k, x1: (b.right - r.left) * k, y1: (b.bottom - r.top) * k };
      if (box.x0 < 0 || box.y0 < 0 || box.x1 > VB.w || box.y1 > VB.h) {
        if (failures.length < 12) failures.push(`rotated beam leaves the viewBox @ ${tag}: ${JSON.stringify(box)}`);
      }
      const margin = Math.min(box.x0, box.y0, VB.w - box.x1, VB.h - box.y1);
      if (!worst['rotated beam margin'] || margin < worst['rotated beam margin'][0]) {
        worst['rotated beam margin'] = [+margin.toFixed(1), tag];
      }
      audit(tag, worst, failures);
      n++;
    }
    return { states: n, failures, count: failures.count || 0, byKind: failures.byKind || {}, worst };
  }

  window.H = { install, drag, fire, reset, panelText, instr, w2c, tipOf, snapshot, audit, phase1, phase2, phase3, ANGLES };
})();
