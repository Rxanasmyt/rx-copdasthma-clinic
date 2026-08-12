// tests/notifications.test.js
// ── ทดสอบ calculateNotifications ส่วนที่เพิ่มใหม่: แจ้งเตือน DRP ที่มอบหมายให้ฉัน + DRP รุนแรงค้างนาน ──
// เดิม DRP Tracker มีอยู่แล้วแต่มอบหมายงานให้ใครแล้วเขาไม่รู้ตัวจนกว่าจะเปิดแอพมาเช็คเอง
const { readApp, extractBlocks } = require('./extract');

const src = readApp();
const code = extractBlocks(src, [
  'COMMON_MEDICATIONS', 'INHALER_CHECKLISTS', 'DRUG_INTERACTIONS', 'RESP_DRUG_KEYWORDS', 'classifyRespiratoryMed',
  'checkInteractions', 'detectDRP', 'drpEntryId', 'normalizeDrpProblem', 'groupVisitsByPatientSorted', 'verifyDRPOutcome',
  'computeDRPWorklist', 'calculateNotifications',
]);
// eslint-disable-next-line no-eval
eval(code + `
global.AppStore = { COMMON_MEDICATIONS, INHALER_CHECKLISTS, DRUG_INTERACTIONS };
global.detectDRP = detectDRP;
global.window = { computeDRPWorklist, AppNavigate: () => {} };
global.calculateNotifications = calculateNotifications;
`);

const mkPatient = (id, dx, extra) => ({ id, hn: 'HN' + id, prefix: '', firstName: 'P' + id, lastName: '', diagnosis: dx, ...extra });

function run(t) {
  const patients = [mkPatient('p1', 'Asthma'), mkPatient('p2', 'Asthma')];
  const visits = [
    { id: 'v1', patientId: 'p1', visitDate: '2026-01-01', medications: [{ name: 'Salbutamol MDI 100 mcg/dose' }] }, // High severity DRP, เก่ามาก (>7 วันจากวันนี้แน่นอน)
    { id: 'v2', patientId: 'p2', visitDate: '2026-01-01', medications: [{ name: 'Salbutamol MDI 100 mcg/dose' }] },
  ];
  // ต้องระบุ problemEn ให้ตรงกับที่ detectDRP สร้างจริง (ใช้ทำ id ให้ตรงกัน — ดู normalizeDrpProblem)
  const SABA_ONLY_PROBLEM = 'SABA-only treatment in asthma without ICS controller (against GINA)';
  const drpP1Id = global.drpEntryId('v1', 'P1.2', SABA_ONLY_PROBLEM);
  const drpP2Id = global.drpEntryId('v2', 'P1.2', SABA_ONLY_PROBLEM);

  // ─── 4a: แจ้งเตือน "มอบหมายให้ฉัน" ต้องขึ้นเฉพาะของ currentUser คนนั้น ไม่ปนของคนอื่น ───
  {
    const drpTracker = { [drpP1Id]: { status: 'open', assignedTo: 'สมศรี' } };
    const dataP1 = { patients, visits, telepharmacy: [], drpTracker };
    const notifsForAssignee = calculateNotifications(dataP1, { name: 'สมศรี', prefix: 'ภญ.' });
    t.ok('calculateNotifications: แจ้งเตือน DRP มอบหมายให้ฉัน ขึ้นเมื่อ assignedTo ตรงกับ currentUser',
      notifsForAssignee.some(n => n.type === 'drp-assigned' && n.id === `drp-assigned-${drpP1Id}`));

    const notifsForOther = calculateNotifications(dataP1, { name: 'อื่น', prefix: 'ภญ.' });
    t.ok('calculateNotifications: ไม่ขึ้นแจ้งเตือน "มอบหมายให้ฉัน" ถ้า currentUser ไม่ตรงกับ assignedTo',
      !notifsForOther.some(n => n.id === `drp-assigned-${drpP1Id}`));

    t.ok('calculateNotifications: ไม่ระบุ currentUser เลย -> ไม่ throw และไม่มีแจ้งเตือนมอบหมายให้ฉัน',
      !calculateNotifications(dataP1, undefined).some(n => n.id === `drp-assigned-${drpP1Id}`));
  }

  // ─── 4b: DRP High ที่ยังไม่มอบหมายใครและค้างเกิน 7 วัน ต้องเตือนแบบ broad (ไม่ต้องเจาะจง currentUser) ───
  {
    const drpTracker = {}; // ไม่มี override เลย -> สถานะ open ทั้งคู่ ไม่มีใครมอบหมาย
    const data = { patients, visits, telepharmacy: [], drpTracker };
    const notifs = calculateNotifications(data, { name: 'ใครก็ได้' });
    t.ok('calculateNotifications: DRP High ค้างเกิน 7 วันไม่มีคนมอบหมาย -> เตือนแบบ broad ให้ทุกคนเห็น',
      notifs.some(n => n.type === 'drp-assigned' && n.id === `drp-overdue-${drpP1Id}`) &&
      notifs.some(n => n.id === `drp-overdue-${drpP2Id}`));
  }

  // ─── DRP ที่ resolved แล้วต้องไม่ขึ้นแจ้งเตือนอีก (ทั้งสองแบบ) ───
  {
    const drpTracker = { [drpP1Id]: { status: 'resolved', assignedTo: 'สมศรี' } };
    const data = { patients: [patients[0]], visits: [visits[0]], telepharmacy: [], drpTracker };
    const notifs = calculateNotifications(data, { name: 'สมศรี', prefix: 'ภญ.' });
    t.ok('calculateNotifications: DRP ที่แก้ไขแล้ว (resolved) ไม่ขึ้นแจ้งเตือนอีก (ไม่นับแจ้งเตือนประเภทอื่น เช่น วัคซีน)',
      !notifs.some(n => n.type === 'drp-assigned'));
  }

  // ─── แต่ละแจ้งเตือน DRP ต้องมี action ที่พาไปหน้า DRP Tracker แบบ focus ที่ผู้ป่วยคนนั้น ───
  {
    const drpTracker = { [drpP1Id]: { status: 'open', assignedTo: 'สมศรี' } };
    const data = { patients, visits, telepharmacy: [], drpTracker };
    const notif = calculateNotifications(data, { name: 'สมศรี', prefix: 'ภญ.' }).find(n => n.id === `drp-assigned-${drpP1Id}`);
    t.ok('calculateNotifications: แจ้งเตือน DRP มี action เป็นฟังก์ชัน (คลิกแล้วนำทางได้)', typeof notif.action === 'function');
    t.ok('calculateNotifications: แจ้งเตือน DRP แนบ patientId มาด้วยถูกต้อง', notif.patientId === 'p1');
  }

  // ─── edge case: computeDRPWorklist ไม่มีให้ใช้ (window ไม่ครบ) -> ไม่ throw ───
  {
    const savedWindow = global.window;
    global.window = {}; // ไม่มี computeDRPWorklist
    t.ok('calculateNotifications: window.computeDRPWorklist ไม่มี -> ไม่ throw (ยังคืนแจ้งเตือนประเภทอื่นได้ปกติ)',
      Array.isArray(calculateNotifications({ patients: [], visits: [], telepharmacy: [] }, null)));
    global.window = savedWindow;
  }
}

module.exports = { run };
