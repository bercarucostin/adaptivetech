// Builds website/assets/social/og-1200x630.png.
//
// No image tooling exists here (the `convert` on PATH is Windows' filesystem
// utility, Python is a blocked Store stub, no sharp/canvas), and the lockup
// SVG uses live <text> rather than outlined paths -- so there is no glyph
// geometry to draw from either.
//
// What there IS: a 4500x1500 banner with the lockup already rendered in the
// real brand fonts. So rather than compose type we cannot set, this lifts
// that rendered lockup and re-lays it out at the Open Graph aspect ratio.
// A centre crop was not an option: the lockup sits in the left third and the
// middle 64% a 3:1 -> 1.91:1 crop keeps would cut it in half.
const fs = require('fs');
const path = require('path');
const { decode, encode } = require('./lib/png.js');

const SOCIAL = path.join(__dirname, '..', 'website', 'assets', 'social');
const SRC = path.join(SOCIAL, 'banner-4500x1500.png');
const OUT = path.join(SOCIAL, 'og-1200x630.png');

const src = decode(fs.readFileSync(SRC));
const at = (img, x, y) => {
  const d = (y * img.width + x) * 4;
  return [img.px[d], img.px[d + 1], img.px[d + 2]];
};

// ── Tight bounds of the LEFT lockup only. Three parts, and all three must be
//    inside the box: the gold A-mark (y~460-800), the light ADAPTIVE wordmark
//    (y~950-1090, ending x~1440), and a letterspaced GOLD tagline under it
//    (y~1156-1210) that runs out to x~1926. That tagline is why the box is
//    ~1416px wide and not ~940 -- the ink past x=1440 is type, not stray
//    antialiasing, so do not 'tidy' the bounds inward.
//
//    The x<2000 cap is what keeps the SEPARATE element at x~3350-4250 from
//    dragging the box across the whole banner. It is load-bearing.
let minX = 1e9, maxX = -1, minY = 1e9, maxY = -1;
for (let y = 0; y < src.height; y++) {
  for (let x = 0; x < 2000; x++) {
    const [r, g, b] = at(src, x, y);
    const gold = r > 150 && g > 100 && b < 120;
    const light = r > 150 && g > 160 && b > 170;
    if (gold || light) {
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
    }
  }
}
console.log('lockup bounds:', minX + '..' + maxX, minY + '..' + maxY,
            '(' + (maxX - minX) + 'x' + (maxY - minY) + ')');

const BG = at(src, 2, 2);                       // the banner's own navy
const W = 1200, H = 630;
const out = { width: W, height: H, px: Buffer.alloc(W * H * 4) };
for (let i = 0; i < W * H; i++) {
  out.px[i * 4] = BG[0]; out.px[i * 4 + 1] = BG[1];
  out.px[i * 4 + 2] = BG[2]; out.px[i * 4 + 3] = 255;
}

// ── Place the lockup centred, at 62% of the canvas width. That leaves a
//    generous margin on all sides, which matters because several platforms
//    round the corners or overlay a play/label chrome at the edges.
const lw = maxX - minX + 1, lh = maxY - minY + 1;
const targetW = Math.round(W * 0.62);
const scale = targetW / lw;
const dw = Math.round(lw * scale), dh = Math.round(lh * scale);
const ox = Math.round((W - dw) / 2), oy = Math.round((H - dh) / 2);
console.log('placing', dw + 'x' + dh, 'at', ox + ',' + oy, '(scale ' + scale.toFixed(3) + ')');

// Bilinear sampling, so downscaling type stays legible rather than aliasing.
for (let y = 0; y < dh; y++) {
  for (let x = 0; x < dw; x++) {
    const sx = minX + (x / scale), sy = minY + (y / scale);
    const x0 = Math.floor(sx), y0 = Math.floor(sy);
    const x1 = Math.min(x0 + 1, src.width - 1), y1 = Math.min(y0 + 1, src.height - 1);
    const fx = sx - x0, fy = sy - y0;
    const d = ((oy + y) * W + (ox + x)) * 4;
    for (let c = 0; c < 3; c++) {
      const p = (X, Y) => src.px[(Y * src.width + X) * 4 + c];
      const top = p(x0, y0) * (1 - fx) + p(x1, y0) * fx;
      const bot = p(x0, y1) * (1 - fx) + p(x1, y1) * fx;
      out.px[d + c] = Math.round(top * (1 - fy) + bot * fy);
    }
    out.px[d + 3] = 255;
  }
}

fs.writeFileSync(OUT, encode(out));
const kb = (fs.statSync(OUT).size / 1024).toFixed(0);
console.log('wrote og-1200x630.png (' + kb + ' KB)');
