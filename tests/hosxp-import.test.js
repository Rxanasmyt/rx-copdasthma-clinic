// tests/hosxp-import.test.js
const { readApp, extractBlocks } = require('./extract');

const src = readApp();
const code = extractBlocks(src, ['THAI_NAME_PREFIXES', 'convertBEDateToISO', 'splitThaiPatientName', 'matchImportedPatient']);
// eslint-disable-next-line no-eval
eval(code + `
global.convertBEDateToISO = convertBEDateToISO;
global.splitThaiPatientName = splitThaiPatientName;
global.matchImportedPatient = matchImportedPatient;
`);

function run(t) {
  // ─── convertBEDateToISO: ปี พ.ศ. 2 หลักจากรายงาน HOSxP จริง ───
  t.ok('BE date "20 /07 /69" -> 2026-07-20', convertBEDateToISO('20 /07 /69') === '2026-07-20');
  t.ok('BE date "03 /07 /69" -> 2026-07-03', convertBEDateToISO('03 /07 /69') === '2026-07-03');
  t.ok('BE date "30 /03 /69" -> 2026-03-30', convertBEDateToISO('30 /03 /69') === '2026-03-30');
  t.ok('invalid/empty date -> empty string, no throw', convertBEDateToISO('') === '' && convertBEDateToISO(null) === '' && convertBEDateToISO('garbage') === '');

  // ─── splitThaiPatientName: ตัวอย่างจริงจากไฟล์ HOSxP ───
  {
    const r = splitThaiPatientName('นายแวฮามะ  สะดียามู');
    t.ok('splitThaiPatientName: นาย prefix detected', r.prefix === 'นาย');
    t.ok('splitThaiPatientName: firstName correct', r.firstName === 'แวฮามะ');
    t.ok('splitThaiPatientName: lastName correct', r.lastName === 'สะดียามู');
  }
  {
    const r = splitThaiPatientName('ด.ญ.ตัสนีม  แสวงดี');
    t.ok('splitThaiPatientName: ด.ญ. prefix detected (multi-char with dots)', r.prefix === 'ด.ญ.');
    t.ok('splitThaiPatientName: firstName after ด.ญ.', r.firstName === 'ตัสนีม');
  }
  {
    const r = splitThaiPatientName('น.ส.สาปีเร๊าะ  เจ๊ะโซ๊ะ');
    t.ok('splitThaiPatientName: น.ส. prefix detected', r.prefix === 'น.ส.');
  }
  {
    const r = splitThaiPatientName('ไม่มีคำนำหน้า');
    t.ok('splitThaiPatientName: no known prefix -> defaults to นาย, keeps whole as firstName', r.prefix === 'นาย' && r.firstName === 'ไม่มีคำนำหน้า');
  }

  // ─── matchImportedPatient: จับคู่ HN ตรง และแบบตัดเลขศูนย์นำหน้า ───
  {
    const patients = [
      { id: 'a', hn: '0025671' },
      { id: 'b', hn: '58970' },
    ];
    t.ok('matchImportedPatient: exact HN match', matchImportedPatient(patients, '0025671')?.id === 'a');
    t.ok('matchImportedPatient: strips leading zeros both sides', matchImportedPatient(patients, '0058970')?.id === 'b');
    t.ok('matchImportedPatient: no match -> undefined', matchImportedPatient(patients, '9999999') === undefined);
  }
}

module.exports = { run };
