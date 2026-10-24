/** pdf.js's worker entry (the part that parses documents), imported to run it in-thread inside our own worker. */
declare module 'pdfjs-dist/build/pdf.worker.min.mjs' {
  export const WorkerMessageHandler: unknown;
}
