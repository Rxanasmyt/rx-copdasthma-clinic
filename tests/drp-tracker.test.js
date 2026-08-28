// tests/drp-tracker.test.js
// ── ทดสอบ DRP Tracker: computeDRPWorklist / getDRPWorklistStats / countOpenHighDRP / drpEntryId ──
// เดิม detectDRP คำนวณสดทุกครั้งไม่เคยถูก "บันทึกเป็นรายการ" (ไม่มี id/สถานะ/คนรับผิดชอบ) —
// ฟีเจอร์นี้ merge ผลตรวจจับสด เข้ากับ data.drpTracker (sparse map) เพื่อติดตาม/แก้ไขได้ตรงจุด
const { readApp, extractBlocks } = require('./extract');

const src = readApp();
const code = extractBlocks(src, [
  'COMMON_MEDICATIONS', 'INHALER_CHECKLISTS', 'DRUG_INTERACTIONS', 'RESP_DRUG_KEYWORDS', 'classifyRespiratoryMed',
  'checkInteractions', 'detectDRP', 'drpEntryId', 'normalizeDrpProblem', 'groupVisitsByPatientSorted', 'verifyDRPOutcome',
  'computeDRPWorklist', 'getDRPWorklistStats', 'countOpenHighDRP',
]);
// eslint-disable-next-line no-eval
eval(code + `
global.AppStore = { COMMON_MEDICATIONS, INHALER_CHECKLISTS, DRUG_INTERACTIONS };
global.detectDRP = detectDRP;
global.drpEntryId = drpEntryId;
global.groupVisitsByPatientSorted = groupVisitsByPatientSorted;
global.verifyDRPOutcome = verifyDRPOutcome;
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
      medications: [{ name: 'Salbutamol MDI 100 mcg/dose' }], // SABA เดี่ยวไม่มี controller
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
    // id ต้องมี visitId+code เป็น prefix เสมอ (deterministic) แต่ตอนนี้มีส่วนต่อท้ายเพิ่ม (normalized
    // problemEn) เพื่อแยกปัญหาคนละเรื่องที่ใช้ code เดียวกันในวิสิตเดียวกันออกจากกัน — ดู normalizeDrpProblem
    t.ok('computeDRPWorklist: ทุกรายการมี id ที่ deterministic ขึ้นต้นด้วย visitId::code เสมอ',
      worklist.every(w => w.id.startsWith(`${w.visitId}::${w.code}::`)));
    t.ok('computeDRPWorklist: id ไม่ชนกันเองแม้ในผู้ป่วยที่ตรวจพบหลาย DRP โค้ดเดียวกันในวิสิตเดียว (unique ทุกตัว)',
      new Set(worklist.map(w => w.id)).size === worklist.length);
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
    const orphanVisits = [{ id: 'vX', patientId: 'ghost', visitDate: '2026-01-01', medications: [{ name: 'Salbutamol MDI 100 mcg/dose' }] }];
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
      { id: 'v1', patientId: 'p1', visitDate: '2026-01-01', medications: [{ name: 'Salbutamol MDI 100 mcg/dose' }] }, // เก่า มี DRP
      { id: 'v2', patientId: 'p1', visitDate: '2026-07-01', medications: [{ name: 'Budesonide/Formoterol (Symbicort) DPI 160/4.5 mcg' }] }, // ล่าสุด แก้ไขแล้ว ไม่มี DRP
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

  // ─── ปิดวงจร (closed-loop outcome verification) ───
  {
    // p1: DRP ที่ visit 1 (SABA เดี่ยว), ปิดว่า resolved, visit ถัดไป (v3) เปลี่ยนมาใช้ controller แล้ว -> ต้องยืนยันว่าดีขึ้น
    const p = mkPatient('cp1', 'Asthma');
    const vDrp = { id: 'cv1', patientId: 'cp1', visitDate: '2026-01-01', medications: [{ name: 'Salbutamol MDI 100 mcg/dose' }] };
    const vFollowUpFixed = { id: 'cv2', patientId: 'cp1', visitDate: '2026-02-01', medications: [{ name: 'Budesonide/Formoterol (Symbicort) DPI 160/4.5 mcg' }] }; // มี controller แล้ว
    const worklistBefore = computeDRPWorklist([p], [vDrp], {}, null);
    const targetEntry = worklistBefore.find(w => w.visitId === 'cv1');
    t.ok('closed-loop: DRP ที่ยังไม่ resolved -> outcome.checked = false เสมอ (ยังไม่ต้องตรวจ)', targetEntry.outcome.checked === false);

    const drpTracker = { [targetEntry.id]: { status: 'resolved', dateResolved: '2026-01-15' } };
    const worklistNoFollowUp = computeDRPWorklist([p], [vDrp], drpTracker, null);
    t.ok('closed-loop: resolved แล้วแต่ยังไม่มี visit ถัดไป -> outcome.checked = false (pending)',
      worklistNoFollowUp[0].outcome.checked === false && worklistNoFollowUp[0].outcome.followUpVisitDate === null);

    const worklistFixed = computeDRPWorklist([p], [vDrp, vFollowUpFixed], drpTracker, null);
    const fixedEntry = worklistFixed.find(w => w.visitId === 'cv1');
    t.ok('closed-loop: มี visit ถัดไปและไม่พบ code เดิมแล้ว -> ยืนยันว่าดีขึ้นจริง (stillDetected = false)',
      fixedEntry.outcome.checked === true && fixedEntry.outcome.stillDetected === false && fixedEntry.outcome.followUpVisitDate === '2026-02-01');

    // ยังไม่ดีขึ้น: visit ถัดไปยังใช้ SABA เดี่ยวเหมือนเดิม
    const vFollowUpSame = { id: 'cv3', patientId: 'cp1', visitDate: '2026-02-01', medications: [{ name: 'Salbutamol MDI 100 mcg/dose' }] };
    const worklistNotFixed = computeDRPWorklist([p], [vDrp, vFollowUpSame], drpTracker, null);
    const notFixedEntry = worklistNotFixed.find(w => w.visitId === 'cv1');
    t.ok('closed-loop: มี visit ถัดไปแต่ยังพบ code เดิม -> ยังไม่ดีขึ้น (stillDetected = true)', notFixedEntry.outcome.stillDetected === true);

    // getDRPWorklistStats ต้องนับ verified/regressed/pending ถูกต้อง และแยกจากกันชัดเจน
    const statsFixed = getDRPWorklistStats(worklistFixed);
    t.ok('getDRPWorklistStats: outcomeVerified นับรายการที่ยืนยันดีขึ้นแล้วถูกต้อง', statsFixed.outcomeVerified === 1 && statsFixed.outcomeRegressed === 0);
    const statsNotFixed = getDRPWorklistStats(worklistNotFixed);
    t.ok('getDRPWorklistStats: outcomeRegressed นับรายการที่ยังไม่ดีขึ้นถูกต้อง', statsNotFixed.outcomeRegressed === 1 && statsNotFixed.outcomeVerified === 0);
    const statsPending = getDRPWorklistStats(worklistNoFollowUp);
    t.ok('getDRPWorklistStats: outcomePending นับรายการที่รอ visit ถัดไปถูกต้อง และ outcomeVerifiedRate เป็น null เมื่อยังไม่มีอะไรให้ตรวจสอบ',
      statsPending.outcomePending === 1 && statsPending.outcomeVerifiedRate === null);
    t.ok('getDRPWorklistStats: outcomeVerifiedRate คำนวณถูกต้องเมื่อยืนยันครบ 100%', statsFixed.outcomeVerifiedRate === '100.0');
  }

  // ─── regression: 2 DRP คนละเรื่องแต่ใช้ PCNE code เดียวกันในวิสิตเดียวกัน ต้องไม่ id ชนกัน ───
  // (สถานการณ์จริง: ผู้ป่วยหืดที่ยังสูบบุหรี่ + ใช้ SABA เดี่ยวไม่มี ICS — ทั้งสองเรื่องเป็น P1.2)
  // เดิม (ก่อนแก้) จะได้ id เดียวกันทั้งคู่ (visitId::code) แก้ปัญหาหนึ่งจะไปทับสถานะอีกปัญหาโดยไม่ตั้งใจ
  {
    const smokerPatient = mkPatient('cs1', 'Asthma', { smokingStatus: 'Current' });
    const v = { id: 'csv1', patientId: 'cs1', visitDate: '2026-03-01', medications: [{ name: 'Salbutamol MDI 100 mcg/dose' }] };
    const worklist = computeDRPWorklist([smokerPatient], [v], {}, null);
    const sameCodeEntries = worklist.filter(w => w.code === 'P1.2');
    t.ok('regression: ตรวจพบ 2 ปัญหาคนละเรื่องที่ใช้ code P1.2 ร่วมกันในวิสิตเดียว (สูบบุหรี่ + SABA-only)', sameCodeEntries.length === 2);
    t.ok('regression: id ของทั้งสองปัญหาต้องไม่ชนกัน แม้ code เดียวกัน', new Set(sameCodeEntries.map(e => e.id)).size === 2);

    // แก้ปัญหาหนึ่ง (SABA-only) เป็น resolved -> อีกปัญหา (สูบบุหรี่) ต้องยังเป็น open อยู่ ไม่ถูกทับสถานะ
    const sabaEntry = sameCodeEntries.find(e => e.problemEn.includes('SABA-only'));
    const smokingEntry = sameCodeEntries.find(e => e.problemEn.includes('smoker'));
    const drpTracker2 = { [sabaEntry.id]: { status: 'resolved', dateResolved: '2026-03-05' } };
    const worklist2 = computeDRPWorklist([smokerPatient], [v], drpTracker2, null);
    const sabaAfter = worklist2.find(w => w.id === sabaEntry.id);
    const smokingAfter = worklist2.find(w => w.id === smokingEntry.id);
    t.ok('regression: แก้ปัญหา SABA-only แล้ว ปัญหานั้นเป็น resolved จริง', sabaAfter.status === 'resolved');
    t.ok('regression: ปัญหาสูบบุหรี่ (คนละเรื่อง แต่ code เดียวกัน) ต้องยังเป็น open ไม่ถูกทับสถานะไปด้วย', smokingAfter.status === 'open');
  }

  // ─── regression: eGFR = 0 (ไตวายระยะสุดท้าย/ฟอกไต) ต้องยังตรวจข้อห้ามใช้ยาทางไตได้ปกติ ───
  // เดิม detectDRP เช็คด้วย `if (patient?.eGFR)` แบบ truthy ทำให้ eGFR=0 ถูกมองว่า "ไม่มีค่า"
  // แล้วข้ามการเช็ค renal-dose-adjustment ทั้งหมดไปเงียบๆ ทั้งที่เป็นกลุ่มอันตรายที่สุด
  {
    const renalPatient = mkPatient('r1', 'COPD', { eGFR: 0 });
    const v = { id: 'rv1', patientId: 'r1', visitDate: '2026-05-01', medications: [{ name: 'Metformin 500 mg' }] };
    const found = detectDRP(v, renalPatient);
    t.ok('regression: eGFR=0 + Metformin ต้อง detect ข้อห้ามใช้ในไตบกพร่อง (P2.2) เหมือน eGFR=29',
      found.some(d => d.code === 'P2.2' && d.categoryEn === 'Contraindication (renal)'));

    // เทียบกับ eGFR ปกติ (ไม่บกพร่อง) ต้องไม่ detect ปัญหานี้ — ยืนยันว่า fix ไม่ได้ทำให้ over-trigger
    const normalRenalPatient = mkPatient('r2', 'COPD', { eGFR: 90 });
    const foundNormal = detectDRP({ ...v, patientId: 'r2' }, normalRenalPatient);
    t.ok('regression: eGFR=90 (ปกติ) + Metformin ไม่ควร detect ข้อห้ามใช้ในไตบกพร่อง', !foundNormal.some(d => d.code === 'P2.2'));
  }
}

module.exports = { run };
