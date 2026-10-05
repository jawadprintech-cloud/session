// Used by `build-demo.mjs --share`: the Claude artifact viewer can't offer downloads, and
// public sharing there can't review the PDF library's embedded file handling.
export class jsPDF {
  constructor() {
    throw new Error("Save to PDF is available when the builder runs on your own site.");
  }
}
