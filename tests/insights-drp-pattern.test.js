// tests/insights-drp-pattern.test.js
// ── ทดสอบ computeInsights ส่วน DRP Intelligence ที่แก้ใหม่: ผูกกับ computeDRPWorklist/data.drpTracker
// จริง แทนการ scan detectDRP สดๆ แล้วมโนอัตราแก้ไขจาก checkbox แยกต่างหาก (ของเดิม 2 ระบบไม่เชื่อมกัน) ──
const { readApp, extractBlocks } = require('./extract');

const src = readApp();
const code = extractBlocks(src, [
  'COMMON_MEDICATIONS', 'INHALER_CHECKLISTS', 'DRUG_INTERACTIONS', 'RESP_DRUG_KEYWORDS', 'classifyRespiratoryMed',
  'RX_KPI_ENUMS', 'checkInteractions', 'detectDRP', 'drpEntryId', 'groupVisitsByPatientSorted', 'verifyDRPOutcome',
  'computeDRPWorklist', 'getDRPWorklistStats', 'computeInsights',
]);
// eslint-disable-next-line no-eval
eval(code + `
global.AppStore = { COMMON_MEDICATIONS, INHALER_CHECKLISTS, DRUG_INTERACTIONS, RX_KPI_ENUMS };
global.detectDRP = detectDRP;
global.checkInteractions = checkInteractions;
global.window = { computeDRPWorklist, getDRPWorklistStats, checkInteractions, detectDRP };
global.computeInsights = computeInsights;
`);

const mkPatient = (id, dx, extra) => ({ id, hn: 'HN' + id, prefix: '', firstName: 'P' + id, lastName: '', diagnosis: dx, ...extra });

function run(t) {
  const patients = [mkPatient('p1', 'Asthma'), mkPatient('p2', 'Asthma'), mkPatient('p3', 'COPD', { smokingStatus: 'Current' })];
  const visits = [
    { id: 'v1', patientId: 'p1', visitDate: '2026-01-01', medications: [{ name: 'Salbutamol MDI 100 mcg/dose' }] },
    { id: 'v2', patientId: 'p2', visitDate: '2026-01-02', medications: [{ name: 'Salbutamol MDI 100 mcg/dose' }] },
    { id: 'v3', patientId: 'p3', visitDate: '2026-01-03', medications: [] },
  ];
  const drpP1Id = global.drpEntryId('v1', 'P1.2');

  // ─── ยังไม่มีอะไร resolved -> totalDRP นับจาก worklist จริง ไม่ใช่ manual checkbox เดิม ───
  {
    const data = { patients, visits, telepharmacy: [], drpTracker: {} };
    const ins = computeInsights(data);
    t.ok('computeInsights: totalDRP นับจาก worklist จริง (ไม่ใช่ manual checkbox v.drp)', ins.totalDRP > 0);
    t.ok('computeInsights: drpResolveRate = 0 เมื่อยังไม่มีรายการไหน resolved เลย', ins.drpResolveRate === 0);
    t.ok('computeInsights: drpCatStatusList มีข้อมูล total/resolved/resolvedPct ครบทุก entry',
      ins.drpCatStatusList.every(d => typeof d.total === 'number' && typeof d.resolved === 'number' && typeof d.resolvedPct === 'number'));
  }

  // ─── resolved 1 ใน N -> drpResolveRate ต้องสะท้อนอัตราจริงจาก drpTracker ───
  {
    const drpTracker = { [drpP1Id]: { status: 'resolved' } };
    const data = { patients, visits, telepharmacy: [], drpTracker };
    const ins = computeInsights(data);
    const worklistLen = ins.totalDRP;
    t.ok('computeInsights: drpResolveRate สะท้อนสัดส่วนที่ resolved จริงจาก drpTracker (1 ใน N)',
      Math.abs(ins.drpResolveRate - Math.round((1 / worklistLen) * 1000) / 10) < 0.2);
  }

  // ─── drpCatStatusList: หมวดที่ทุกรายการ resolved ต้องได้ resolvedPct = 100 ───
  {
    const singleCatPatients = [mkPatient('sp1', 'Asthma')];
    const singleCatVisits = [{ id: 'sv1', patientId: 'sp1', visitDate: '2026-01-01', medications: [{ name: 'Salbutamol MDI 100 mcg/dose' }] }];
    const targetId = global.drpEntryId('sv1', 'P1.2');
    const data = { patients: singleCatPatients, visits: singleCatVisits, telepharmacy: [], drpTracker: { [targetId]: { status: 'resolved' } } };
    const ins = computeInsights(data);
    t.ok('computeInsights: drpCatStatusList ให้ resolvedPct = 100 เมื่อทุกรายการในหมวดนั้น resolved หมด',
      ins.drpCatStatusList.length > 0 && ins.drpCatStatusList.every(d => d.resolvedPct === 100));
  }

  // ─── edge case: ไม่มี patients/visits เลย -> ไม่ throw ───
  {
    const ins = computeInsights({ patients: [], visits: [], telepharmacy: [], drpTracker: {} });
    t.ok('computeInsights: data ว่างเปล่าทั้งหมด -> ไม่ throw, totalDRP=0, drpResolveRate=0',
      ins.totalDRP === 0 && ins.drpResolveRate === 0 && ins.drpCatStatusList.length === 0);
  }
}

module.exports = { run };
