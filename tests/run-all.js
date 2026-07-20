// tests/run-all.js
// ── ตัวรันเทสต์รวม: require ทุกไฟล์ *.test.js ในโฟลเดอร์นี้แล้วรัน run(t) ───
const fs = require('fs');
const path = require('path');

let pass = 0, fail = 0;
const failures = [];

function makeT(fileName) {
  return {
    ok(name, cond) {
      if (cond) {
        pass++;
      } else {
        fail++;
        failures.push(`${fileName}: ${name}`);
      }
    },
  };
}

const dir = __dirname;
const files = fs.readdirSync(dir).filter(f => f.endsWith('.test.js')).sort();

if (files.length === 0) {
  console.log('ไม่พบไฟล์ *.test.js ในโฟลเดอร์ tests/');
  process.exit(1);
}

async function main() {
  for (const f of files) {
    const mod = require(path.join(dir, f));
    if (typeof mod.run !== 'function') {
      console.log(`ข้าม ${f}: ไม่ export ฟังก์ชัน run(t)`);
      continue;
    }
    try {
      // รองรับทั้ง run(t) แบบ sync และ async function run(t) — await เสมอเพื่อไม่ให้ assertion
      // ที่อยู่หลัง await ในเทสต์หลุดไปทำงานหลัง process.exit() แล้วนับผลไม่ครบ
      await mod.run(makeT(f));
    } catch (e) {
      fail++;
      failures.push(`${f}: threw ${e.message}`);
    }
  }

  console.log(`\n=== rx-copdasthma-clinic test suite: ${pass} passed, ${fail} failed (${files.length} files) ===`);
  if (failures.length) {
    console.log('\nFAILED:');
    failures.forEach(f => console.log('  - ' + f));
  }
  process.exit(fail ? 1 : 0);
}

main();
