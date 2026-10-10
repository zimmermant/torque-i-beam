import { DEG, detentAt } from './physics.js';
import { derive } from './state.js';
import { el, clear, text, COLORS } from './svg.js';
import { toPx, beamRects, ORIGIN_PX, FORCE_PX_PER_N } from './geometry.js';

// --- pure helpers (exported so a test can check them without a DOM) ---------
export const SWING_DEG = 18;
export const SWING_MS = 1200;
export const ARC_R = 52;
export const GLYPH_HYP_PX = 40;
export const GLYPH_OFFSET_PX = 30;

// SVG's y axis points down, so a positive SVG rotation is CLOCKWISE on screen.
export function swingTarget(truth) {
  if (truth === 'ccw') return -SWING_DEG;
  if (truth === 'cw') return SWING_DEG;
  return 0;
}

export function easeOut(t) {
  const u = 1 - Math.min(1, Math.max(0, t));
  return 1 - u * u * u;
}

// The swing starts only on ENTERING the reveal. render() runs on every state
// change; without this the beam would restart its swing every time it did.
export function shouldStartSwing(prevStep, step) {
  return step === 'reveal' && prevStep !== 'reveal';
}

export function arrowPx(forcePoint, F) {
  const from = toPx(forcePoint);
  return { from, to: { x: from.x + F.x * FORCE_PX_PER_N, y: from.y - F.y * FORCE_PX_PER_N } };
}

// Smallest distance between an axis-aligned box and a segment (sampled).
export function boxSegDist(b, p, q) {
  let m = Infinity;
  for (let i = 0; i <= 60; i++) {
    const t = i / 60, x = p.x + t * (q.x - p.x), y = p.y + t * (q.y - p.y);
    m = Math.min(m, Math.hypot(Math.max(b.x0 - x, 0, x - b.x1), Math.max(b.y0 - y, 0, y - b.y1)));
  }
  return m;
}

// Gap between two boxes; negative when they overlap.
export function boxGap(a, b) {
  return Math.max(b.x0 - a.x1, a.x0 - b.x1, b.y0 - a.y1, a.y0 - b.y1);
}

// The box a short label occupies. x, y is the text's anchor point and baseline.
export function labelBox(x, y, w, anchor) {
  const x0 = anchor === 'start' ? x : anchor === 'end' ? x - w : x - w / 2;
  return { x0, y0: y - 14, x1: x0 + w, y1: y + 5 };
}

// A candidate label position that clears everything by at least this much is
// "clear". The first clear candidate in priority order wins, so a label stays
// where it is while the user drags and only moves when something gets in its way.
export const CLEAR_GOOD = 10;

// Choose among candidates ({ x, y, anchor, w }, in priority order) against
// obstacles ({ segments: [{p,q}], boxes: [{x0,y0,x1,y1}], beam: {x0,y0,x1,y1} }).
// Touching a line or another label is a real collision; sitting on the beam's
// grey fill is only a preference, because a label has a white halo and reads
// fine there. So: the first candidate that is clear AND off the beam; failing
// that, the first that is merely clear; failing that, the one with the most room.
export function pickLabel(candidates, obstacles) {
  const scored = candidates.map(c => {
    const box = labelBox(c.x, c.y, c.w, c.anchor);
    let clear = Infinity;
    for (const sg of obstacles.segments) clear = Math.min(clear, boxSegDist(box, sg.p, sg.q));
    for (const bx of obstacles.boxes) clear = Math.min(clear, boxGap(box, bx));
    const onBeam = obstacles.beam ? boxGap(box, obstacles.beam) < 0 : false;
    return { ...c, clear, onBeam };
  });
  return scored.find(c => c.clear >= CLEAR_GOOD && !c.onBeam) ||
         scored.find(c => c.clear >= CLEAR_GOOD) ||
         scored.reduce((best, c) => (c.clear > best.clear + 1e-9 ? c : best));
}

// "F" goes just beyond the arrow's tip; if something is there, swing round the
// tip to either side.
export function forceLabelCandidates(from, to, gap = 18) {
  const len = Math.hypot(to.x - from.x, to.y - from.y) || 1;
  const ux = (to.x - from.x) / len, uy = (to.y - from.y) / len;
  const out = [];
  for (const g of [gap, gap + 12]) for (const deg of [0, 50, -50, 100, -100, 150, -150]) {
    const c = Math.cos(deg * DEG), sn = Math.sin(deg * DEG);
    const vx = ux * c - uy * sn, vy = ux * sn + uy * c;
    out.push({ x: to.x + vx * g, y: to.y + vy * g + 5, w: 14,
               anchor: vx > 0.3 ? 'start' : vx < -0.3 ? 'end' : 'middle' });
  }
  return out;
}

