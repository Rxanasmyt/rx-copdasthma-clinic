// tests/drp-tracker.test.js
// ── ทดสอบ DRP Tracker: computeDRPWorklist / getDRPWorklistStats / countOpenHighDRP / drpEntryId ──
// เดิม detectDRP คำนวณสดทุกครั้งไม่เคยถูก "บันทึกเป็นรายการ" (ไม่มี id/สถานะ/คนรับผิดชอบ) —
// ฟีเจอร์นี้ merge ผลตรวจจับสด เข้ากับ data.drpTracker (sparse map) เพื่อติดตาม/แก้ไขได้ตรงจุด
const { readApp, extractBlocks } = require('./extract');

const src = readApp();
const code = extractBlocks(src, [
  'COMMON_MEDICATIONS', 'INHALER_CHECKLISTS', 'DRUG_INTERACTIONS', 'RESP_DRUG_KEYWORDS', 'classifyRespiratoryMed',
  'checkInteractions', 'detectDRP', 'drpEntryId', 'computeDRPWorklist', 'getDRPWorklistStats', 'countOpenHighDRP',
]);
// eslint-disable-next-line no-eval
eval(code + `
global.AppStore = { COMMON_MEDICATIONS, INHALER_CHECKLISTS, DRUG_INTERACTIONS };
global.detectDRP = detectDRP;
global.drpEntryId = drpEntryId;
global.computeDRPWorklist = computeDRPWorklist;
global.getDRPWorklistStats = getDRPWorklistStats;
global.countOpenHighDRP = countOpenHighDRP;
`);

const mkPatient = (id, dx, extra) => ({ id, hn: 'HN' + id, prefix: '', firstName: 'P' + id, lastName: '', diagnosis: dx, ...extra });

