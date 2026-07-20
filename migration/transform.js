// migration/transform.js
// ── ฟังก์ชัน "แปลงข้อมูล" ล้วนๆ (pure) ไม่แตะ Firestore เลย ──
// รับ data object รูปแบบเดิม (จาก clinic/main เอกสารเดียว) แล้วคืนรายการเอกสารที่ควรเขียนไปยัง
// โครงสร้างใหม่แบบแยก collection ทดสอบได้ทั้งหมดโดยไม่ต้องเชื่อมต่อ Firestore จริง
// ดู migration/README.md สำหรับแผนการย้ายแบบเต็ม และ migration/migrate.js สำหรับตัวรันจริง

function buildPatientDocs(data) {
  // เอกสารผู้ป่วยในโครงสร้างใหม่ไม่มี field "visits" ฝังอยู่ (เหมือนเดิม — visits เป็น top-level
  // array ที่อ้างอิงด้วย patientId อยู่แล้วในโครงสร้างเก่า) — ย้ายไปเป็น subcollection แทน
  return (data.patients || []).map(p => ({ path: `patients/${p.id}`, data: { ...p } }));
}

function buildVisitDocs(data) {
  return (data.visits || []).map(v => ({
    path: `patients/${v.patientId}/visits/${v.id}`,
    data: { ...v },
  }));
}

function buildTelepharmacyDocs(data) {
  return (data.telepharmacy || []).map(t => ({ path: `telepharmacy/${t.id}`, data: { ...t } }));
}

function buildUserDocs(data) {
  // ใช้ uid เป็น doc id เสมอ (ตรงกับ Firebase Auth uid) เพื่อให้ Firestore rules อ่าน role ของ
  // ผู้ใช้ปัจจุบันได้ตรงๆ ผ่าน get(/databases/$(database)/documents/users/$(request.auth.uid))
  return (data.users || [])
    .filter(u => u.uid || u.id)
    .map(u => ({ path: `users/${u.uid || u.id}`, data: { ...u } }));
}

function buildRosterDocs(data) {
  // date (yyyy-mm-dd) เป็น doc id ตรงตัว — วันคลินิกมีได้แค่ roster เดียวต่อวันอยู่แล้วในโครงสร้างเดิม
  return (data.clinicDayRosters || []).map(r => ({ path: `clinicDayRosters/${r.date}`, data: { ...r } }));
}

function buildQueueWalkInDocs(data) {
  // composite id `${date}_${patientId}` กัน walk-in ซ้ำคนเดียวกันในวันเดียวกันโดยธรรมชาติของ doc id
  return (data.queueWalkIns || []).map(w => ({
    path: `queueWalkIns/${w.date}_${w.patientId}`,
    data: { ...w },
  }));
}

function buildHAComplianceDoc(data) {
  if (!data.haCompliance) return null;
  return { path: 'haCompliance/main', data: { ...data.haCompliance } };
}

// รวมทุกอย่างเป็นแผนเดียว — ใช้ทั้งตอน dry-run (แค่ log) และตอนเขียนจริง
function buildMigrationPlan(data) {
  const haDoc = buildHAComplianceDoc(data);
  return {
    patients: buildPatientDocs(data),
    visits: buildVisitDocs(data),
    telepharmacy: buildTelepharmacyDocs(data),
    users: buildUserDocs(data),
    clinicDayRosters: buildRosterDocs(data),
    queueWalkIns: buildQueueWalkInDocs(data),
    haCompliance: haDoc ? [haDoc] : [],
  };
}

function planSummary(plan) {
  return Object.fromEntries(Object.entries(plan).map(([k, v]) => [k, v.length]));
}

// ตรวจว่าจำนวนเอกสารที่ "จะเขียน" ตรงกับจำนวนต้นทางเป๊ะ — ใช้ยืนยันก่อน/หลัง migrate จริง
// (ไม่นับ haCompliance เพราะเป็นเอกสารเดียวรวม ไม่ใช่ list)
function verifyPlanCounts(data, plan) {
  const mismatches = [];
  const checks = [
    ['patients', (data.patients || []).length, plan.patients.length],
    ['visits', (data.visits || []).length, plan.visits.length],
    ['telepharmacy', (data.telepharmacy || []).length, plan.telepharmacy.length],
    ['clinicDayRosters', (data.clinicDayRosters || []).length, plan.clinicDayRosters.length],
    ['queueWalkIns', (data.queueWalkIns || []).length, plan.queueWalkIns.length],
  ];
  checks.forEach(([name, expected, actual]) => {
    if (expected !== actual) mismatches.push({ collection: name, expected, actual });
  });
  // users: กรองทิ้งเฉพาะที่ไม่มี uid/id เลย (ข้อมูลเสียตั้งแต่ต้นทาง) — เตือนแต่ไม่ถือเป็น mismatch บล็อก
  const usersSource = (data.users || []).length;
  const usersSkipped = usersSource - plan.users.length;
  return { ok: mismatches.length === 0, mismatches, usersSkipped };
}

module.exports = {
  buildPatientDocs,
  buildVisitDocs,
  buildTelepharmacyDocs,
  buildUserDocs,
  buildRosterDocs,
  buildQueueWalkInDocs,
  buildHAComplianceDoc,
  buildMigrationPlan,
  planSummary,
  verifyPlanCounts,
};
