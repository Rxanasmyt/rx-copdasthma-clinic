// tests/patient-reports.test.js
// ── ทดสอบฟีเจอร์รายงาน/ดึงรายชื่อผู้ป่วยที่เพิ่มใหม่: ค้นหาตามยา (ทั้งทะเบียน) + รายชื่อฝั่ง "ผ่านเกณฑ์" ของ KPI ──
const { readApp, extractBlocks } = require('./extract');

const src = readApp();
const code = extractBlocks(src, ['searchPatientsByMedication', 'getProblemPatients', 'getPassingPatients']);
// eslint-disable-next-line no-eval
eval(code + `
global.searchPatientsByMedication = searchPatientsByMedication;
global.getProblemPatients = getProblemPatients;
global.getPassingPatients = getPassingPatients;
`);

const mkPatient = (id, dx, extra) => ({ id, hn: 'HN' + id, prefix: '', firstName: 'P' + id, lastName: 'Last' + id, diagnosis: dx, ...extra });

function run(t) {
  // ─── searchPatientsByMedication: กรณีพื้นฐาน — ตอบคำถาม "ใช้ยา Anoro กี่คน ใครบ้าง" ───
  {
    const patients = [mkPatient('p1', 'COPD'), mkPatient('p2', 'Asthma'), mkPatient('p3', 'COPD')];
    const visits = [
      { id: 'v1', patientId: 'p1', visitDate: '2026-06-01', medications: [{ name: 'Anoro Ellipta', dose: '1 puff OD', adherence: 'Good' }] },
      { id: 'v2', patientId: 'p2', visitDate: '2026-06-02', medications: [{ name: 'Symbicort Turbuhaler', dose: '2 puff BID' }] },
      { id: 'v3', patientId: 'p1', visitDate: '2026-07-01', medications: [{ name: 'Anoro Ellipta', dose: '1 puff OD' }] }, // p1 ใช้ Anoro 2 ครั้ง
      { id: 'v4', patientId: 'p3', visitDate: '2026-07-05', medications: [{ name: 'anoro ellipta', dose: '1 puff OD' }] }, // ตัวพิมพ์เล็กหมด ต้องยังเจอ
    ];
    const results = searchPatientsByMedication(patients, visits, 'Anoro');
    t.ok('searchPatientsByMedication: นับผู้ป่วยไม่ซ้ำ (ไม่ใช่นับจำนวน visit)', results.length === 2);
    t.ok('searchPatientsByMedication: จับคู่แบบไม่สนตัวพิมพ์เล็ก/ใหญ่', results.some(r => r.patientId === 'p3'));
    t.ok('searchPatientsByMedication: ไม่รวมผู้ป่วยที่ไม่ได้ใช้ยานี้', !results.some(r => r.patientId === 'p2'));
    const p1result = results.find(r => r.patientId === 'p1');
    t.ok('searchPatientsByMedication: เก็บประวัติการใช้ยาครบทุกครั้ง (ไม่ใช่แค่ครั้งล่าสุด)', p1result.matches.length === 2);
    t.ok('searchPatientsByMedication: เรียงประวัติของแต่ละคนตามวันที่ล่าสุดก่อน', p1result.matches[0].visitDate === '2026-07-01');
    t.ok('searchPatientsByMedication: แนบข้อมูล patient object ให้ครบ (ดึงไปแสดง/นำทางได้)', p1result.patient.hn === 'HNp1');
    t.ok('searchPatientsByMedication: เรียงผลลัพธ์ตามวันที่ใช้ยาล่าสุดของแต่ละคน (คนล่าสุดก่อน)', results[0].patientId === 'p3');
  }

  // ─── searchPatientsByMedication: กรณี edge case ───
  {
    t.ok('searchPatientsByMedication: query ว่าง -> คืน array ว่าง (ไม่ค้นทั้งหมดมาโดยไม่ตั้งใจ)',
      searchPatientsByMedication([mkPatient('p1', 'COPD')], [{ patientId: 'p1', medications: [{ name: 'Anoro' }] }], '').length === 0);
    t.ok('searchPatientsByMedication: ไม่มี visits/patients เลย -> ไม่ throw คืน array ว่าง',
      searchPatientsByMedication(undefined, undefined, 'anoro').length === 0);
    t.ok('searchPatientsByMedication: visit ที่ไม่มี medications array -> ไม่ throw',
      searchPatientsByMedication([mkPatient('p1', 'COPD')], [{ patientId: 'p1', visitDate: '2026-01-01' }], 'anoro').length === 0);
    // ผู้ป่วยถูกลบไปแล้วแต่ visit เก่ายังค้างอยู่ — ต้องกรองทิ้ง ไม่ crash ตอน render (ไม่มี patient object)
    const orphanResult = searchPatientsByMedication([], [{ patientId: 'ghost', visitDate: '2026-01-01', medications: [{ name: 'Anoro' }] }], 'anoro');
    t.ok('searchPatientsByMedication: กรองทิ้ง visit ของผู้ป่วยที่ถูกลบไปแล้ว (กัน crash)', orphanResult.length === 0);
  }

  // ─── getPassingPatients: ต้องเป็นส่วนเติมเต็มของ getProblemPatients เสมอ (ไม่ทับซ้อน ไม่ตกหล่นคนในทะเบียน) ───
  {
    const roster = [
      { id: 'p1', hn: 'HN1', name: 'A', diagnosis: 'Asthma', hasICS: false },
      { id: 'p2', hn: 'HN2', name: 'B', diagnosis: 'Asthma', hasICS: true },
      { id: 'p3', hn: 'HN3', name: 'C', diagnosis: 'COPD', hasICS: true }, // ไม่เกี่ยวกับ ICS metric (ไม่ใช่ Asthma)
    ];
    const fail = getProblemPatients('asthmaIcsPercent', roster, []);
    const pass = getPassingPatients('asthmaIcsPercent', roster, []);
    t.ok('getPassingPatients: คืนฝั่งตรงข้ามของ getProblemPatients พอดี (ไม่นับซ้ำ ไม่ตกหล่น)',
      fail.length === 1 && pass.length === 1 && fail[0].id === 'p1' && pass[0].id === 'p2');
    t.ok('getPassingPatients: ไม่รวมผู้ป่วยที่ไม่เข้าเกณฑ์ตัวชี้วัดนี้ตั้งแต่ต้น (COPD ไม่เกี่ยวกับ ICS metric)',
      !fail.some(r => r.id === 'p3') && !pass.some(r => r.id === 'p3'));

    // techniquePass ใช้ tri-state (true/false/null) — ผู้ป่วยที่ไม่เคยประเมินเทคนิคเลย (null) ต้องไม่ถูกนับทั้งสองฝั่ง
    const rosterTech = [
      { id: 'p1', techniquePass: true }, { id: 'p2', techniquePass: false }, { id: 'p3', techniquePass: null },
    ];
    const passTech = getPassingPatients('techniquePercent', rosterTech, []);
    const failTech = getProblemPatients('techniquePercent', rosterTech, []);
    t.ok('getPassingPatients: techniquePass=null (ยังไม่ประเมิน) ไม่ถูกนับเป็นฝั่งผ่าน', passTech.length === 1 && passTech[0].id === 'p1');
    t.ok('getPassingPatients: techniquePass=null ไม่ถูกนับเป็นฝั่งไม่ผ่านเช่นกัน (สอดคล้องของเดิม)', failTech.length === 1 && failTech[0].id === 'p2');

    // carePercent: ฝั่งผ่าน = มาตามนัดจริง (ไม่อยู่ใน noShowRoster)
    const careRoster = [{ id: 'p1', hn: 'HN1', name: 'A' }, { id: 'p2', hn: 'HN2', name: 'B' }];
    const noShow = [{ id: 'p2', hn: 'HN2', name: 'B', nextVisit: '2026-07-01' }];
    const carePass = getPassingPatients('carePercent', careRoster, noShow);
    t.ok('getPassingPatients carePercent: ผู้ป่วยที่ไม่ได้อยู่ใน no-show roster ถือว่ามาตามนัด', carePass.length === 1 && carePass[0].id === 'p1');
  }
}

module.exports = { run };