// "r" goes above the middle of the lever arm; if something is there, try below,
// other places along it, and nearer in.
export function leverLabelCandidates(from, to) {
  const dx = to.x - from.x, dy = to.y - from.y;
  const len = Math.hypot(dx, dy) || 1;
  let nx = -dy / len, ny = dx / len;
  if (ny > 1e-9 || (Math.abs(ny) <= 1e-9 && nx < 0)) { nx = -nx; ny = -ny; }
  const out = [];
  for (const off of [36, 26, 50, 64]) for (const t of [0.5, 0.3, 0.7, 0.2, 0.8]) for (const side of [1, -1]) {
    out.push({ x: from.x + t * dx + side * nx * off, y: from.y + t * dy + side * ny * off + 5,
               w: 12, anchor: 'middle' });
  }
  return out;
}

// The curved arrow around the pivot showing the sense of rotation. Angles are
// maths angles (counterclockwise from +x, y up); the arc stays above the beam
// where it can.
export function torqueArc(pivotPx, truth) {
  if (truth !== 'ccw' && truth !== 'cw') return null;
  const a0 = truth === 'ccw' ? 30 : 150;
  const a1 = truth === 'ccw' ? 150 : 30;
  const pt = a => ({ x: pivotPx.x + ARC_R * Math.cos(a * DEG), y: pivotPx.y - ARC_R * Math.sin(a * DEG) });
  const p0 = pt(a0), p1 = pt(a1);
  const sweep = a1 > a0 ? 0 : 1;
  return { start: p0, end: p1, a0, a1, sweep, d: `M ${p0.x} ${p0.y} A ${ARC_R} ${ARC_R} 0 0 ${sweep} ${p1.x} ${p1.y}` };
}

// The torque arc as a short polyline, so the labels can keep clear of it.
export function arcSegments(pivotPx, truth, n = 12) {
  const arc = torqueArc(pivotPx, truth);
  if (!arc) return [];
  const pt = a => ({ x: pivotPx.x + ARC_R * Math.cos(a * DEG), y: pivotPx.y - ARC_R * Math.sin(a * DEG) });
  const out = [];
  let prev = pt(arc.a0);
  for (let i = 1; i <= n; i++) {
    const next = pt(arc.a0 + (arc.a1 - arc.a0) * i / n);
    out.push({ p: prev, q: next });
    prev = next;
  }
  return out;
}

// The small black slope triangle drawn beside a 3-4-5 force arrow, like the one
// in a textbook figure. Its hypotenuse is parallel to the arrow, its legs are
// horizontal and vertical, and it sits on the side of the arrow away from the
// beam's centre line so it does not land on the beam.
//   opts.offset -- how far from the arrow's middle (default GLYPH_OFFSET_PX)
//   opts.flip   -- put it on the OTHER side of the arrow from the default
export function tripleGlyph(from, to, detent, opts = {}) {
  const offset = opts.offset || GLYPH_OFFSET_PX;
  const dir = { x: detent.sx * detent.run / detent.hyp, y: -detent.sy * detent.rise / detent.hyp };
  const mid = { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 };
  let n = { x: -dir.y, y: dir.x };
  const farUp = Math.abs(mid.y - n.y * offset - ORIGIN_PX.y);
  const farDown = Math.abs(mid.y + n.y * offset - ORIGIN_PX.y);
  if (farUp > farDown || (farUp === farDown && n.y > 0)) n = { x: -n.x, y: -n.y };
  if (opts.flip) n = { x: -n.x, y: -n.y };
  const c = { x: mid.x + n.x * offset, y: mid.y + n.y * offset };
  const a = { x: c.x - dir.x * GLYPH_HYP_PX / 2, y: c.y - dir.y * GLYPH_HYP_PX / 2 };
  const b = { x: c.x + dir.x * GLYPH_HYP_PX / 2, y: c.y + dir.y * GLYPH_HYP_PX / 2 };
  // the right-angle vertex: of the two candidates, the one farther from the arrow
  const v1 = { x: b.x, y: a.y }, v2 = { x: a.x, y: b.y };
  const side = v => (v.x - c.x) * n.x + (v.y - c.y) * n.y;
  const v = side(v1) >= side(v2) ? v1 : v2;
  const centroid = { x: (a.x + b.x + v.x) / 3, y: (a.y + b.y + v.y) / 3 };
  const horiz = v === v1 ? { p: a, q: v } : { p: v, q: b };   // the leg on the line y = const
  const vert = v === v1 ? { p: v, q: b } : { p: a, q: v };    // the leg on the line x = const
  const hm = { x: (horiz.p.x + horiz.q.x) / 2, y: (horiz.p.y + horiz.q.y) / 2 };
  const vm = { x: (vert.p.x + vert.q.x) / 2, y: (vert.p.y + vert.q.y) / 2 };
  const hSign = hm.y >= centroid.y ? 1 : -1;
  const vSign = vm.x >= centroid.x ? 1 : -1;
  const hypMid = c;
  let hn = { x: -dir.y, y: dir.x };
  if ((v.x - c.x) * hn.x + (v.y - c.y) * hn.y > 0) hn = { x: -hn.x, y: -hn.y };   // away from the vertex
  return {
    a, b, v, centroid,
    labels: [
      { text: String(detent.run),  x: hm.x, y: hm.y + (hSign > 0 ? 15 : -7), anchor: 'middle' },
      { text: String(detent.rise), x: vm.x + vSign * 8, y: vm.y + 4, anchor: vSign > 0 ? 'start' : 'end' },
      { text: String(detent.hyp),  x: hypMid.x + hn.x * 13, y: hypMid.y + hn.y * 13 + 4, anchor: 'middle' }
    ]
  };
}

