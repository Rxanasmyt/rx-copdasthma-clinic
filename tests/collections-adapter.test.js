// tests/collections-adapter.test.js
// ── ทดสอบ adapter โหมด 'collections' (ทดลอง, opt-in) ที่ฝังอยู่ใน RxClinic.html โดยตรง ──
// ดึงโค้ดจริงออกมาทดสอบ (ไม่ copy สูตรมาเขียนซ้ำ) เทียบกับ Firestore mock แบบ in-memory
const { readApp, extractBlocks } = require('./extract');
const { makeFirestoreMock } = require('./firestoreMock');
const transform = require('../migration/transform');

const src = readApp();
const code = extractBlocks(src, [
  'userDocId', 'queueWalkInDocId', 'assembleDataFromCollections',
  'diffArrayById', 'buildCollectionWriteOps', 'diffAndWriteChanges',
]);
// eslint-disable-next-line no-eval
eval(code + `
global.assembleDataFromCollections = assembleDataFromCollections;
global.buildCollectionWriteOps = buildCollectionWriteOps;
global.diffAndWriteChanges = diffAndWriteChanges;
`);

const sampleData = {
  patients: [
    { id: 'p1', hn: 'HN001', firstName: 'หนึ่ง', diagnosis: 'COPD' },
    { id: 'p2', hn: 'HN002', firstName: 'สอง', diagnosis: 'Asthma' },
  ],
  visits: [
    { id: 'v1', patientId: 'p1', visitDate: '2026-01-01' },
    { id: 'v2', patientId: 'p1', visitDate: '2026-02-01' },
    { id: 'v3', patientId: 'p2', visitDate: '2026-01-15' },
  ],
  telepharmacy: [{ id: 't1', patientId: 'p2', status: 'Pending' }],
  users: [{ uid: 'u1', id: 'u1', role: 'admin', name: 'แอดมิน' }],
  clinicDayRosters: [{ date: '2026-07-20', patientIds: ['p1'], scheduledCount: 5 }],
  queueWalkIns: [{ date: '2026-07-20', patientId: 'p2', addedAt: 123 }],
  haCompliance: { medRec: [], adr: [], referrals: [], discharge: [], rca: [] },
};

async function run(t) {
  // ─── Round-trip: เขียนจาก empty ผ่าน diffAndWriteChanges แล้วอ่านกลับผ่าน assembleDataFromCollections ───
  {
    const db = makeFirestoreMock();
    const opCount = await diffAndWriteChanges(db, {}, sampleData);
    // 2 patients + 3 visits + 1 telepharmacy + 1 user + 1 roster + 1 queueWalkIn + 1 haCompliance
    t.ok('diffAndWriteChanges: op count matches total item count',
      opCount === 2 + 3 + 1 + 1 + 1 + 1 + 1);

    const assembled = await assembleDataFromCollections(db);
    t.ok('round-trip: patients count matches', assembled.patients.length === 2);
    t.ok('round-trip: visits count matches (read via nested subcollection)', assembled.visits.length === 3);
    t.ok('round-trip: visit correctly nested under its own patient', db._store.has('patients/p1/visits/v1') && db._store.has('patients/p2/visits/v3'));
    t.ok('round-trip: telepharmacy matches', assembled.telepharmacy.length === 1);
    t.ok('round-trip: users doc id uses uid', db._store.has('users/u1'));
    t.ok('round-trip: roster doc id uses date', db._store.has('clinicDayRosters/2026-07-20'));
    t.ok('round-trip: queueWalkIn doc id is composite date_patientId', db._store.has('queueWalkIns/2026-07-20_p2'));
    t.ok('round-trip: haCompliance written as single doc', db._store.has('haCompliance/main'));
    t.ok('round-trip: patient field values preserved exactly', assembled.patients.find(p => p.id === 'p1').hn === 'HN001');
  }

  // ─── Incremental diff: เขียนซ้ำ เปลี่ยนแค่ 1 อย่าง -> ต้องเขียนเฉพาะที่เปลี่ยน ไม่เขียนทั้งก้อน ───
  {
    const db = makeFirestoreMock();
    await diffAndWriteChanges(db, {}, sampleData);
    const nextData = {
      ...sampleData,
      patients: sampleData.patients.map(p => p.id === 'p1' ? { ...p, riskLevel: 'High' } : p), // p1 เปลี่ยน, p2 เหมือนเดิม
    };
    const opCount2 = await diffAndWriteChanges(db, sampleData, nextData);
    t.ok('incremental diff: only the 1 changed patient triggers a write (not all)', opCount2 === 1);
    const reread = await assembleDataFromCollections(db);
    t.ok('incremental diff: change actually persisted', reread.patients.find(p => p.id === 'p1').riskLevel === 'High');
  }

  // ─── ลบรายการ: visit ที่หายไปจาก nextData ต้องถูก delete ออกจาก subcollection จริง ───
  {
    const db = makeFirestoreMock();
    await diffAndWriteChanges(db, {}, sampleData);
    const nextData = { ...sampleData, visits: sampleData.visits.filter(v => v.id !== 'v2') };
    await diffAndWriteChanges(db, sampleData, nextData);
    t.ok('deletion: removed visit doc is gone from mock store', !db._store.has('patients/p1/visits/v2'));
    t.ok('deletion: sibling visit under same patient untouched', db._store.has('patients/p1/visits/v1'));
  }

  // ─── ไม่มีอะไรเปลี่ยน -> ไม่ควรมี op เลย (กัน overwrite โดยไม่จำเป็น) ───
  {
    const db = makeFirestoreMock();
    await diffAndWriteChanges(db, {}, sampleData);
    const opCount3 = await diffAndWriteChanges(db, sampleData, sampleData);
    t.ok('no-op diff: identical data produces zero writes', opCount3 === 0);
  }

  // ─── Consistency กับ migration/transform.js: doc path ต้องตรงกันทุกเส้นทาง กันสองระบบหลุด sync ───
  {
    const db = makeFirestoreMock();
    const ops = buildCollectionWriteOps(db, {}, sampleData);
    const livePaths = new Set(ops.map(op => op.ref.path));

    const plan = transform.buildMigrationPlan(sampleData);
    const migrationPaths = new Set([
      ...plan.patients.map(d => d.path),
      ...plan.visits.map(d => d.path),
      ...plan.telepharmacy.map(d => d.path),
      ...plan.users.map(d => d.path),
      ...plan.clinicDayRosters.map(d => d.path),
      ...plan.queueWalkIns.map(d => d.path),
      ...plan.haCompliance.map(d => d.path),
    ]);

    t.ok('path consistency: live adapter and migration script produce the exact same doc paths',
      livePaths.size === migrationPaths.size && [...livePaths].every(p => migrationPaths.has(p)));
  }
}

module.exports = { run };
