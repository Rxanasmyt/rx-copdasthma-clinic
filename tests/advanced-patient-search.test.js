// tests/advanced-patient-search.test.js
// ── ทดสอบ advancedPatientSearch: ค้นหาผู้ป่วยแบบผสมหลายเงื่อนไข ทั้งทะเบียน ──
const { readApp, extractBlocks } = require('./extract');

const src = readApp();
const code = extractBlocks(src, [
  'COMMON_MEDICATIONS', 'RESP_DRUG_KEYWORDS', 'classifyRespiratoryMed',
  'RX_KPI_ENUMS', 'isTechniquePass', 'isAdherenceGood', 'advancedPatientSearch',
]);
// eslint-disable-next-line no-eval
eval(code + `
global.classifyRespiratoryMed = classifyRespiratoryMed;
global.RX_KPI_ENUMS = RX_KPI_ENUMS;
global.isTechniquePass = isTechniquePass;
global.isAdherenceGood = isAdherenceGood;
global.advancedPatientSearch = advancedPatientSearch;
`);

const mkPatient = (id, dx, extra) => ({ id, hn: 'HN' + id, prefix: '', firstName: 'P' + id, lastName: 'Last', diagnosis: dx, ...extra });

function run(t) {
  const patients = [
    mkPatient('p1', 'COPD', { riskLevel: 'High' }),
    mkPatient('p2', 'Asthma', { riskLevel: 'Low' }),
    mkPatient('p3', 'Asthma', { riskLevel: 'Medium' }),
    mkPatient('p4', 'COPD'), // riskLevel ไม่ระบุ -> ต้องเทียบเท่า 'Low'
  ];
  const visits = [
    // p1: COPD, ยา LABA/LAMA, เทคนิคผ่าน, adherence ดี, มาล่าสุด 2026-08-01
    { id: 'v1', patientId: 'p1', visitDate: '2026-08-01', medications: [{ name: 'Anoro Ellipta' }],
      inhalerTechnique: [{ overallScore: 'Good' }], adherence: { level: 'Good' } },
    // p2: Asthma ไม่มี ICS, ไม่เคยประเมินเทคนิค, ไม่มาตั้งแต่ 2026-01-01 (นานมาก)
    { id: 'v2', patientId: 'p2', visitDate: '2026-01-01', medications: [{ name: 'Salbutamol MDI' }] },
    // p3: Asthma มี ICS, เทคนิคไม่ผ่าน, adherence ไม่ดี
    { id: 'v3', patientId: 'p3', visitDate: '2026-07-15', medications: [{ name: 'Symbicort Turbuhaler' }],
      inhalerTechnique: [{ overallScore: 'Poor' }], adherence: { level: 'Poor' } },
    // p4: ไม่มี visit เลย
  ];
  const TODAY = '2026-08-08';

  // ─── ไม่ระบุ filter ใดๆ -> คืนผู้ป่วยทั้งหมด ───
  t.ok('advancedPatientSearch: ไม่ระบุเงื่อนไขเลย -> คืนทั้งทะเบียน', advancedPatientSearch(patients, visits, {}, TODAY).length === 4);

  // ─── กรองทีละเงื่อนไข ───
  t.ok('advancedPatientSearch: diagnosis กรองถูกต้อง', advancedPatientSearch(patients, visits, { diagnosis: 'COPD' }, TODAY).length === 2);
  t.ok('advancedPatientSearch: riskLevel กรองถูกต้อง (High เจอแค่ p1)',
    advancedPatientSearch(patients, visits, { riskLevel: 'High' }, TODAY).map(r => r.id).join() === 'p1');
  {
    const rLow = advancedPatientSearch(patients, visits, { riskLevel: 'Low' }, TODAY);
    t.ok('advancedPatientSearch: riskLevel ไม่ระบุ ถือเป็น Low โดย default', rLow.some(x => x.id === 'p2') && rLow.some(x => x.id === 'p4'));
  }

  // ─── ผสมหลายเงื่อนไข: COPD + ยังไม่ได้ ICS (ไม่มีเลย เพราะ p1 มี LABA/LAMA ไม่ใช่ ICS) ───
  {
    const r = advancedPatientSearch(patients, visits, { diagnosis: 'COPD', hasICS: 'no' }, TODAY);
    t.ok('advancedPatientSearch: ผสมเงื่อนไข diagnosis+hasICS ถูกต้อง (p1 ไม่มี ICS, p4 ไม่มี visit เลยก็ถือว่าไม่มี ICS)',
      r.length === 2 && r.every(x => x.diagnosis === 'COPD'));
  }

  // ─── techniquePass: pass / fail / never_assessed แยกกันถูกต้อง ───
  t.ok('advancedPatientSearch techniquePass=pass: เจอเฉพาะ p1', advancedPatientSearch(patients, visits, { techniquePass: 'pass' }, TODAY).map(r => r.id).join() === 'p1');
  t.ok('advancedPatientSearch techniquePass=fail: เจอเฉพาะ p3', advancedPatientSearch(patients, visits, { techniquePass: 'fail' }, TODAY).map(r => r.id).join() === 'p3');
  {
    const r = advancedPatientSearch(patients, visits, { techniquePass: 'never_assessed' }, TODAY).map(x => x.id);
    t.ok('advancedPatientSearch techniquePass=never_assessed: เจอ p2 (มี visit แต่ไม่ประเมิน) และ p4 (ไม่มี visit เลย)',
      r.includes('p2') && r.includes('p4') && !r.includes('p1') && !r.includes('p3'));
  }

  // ─── adherenceGood: good / poor / never_assessed ───
  t.ok('advancedPatientSearch adherenceGood=good: เจอเฉพาะ p1', advancedPatientSearch(patients, visits, { adherenceGood: 'good' }, TODAY).map(r => r.id).join() === 'p1');
  t.ok('advancedPatientSearch adherenceGood=poor: เจอเฉพาะ p3', advancedPatientSearch(patients, visits, { adherenceGood: 'poor' }, TODAY).map(r => r.id).join() === 'p3');

  // ─── medicationContains ───
  t.ok('advancedPatientSearch medicationContains: กรองตามชื่อยาบางส่วน case-insensitive',
    advancedPatientSearch(patients, visits, { medicationContains: 'anoro' }, TODAY).map(r => r.id).join() === 'p1');

  // ─── notVisitedDays ───
  {
    const r = advancedPatientSearch(patients, visits, { notVisitedDays: 90 }, TODAY).map(x => x.id);
    t.ok('advancedPatientSearch notVisitedDays: รวมทั้งคนไม่มานานและคนไม่เคยมาเลย',
      r.includes('p2') && r.includes('p4') && !r.includes('p1'));
  }

  // ─── reasons: ต้องมีคำอธิบายเหตุผลติดมาด้วยเมื่อ filter นั้น active ───
  {
    const r = advancedPatientSearch(patients, visits, { techniquePass: 'fail' }, TODAY);
    t.ok('advancedPatientSearch: แนบเหตุผล (reasons) ที่ตรงเงื่อนไขมาด้วย', r[0].reasons.some(x => x.includes('เทคนิค')));
  }

  // ─── edge case: data ว่างเปล่า ───
  t.ok('advancedPatientSearch: patients/visits ว่างเปล่า -> ไม่ throw คืน array ว่าง', advancedPatientSearch([], [], {}, TODAY).length === 0);
  t.ok('advancedPatientSearch: undefined ทุก parameter -> ไม่ throw', advancedPatientSearch(undefined, undefined, undefined, undefined).length === 0);
}

module.exports = { run };