// Where the triangle could go: the default spot, further out, and the far side
// of the arrow, in that order.
export function glyphCandidates(from, to, detent) {
  const out = [];
  for (const [flip, offset] of [[false, 30], [false, 44], [true, 30], [true, 44], [false, 58], [true, 58]]) {
    out.push(tripleGlyph(from, to, detent, { flip, offset }));
  }
  return out;
}

// Distance between two segments (sampled).
export function segSegDist(p1, q1, p2, q2) {
  const pointSeg = (pt, a, b) => {
    const dx = b.x - a.x, dy = b.y - a.y, len2 = dx * dx + dy * dy || 1;
    const t = Math.min(1, Math.max(0, ((pt.x - a.x) * dx + (pt.y - a.y) * dy) / len2));
    return Math.hypot(pt.x - (a.x + t * dx), pt.y - (a.y + t * dy));
  };
  let m = Infinity;
  for (let i = 0; i <= 24; i++) {
    const t = i / 24;
    m = Math.min(m,
      pointSeg({ x: p1.x + t * (q1.x - p1.x), y: p1.y + t * (q1.y - p1.y) }, p2, q2),
      pointSeg({ x: p2.x + t * (q2.x - p2.x), y: p2.y + t * (q2.y - p2.y) }, p1, q1));
  }
  return m;
}

// How much room a whole glyph (its three edges and its three digits) leaves
// round the obstacles.
export function glyphClear(g, obstacles) {
  const edges = [{ p: g.a, q: g.b }, { p: g.b, q: g.v }, { p: g.v, q: g.a }];
  const boxes = g.labels.map(l => labelBox(l.x, l.y, 16, l.anchor));
  let clear = Infinity;
  for (const sg of obstacles.segments) {
    for (const e of edges) clear = Math.min(clear, segSegDist(e.p, e.q, sg.p, sg.q));
    for (const bx of boxes) clear = Math.min(clear, boxSegDist(bx, sg.p, sg.q));
  }
  for (const ob of obstacles.boxes) for (const bx of boxes) clear = Math.min(clear, boxGap(bx, ob));
  return clear;
}

export const GLYPH_CLEAR_GOOD = 6;

// The first candidate with room; failing that, the one with the most.
export function pickGlyph(candidates, obstacles) {
  const scored = candidates.map(g => ({ g, clear: glyphClear(g, obstacles) }));
  const good = scored.find(c => c.clear >= GLYPH_CLEAR_GOOD);
  if (good) return good.g;
  return scored.reduce((best, c) => (c.clear > best.clear + 1e-9 ? c : best)).g;
}

