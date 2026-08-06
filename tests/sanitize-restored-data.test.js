// tests/sanitize-restored-data.test.js
// ── sanitizeRestoredData: กัน record ที่ผิดรูปแบบจากไฟล์ backup เข้าไปทำให้แอพ crash ทีหลัง ──
// (จุด .localeCompare/.charAt(0) หลายสิบจุดทั่วแอพไม่ guard ค่า undefined — ต้องกรองที่ต้นทาง
// ตอน restore แทนที่จะไล่แก้ทุกจุดที่ใช้ข้อมูลนี้)
const { readApp, extractBlocks } = require('./extract');

const src = readApp();
const code = extractBlocks(src, ['sanitizeRestoredData']);
// eslint-disable-next-line no-eval
eval(code + `\nglobal.sanitizeRestoredData = sanitizeRestoredData;`);

function run(t) {
  const validPatient = { id: 'p1', hn: 'HN001', firstName: 'ทดสอบ', lastName: 'หนึ่ง' };
  const validVisit = { id: 'v1', patientId: 'p1', visitDate: '2026-01-01' };
  const validTele = { id: 't1', patientId: 'p1', scheduledDate: '2026-01-01' };

  t.ok('valid records all pass through unchanged',
    (() => {
      const r = sanitizeRestoredData({ patients: [validPatient], visits: [validVisit], telepharmacy: [validTele] }, []);
      return r.patients.length === 1 && r.visits.length === 1 && r.telepharmacy.length === 1 && r.skipped.patients === 0;
    })());

  t.ok('patient missing firstName is dropped',
    (() => {
      const r = sanitizeRestoredData({ patients: [{ id: 'p2', hn: 'HN002' }] }, []);
      return r.patients.length === 0 && r.skipped.patients === 1;
    })());

  t.ok('visit missing visitDate is dropped (the exact crash trigger for .localeCompare sorts)',
    (() => {
      const r = sanitizeRestoredData({ patients: [validPatient], visits: [{ id: 'v2', patientId: 'p1' }] }, []);
      return r.visits.length === 0 && r.skipped.visits === 1;
    })());

  t.ok('telepharmacy missing scheduledDate is dropped',
    (() => {
      const r = sanitizeRestoredData({ patients: [validPatient], telepharmacy: [{ id: 't2', patientId: 'p1' }] }, []);
      return r.telepharmacy.length === 0 && r.skipped.telepharmacy === 1;
    })());

  t.ok('visit referencing a non-existent patientId is dropped (orphaned record)',
    (() => {
      const r = sanitizeRestoredData({ patients: [validPatient], visits: [{ id: 'v3', patientId: 'p999', visitDate: '2026-01-01' }] }, []);
      return r.visits.length === 0;
    })());

  t.ok('missing users -> falls back to provided fallback (does not wipe accounts)',
    (() => sanitizeRestoredData({ patients: [] }, [{ id: 'u1', role: 'admin' }]).users.length === 1)());
  t.ok('present users -> uses backup file users, not fallback',
    (() => sanitizeRestoredData({ patients: [], users: [{ id: 'u2' }] }, [{ id: 'u1' }]).users[0].id === 'u2')());

  t.ok('completely empty input -> no throw, empty arrays', (() => {
    const r = sanitizeRestoredData({}, []);
    return r.patients.length === 0 && r.visits.length === 0 && r.telepharmacy.length === 0;
  })());
}

module.exports = { run };
