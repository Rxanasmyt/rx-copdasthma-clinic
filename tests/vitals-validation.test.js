// tests/vitals-validation.test.js
const { readApp, extractBlocks } = require('./extract');

const src = readApp();
const code = extractBlocks(src, ['validateVitalsRange']);
// eslint-disable-next-line no-eval
eval(code + `\nglobal.validateVitalsRange = validateVitalsRange;`);

function run(t) {
  t.ok('empty vitals -> no errors', Object.keys(validateVitalsRange({})).length === 0);
  t.ok('normal vitals -> no errors', Object.keys(validateVitalsRange({ spO2: '96', rr: '18', bp: '130/80', fev1: '65', peakFlow: '350' })).length === 0);

  t.ok('SpO2 > 100 -> error', !!validateVitalsRange({ spO2: '150' }).spO2);
  t.ok('SpO2 negative -> error', !!validateVitalsRange({ spO2: '-5' }).spO2);
  t.ok('SpO2 100 (boundary) -> no error', !validateVitalsRange({ spO2: '100' }).spO2);

  t.ok('RR > 60 -> error', !!validateVitalsRange({ rr: '999' }).rr);
  t.ok('RR 0 (boundary) -> no error', !validateVitalsRange({ rr: '0' }).rr);

  t.ok('FEV1 > 150 -> error', !!validateVitalsRange({ fev1: '500' }).fev1);
  t.ok('peakFlow > 800 -> error', !!validateVitalsRange({ peakFlow: '9000' }).peakFlow);

  t.ok('BP malformed (no slash) -> error', !!validateVitalsRange({ bp: '13080' }).bp);
  t.ok('BP well-formed -> no error', !validateVitalsRange({ bp: '120/80' }).bp);
  t.ok('BP empty -> no error (optional field)', !validateVitalsRange({ bp: '' }).bp);
}

module.exports = { run };