// Where everything goes, as a pure function of the state and the step, so a test
// can sweep it without a DOM. The shapes are placed first and the labels after,
// so each label can see every shape it must keep clear of.
//   arrow       { from, to } of the force, in px, or null
//   glyph       the 3-4-5 triangle, or null
//   leverSeg    { p, q } of the lever arm, or null (also null when r = 0)
//   arcSegs     the torque arc as a polyline (reveal only)
//   forceLabel  { x, y, anchor, w, clear } for "F", or null
//   leverLabel  likewise for "r"
export function layoutScene(s, step) {
  const d = derive(s);
  const pivotPx = s.pivot ? toPx(s.pivot) : null;
  const bt = toPx({ x: -2.5, y: 0.25 }), bb = toPx({ x: 2.5, y: -0.25 });
  const beamBox = { x0: bt.x, y0: bt.y, x1: bb.x, y1: bb.y };
  const arrow = s.forcePoint && d.F ? arrowPx(s.forcePoint, d.F) : null;
  const detent = s.force ? detentAt(s.force.angle) : null;
  const leverSeg = pivotPx && d.r && (d.r.x !== 0 || d.r.y !== 0)
    ? { p: pivotPx, q: d.rValid ? toPx(s.forcePoint) : toPx(s.rTip) } : null;
  const arcSegs = step === 'reveal' && pivotPx ? arcSegments(pivotPx, d.truth) : [];
  const glyph = arrow && detent && detent.kind === 'triple'
    ? pickGlyph(glyphCandidates(arrow.from, arrow.to, detent), {
        segments: [...arcSegs, { p: arrow.from, q: arrow.to }, ...(leverSeg ? [leverSeg] : [])],
        boxes: [] })
    : null;

  const around = { segments: [...arcSegs], boxes: [], beam: beamBox };
  if (glyph) {
    around.segments.push({ p: glyph.a, q: glyph.b }, { p: glyph.b, q: glyph.v }, { p: glyph.v, q: glyph.a });
    for (const l of glyph.labels) around.boxes.push(labelBox(l.x, l.y, 16, l.anchor));
  }

  let forceLabel = null;
  if (arrow) {
    forceLabel = pickLabel(forceLabelCandidates(arrow.from, arrow.to), {
      segments: [...around.segments, { p: arrow.from, q: arrow.to }, ...(leverSeg ? [leverSeg] : [])],
      boxes: around.boxes, beam: beamBox });
  }
  let leverLabel = null;
  if (leverSeg) {
    leverLabel = pickLabel(leverLabelCandidates(leverSeg.p, leverSeg.q), {
      segments: [...around.segments, ...(arrow ? [{ p: arrow.from, q: arrow.to }] : [])],
      boxes: [...around.boxes, ...(forceLabel ? [labelBox(forceLabel.x, forceLabel.y, forceLabel.w, forceLabel.anchor)] : [])],
      beam: beamBox });
  }
  return { d, pivotPx, arrow, glyph, leverSeg, arcSegs, forceLabel, leverLabel };
}

