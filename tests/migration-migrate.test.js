// tests/migration-migrate.test.js
// ── ทดสอบ loadSourceData/writeDocs/verifyWritten ใน migration/migrate.js ด้วย Firestore mock
// จำลองพฤติกรรมที่ migrate.js ใช้จริง (collection().doc().get(), db.doc(path), db.batch()) แบบ
// in-memory ล้วนๆ ไม่ต้องมี firebase-admin ติดตั้งจริงหรือเชื่อมต่อเน็ตเวิร์กใดๆ
const { loadSourceData, writeDocs, verifyWritten } = require('../migration/migrate');
const { buildMigrationPlan } = require('../migration/transform');

function makeMockDb(seed = {}) {
  const store = new Map(); // path -> data
  Object.entries(seed).forEach(([path, data]) => store.set(path, data));

  function docRef(path) {
    return {
      path,
      get: async () => ({ exists: store.has(path), data: () => store.get(path) }),
    };
  }
  return {
    collection: (name) => ({
      doc: (id) => docRef(`${name}/${id}`),
    }),
    doc: (path) => docRef(path),
    batch: () => {
      const ops = [];
      return {
        set: (ref, data) => ops.push({ ref, data }),
        commit: async () => { ops.forEach(({ ref, data }) => store.set(ref.path, data)); },
      };
    },
    _store: store,
  };
}

const sampleData = {
  patients: [{ id: 'p1', hn: 'HN001', firstName: 'หนึ่ง' }],
  visits: [{ id: 'v1', patientId: 'p1', visitDate: '2026-01-01' }],
  telepharmacy: [],
  users: [{ uid: 'u1', role: 'admin' }],
  clinicDayRosters: [],
  queueWalkIns: [],
  haCompliance: { medRec: [] },
};

async function run(t) {
  // ─── loadSourceData ───
  {
    const db = makeMockDb({ 'clinic/main': sampleData });
    const loaded = await loadSourceData(db);
    t.ok('loadSourceData: reads clinic/main correctly', loaded.patients[0].hn === 'HN001');
  }
  {
    const db = makeMockDb({}); // ไม่มี clinic/main เลย
    let threw = false;
    try { await loadSourceData(db); } catch (e) { threw = true; }
    t.ok('loadSourceData: throws clear error when clinic/main missing', threw);
  }

  // ─── writeDocs + verifyWritten (end-to-end ผ่าน mock) ───
  {
    const db = makeMockDb();
    const plan = buildMigrationPlan(sampleData);
    for (const docs of Object.values(plan)) {
      await writeDocs(db, docs, { commit: true });
    }
    t.ok('writeDocs: patient doc actually written to mock store', db._store.has('patients/p1'));
    t.ok('writeDocs: visit doc written under nested patient path', db._store.has('patients/p1/visits/v1'));
    t.ok('writeDocs: clinic/main itself untouched (migration never writes there)', !db._store.has('clinic/main'));

    const written = await verifyWritten(db, plan);
    t.ok('verifyWritten: patients collection reports ok=true', written.patients.ok === true);
    t.ok('verifyWritten: visits collection reports ok=true', written.visits.ok === true);
  }
  {
    // dry-run (commit: false) — ไม่ควรเขียนอะไรเลยแม้เรียก writeDocs
    const db = makeMockDb();
    const plan = buildMigrationPlan(sampleData);
    await writeDocs(db, plan.patients, { commit: false });
    t.ok('writeDocs: dry-run (commit=false) writes nothing', db._store.size === 0);
  }
}

module.exports = { run };
