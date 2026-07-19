// tests/diff-visit-fields.test.js
const { readApp, extractBlocks } = require('./extract');

const src = readApp();
const code = extractBlocks(src, ['diffVisitFields']);
// eslint-disable-next-line no-eval
eval(code + `\nglobal.diffVisitFields = diffVisitFields;`);

function run(t) {
  t.ok('identical visits -> no changed fields',
    diffVisitFields({ soap: { s: 'a' } }, { soap: { s: 'a' } }).length === 0);

  t.ok('changed SOAP field is detected',
    diffVisitFields({ soap: { s: 'a' } }, { soap: { s: 'b' } }).length > 0);

  t.ok('changed medications is detected',
    diffVisitFields({ medications: [] }, { medications: [{ name: 'x' }] }).length > 0);

  t.ok('undefined before/after does not throw', (() => {
    diffVisitFields(undefined, undefined);
    diffVisitFields({}, {});
    return true;
  })());
}

module.exports = { run };
