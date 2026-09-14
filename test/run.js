// Lightweight test runner for the pure-logic modules — no VS Code, no deps.
// Run with: npm test   (which compiles first, then `node test/run.js`)
const path = require('path');
const Module = require('module');

// Resolve `require('vscode')` to the local stub.
process.env.NODE_PATH = path.join(__dirname, 'stubs') + path.delimiter + (process.env.NODE_PATH || '');
Module._initPaths();

let passed = 0;
let failed = 0;
function ok(name, cond) {
  if (cond) { passed++; console.log('  \u2713', name); }
  else { failed++; console.error('  \u2717 FAIL:', name); }
}
const has = (obj, s) => JSON.stringify(obj).includes(s);

const OUT = path.join(__dirname, '..', 'out');
const { parseUsda } = require(path.join(OUT, 'parse.js'));
const { propertyGroupRanges } = require(path.join(OUT, 'groups.js'));
const { lintUsda } = require(path.join(OUT, 'lint.js'));
const { buildRelations } = require(path.join(OUT, 'relations.js'));
const { scoreUsdCandidate, isUsdPath } = require(path.join(OUT, 'jump.js'));
const { findDeactivations, removeDeactivations, partitionByPrefix, toggleGroup } = require(path.join(OUT, 'deactivations.js'));

console.log('parse');
{
  const doc = '#usda 1.0\ndef Xform "root" {\n  def Sphere "ball" {\n  }\n  over "child" {}\n}\n';
  const prims = parseUsda(doc);
  ok('returns an array', Array.isArray(prims));
  ok('finds the root prim', prims.some(p => p.name === 'root'));
  ok('captures nested prims', has(prims, 'ball') && has(prims, 'child'));
}

console.log('groups');
{
  const doc = 'def "x" {\n' +
    '  rel collection:a:includes = </a>\n' +
    '  rel collection:a:excludes = </b>\n' +
    '  token outputs:surface.connect = </m>\n' +
    '  double radius = 1\n}\n';
  const ranges = propertyGroupRanges(doc, ['collection:', 'material:binding']);
  ok('returns ranges for a same-namespace run', Array.isArray(ranges) && ranges.length >= 1);
}

console.log('lint');
{
  // "xformOp:rotateX" is listed in the order but never defined -> should be flagged.
  const doc = '#usda 1.0\ndef Xform "a" {\n' +
    '  float3 xformOp:translate = (0, 0, 0)\n' +
    '  uniform token[] xformOpOrder = ["xformOp:translate", "xformOp:rotateX"]\n}\n';
  const lints = lintUsda(doc);
  ok('returns an array', Array.isArray(lints));
  ok('flags the dangling xformOp:rotateX', has(lints, 'rotateX'));
}

console.log('relations');
{
  const doc = '#usda 1.0\n' +
    'def "L" {\n  rel mtl = </Looks/M>\n}\n' +
    'def "Looks" {\n  def "M" {}\n}\n';
  const rel = buildRelations(doc);
  const fromCount = rel.byFrom instanceof Map ? rel.byFrom.size : Object.keys(rel.byFrom || {}).length;
  ok('indexes at least one edge', fromCount >= 1);
}

console.log('jump');
{
  ok('isUsdPath matches .usda', isUsdPath('/x/a.usda', ['.usda', '.usd']) === true);
  ok('isUsdPath matches .usd', isUsdPath('/x/a.usd', ['.usda', '.usd']) === true);
  ok('isUsdPath rejects .nk', isUsdPath('/x/comp.nk', ['.usda', '.usd']) === false);
  ok('isUsdPath honours added .usdc', isUsdPath('/x/a.usdc', ['.usda', '.usd', '.usdc']) === true);

  const refName = 'shot010';
  const files = [
    ['lookdev/lgt/lighting.usda', 'lighting.usda'],
    ['geo/geo.usda', 'geo.usda'],
    ['payload.usda', 'payload.usda'],
    ['shot010.usda', 'shot010.usda'],
  ];
  const top = files
    .map(([rel, f]) => ({ rel, s: scoreUsdCandidate(rel, f, refName) }))
    .sort((a, b) => b.s - a.s)[0].rel;
  ok('scores the folder-name match at root highest', top === 'shot010.usda');
}

