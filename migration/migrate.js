#!/usr/bin/env node
// migration/migrate.js
// ── ตัวรัน migration จริง — ย้ายจาก clinic/main (เอกสารเดียว) ไปเป็นหลาย collection ──
//
// ปลอดภัยโดยดีไซน์:
//   1. ไม่ลบ/แก้ clinic/main เลย — เขียนไปที่ collection ใหม่เท่านั้น ของเดิมยังอยู่ครบ
//      (แอพปัจจุบันยังอ่าน/เขียน clinic/main เหมือนเดิมทุกประการ จนกว่าจะแก้โค้ดแอพแยกต่างหาก
//       ในขั้นตอนถัดไป — การรัน migration นี้จึงไม่กระทบผู้ใช้งานแอพจริงเลยแม้แต่น้อย)
//   2. โหมด default คือ --dry-run (ไม่เขียนอะไรทั้งสิ้น แค่ print แผน+ตรวจนับ)
//   3. ต้องส่ง --commit ชัดเจนถึงจะเขียนจริง และต้องมี GOOGLE_APPLICATION_CREDENTIALS
//      ชี้ไปยัง service account key ของโปรเจกต์เอง (ไม่ hardcode credential ในโค้ด)
//   4. เขียนแบบ idempotent (ใช้ id เดิมเป็น doc id เสมอ) — รันซ้ำได้โดยไม่ซ้ำข้อมูล
//   5. verify อัตโนมัติหลังเขียน — เทียบจำนวนเอกสารใน collection ใหม่กับต้นทาง
//
// วิธีใช้:
//   node migration/migrate.js                     # dry-run (ปลอดภัย รันได้เสมอ)
//   node migration/migrate.js --commit             # เขียนจริง ต้องตั้ง GOOGLE_APPLICATION_CREDENTIALS ก่อน
//   node migration/migrate.js --commit --project=rxcopdasthmaclinic
//
// ดู migration/README.md สำหรับ runbook แบบเต็ม (ก่อน/หลังรัน, วิธี rollback)

const { buildMigrationPlan, planSummary, verifyPlanCounts } = require('./transform');

function parseArgs(argv) {
  const commit = argv.includes('--commit');
  const projectArg = argv.find(a => a.startsWith('--project='));
  const project = projectArg ? projectArg.split('=')[1] : null;
  return { commit, project };
}

async function loadSourceData(db) {
  const snap = await db.collection('clinic').doc('main').get();
  if (!snap.exists) throw new Error('ไม่พบเอกสาร clinic/main — ตรวจสอบว่าเชื่อมต่อโปรเจกต์ Firebase ถูกต้อง');
  return snap.data();
}

async function writeDocs(db, docs, { commit }) {
  if (!commit || docs.length === 0) return;
  // เขียนเป็น batch ละ <=400 (เผื่อ margin จากขีดจำกัด 500 ต่อ batch ของ Firestore)
  const BATCH_SIZE = 400;
  for (let i = 0; i < docs.length; i += BATCH_SIZE) {
    const batch = db.batch();
    docs.slice(i, i + BATCH_SIZE).forEach(({ path, data }) => {
      batch.set(db.doc(path), data, { merge: false });
    });
    await batch.commit();
  }
}

async function verifyWritten(db, plan) {
  // อ่านนับจำนวนเอกสารที่เขียนจริงใน collection ใหม่ เทียบกับแผนที่ตั้งใจเขียน
  const results = {};
  for (const [name, docs] of Object.entries(plan)) {
    if (docs.length === 0) { results[name] = { expected: 0, written: 0, ok: true }; continue; }
    let written = 0;
    for (const { path } of docs) {
      const snap = await db.doc(path).get();
      if (snap.exists) written++;
    }
    results[name] = { expected: docs.length, written, ok: written === docs.length };
  }
  return results;
}

