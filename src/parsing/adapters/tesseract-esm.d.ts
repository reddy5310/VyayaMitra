// The pre-bundled browser build of Tesseract.js. Importing it by path gives the lazy chunk a stable
// name ("tesseract.esm.min-*.js") that the PWA config can keep out of the install-time precache.
declare module 'tesseract.js/dist/tesseract.esm.min.js' {
  import * as T from 'tesseract.js';
  const tesseract: typeof T;
  export default tesseract;
}
