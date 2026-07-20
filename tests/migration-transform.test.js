// tests/migration-transform.test.js
// ── ทดสอบตรรกะการแปลงข้อมูลสำหรับ migration ไป multi-collection (ไม่แตะ Firestore จริง) ──
const {
  buildPatientDocs, buildVisitDocs, buildTelepharmacyDocs, buildUserDocs,
  buildRosterDocs, buildQueueWalkInDocs, buildHAComplianceDoc,
  buildMigrationPlan, planSummary, verifyPlanCounts,
} = require('../migration/transform');

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
  users: [
    { uid: 'u1', role: 'admin', name: 'แอดมิน' },
    { id: 'u2', role: 'pharmacist', name: 'เภสัชกร' }, // ไม่มี uid แต่มี id เก่า
    { role: 'assistant', name: 'ไม่มีทั้ง uid และ id' }, // ข้อมูลเสีย — ควรถูกข้าม
  ],
  clinicDayRosters: [{ date: '2026-07-20', patientIds: ['p1'], scheduledCount: 5 }],
  queueWalkIns: [{ date: '2026-07-20', patientId: 'p2', addedAt: 123 }],
  haCompliance: { medRec: [], adr: [], referrals: [], discharge: [], rca: [] },
};

function run(t) {
  t.ok('buildPatientDocs: 2 patients -> 2 docs with correct paths',
    JSON.stringify(buildPatientDocs(sampleData).map(d => d.path)) === JSON.stringify(['patients/p1', 'patients/p2']));
  t.ok('buildPatientDocs: no "visits" field leaked into patient doc',
    !('visits' in buildPatientDocs(sampleData)[0].data));

  const visitDocs = buildVisitDocs(sampleData);
  t.ok('buildVisitDocs: 3 visits -> 3 docs nested under correct patient',
    visitDocs.length === 3 && visitDocs[0].path === 'patients/p1/visits/v1' && visitDocs[2].path === 'patients/p2/visits/v3');

  t.ok('buildTelepharmacyDocs: top-level path, not nested under patient',
    buildTelepharmacyDocs(sampleData)[0].path === 'telepharmacy/t1');

  const userDocs = buildUserDocs(sampleData);
  t.ok('buildUserDocs: prefers uid over id when both concept exist', userDocs[0].path === 'users/u1');
  t.ok('buildUserDocs: falls back to id when uid missing', userDocs[1].path === 'users/u2');
  t.ok('buildUserDocs: skips user with neither uid nor id (bad source data)', userDocs.length === 2);

  t.ok('buildRosterDocs: date used as doc id', buildRosterDocs(sampleData)[0].path === 'clinicDayRosters/2026-07-20');

  t.ok('buildQueueWalkInDocs: composite date_patientId id prevents dup walk-in same day',
    buildQueueWalkInDocs(sampleData)[0].path === 'queueWalkIns/2026-07-20_p2');

  const haDoc = buildHAComplianceDoc(sampleData);
  t.ok('buildHAComplianceDoc: single doc at haCompliance/main', haDoc.path === 'haCompliance/main');
  t.ok('buildHAComplianceDoc: null when source has no haCompliance', buildHAComplianceDoc({}) === null);

  const plan = buildMigrationPlan(sampleData);
  const summary = planSummary(plan);
  t.ok('planSummary: counts match source exactly',
    summary.patients === 2 && summary.visits === 3 && summary.telepharmacy === 1 &&
    summary.clinicDayRosters === 1 && summary.queueWalkIns === 1 && summary.haCompliance === 1);

  const verify = verifyPlanCounts(sampleData, plan);
  t.ok('verifyPlanCounts: ok=true when every collection count matches source', verify.ok === true);
  t.ok('verifyPlanCounts: flags the 1 user skipped for missing uid/id', verify.usersSkipped === 1);

  // ── กรณีข้อมูลว่างเปล่าทั้งหมด — ต้องไม่ throw และคืน array ว่างทุกตัว ──
  const emptyPlan = buildMigrationPlan({});
  t.ok('buildMigrationPlan: empty source data -> no throw, all-empty plan',
    Object.values(planSummary(emptyPlan)).every(n => n === 0));
}

module.exports = { run };
