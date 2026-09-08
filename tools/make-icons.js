// Builds the icon files browsers and crawlers ask for by convention.
//
// WHY: the site declared only an inline SVG data-URI favicon, so every request
// for the conventional paths 404'd -- and they get requested a lot, by
// browsers, by crawlers, and by link-preview fetchers. Cloudflare's AI Crawl
// Control showed 28 of 84 crawler requests in a day returning 404.
//
// Source is assets/png/app-icon-1024.png (RGBA, transparent rounded corners).
//
//   /favicon.ico          16 + 32 px, alpha kept
//   /apple-touch-icon.png 180 px, flattened onto brand navy
//
// The SVG icon in the page head stays and still wins where it is supported;
// these are the fallbacks for everything that does not ask the page first.
const fs = require('fs');
const path = require('path');
const { decode, encode } = require('./lib/png.js');

const ASSETS = path.join(__dirname, '..', 'website', 'assets', 'png');
const OUT = path.join(__dirname, '..', 'website');
const NAVY = [12, 48, 84];                                   // #0C3054

const src = decode(fs.readFileSync(path.join(ASSETS, 'app-icon-1024.png')));

// Bilinear on PREMULTIPLIED alpha. Interpolating straight RGB against the
// transparent corners (which are [0,0,0,0]) drags colour toward black and
// leaves a dark fringe around the rounded edge; weighting by alpha does not.
function resize(img, size) {
  const out = { width: size, height: size, px: Buffer.alloc(size * size * 4) };
  const k = img.width / size;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      // Box-average the source cell this output pixel covers, so a 32x downscale
      // samples every source pixel rather than 4 of them.
      const x0 = Math.floor(x * k), x1 = Math.min(Math.ceil((x + 1) * k), img.width);
      const y0 = Math.floor(y * k), y1 = Math.min(Math.ceil((y + 1) * k), img.height);
      let r = 0, g = 0, b = 0, a = 0, n = 0;
      for (let sy = y0; sy < y1; sy++) {
        for (let sx = x0; sx < x1; sx++) {
          const d = (sy * img.width + sx) * 4;
          const al = img.px[d + 3] / 255;
          r += img.px[d] * al; g += img.px[d + 1] * al; b += img.px[d + 2] * al;
          a += al; n++;
        }
      }
      const d = (y * size + x) * 4;
      // Un-premultiply: divide the colour sum by the ALPHA sum, not the count.
      out.px[d] = a > 0 ? Math.round(r / a) : 0;
      out.px[d + 1] = a > 0 ? Math.round(g / a) : 0;
      out.px[d + 2] = a > 0 ? Math.round(b / a) : 0;
      out.px[d + 3] = Math.round((a / n) * 255);
      }
  }
  return out;
}

function flatten(img, bg) {
  const out = { width: img.width, height: img.height, px: Buffer.from(img.px) };
  for (let i = 0; i < img.width * img.height; i++) {
    const a = out.px[i * 4 + 3] / 255;
    for (let c = 0; c < 3; c++) {
      out.px[i * 4 + c] = Math.round(out.px[i * 4 + c] * a + bg[c] * (1 - a));
    }
    out.px[i * 4 + 3] = 255;
  }
  return out;
}

// ── ICO container. Since Vista an .ico entry may hold a whole PNG rather than
//    a raw DIB, which every browser in use understands -- so this is a 22-byte
//    header per image plus the PNGs we already know how to encode.
function ico(images) {
  const pngs = images.map((img) => encode(img));
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);              // reserved
  header.writeUInt16LE(1, 2);              // 1 = icon
  header.writeUInt16LE(images.length, 4);
  let offset = 6 + 16 * images.length;
  const entries = images.map((img, i) => {
    const e = Buffer.alloc(16);
    e[0] = img.width >= 256 ? 0 : img.width;   // 0 means 256
    e[1] = img.height >= 256 ? 0 : img.height;
    e[2] = 0;                                  // palette size
    e[3] = 0;                                  // reserved
    e.writeUInt16LE(1, 4);                     // colour planes
    e.writeUInt16LE(32, 6);                    // bits per pixel
    e.writeUInt32LE(pngs[i].length, 8);
    e.writeUInt32LE(offset, 12);
    offset += pngs[i].length;
    return e;
  });
  return Buffer.concat([header, ...entries, ...pngs]);
}

const write = (name, buf) => {
  fs.writeFileSync(path.join(OUT, name), buf);
  console.log('  ' + name.padEnd(24) + (buf.length / 1024).toFixed(1) + ' KB');
};

console.log('building icons from assets/png/app-icon-1024.png');
write('favicon.ico', ico([resize(src, 16), resize(src, 32)]));
write('apple-touch-icon.png', encode(flatten(resize(src, 180), NAVY)));
