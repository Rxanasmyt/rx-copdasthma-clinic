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

  // มี body เป็น object/array/block — นับ {}/[] ให้สมดุล (ข้าม string/template literal ระหว่างทาง)
  let depth = 0;
  let i = candidates[0].idx;
  let inStr = null; // null | '"' | "'" | '`'
  for (; i < source.length; i++) {
    const c = source[i];
    const prev = source[i - 1];
    if (inStr) {
      if (c === inStr && prev !== '\\') inStr = null;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') { inStr = c; continue; }
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
