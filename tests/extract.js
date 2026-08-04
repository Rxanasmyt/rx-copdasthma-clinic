// tests/extract.js
// ── ดึงฟังก์ชัน/ค่าคงที่ที่ต้องการทดสอบออกจาก RxClinic.html แบบ robust ──
// ไม่อิงเลขบรรทัด (ซึ่งขยับทุกครั้งที่แก้ไฟล์) แต่ค้นหาด้วยชื่อ declaration แล้วนับวงเล็บ/แบร็กเก็ตให้สมดุล
// เพื่อตัดโค้ดจริงจากไฟล์แอพมาทดสอบ (ไม่ใช่การ copy สูตรมาเขียนใหม่ ซึ่งอาจหลุดตรงกับของจริง)
const fs = require('fs');
const path = require('path');

const APP_PATH = path.join(__dirname, '..', 'RxClinic.html');

function readApp() {
  return fs.readFileSync(APP_PATH, 'utf8');
}

// หา declaration แบบ `const NAME = ` หรือ `function NAME(` ที่ต้นบรรทัด (อาจมี indent) แล้วดึงมาทั้ง block
// รองรับทั้ง object/array literal ({...} หรือ [...]), function/arrow แบบมี body เป็น block,
// และ arrow แบบ single-expression บรรทัดเดียวที่ไม่มี {} เลย (เช่น `const f = (x) => x + 1;`)
function extractBlock(source, name) {
  const declRe = new RegExp(`^(?:const|(?:async\\s+)?function)\\s+${name}\\b`, 'm');
  const m = declRe.exec(source);
  if (!m) throw new Error(`extractBlock: ไม่พบ declaration ของ "${name}" ใน RxClinic.html`);
  const start = m.index;

  // หาตัวเปิดกลุ่มแรกสุดที่แท้จริง: "{" หรือ "[" หรือ ";" (จบแบบ single-expression) — เอาตัวที่ index น้อยสุด
  const candidates = [
    { ch: '{', idx: source.indexOf('{', start) },
    { ch: '[', idx: source.indexOf('[', start) },
    { ch: ';', idx: source.indexOf(';', start) },
  ].filter(c => c.idx !== -1).sort((a, b) => a.idx - b.idx);

  if (candidates.length === 0) throw new Error(`extractBlock: ไม่พบ "{"/"["/";" หลัง declaration ของ "${name}"`);

  if (candidates[0].ch === ';') {
    // single-expression arrow function/ค่าคงที่บรรทัดเดียว — ตัดถึง ";" ตัวแรกเลย
    return source.slice(start, candidates[0].idx + 1);
  }

  // มี body เป็น object/array/block — นับ {}/[] ให้สมดุล (ข้าม string/template literal/regex literal ระหว่างทาง)
  // regex literal ต้องข้ามด้วย ไม่งั้น "[^\"]" หรือ [^,] ข้างในจะทำให้ตัวนับเพี้ยน (นับ "/[^\"]/" เป็น string
  // เพราะเจอ " ตัวแรกแล้วเข้าใจผิดว่าเป็นการเปิด string) — แยกแยะ regex vs division ด้วย heuristic ตัวอักษร
  // ที่ไม่ใช่ space ก่อนหน้า "/" (ถ้าเป็น identifier/number/")"/"]" แปลว่าหารเลข ไม่ใช่ regex)
  let depth = 0;
  let i = candidates[0].idx;
  let inStr = null; // null | '"' | "'" | '`'
  const isRegexContext = (idx) => {
    let j = idx - 1;
    while (j >= 0 && /\s/.test(source[j])) j--;
    if (j < 0) return true;
    const c = source[j];
    if (/[a-zA-Z0-9_$)\]]/.test(c)) return false; // หลัง identifier/number/)/"]" คือหารเลข ไม่ใช่ regex
    return true;
  };
  for (; i < source.length; i++) {
    const c = source[i];
    const prev = source[i - 1];
    if (inStr) {
      if (c === inStr && prev !== '\\') inStr = null;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') { inStr = c; continue; }
    if (c === '/' && isRegexContext(i)) {
      // ข้าม regex literal ทั้งตัว (รวม character class [...] ที่ "/" ข้างในไม่ปิด regex)
      let j = i + 1, inClass = false;
      for (; j < source.length; j++) {
        const rc = source[j];
        if (rc === '\\') { j++; continue; }
        if (rc === '[') inClass = true;
        else if (rc === ']') inClass = false;
        else if (rc === '/' && !inClass) break;
        else if (rc === '\n') break; // regex literal ข้ามบรรทัดไม่ได้ ป้องกัน scan เพี้ยนไปไกล
      }
      i = j; // ข้าม flags (g/i/m ฯลฯ) ต่อท้ายด้วยการปล่อยให้ loop หลักเดินต่อทีละตัวตามปกติ
      continue;
    }
    if (c === '{' || c === '[') depth++;
    else if (c === '}' || c === ']') {
      depth--;
      if (depth === 0) { i++; break; }
    }
  }
  if (depth !== 0) throw new Error(`extractBlock: วงเล็บ/แบร็กเก็ตของ "${name}" ไม่สมดุล (ไฟล์อาจเปลี่ยนโครงสร้างไปมาก)`);
  // กิน ';' ต่อท้ายถ้ามี (สำหรับ const X = {...}; หรือ const X = [...];)
  if (source[i] === ';') i++;
  return source.slice(start, i);
}

// ดึงหลาย block พร้อมกัน แล้วต่อกันเป็นสตริงเดียว เรียงตามลำดับที่ขอ (สำคัญถ้า block หลังพึ่ง block ก่อน)
function extractBlocks(source, names) {
  return names.map(n => extractBlock(source, n)).join('\n\n');
}

module.exports = { readApp, extractBlock, extractBlocks, APP_PATH };
