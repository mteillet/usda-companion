// Minimal `vscode` stub so the pure-logic modules (which import the real module
// only for *types*, erased at compile time) can be required under plain Node for
// testing. Only the few runtime members that might be touched are provided.
class Position {
  constructor(line, character) { this.line = line; this.character = character; }
}
class Range {
  constructor(a, b, c, d) {
    if (a instanceof Position) { this.start = a; this.end = b; }
    else { this.start = new Position(a, b); this.end = new Position(c, d); }
  }
}
const Uri = {
  file: (p) => ({ scheme: 'file', fsPath: p, path: p, toString: () => 'file://' + p }),
};
const FileType = { Unknown: 0, File: 1, Directory: 2, SymbolicLink: 64 };

module.exports = { Position, Range, Uri, FileType };