async function main() {
  const { commit, project } = parseArgs(process.argv.slice(2));

  console.log(`\n═══ Rx-COPD/Asthma Clinic — Data Migration (single doc → collections) ═══`);
  console.log(`โหมด: ${commit ? '⚠️  COMMIT (เขียนจริง)' : '🔍 DRY-RUN (ไม่เขียนอะไร)'}\n`);

  if (commit && !process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    console.error('❌ ต้องตั้งค่า GOOGLE_APPLICATION_CREDENTIALS ให้ชี้ไปยัง service account key ก่อนใช้ --commit');
    console.error('   ดูวิธีขอ key ที่ migration/README.md');
    process.exit(1);
  }

  // require firebase-admin แบบ lazy — dry-run โดยไม่มี firebase-admin ติดตั้งก็ยัง import
  // transform.js มาทดสอบ logic ได้ตามปกติ (ดู tests/migration-transform.test.js)
  let admin;
  try {
    admin = require('firebase-admin');
  } catch (e) {
    console.error('❌ ไม่พบ firebase-admin — ติดตั้งก่อน: npm install firebase-admin');
    process.exit(1);
  }

  admin.initializeApp(project ? { projectId: project } : {});
  const db = admin.firestore();

  console.log('📥 กำลังอ่านข้อมูลต้นทางจาก clinic/main ...');
  const data = await loadSourceData(db);

  const plan = buildMigrationPlan(data);
  const summary = planSummary(plan);
  console.log('\n📋 แผนการย้ายข้อมูล (จำนวนเอกสารที่จะเขียนต่อ collection):');
  console.table(summary);

  const verify = verifyPlanCounts(data, plan);
  if (!verify.ok) {
    console.error('\n❌ จำนวนเอกสารในแผนไม่ตรงกับต้นทาง — หยุดก่อนเขียนจริง ตรวจสอบ transform.js:');
    console.error(JSON.stringify(verify.mismatches, null, 2));
    process.exit(1);
  }
  if (verify.usersSkipped > 0) {
    console.warn(`\n⚠️  พบผู้ใช้ ${verify.usersSkipped} รายที่ไม่มี uid/id — จะไม่ถูกย้าย ตรวจสอบข้อมูลต้นทางด้วยตนเอง`);
  }

  if (!commit) {
    console.log('\n✅ Dry-run เสร็จสิ้น — ไม่มีการเขียนข้อมูลใดๆ clinic/main ยังคงเดิมทุกประการ');
    console.log('   เมื่อพร้อมเขียนจริง ให้รันอีกครั้งพร้อม --commit\n');
    return;
  }

  console.log('\n✍️  กำลังเขียนข้อมูลไปยัง collection ใหม่ (clinic/main จะไม่ถูกแตะต้อง)...');
  for (const [name, docs] of Object.entries(plan)) {
    await writeDocs(db, docs, { commit });
    console.log(`   ✓ เขียน ${name}: ${docs.length} เอกสาร`);
  }

  console.log('\n🔍 กำลังตรวจสอบข้อมูลที่เขียนจริงในฐานข้อมูล...');
  const written = await verifyWritten(db, plan);
  console.table(written);
  const allOk = Object.values(written).every(r => r.ok);
  if (allOk) {
    console.log('\n✅ Migration สำเร็จ ครบทุกเอกสาร — clinic/main เดิมยังอยู่ครบเป็น fallback');
    console.log('   ขั้นตอนถัดไป (แยกต่างหาก ยังไม่ทำอัตโนมัติ): แก้โค้ดแอพให้อ่าน/เขียน collection ใหม่');
  } else {
    console.error('\n❌ พบเอกสารที่เขียนไม่ครบ — ตรวจสอบ log ด้านบน ข้อมูลต้นทาง (clinic/main) ยังปลอดภัย ไม่ถูกแตะต้อง');
    process.exit(1);
  }
}

if (require.main === module) {
  main().catch(err => {
    console.error('\n❌ Migration ล้มเหลว:', err.message);
    console.error('   clinic/main ไม่ถูกแตะต้อง — ปลอดภัย รันใหม่ได้หลังแก้ปัญหา');
    process.exit(1);
  });
}

module.exports = { parseArgs, loadSourceData, writeDocs, verifyWritten };
