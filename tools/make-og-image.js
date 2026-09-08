// Builds website/assets/social/og-1200x630.png.
//
// No image tooling exists here (the `convert` on PATH is Windows' filesystem
// utility, Python is a blocked Store stub, no sharp/canvas), and the lockup
// SVG uses live <text> rather than outlined paths -- so there is no glyph
// geometry to draw from either.
//
// What there IS: a 4500x1500 banner with the lockup already rendered in the
// real brand fonts. So rather than set type we cannot set, this lifts the
// rendered artwork out of that banner and re-lays it out.
//
// The banner stacks the lockup vertically (mark ABOVE the text). The share
// card wants it horizontal (mark BESIDE the text), which is why the three
// bands are lifted as separate blocks and repositioned, rather than the whole
// lockup being scaled as one.
const fs = require('fs');
const path = require('path');
const { decode, encode } = require('./lib/png.js');

const SOCIAL = path.join(__dirname, '..', 'website', 'assets', 'social');
const SRC = path.join(SOCIAL, 'banner-4500x1500.png');
const OUT = path.join(SOCIAL, 'og-1200x630.png');

const W = 1200, H = 630;

// Everything right of this is a SEPARATE element sitting at x~3350-4250, not
// part of the lockup. Without the cap it drags every measurement across the
// whole banner. Load-bearing.
const XCAP = 2000;

// How much of the card's width the finished lockup spans. The rest is margin,
// which matters because several platforms round the card's corners or lay
// their own chrome over its edges.
const WIDTH_FRACTION = 0.82;

const src = decode(fs.readFileSync(SRC));
const at = (x, y) => {
  const d = (y * src.width + x) * 4;
  return [src.px[d], src.px[d + 1], src.px[d + 2]];
};
const isInk = (p) => {
  const gold = p[0] > 150 && p[1] > 100 && p[2] < 120;
  const light = p[0] > 150 && p[1] > 160 && p[2] > 170;
  return gold || light;
};

// ── Find the bands by scanning for rows that carry ink, then splitting on the
//    blank rows between them. Measured rather than hardcoded, so a re-exported
//    banner still works instead of silently cropping to stale coordinates.
function findBands() {
  const inked = [];
  for (let y = 0; y < src.height; y++) {
    let n = 0;
    for (let x = 0; x < XCAP; x++) if (isInk(at(x, y))) n++;
    inked.push(n > 0);
  }
  const bands = [];
  let start = -1;
  for (let y = 0; y < src.height; y++) {
    if (inked[y] && start < 0) start = y;
    else if (!inked[y] && start >= 0) { bands.push([start, y - 1]); start = -1; }
  }
  if (start >= 0) bands.push([start, src.height - 1]);

  return bands.map(([y0, y1]) => {
    let x0 = Infinity, x1 = -1;
    for (let y = y0; y <= y1; y++) {
      for (let x = 0; x < XCAP; x++) {
        if (!isInk(at(x, y))) continue;
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
      }
    }
    return { x0, y0, x1, y1, w: x1 - x0 + 1, h: y1 - y0 + 1 };
  });
}

const bands = findBands();
// Three: the gold A-mark, the light ADAPTIVE wordmark, and a letterspaced gold
// line under it. Anything else means the banner changed shape and the layout
// below no longer describes it -- stop rather than emit a mangled card.
if (bands.length !== 3) {
  console.error('expected 3 lockup bands, found ' + bands.length);
  for (const b of bands) console.error('  y ' + b.y0 + '-' + b.y1 + '  x ' + b.x0 + '-' + b.x1);
  process.exit(1);
}

const mark = bands[0];
// The two text lines are lifted as ONE block spanning both, so their internal
// spacing and their left alignment survive exactly as the brand sets them.
const text = {
  x0: Math.min(bands[1].x0, bands[2].x0),
  y0: bands[1].y0,
  x1: Math.max(bands[1].x1, bands[2].x1),
  y1: bands[2].y1,
};
text.w = text.x1 - text.x0 + 1;
text.h = text.y1 - text.y0 + 1;

// Reuse the banner's OWN mark-to-text distance as the horizontal gap, rather
// than inventing a number: it is the spacing the brand already sets between
// these two elements.
const gap = bands[1].y0 - mark.y1;

const lockupW = mark.w + gap + text.w;
const lockupH = Math.max(mark.h, text.h);
const scale = (W * WIDTH_FRACTION) / lockupW;

console.log('mark  ' + mark.w + 'x' + mark.h + '   text ' + text.w + 'x' + text.h + '   gap ' + gap);
console.log('lockup ' + lockupW + 'x' + lockupH + ' -> scale ' + scale.toFixed(4));

const out = { width: W, height: H, px: Buffer.alloc(W * H * 4) };
const BG = at(2, 2);                                  // the banner's own navy
for (let i = 0; i < W * H; i++) {
  out.px[i * 4] = BG[0]; out.px[i * 4 + 1] = BG[1];
  out.px[i * 4 + 2] = BG[2]; out.px[i * 4 + 3] = 255;
}

// Bilinear, so downscaled type stays legible instead of aliasing to crumbs.
function draw(region, dx, dy, dw, dh) {
  const kx = region.w / dw, ky = region.h / dh;
  for (let y = 0; y < dh; y++) {
    for (let x = 0; x < dw; x++) {
      const sx = region.x0 + x * kx, sy = region.y0 + y * ky;
      const x0 = Math.floor(sx), y0 = Math.floor(sy);
      const x1 = Math.min(x0 + 1, src.width - 1), y1 = Math.min(y0 + 1, src.height - 1);
      const fx = sx - x0, fy = sy - y0;
      const d = ((dy + y) * W + (dx + x)) * 4;
      for (let c = 0; c < 3; c++) {
        const p = (X, Y) => src.px[(Y * src.width + X) * 4 + c];
        const top = p(x0, y0) * (1 - fx) + p(x1, y0) * fx;
        const bot = p(x0, y1) * (1 - fx) + p(x1, y1) * fx;
        out.px[d + c] = Math.round(top * (1 - fy) + bot * fy);
      }
      out.px[d + 3] = 255;
    }
  }
}

const dLockupW = Math.round(lockupW * scale), dLockupH = Math.round(lockupH * scale);
const ox = Math.round((W - dLockupW) / 2), oy = Math.round((H - dLockupH) / 2);

// Mark left, text right, each centred on the shared vertical axis -- the mark
// is the taller of the two, so it overhangs the text block top and bottom.
const dMarkW = Math.round(mark.w * scale), dMarkH = Math.round(mark.h * scale);
const dTextW = Math.round(text.w * scale), dTextH = Math.round(text.h * scale);

draw(mark, ox, oy + Math.round((dLockupH - dMarkH) / 2), dMarkW, dMarkH);
draw(text, ox + Math.round((mark.w + gap) * scale),
     oy + Math.round((dLockupH - dTextH) / 2), dTextW, dTextH);

fs.writeFileSync(OUT, encode(out));
console.log('wrote og-1200x630.png (' + (fs.statSync(OUT).size / 1024).toFixed(0) + ' KB)');
