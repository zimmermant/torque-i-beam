export const NS = 'http://www.w3.org/2000/svg';

// One palette for the whole app. It lives here rather than in each renderer
// because build.js concatenates every module into a single scope, so a
// top-level `const C1` in three files would collide and fail the build.
export const COLORS = {
  force:  '#e06c3a',   // the applied force F
  lever:  '#3a86c8',   // the lever-arm vector r
  torque: '#7c3aed',   // the torque's sense of rotation
  warn:   '#d97706',   // r that does not reach the force point
  ink:    '#111827',   // pivot, outlines, the 3-4-5 triangle
  annot:  '#9aa3af',   // muted ink for the ghost outline
  beam:   '#dbe3ec',   // the beam's web
  flange: '#94a3b8'    // the beam's flanges
};

export function el(name, attrs = {}, parent = null) {
  const node = document.createElementNS(NS, name);
  for (const k in attrs) {
    const v = attrs[k];
    if (v !== null && v !== undefined) node.setAttribute(k, String(v));
  }
  if (parent) parent.appendChild(node);
  return node;
}

export function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
}

// Text with a background-coloured halo so labels stay readable where they cross lines.
export function text(parent, x, y, str, opts = {}) {
  const node = el('text', {
    x, y,
    'font-size': opts.size || 14,
    'font-family': 'system-ui, -apple-system, sans-serif',
    'font-style': opts.italic ? 'italic' : null,
    fill: opts.fill || COLORS.ink,
    'text-anchor': opts.anchor || 'start',
    'font-weight': opts.weight || 400,
    'paint-order': 'stroke',
    stroke: '#ffffff',
    'stroke-width': opts.halo === false ? 0 : 3.5,
    'stroke-linejoin': 'round'
  }, parent);
  node.textContent = str;
  return node;
}

// Pointer position in viewBox units. Handles CSS scaling and page scroll correctly,
// which naive clientX - rect.left arithmetic does not.
export function clientToSvg(svg, clientX, clientY) {
  const pt = svg.createSVGPoint();
  pt.x = clientX;
  pt.y = clientY;
  return pt.matrixTransform(svg.getScreenCTM().inverse());
}
