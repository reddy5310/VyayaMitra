// Copies the self-hosted OCR runtime from node_modules into public/ocr/ so the app never needs a CDN.
// Wired as "predev" and "prebuild"; public/ocr/ is gitignored and regenerated on every CI build.
import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'public', 'ocr');
const nm = (...p) => join(root, 'node_modules', ...p);

/** [source, destination name] */
const FILES = [
  // Web worker that hosts the engine.
  [nm('tesseract.js', 'dist', 'worker.min.js'), 'worker.min.js'],
  // WebAssembly cores (LSTM-only). The worker picks one: relaxed-SIMD, SIMD, or plain.
  [nm('tesseract.js-core', 'tesseract-core-relaxedsimd-lstm.wasm.js'), 'tesseract-core-relaxedsimd-lstm.wasm.js'],
  [nm('tesseract.js-core', 'tesseract-core-simd-lstm.wasm.js'), 'tesseract-core-simd-lstm.wasm.js'],
  [nm('tesseract.js-core', 'tesseract-core-lstm.wasm.js'), 'tesseract-core-lstm.wasm.js'],
  // Licences travel with the redistributed files.
  [nm('tesseract.js', 'LICENSE.md'), 'LICENSE-tesseract.js.md'],
  [nm('tesseract.js-core', 'LICENSE'), 'LICENSE-tesseract.js-core.txt'],
];

mkdirSync(out, { recursive: true });
let total = 0;
for (const [src, name] of FILES) {
  if (!existsSync(src)) {
    console.error(`copy-ocr-assets: missing ${src}\nRun "npm ci" first.`);
    process.exit(1);
  }
  const dest = join(out, name);
  const size = statSync(src).size;
  if (!existsSync(dest) || statSync(dest).size !== size) copyFileSync(src, dest);
  total += size;
}
// English model: "best" accuracy, integer-quantised. It is stored DECOMPRESSED (5.2 MB, from a 2.9 MB .gz):
// the in-browser gunzip that Tesseract.js bundles (zlibjs) corrupts this file, which makes the engine fail to
// initialise; reading it uncompressed (`gzip: false` in src/parsing/adapters/ocr.ts) is reliable everywhere.
const model = nm('@tesseract.js-data', 'eng', '4.0.0_best_int', 'eng.traineddata.gz');
if (!existsSync(model)) {
  console.error(`copy-ocr-assets: missing ${model}
Run "npm ci" first.`);
  process.exit(1);
}
const modelOut = join(out, 'eng.traineddata');
const raw = gunzipSync(readFileSync(model));
if (!existsSync(modelOut) || statSync(modelOut).size !== raw.length) writeFileSync(modelOut, raw);
total += raw.length;

console.log(`copy-ocr-assets: ${FILES.length + 1} files, ${(total / 1048576).toFixed(1)} MB -> public/ocr/`);
