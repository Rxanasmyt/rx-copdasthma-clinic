// tests/calculate-risk.test.js
// ── ทดสอบ calculateRisk: ตรวจว่าคะแนน CAT/mMRC/ACT ที่บันทึกในวิสิตมีผลต่อ risk level จริง ──
// เดิม calculateRisk อ่านแค่ exacerbation/adherence/inhalerTechnique จาก visitData ไม่เคยอ่าน
// visitData.assessments (CAT/mMRC/ACT) เลย ทำให้ผู้ป่วยที่ประเมิน CAT/mMRC สูงมากในวิสิตเดียวกัน
// ยังถูกคำนวณเป็น "Low Risk" ได้ ทั้งที่การ์ด GOLD/GINA บนหน้าจอเดียวกันแสดงกลุ่มเสี่ยงสูงชัดเจน
const { readApp, extractBlocks } = require('./extract');

const src = readApp();
const code = extractBlocks(src, ['calculateRisk', 'getPatientAge', 'calcAgeFromDOB']);
// eslint-disable-next-line no-eval
eval(code + `
global.calculateRisk = calculateRisk;
`);

function run(t) {
  const basePatient = { age: 55, comorbidities: [], asthmaControl: '', goldGrade: '' };
  const blankVisit = () => ({
    exacerbation: { countThisYear: 0, hospitalized: false },
    adherence: { level: 'Good' },
    inhalerTechnique: [{ overallScore: 'Good' }],
    assessments: {
      cat: { score: 0, allAnswered: false },
      mmrc: { grade: null },
      act: { score: 25, allAnswered: false },
    },
  });

  // ─── regression: CAT สูงมาก (≥30) ต้องดันเป็น High risk แม้ไม่มี exacerbation เลย ───
  {
    const v = blankVisit();
    v.assessments.cat = { score: 32, allAnswered: true };
    const r = calculateRisk(basePatient, v);
    t.ok('regression: CAT=32 (allAnswered) -> High risk แม้ไม่มี exacerbation/GOLD grade', r.level === 'High');
    t.ok('regression: CAT=32 -> มี flag บอกเหตุผลชัดเจน', r.flags.some(f => f.includes('CAT')));
  }

  // ─── regression: mMRC Grade 4 (แย่ที่สุด) ต้องดันเป็น High risk ───
  {
    const v = blankVisit();
    v.assessments.mmrc = { grade: 4 };
    const r = calculateRisk(basePatient, v);
    t.ok('regression: mMRC Grade 4 -> High risk', r.level === 'High');
  }

  // ─── regression: ACT < 16 (หืดควบคุมไม่ได้ตามเกณฑ์มาตรฐาน) ต้องดันเป็น High risk ───
  {
    const v = blankVisit();
    v.assessments.act = { score: 13, allAnswered: true };
    const r = calculateRisk(basePatient, v);
    t.ok('regression: ACT=13 (allAnswered, <16) -> High risk', r.level === 'High');
  }

  // ─── CAT ปานกลาง (20-29) ไม่ควรดันเป็น High risk ทันที (ต้องพิจารณาร่วมกับ exacerbation ตาม GOLD)
  // แต่ต้องมี flag บอกไว้ ไม่ใช่หายไปเงียบๆ ───
  {
    const v = blankVisit();
    v.assessments.cat = { score: 24, allAnswered: true };
    const r = calculateRisk(basePatient, v);
    t.ok('CAT=24 (20-29) ไม่ดันเป็น High เอง (ต้องรอ exacerbation ประกอบตามเกณฑ์ GOLD)', r.level !== 'High');
    t.ok('CAT=24 ยังมี flag แจ้งไว้ (ไม่หายไปเงียบๆ)', r.flags.some(f => f.includes('CAT')));
  }

  // ─── ไม่ได้ตอบครบ (allAnswered=false) ต้องไม่ถูกนำมาคิด risk (ค่า partial ยังไม่น่าเชื่อถือ) ───
  {
    const v = blankVisit();
    v.assessments.cat = { score: 35, allAnswered: false }; // ตอบไม่ครบ แม้คะแนนบางส่วนจะสูง
    const r = calculateRisk(basePatient, v);
    t.ok('CAT allAnswered=false ไม่ถูกนำมาคิด risk (ป้องกันค่าที่ยังตอบไม่ครบ)', !r.flags.some(f => f.includes('CAT')));
  }

  // ─── ค่าปกติทั้งหมดต้องยังเป็น Low เหมือนเดิม (ไม่ over-trigger) ───
  {
    const v = blankVisit();
    const r = calculateRisk(basePatient, v);
    t.ok('ค่าประเมินปกติทั้งหมด (ไม่มี CAT/mMRC สูง, ACT ดี) -> ยังเป็น Low เหมือนเดิม', r.level === 'Low');
  }

  // ─── exacerbation ≥2 ครั้ง/ปี ยังคงทำงานถูกต้องเหมือนเดิม (ไม่ regression) ───
  {
    const v = blankVisit();
    v.exacerbation.countThisYear = 2;
    const r = calculateRisk(basePatient, v);
    t.ok('exacerbation countThisYear=2 -> ยัง High risk เหมือนเดิม (ไม่ regression)', r.level === 'High');
  }
}

module.exports = { run };
