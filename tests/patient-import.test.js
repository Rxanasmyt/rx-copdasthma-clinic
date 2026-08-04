// tests/patient-import.test.js
const { readApp, extractBlocks } = require('./extract');
const fs = require('fs');
const path = require('path');

const src = readApp();
const code = extractBlocks(src, ['parsePatientImportTable']);

// stub the runtime deps parsePatientImportTable calls at runtime (AppStore, window.RxOCR)
// ใช้ logic เดียวกับที่มีอยู่จริงในแอพ ไม่ประดิษฐ์ใหม่ — คัดลอกจาก RxClinic.html บล็อกเดียวกับที่
// ใช้งานจริง (splitThaiName, calcAgeFromDOB, genderFromPrefix)
const THAI_PREFIX_MAP = [
  ['เด็กชาย', 'เด็กชาย'], ['เด็กหญิง', 'เด็กหญิง'],
  ['ด.ช.', 'เด็กชาย'], ['ด.ญ.', 'เด็กหญิง'],
  ['นางสาว', 'นางสาว'], ['น.ส.', 'นางสาว'], ['นส.', 'นางสาว'],
  ['นาง', 'นาง'], ['นาย', 'นาย'],
];
function splitThaiName(nameStr) {
  const trimmed = (nameStr || '').trim().replace(/\s+/g, ' ');
  if (!trimmed) return { prefix: null, firstName: null, lastName: null };
  const match = THAI_PREFIX_MAP.find(([detect]) => trimmed.startsWith(detect));
  const rest = match ? trimmed.slice(match[0].length).trim() : trimmed;
  const parts = rest.split(/\s+/).filter(Boolean);
  return { prefix: match ? match[1] : null, firstName: parts[0] || null, lastName: parts.slice(1).join(' ') || null };
}
function calcAgeFromDOB(dobStr) {
  if (!dobStr) return null;
  const dob = new Date(dobStr);
  if (isNaN(dob.getTime())) return null;
  const today = new Date('2026-08-03'); // วันที่คงที่ ไม่ใช้ new Date() ตรงตามข้อจำกัด workflow ของ session นี้
  let age = today.getFullYear() - dob.getFullYear();
  const m = today.getMonth() - dob.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < dob.getDate())) age--;
  return age;
}
function genderFromPrefix(prefix) {
  if (['นาง', 'นางสาว', 'เด็กหญิง'].includes(prefix)) return 'F';
  if (['นาย', 'เด็กชาย'].includes(prefix)) return 'M';
  return null;
}

global.window = { RxOCR: { splitThaiName } };
global.AppStore = { calcAgeFromDOB, genderFromPrefix };
// eslint-disable-next-line no-eval
eval(code + `\nglobal.parsePatientImportTable = parsePatientImportTable;`);

