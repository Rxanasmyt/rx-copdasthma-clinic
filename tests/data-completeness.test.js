// tests/data-completeness.test.js
// ── ทดสอบ computeDataCompleteness: ตรวจว่าข้อมูลที่ใช้คิด KPI ครบถ้วนแค่ไหน ──
// (ก่อนเชื่อตัวเลข KPI ต้องมั่นใจก่อนว่าไม่มีคนที่ "ลืมประเมิน" หลุดจากการนับไปเงียบๆ)
const { readApp, extractBlocks } = require('./extract');

const src = readApp();
const code = extractBlocks(src, ['computeDataCompleteness']);
// eslint-disable-next-line no-eval
eval(code + `
global.computeDataCompleteness = computeDataCompleteness;
`);

const mkPatient = (id, dx, extra) => ({ id, hn: 'HN' + id, prefix: '', firstName: 'P' + id, lastName: 'Last', diagnosis: dx, ...extra });

function run(t) {
  const patients = [
    mkPatient('p1', 'Asthma', { riskLevel: 'High' }),   // ครบทุกอย่าง
    mkPatient('p2', 'COPD'),                            // ไม่มี riskLevel, visit ล่าสุดไม่ประเมินเทคนิค+adherence
    mkPatient('p3', 'Asthma', { riskLevel: 'Low' }),    // ไม่มี visit เลย แต่มี riskLevel แล้ว
    mkPatient('p4', 'COPD'),                            // ไม่มี visit เลย และไม่มี riskLevel ด้วย (regression case)
  ];
  const visits = [
    { id: 'v1', patientId: 'p1', visitDate: '2026-07-01', inhalerTechnique: [{ overallScore: 'Good' }], adherence: { level: 'Good' } },
    { id: 'v2', patientId: 'p2', visitDate: '2026-01-01', inhalerTechnique: [{ overallScore: 'Poor' }], adherence: { level: 'Poor' } }, // เก่า
    { id: 'v3', patientId: 'p2', visitDate: '2026-07-15', inhalerTechnique: [], adherence: {} }, // ล่าสุด — ไม่ประเมินอะไรเลย
  ];

  const result = computeDataCompleteness(patients, visits);

  t.ok('computeDataCompleteness: total นับผู้ป่วยทั้งทะเบียนถูกต้อง', result.total === 4);
  t.ok('computeDataCompleteness: neverVisited เจอ p3 และ p4', result.neverVisited.length === 2 &&
    result.neverVisited.some(r => r.id === 'p3') && result.neverVisited.some(r => r.id === 'p4'));
  // regression: เดิม early-return ก่อนเช็ค riskLevel ทำให้ผู้ป่วยที่ไม่เคยมาเลย (ซึ่งไม่มี riskLevel แน่ๆ)
  // หลุดจากรายการ "ยังไม่ได้ประเมินความเสี่ยง" ไปเงียบๆ ทั้งที่ label ไม่ได้จำกัดว่าต้องมี visit ก่อน
  t.ok('regression: missingRiskLevel ต้องรวมผู้ป่วยที่ไม่เคยมาเลยด้วย (p4 ไม่มี visit และไม่มี riskLevel)',
    result.missingRiskLevel.some(r => r.id === 'p4'));
  t.ok('computeDataCompleteness: p3 มี riskLevel แล้ว แม้ไม่เคยมา -> ไม่ติด missingRiskLevel',
    !result.missingRiskLevel.some(r => r.id === 'p3'));
  t.ok('computeDataCompleteness: p1 (ครบทุกอย่าง) ไม่ติดในรายการไหนเลย',
    !result.missingTechnique.some(r => r.id === 'p1') && !result.missingAdherence.some(r => r.id === 'p1') && !result.missingRiskLevel.some(r => r.id === 'p1'));
  t.ok('computeDataCompleteness: ใช้ visit ล่าสุดเท่านั้น (ไม่ใช่ visit เก่า) — p2 ล่าสุดไม่ประเมิน แม้ visit เก่าจะประเมินไว้แล้ว',
    result.missingTechnique.some(r => r.id === 'p2') && result.missingAdherence.some(r => r.id === 'p2'));
  t.ok('computeDataCompleteness: missingRiskLevel เจอ p2 (ไม่มี riskLevel เลย)', result.missingRiskLevel.some(r => r.id === 'p2'));
  t.ok('computeDataCompleteness: neverVisited ไม่ถูกนับซ้ำเข้า missingTechnique/missingAdherence (แยกหมวดชัดเจน ไม่ปนกัน)',
    !result.missingTechnique.some(r => r.id === 'p3') && !result.missingAdherence.some(r => r.id === 'p3'));
  t.ok('computeDataCompleteness: คำนวณ % ถูกต้อง (2/4 = 50.0%)', result.neverVisitedPct === '50.0');

  // ─── edge cases ───
  t.ok('computeDataCompleteness: ทะเบียนว่างเปล่า -> ไม่ throw, total=0, % = 0 ไม่ใช่ NaN',
    (() => { const r = computeDataCompleteness([], []); return r.total === 0 && r.neverVisitedPct === '0'; })());
  t.ok('computeDataCompleteness: undefined ทุก parameter -> ไม่ throw',
    (() => { const r = computeDataCompleteness(undefined, undefined); return r.total === 0; })());
}

module.exports = { run };
