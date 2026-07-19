// tests/problem-patients.test.js
const { readApp, extractBlocks } = require('./extract');

const src = readApp();
const code = extractBlocks(src, ['getProblemPatients']);
// eslint-disable-next-line no-eval
eval(code + `\nglobal.getProblemPatients = getProblemPatients;`);

function run(t) {
  const roster = [
    { id: 'p1', hn: 'H1', name: 'A', diagnosis: 'COPD', exacerbationCount: 2, exacerbationIsApprox: false, erOrAdmit: null, hasICS: null, hasAppropriateCOPDTherapy: false, techniquePass: false, adherenceGood: false },
    { id: 'p2', hn: 'H2', name: 'B', diagnosis: 'Asthma', exacerbationCount: 0, exacerbationIsApprox: null, erOrAdmit: true, hasICS: false, hasAppropriateCOPDTherapy: null, techniquePass: true, adherenceGood: true },
    { id: 'p3', hn: 'H3', name: 'C', diagnosis: 'Both', exacerbationCount: 1, exacerbationIsApprox: true, erOrAdmit: false, hasICS: true, hasAppropriateCOPDTherapy: true, techniquePass: null, adherenceGood: false },
    { id: 'p4', hn: 'H4', name: 'D', diagnosis: 'COPD', exacerbationCount: 0, exacerbationIsApprox: null, erOrAdmit: null, hasICS: null, hasAppropriateCOPDTherapy: null, techniquePass: true, adherenceGood: true },
  ];
  const noShowRoster = [{ id: 'p5', hn: 'H5', name: 'E', diagnosis: 'COPD', nextVisit: '2026-07-01' }];

  t.ok('copdExacerbRate -> only p1 (Both patient p3 excluded)',
    JSON.stringify(getProblemPatients('copdExacerbRate', roster, noShowRoster).map(p => p.id)) === JSON.stringify(['p1']));
  t.ok('copdExacerbRate p1 reason has count', getProblemPatients('copdExacerbRate', roster).find(p => p.id === 'p1').reason === 'กำเริบ 2 ครั้ง');

  t.ok('asthmaErRate -> only p2 (Both excluded)',
    JSON.stringify(getProblemPatients('asthmaErRate', roster).map(p => p.id)) === JSON.stringify(['p2']));

  t.ok('asthmaIcsPercent -> only p2 (Asthma, hasICS false)',
    JSON.stringify(getProblemPatients('asthmaIcsPercent', roster).map(p => p.id)) === JSON.stringify(['p2']));

  t.ok('copdTherapyPercent -> only p1 (hasAppropriateCOPDTherapy===false, not null)',
    JSON.stringify(getProblemPatients('copdTherapyPercent', roster).map(p => p.id)) === JSON.stringify(['p1']));

  t.ok('techniquePercent -> only p1 (techniquePass===false, not null)',
    JSON.stringify(getProblemPatients('techniquePercent', roster).map(p => p.id)) === JSON.stringify(['p1']));

  t.ok('carePercent -> uses noShowRoster directly (p5)',
    JSON.stringify(getProblemPatients('carePercent', roster, noShowRoster).map(p => p.id)) === JSON.stringify(['p5']));
  t.ok('carePercent reason includes nextVisit date', getProblemPatients('carePercent', roster, noShowRoster)[0].reason.includes('2026-07-01'));

  t.ok('adherenceGoodPercent -> p1 and p3 (adherenceGood===false)',
    JSON.stringify(getProblemPatients('adherenceGoodPercent', roster).map(p => p.id).sort()) === JSON.stringify(['p1', 'p3']));

  t.ok('unknown metricKey -> empty array', getProblemPatients('bogusKey', roster).length === 0);
  t.ok('undefined roster/noShowRoster -> no throw, empty array', getProblemPatients('copdExacerbRate', undefined, undefined).length === 0);
}

module.exports = { run };