function run(t) {
  // ─── กรณีพื้นฐาน: หัวตารางภาษาอังกฤษเดิม (backward compatible) คั่นด้วย comma ───
  {
    const csv = 'HN,Prefix,FirstName,LastName,Age,Gender,Diagnosis,Phone\n67001234,นาย,สมชาย,ใจดี,65,M,COPD,0812345678';
    const r = parsePatientImportTable(csv);
    t.ok('English header CSV (comma) still works', r.rows?.length === 1 && r.rows[0].hn === '67001234' && r.rows[0].firstName === 'สมชาย');
  }

  // ─── คอลัมน์ชื่อรวม + วันเกิด + ที่อยู่ + เบอร์ "-" (รูปแบบจริงที่ผู้ใช้ส่งมา) คั่นด้วย Tab ───
  {
    const tsv = [
      'ลำดับ\tHN\tเบอร์โทรศัพท์\tคำนำหน้า/ชื่อ-นามสกุล\tวันเกิด (DOB)\tที่อยู่\tโรค',
      '1\t7963\t822623570\tน.ส.ซาลีฮะ สาเมาะแม\t1/3/1964\t50/3 หมู่ที่ 09 ต.กรงปินัง อ.กรงปินัง\tCOPD',
      '2\t38957\t-\tน.ส.ปิเยาะ เจะโอะ\t7/1/19554\t1/1 หมู่ที่ 03 ต.สะเอะ อ.กรงปินัง จ.ยะลา\tCOPD',
    ].join('\n');
    const r = parsePatientImportTable(tsv);
    t.ok('Tab-delimited real-world table parses 2 rows', r.rows?.length === 2);
    const row1 = r.rows[0];
    t.ok('combined name column splits correctly (prefix)', row1.prefix === 'นางสาว');
    t.ok('combined name column splits correctly (firstName)', row1.firstName === 'ซาลีฮะ');
    t.ok('combined name column splits correctly (lastName)', row1.lastName === 'สาเมาะแม');
    t.ok('DOB d/m/yyyy converts to ISO', row1.dateOfBirth === '1964-03-01');
    t.ok('age computed from DOB (not left at 0)', row1.age > 0);
    t.ok('gender inferred from prefix when no gender column', row1.gender === 'F');
    t.ok('address column captured', row1.address.includes('กรงปินัง'));
    t.ok('diagnosis column captured', row1.diagnosis === 'COPD');

    const row2 = r.rows[1];
    t.ok('phone "-" normalized to empty string, not literal "-"', row2.phone === '');
    t.ok('malformed DOB (5-digit year) does not throw, falls back to empty dateOfBirth', row2.dateOfBirth === '');
    t.ok('malformed DOB -> age falls back to 0 (visible as "?" in preview, not silently wrong)', row2.age === 0);
  }

  // ─── วันเกิดมี double-slash พิมพ์ผิด (พบจริงในข้อมูลผู้ใช้) ───
  {
    const tsv = 'HN\tคำนำหน้า/ชื่อ-นามสกุล\tวันเกิด (DOB)\tโรค\n13848\tนางสปิเย๊าะ แยแล\t1/1//1947\tCOPD';
    const r = parsePatientImportTable(tsv);
    t.ok('double-slash malformed DOB does not throw', r.rows?.length === 1);
    t.ok('double-slash malformed DOB -> empty dateOfBirth (not garbage)', r.rows[0].dateOfBirth === '');
  }

  // ─── HN ซ้ำ/แถวไม่มี HN หรือชื่อ -> ถูกกรองออก ไม่ throw ───
  {
    const tsv = 'HN\tคำนำหน้า/ชื่อ-นามสกุล\tโรค\n\tนายไม่มีHN\tCOPD\n999\t\tCOPD';
    const r = parsePatientImportTable(tsv);
    t.ok('rows missing HN or name are filtered out silently', (r.rows || []).length === 0);
  }

  // ─── ไฟล์ว่าง/ไม่มีข้อมูล -> error ชัดเจน ไม่ throw ───
  {
    const r = parsePatientImportTable('HN,FirstName');
    t.ok('header-only input returns error, not throw', !!r.error);
  }

  // ─── ทดสอบกับข้อมูลจริงทั้งหมด 147 รายที่ผู้ใช้ส่งมาในแชท (ถ้ามีไฟล์ fixture) ───
  const fixturePath = path.join(__dirname, 'fixtures', 'real-patient-import-147.tsv');
  if (fs.existsSync(fixturePath)) {
    const realData = fs.readFileSync(fixturePath, 'utf8');
    const r = parsePatientImportTable(realData);
    t.ok('real 147-row dataset: no throw, produces rows', Array.isArray(r.rows));
    t.ok('real 147-row dataset: all 147 rows parsed (none silently dropped)', r.rows?.length === 147);
    t.ok('real 147-row dataset: every row has a non-empty HN', r.rows.every(row => row.hn));
    t.ok('real 147-row dataset: every row has a non-empty firstName', r.rows.every(row => row.firstName));
    t.ok('real 147-row dataset: every row has a non-empty lastName', r.rows.every(row => row.lastName));
    t.ok('real 147-row dataset: all diagnosed COPD as given', r.rows.every(row => row.diagnosis === 'COPD'));
    const noDob = r.rows.filter(row => !row.dateOfBirth);
    t.ok('real 147-row dataset: only the 2 known-malformed DOB rows fail to parse (HN 38957, 13848)',
      noDob.length === 2 && noDob.every(row => ['38957', '13848'].includes(row.hn)));
    const dashPhoneRows = r.rows.filter(row => row.phone === '');
    t.ok('real 147-row dataset: "-" phone rows normalized to empty (HN 38957, 17945, 17351, 5244, 11224, 16724, 12527)',
      dashPhoneRows.length === 7 && ['38957', '17945', '17351', '5244', '11224', '16724', '12527'].every(hn => dashPhoneRows.some(row => row.hn === hn)));
  }
}

module.exports = { run };
