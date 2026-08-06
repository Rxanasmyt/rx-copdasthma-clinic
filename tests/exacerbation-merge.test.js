// tests/exacerbation-merge.test.js
// ── mergeExacerbationEvents: 3-way merge กันข้อมูลกำเริบหายเวลาแก้ visit พร้อมกัน 2 เครื่อง ──
const { readApp, extractBlocks } = require('./extract');

const src = readApp();
const code = extractBlocks(src, ['mergeExacerbationEvents']);
// eslint-disable-next-line no-eval
eval(code + `\nglobal.mergeExacerbationEvents = mergeExacerbationEvents;`);

const e1 = { id: 'e1', date: '2026-01-01' };
const e2 = { id: 'e2', date: '2026-02-01' };
const e3 = { id: 'e3', date: '2026-03-01' };

function run(t) {
  t.ok('no changes anywhere -> unchanged', (() => {
    const r = mergeExacerbationEvents([e1], [e1], [e1]);
    return r.length === 1 && r[0].id === 'e1';
  })());

  t.ok('local added a new event, remote unchanged -> local addition kept', (() => {
    const r = mergeExacerbationEvents([e1], [e1, e2], [e1]);
    return r.length === 2 && r.some(e => e.id === 'e2');
  })());

  t.ok('local removed an event, remote unchanged -> removal respected', (() => {
    const r = mergeExacerbationEvents([e1, e2], [e1], [e1, e2]);
    return r.length === 1 && !r.some(e => e.id === 'e2');
  })());

  // ─── สถานการณ์จริงที่พบบั๊ก: อีกเครื่องเพิ่ม event ใหม่ระหว่างที่ฟอร์มนี้เปิดอยู่ ───
  t.ok('remote gained a new event (added by another device) not in base or local -> preserved, not lost', (() => {
    const r = mergeExacerbationEvents([e1], [e1], [e1, e3]); // e3 added remotely, local never saw it
    return r.length === 2 && r.some(e => e.id === 'e3');
  })());

  t.ok('local edits an event AND remote adds a new one -> both survive', (() => {
    const editedE1 = { ...e1, severity: 'Severe' };
    const r = mergeExacerbationEvents([e1], [editedE1], [e1, e3]);
    return r.length === 2 && r.find(e => e.id === 'e1').severity === 'Severe' && r.some(e => e.id === 'e3');
  })());

  t.ok('local removed an event that remote also still has (not re-added by remote) -> stays removed', (() => {
    // e2 present in base and remote (remote never changed it), but user explicitly removed it locally
    const r = mergeExacerbationEvents([e1, e2], [e1], [e1, e2]);
    return !r.some(e => e.id === 'e2');
  })());

  t.ok('all empty -> no throw, empty result', mergeExacerbationEvents([], [], []).length === 0);
  t.ok('null inputs -> no throw', mergeExacerbationEvents(null, null, null).length === 0);
}

module.exports = { run };