// --- drawing ----------------------------------------------------------------
export function createScene(svg) {
  const defs = el('defs', {}, svg);
  for (const [key, color] of [['force', COLORS.force], ['lever', COLORS.lever],
                              ['warn', COLORS.warn], ['torque', COLORS.torque]]) {
    const m = el('marker', {
      id: `head-${key}`, viewBox: '0 0 10 10', refX: 8, refY: 5,
      markerWidth: 6, markerHeight: 6, orient: 'auto-start-reverse'
    }, defs);
    el('path', { d: 'M 0 0 L 10 5 L 0 10 z', fill: color }, m);
  }
  const drawRoot = el('g', {}, svg);
  const handleRoot = el('g', {}, svg);

  let latest = null;
  let prevStep = null;
  let pose = 0;                 // the beam's current swing, in SVG degrees
  let frame = null;

  function reducedMotion() {
    return typeof window.matchMedia === 'function' &&
           window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  function stopSwing(toPose) {
    if (frame !== null) cancelAnimationFrame(frame);
    frame = null;
    pose = toPose;
  }

  function startSwing() {
    stopSwing(0);
    const target = swingTarget(derive(latest.s).truth);
    if (target === 0 || reducedMotion()) { pose = target; return; }
    const t0 = performance.now();
    const tick = now => {
      const t = (now - t0) / SWING_MS;
      pose = target * easeOut(t);
      draw();
      frame = t < 1 ? requestAnimationFrame(tick) : null;
    };
    frame = requestAnimationFrame(tick);
  }

  function handle(kind, px, color, cls) {
    const g = el('g', { class: `handle ${cls}`, 'data-h': kind,
                        transform: `translate(${px.x} ${px.y})` }, handleRoot);
    el('circle', { class: 'hit', r: 22, fill: 'transparent' }, g);
    el('circle', { class: 'dot', r: 8, fill: '#fff', stroke: color, 'stroke-width': 3 }, g);
  }

  function draw() {
    const { s, view } = latest;
    const step = view.step, drag = view.drag;
    const { d, pivotPx, arrow, glyph, leverSeg, forceLabel, leverLabel } = layoutScene(s, step);
    clear(drawRoot);
    clear(handleRoot);

    const armed = step === 'place' || step === 'aim' || step === 'pivot' || step === 'draw';

    // the ghost of the beam where it started, once it has moved
    if (Math.abs(pose) > 0.01) {
      const top = toPx({ x: -2.5, y: 0.25 }), bot = toPx({ x: 2.5, y: -0.25 });
      el('rect', { x: top.x, y: top.y, width: bot.x - top.x, height: bot.y - top.y,
                   fill: 'none', stroke: COLORS.annot, 'stroke-width': 2,
                   'stroke-dasharray': '6 5' }, drawRoot);
    }

    // the beam, turning about the pivot
    const beam = el('g', { class: `beam${armed ? ' beam--armed' : ''}` }, drawRoot);
    if (pivotPx && Math.abs(pose) > 0.01) {
      beam.setAttribute('transform', `rotate(${pose} ${pivotPx.x} ${pivotPx.y})`);
    }
    for (const r of beamRects()) {
      const p0 = toPx({ x: r.x0, y: r.y1 }), p1 = toPx({ x: r.x1, y: r.y0 });
      el('rect', {
        class: r.role === 'web' ? 'beam-web' : 'beam-flange',
        x: p0.x, y: p0.y, width: p1.x - p0.x, height: p1.y - p0.y,
        fill: r.role === 'web' ? COLORS.beam : COLORS.flange,
        stroke: COLORS.ink, 'stroke-width': 1.5
      }, beam);
    }

    // the force arrow, its label, and the 3-4-5 triangle when it applies
    if (arrow) {
      const { from, to } = arrow;
      el('line', { x1: from.x, y1: from.y, x2: to.x, y2: to.y, stroke: COLORS.force,
                   'stroke-width': 4, 'marker-end': 'url(#head-force)' }, drawRoot);
      const lp = forceLabel;
      text(drawRoot, lp.x, lp.y, 'F', { fill: COLORS.force, weight: 700, italic: true, anchor: lp.anchor, size: 17 });
      if (glyph) {
        el('polygon', { points: `${glyph.a.x},${glyph.a.y} ${glyph.b.x},${glyph.b.y} ${glyph.v.x},${glyph.v.y}`,
                        fill: 'none', stroke: COLORS.ink, 'stroke-width': 2,
                        'stroke-linejoin': 'round' }, drawRoot);
        for (const l of glyph.labels) text(drawRoot, l.x, l.y, l.text, { size: 12, weight: 600, anchor: l.anchor });
      }
    }

    // the lever arm: solid when it reaches the force point, dashed amber when not
    if (leverSeg) {
      const color = d.rValid ? COLORS.lever : COLORS.warn;
      el('line', { x1: leverSeg.p.x, y1: leverSeg.p.y, x2: leverSeg.q.x, y2: leverSeg.q.y, stroke: color,
                   'stroke-width': 4, 'stroke-dasharray': d.rValid ? null : '8 5',
                   'marker-end': `url(#head-${d.rValid ? 'lever' : 'warn'})` }, drawRoot);
      text(drawRoot, leverLabel.x, leverLabel.y, 'r', { fill: color, weight: 700, italic: true, anchor: leverLabel.anchor, size: 17 });
    }

    // the sense of rotation, once revealed
    if (step === 'reveal' && pivotPx) {
      const arc = torqueArc(pivotPx, d.truth);
      if (arc) {
        el('path', { d: arc.d, fill: 'none', stroke: COLORS.torque, 'stroke-width': 4,
                     'marker-end': 'url(#head-torque)' }, drawRoot);
      }
    }

    // handles: the markers themselves, and the things a press can grab
    if (s.forcePoint) {
      const live = step === 'aim';
      handle('force', toPx(s.forcePoint), COLORS.force,
             `${live ? '' : 'handle--idle'}${drag === 'force' ? ' handle--active' : ''}`);
    }
    if (pivotPx) {
      const live = step === 'draw';
      handle('pivot', pivotPx, COLORS.ink,
             `${live ? '' : 'handle--idle'}${drag === 'r' ? ' handle--active' : ''}`);
    }
    if (s.rTip && !d.rValid) {
      handle('rtip', toPx(s.rTip), COLORS.warn, drag === 'r' ? 'handle--active' : '');
    }
  }

  function render(s, view) {
    latest = { s, view };
    if (shouldStartSwing(prevStep, view.step)) startSwing();
    else if (view.step !== 'reveal' && prevStep === 'reveal') stopSwing(0);
    prevStep = view.step;
    draw();
  }

  function replay() {
    if (!latest || latest.view.step !== 'reveal') return;
    startSwing();
    draw();
  }

  return { render, replay };
}
