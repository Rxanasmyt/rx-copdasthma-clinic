// สร้างไฟล์ที่ deploy จริง: แปลง <script type="text/babel"> เป็น JS ธรรมดาล่วงหน้า (precompile) แล้วตัด Babel
// ออกจากหน้าเว็บ — เดิมทุกครั้งที่เปิดแอพ เบราว์เซอร์ต้องแปลง JSX ~1.4MB เองใช้เวลา 1-4 วินาที (หน้าขาว)
// ต้องใช้ preset env + react (ไม่ใช่ react อย่างเดียว) เพราะ env แปลง const/let เป็น var — แอพประกาศ
// `const { useState } = React` ซ้ำในหลายบล็อก ถ้าเหลือเป็น const จะชน "Identifier has already been declared"
// ใช้ @babel/standalone เวอร์ชันเดียวกับที่หน้าเว็บเคยโหลดเอง (7.29.0) เพื่อให้ผลแปลงตรงกับของเดิมที่สุด
// ใช้: node scripts/build-site.js <input.html> <output.html>
const fs = require('fs');
const Babel = require('@babel/standalone');

const [input, output] = process.argv.slice(2);
if (!input || !output) { console.error('usage: node scripts/build-site.js <in.html> <out.html>'); process.exit(1); }

let html = fs.readFileSync(input, 'utf8');
let count = 0;
html = html.replace(/<script type="text\/babel"[^>]*>([\s\S]*?)<\/script>/g, (_, code) => {
  count++;
  const out = Babel.transform(code, { presets: ['env', 'react'] }).code;
  if (/<\/script/i.test(out)) throw new Error('compiled block ' + count + ' contains "</script" — cannot inline');
  return '<script>\n' + out + '\n</script>';
});
if (count === 0) throw new Error('no text/babel blocks found — refusing to write output');

const before = html.length;
html = html.replace(/<script[^>]*@babel\/standalone[^>]*><\/script>\s*/, '');
if (html.length === before) throw new Error('babel <script> tag not found');
if (/type="text\/babel"/.test(html.replace(/<!--[\s\S]*?-->/g, ''))) throw new Error('text/babel block remains');

fs.writeFileSync(output, html);
console.log('compiled ' + count + ' blocks -> ' + output + ' (' + Math.round(html.length / 1024) + ' KB)');