console.log('deactivations');
{
  const doc = '#usda 1.0\n' +
    'def Xform "shot"\n{\n' +
    '    over "Vars"\n    {\n' +
    '        over "key" (\n            active = false\n        )\n        {\n        }\n' +
    '        over "fill" (\n            active = false\n        )\n        {\n        }\n' +
    '    }\n' +
    '    over "Keep" (\n        kind = "assembly"\n    )\n    {\n' +
    '        over "rim" (\n            active = false\n        )\n        {\n        }\n' +
    '        double x = 1\n    }\n}\n';

  const found = findDeactivations(doc);
  ok('finds every active = false prim', found.length === 3);
  ok('builds full prim paths', found.some(d => d.path === '/shot/Vars/key'));

  const underVars = found.filter(d => d.parentPath === '/shot/Vars');
  const pruned = removeDeactivations(doc, underVars, true);
  ok('deletes the selected blocks', !/over "fill"/.test(pruned));
  ok('prunes the now-empty over "Vars"', !/over "Vars"/.test(pruned));
  ok('keeps siblings with content', /over "Keep"/.test(pruned) && /double x = 1/.test(pruned));
  ok('leaves no double blank line at the cut', !/\n\s*\n\s*\n/.test(pruned));

  const kept = removeDeactivations(doc, underVars, false);
  ok('pruning off keeps the empty parent', /over "Vars"/.test(kept));

  const partial = removeDeactivations(doc, [found[0]], true);
  ok('partial delete keeps a still-populated parent', /over "Vars"/.test(partial) && /over "fill"/.test(partial));

  ok('ignores a commented-out active = false',
    findDeactivations('#usda 1.0\nover "c" (\n  # active = false\n  kind = "group"\n)\n{\n}\n').length === 0);
  ok('ignores active = true', findDeactivations('#usda 1.0\nover "z" ( active = true ) {}\n').length === 0);

  // A deactivated prim that ALSO declares/overrides content: keep the content,
  // strip only the deactivation (regression: we used to delete the whole block).
  const withBody = '#usda 1.0\n' +
    'over "Vars"\n{\n' +
    '    over "key" (\n        active = false\n    )\n    {\n' +
    '        float customExposure = 2.0\n        color3f myColor = (1, 0, 0)\n' +
    '    }\n}\n';
  {
    const f = findDeactivations(withBody);
    const out = removeDeactivations(withBody, f, true);
    ok('block with content is kept', /over "key"/.test(out));
    ok('its declarations are preserved', /customExposure/.test(out) && /myColor/.test(out));
    ok('only active = false is removed', !/active\s*=\s*false/.test(out));
    ok('parent kept (child not emptied)', /over "Vars"/.test(out));
  }

  // Extra metadata beside active = false: keep the other metadata.
  const multiMeta = '#usda 1.0\nover "k" (\n    active = false\n    kind = "group"\n)\n{\n}\n';
  {
    const out = removeDeactivations(multiMeta, findDeactivations(multiMeta), true);
    ok('keeps sibling metadata (kind)', /kind\s*=\s*"group"/.test(out));
    ok('drops active = false', !/active\s*=\s*false/.test(out));
    ok('keeps the over (still has metadata)', /over "k"/.test(out));
  }

  // Pure empty scaffolding still gets cleaned up entirely.
  const emptyScaffold = '#usda 1.0\nover "Vars"\n{\n    over "key" (\n        active = false\n    )\n    {\n    }\n}\n';
  {
    const out = removeDeactivations(emptyScaffold, findDeactivations(emptyScaffold), true);
    ok('empty deactivation block is removed', !/over "key"/.test(out));
    ok('emptied parent is pruned', !/over "Vars"/.test(out));
  }
}

