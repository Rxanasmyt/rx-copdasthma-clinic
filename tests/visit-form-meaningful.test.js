// tests/visit-form-meaningful.test.js
// ── isVisitFormMeaningful: ตรวจการกันข้อมูลหาย (autosave gate + navigate-away guard) ──
// เดิมเช็คแค่ chiefComplaint/medications/inhalerTechnique/adherence/soap(s,a,p)/drp เท่านั้น
// ทำให้ vitals/CAT/ACT/exacerbation/counseling/pharmacistNote/nextVisit ที่กรอกไว้ไม่ถูกนับว่า
// "มีข้อมูล" เลย — ผู้ป่วยกรอกแค่พวกนี้แล้วออกจากฟอร์มโดยไม่บันทึกจะไม่มีการเตือน/ไม่มี draft กู้คืน
const { readApp, extractBlocks } = require('./extract');

const src = readApp();
const code = extractBlocks(src, ['isVisitFormMeaningful']);
// eslint-disable-next-line no-eval
eval(code + `\nglobal.isVisitFormMeaningful = isVisitFormMeaningful;`);

function run(t) {
  t.ok('empty form -> not meaningful', isVisitFormMeaningful({}, []) === false);
  t.ok('null form -> not meaningful, no throw', isVisitFormMeaningful(null, []) === false);

  t.ok('chiefComplaint alone -> meaningful (existing behavior preserved)',
    isVisitFormMeaningful({ chiefComplaint: 'ไอ' }, []) === true);
  t.ok('soap.p alone -> meaningful (existing behavior preserved)',
    isVisitFormMeaningful({ soap: { p: 'plan text' } }, []) === true);

  // ─── ฟิลด์ที่เดิมหลุดจากการเช็ค — ต้องนับว่า meaningful แล้วตอนนี้ ───
  t.ok('vitals.spO2 alone -> meaningful (was missing before fix)',
    isVisitFormMeaningful({ vitals: { spO2: '96' } }, []) === true);
  t.ok('assessments.cat.allAnswered -> meaningful (was missing before fix)',
    isVisitFormMeaningful({ assessments: { cat: { allAnswered: true } } }, []) === true);
  t.ok('exacerbation.hospitalized -> meaningful (was missing before fix)',
    isVisitFormMeaningful({ exacerbation: { hospitalized: true } }, []) === true);
  t.ok('exacEvents non-empty -> meaningful (was missing before fix)',
    isVisitFormMeaningful({}, [{ id: 'e1', date: '2026-01-01' }]) === true);
  t.ok('counselingTopics non-empty -> meaningful (was missing before fix)',
    isVisitFormMeaningful({ counselingTopics: ['inhaler-technique'] }, []) === true);
  t.ok('pharmacistNote alone -> meaningful (was missing before fix)',
    isVisitFormMeaningful({ pharmacistNote: 'ติดตามอาการ' }, []) === true);
  t.ok('nextVisit alone -> meaningful (was missing before fix)',
    isVisitFormMeaningful({ nextVisit: '2026-08-01' }, []) === true);
  t.ok('soap.o alone -> meaningful (was missing before fix)',
    isVisitFormMeaningful({ soap: { o: 'objective findings' } }, []) === true);

  // exacerbation.countThisYear === 0 (default/unset) should NOT count as meaningful on its own
  t.ok('exacerbation.countThisYear=0 alone -> not meaningful (default value, not user input)',
    isVisitFormMeaningful({ exacerbation: { countThisYear: 0 } }, []) === false);
  t.ok('exacerbation.countThisYear=2 -> meaningful',
    isVisitFormMeaningful({ exacerbation: { countThisYear: 2 } }, []) === true);

  // ─── regression จริงที่พบผ่าน browser test: informedConsent default เป็น true เสมอ ───
  // สำหรับ visit ใหม่ทุกอัน (opt-out ไม่ใช่ opt-in) — ต้องไม่นับว่า "meaningful" จากค่า default
  // นี้เพียงอย่างเดียว ไม่งั้นฟอร์มใหม่เอี่ยมที่ยังไม่ได้แตะอะไรเลยจะโดนเตือน/สร้าง draft ทันที
  t.ok('informedConsent=true alone (blank new-visit default) -> NOT meaningful',
    isVisitFormMeaningful({ informedConsent: true }, []) === false);
  t.ok('informedConsent explicitly unchecked (false) -> meaningful (deliberate action)',
    isVisitFormMeaningful({ informedConsent: false }, []) === true);
  t.ok('full blank-visit-shaped default (informedConsent:true, empty everything else) -> NOT meaningful',
    isVisitFormMeaningful({
      chiefComplaint: '', medications: [], inhalerTechnique: [], adherence: { score: 0 },
      soap: { s: '', o: '', a: '', p: '' }, drp: { items: [] },
      vitals: {}, assessments: {}, exacerbation: { countThisYear: 0 },
      counselingTopics: [], pharmacistNote: '', nextVisit: '', informedConsent: true,
    }, []) === false);
}

module.exports = { run };
