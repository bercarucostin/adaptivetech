# Vendored browser libraries

## qrcode-generator 2.0.4

- Upstream: https://github.com/kazuhikoarase/qrcode-generator
- Distribution: https://registry.npmjs.org/qrcode-generator/-/qrcode-generator-2.0.4.tgz
- File copied unchanged: `package/dist/qrcode.js` → `qrcode-generator-2.0.4.js`.
- License: MIT, see `qrcode-generator.LICENSE` (upstream LICENSE).
- Used only to render work-order links as inline SVG. No network requests at runtime.

## SheetJS CE 0.20.3

- Official distribution: https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js
- License: Apache-2.0, see `sheetjs.LICENSE` from the same distribution.
- Copied unchanged to `xlsx-0.20.3.full.min.js`.
- Loaded in a disposable Web Worker for local Excel import/export. No CDN request or file upload is needed at runtime.