function run(t) {
  // ─── สถานการณ์จริง: ผู้ป่วยหืดใช้แต่ SABA เดี่ยว (ไม่มี controller) -> ต้อง detect DRP ได้ ───
  const patients = [
    mkPatient('p1', 'Asthma'),
    mkPatient('p2', 'COPD', { smokingStatus: 'Current' }), // สูบบุหรี่ปัจจุบัน -> DRP "untreated indication"
  ];
  const visits = [
    {
      id: 'v1', patientId: 'p1', visitDate: '2026-06-01',
      medications: [{ name: 'Salbutamol MDI' }], // SABA เดี่ยวไม่มี controller
    },
    {
      id: 'v2', patientId: 'p2', visitDate: '2026-07-01',
      medications: [],
    },
  ];

  // ─── computeDRPWorklist: พื้นฐาน ───
  {
    const worklist = computeDRPWorklist(patients, visits, {}, null);
    t.ok('computeDRPWorklist: ตรวจพบ DRP อย่างน้อย 1 รายการจากข้อมูลจำลอง', worklist.length > 0);
    t.ok('computeDRPWorklist: ทุกรายการมี id ที่ deterministic (visitId::code)', worklist.every(w => w.id === `${w.visitId}::${w.code}`));
    t.ok('computeDRPWorklist: แนบข้อมูลผู้ป่วย (ชื่อ/HN) มาด้วยครบ', worklist.every(w => w.patient && w.patient.hn));
    t.ok('computeDRPWorklist: ไม่มี override ใน drpTracker -> สถานะเริ่มต้นเป็น open ทุกรายการ', worklist.every(w => w.status === 'open'));
  }

  // ─── computeDRPWorklist: merge สถานะจาก drpTracker ถูกต้อง ───
  {
    const worklistFirst = computeDRPWorklist(patients, visits, {}, null);
    const target = worklistFirst[0];
    const drpTracker = {
      [target.id]: { status: 'resolved', assignedTo: 'ภญ.เอ', actionTaken: 'ปรับยาแล้ว', dateResolved: '2026-07-10', resolvedBy: 'ภญ.เอ' },
    };
    const worklist2 = computeDRPWorklist(patients, visits, drpTracker, null);
    const updated = worklist2.find(w => w.id === target.id);
    t.ok('computeDRPWorklist: สถานะที่บันทึกไว้ถูก merge เข้ากับผลตรวจจับสดถูกต้อง', updated.status === 'resolved' && updated.assignedTo === 'ภญ.เอ');
    t.ok('computeDRPWorklist: รายการอื่นที่ไม่มี override ยังเป็น open ตามปกติ (ไม่กระทบกัน)',
      worklist2.filter(w => w.id !== target.id).every(w => w.status === 'open'));
  }

  // ─── computeDRPWorklist: dateRange filter ───
  {
    const juneOnly = computeDRPWorklist(patients, visits, {}, { start: '2026-06-01', end: '2026-06-30' });
    t.ok('computeDRPWorklist+dateRange: กรองเฉพาะ visit ในช่วงที่ระบุ (p2 เดือน ก.ค. ต้องไม่ติดมา)',
      juneOnly.every(w => w.visitId === 'v1'));
  }

  // ─── computeDRPWorklist: เรียงลำดับถูกต้อง (ยังไม่ปิดมาก่อน, High ก่อน Medium/Low) ───
  {
    const worklist = computeDRPWorklist(patients, visits, {}, null);
    for (let i = 1; i < worklist.length; i++) {
      const prevOpen = worklist[i - 1].status !== 'resolved';
      const curOpen = worklist[i].status !== 'resolved';
      t.ok(`computeDRPWorklist: ลำดับ ${i} — รายการที่ยังไม่ปิดต้องมาก่อนรายการที่ปิดแล้วเสมอ`, prevOpen || !curOpen);
    }
  }

  // ─── computeDRPWorklist: ผู้ป่วยถูกลบไปแล้วแต่ visit เก่าค้าง -> ไม่ throw ไม่รวมมา ───
  {
    const orphanVisits = [{ id: 'vX', patientId: 'ghost', visitDate: '2026-01-01', medications: [{ name: 'Salbutamol MDI' }] }];
    const worklist = computeDRPWorklist([], orphanVisits, {}, null);
    t.ok('computeDRPWorklist: กรองทิ้ง visit ของผู้ป่วยที่ถูกลบไปแล้ว (กัน crash)', worklist.length === 0);
  }

  // ─── computeDRPWorklist: data ว่างเปล่าทั้งหมด -> ไม่ throw ───
  {
    t.ok('computeDRPWorklist: patients/visits ว่างเปล่า -> คืน array ว่าง ไม่ throw',
      computeDRPWorklist([], [], {}, null).length === 0);
    t.ok('computeDRPWorklist: undefined ทุก parameter -> ไม่ throw',
      computeDRPWorklist(undefined, undefined, undefined, undefined).length === 0);
  }

  // ─── getDRPWorklistStats ───
  {
    const worklist = [
      { status: 'open', severity: 'High' },
      { status: 'open', severity: 'Medium' },
      { status: 'in_progress', severity: 'High' },
      { status: 'resolved', severity: 'High' },
      { status: 'resolved', severity: 'Low' },
    ];
    const stats = getDRPWorklistStats(worklist);
    t.ok('getDRPWorklistStats: นับ open ถูกต้อง', stats.open === 2);
    t.ok('getDRPWorklistStats: นับ in_progress ถูกต้อง', stats.inProgress === 1);
    t.ok('getDRPWorklistStats: นับ resolved ถูกต้อง', stats.resolved === 2);
    t.ok('getDRPWorklistStats: highOpen นับเฉพาะ High ที่ยังไม่ resolved (open+in_progress)', stats.highOpen === 2);
    t.ok('getDRPWorklistStats: resolutionRate คำนวณถูกต้อง (2/5 = 40.0%)', stats.resolutionRate === '40.0');
    t.ok('getDRPWorklistStats: worklist ว่างเปล่า -> resolutionRate = 0 ไม่ throw (หาร 0)', getDRPWorklistStats([]).resolutionRate === '0');
  }

  // ─── countOpenHighDRP: นับจาก visit ล่าสุดของแต่ละคนเท่านั้น ───
  {
    const multiVisitPatients = [mkPatient('p1', 'Asthma')];
    const multiVisits = [
      { id: 'v1', patientId: 'p1', visitDate: '2026-01-01', medications: [{ name: 'Salbutamol MDI' }] }, // เก่า มี DRP
      { id: 'v2', patientId: 'p1', visitDate: '2026-07-01', medications: [{ name: 'Symbicort Turbuhaler' }] }, // ล่าสุด แก้ไขแล้ว ไม่มี DRP
    ];
    const count = countOpenHighDRP(multiVisitPatients, multiVisits, {});
    t.ok('countOpenHighDRP: นับจาก visit ล่าสุดเท่านั้น ไม่รวม visit เก่าที่แก้ไขไปแล้ว', count === 0);
  }
  {
    const worklist = computeDRPWorklist(patients, visits, {}, null);
    const highOpenIds = worklist.filter(w => w.severity === 'High' && w.status !== 'resolved').map(w => w.id);
    const drpTracker = {};
    highOpenIds.forEach(id => { drpTracker[id] = { status: 'resolved' }; });
    const countAfterResolve = countOpenHighDRP(patients, visits, drpTracker);
    t.ok('countOpenHighDRP: ตัดรายการที่ resolved ออกจากจำนวนที่ยังเปิดอยู่', countAfterResolve === 0);
  }

  // ─── computeDRPWorklist: ใช้ในโหมด "ต่อผู้ป่วยคนเดียว" (Patient Hub) — ส่ง [patient] เดี่ยว + visits
  // ที่กรองมาแล้วเฉพาะคนนั้น (ถูกกว่าคำนวณทั้งคลินิกแล้วมากรองทีหลัง) ต้องได้ผลเหมือนกับกรองจาก worklist เต็ม ───
  {
    const fullWorklist = computeDRPWorklist(patients, visits, {}, null).filter(w => w.patientId === 'p1');
    const singlePatientVisits = visits.filter(v => v.patientId === 'p1');
    const scopedWorklist = computeDRPWorklist([patients[0]], singlePatientVisits, {}, null);
    t.ok('computeDRPWorklist: โหมดผู้ป่วยคนเดียว ([patient]+visits ที่กรองแล้ว) ให้ผลเหมือนกรองจาก worklist เต็มทุกประการ',
      JSON.stringify(scopedWorklist.map(w => w.id).sort()) === JSON.stringify(fullWorklist.map(w => w.id).sort()));
  }
}

module.exports = { run };