console.log('deactivation grouping');
{
  const doc = '#usda 1.0\n' +
    'over "Vars"\n{\n' +
    '    over "LGT_key" ( active = false ) {}\n' +
    '    over "bgGeo" ( active = false ) {}\n' +
    '    over "LGT_fill" ( active = false ) {}\n' +
    '    over "lgt_rim" ( active = false ) {}\n' +
    '}\n';
  const found = findDeactivations(doc);
  ok('finds all four', found.length === 4);

  const { matching, others } = partitionByPrefix(found, 'LGT_');
  ok('groups the LGT_ prims', matching.length === 2);
  ok('matching are the prefixed ones', matching.every(d => d.name.startsWith('LGT_')));
  ok('keeps document order in the group', matching[0].name === 'LGT_key' && matching[1].name === 'LGT_fill');
  ok('everything else lands in others', others.length === 2);
  ok('matching is case-sensitive', others.some(d => d.name === 'lgt_rim'));
  ok('no prim is lost or duplicated', matching.length + others.length === found.length);

  // An empty prefix disables the split.
  const flat = partitionByPrefix(found, '');
  ok('empty prefix groups nothing', flat.matching.length === 0 && flat.others.length === 4);

  // A prefix nothing matches leaves one populated group.
  const none = partitionByPrefix(found, 'CAM_');
  ok('unmatched prefix yields an empty group', none.matching.length === 0 && none.others.length === 4);

  // All-matching: `others` stays empty.
  const allDoc = '#usda 1.0\nover "LGT_a" ( active = false ) {}\nover "LGT_b" ( active = false ) {}\n';
  const all = partitionByPrefix(findDeactivations(allDoc), 'LGT_');
  ok('all-prefixed leaves others empty', all.matching.length === 2 && all.others.length === 0);

  // Grouping must not disturb the edit itself: removing only the LGT_ group
  // leaves the others deactivated.
  const out = removeDeactivations(doc, matching, true);
  ok('selected group is re-activated', !/LGT_key/.test(out) && !/LGT_fill/.test(out));
  ok('untouched prims keep active = false', /"bgGeo" \( active = false \)/.test(out) && /"lgt_rim" \( active = false \)/.test(out));
  ok('parent survives (still has content)', /over "Vars"/.test(out));
}

console.log('group toggle');
{
  const lgt = ['LGT_key', 'LGT_fill'];
  const rest = ['bgGeo', 'lgt_rim'];

  // From an empty selection each button ticks its own group.
  const onlyLgt = toggleGroup([], lgt);
  ok('ticks the whole group', onlyLgt.length === 2 && lgt.every(x => onlyLgt.includes(x)));

  // The two groups are independent switches: ticking one keeps the other.
  const both = toggleGroup(onlyLgt, rest);
  ok('second group adds without dropping the first', both.length === 4);
  ok('first group survives', lgt.every(x => both.includes(x)));

  // Pressing the same button again clears only that group.
  const backToRest = toggleGroup(both, lgt);
  ok('re-press clears its own group', lgt.every(x => !backToRest.includes(x)));
  ok('re-press keeps the other group', rest.every(x => backToRest.includes(x)));

  // A partially-ticked group completes rather than clearing.
  const partial = toggleGroup(['LGT_key'], lgt);
  ok('partial group completes', partial.length === 2 && partial.includes('LGT_fill'));
  ok('completing does not duplicate', partial.filter(x => x === 'LGT_key').length === 1);

  // Manual ticks outside any group are never disturbed.
  const manual = toggleGroup(['bgGeo'], lgt);
  ok('unrelated ticks are kept', manual.includes('bgGeo') && manual.length === 3);

  ok('empty group is a no-op', toggleGroup(['bgGeo'], []).length === 1);
  ok('does not mutate the input', (() => { const src = ['bgGeo']; toggleGroup(src, lgt); return src.length === 1; })());
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
