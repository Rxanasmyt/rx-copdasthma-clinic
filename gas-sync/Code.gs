/**
 * Rx-COPD/Asthma Clinic — Google Sheets Sync (Google Apps Script)
 *
 * รับข้อมูลการบริบาลเภสัชกรรมทุกหมวดที่บันทึกในแอพ (ผู้ป่วย, visit, telepharmacy, DRP, ส่งต่อแพทย์,
 * ADR, Med Reconciliation, Discharge Counseling, และ snapshot ตัวชี้วัดคุณภาพ) แล้วเขียน/อัปเดตลงชีต
 * แยกตามหมวดหมู่ (upsert ด้วย ID คอลัมน์แรก — ยกเว้น KPI_Snapshots ที่เพิ่มแถวใหม่ทุกครั้งเพื่อเก็บ
 * ประวัติแนวโน้มย้อนหลัง) พร้อมสร้างชีต "Dashboard" สรุปภาพรวมให้อัตโนมัติด้วย setupDashboard()
 *
 * สเปรดชีตนี้เป็นแค่ "สำเนาสำหรับทำรายงาน/วิเคราะห์" — Firestore ในแอพยังเป็นฐานข้อมูลหลักเสมอ
 * ถ้าสเปรดชีตนี้ล่ม/ตั้งค่าผิด แอพยังทำงานได้ปกติ (ฝั่งแอพออกแบบให้ sync แบบ fire-and-forget)
 *
 * ตัวชี้วัดคุณภาพ (KPI1-7) คำนวณในแอพด้วยฟังก์ชันที่ตรวจสอบความถูกต้องมาแล้วอย่างละเอียด (ดู
 * calculateQualityKPIs ใน RxClinic.html) แล้วส่ง "ผลลัพธ์ที่คำนวณเสร็จแล้ว" มาที่นี่เท่านั้น — ไม่คำนวณ
 * ซ้ำด้วยสูตร Sheets เอง เพื่อไม่ให้เกิดความเสี่ยงที่ตัวเลข 2 ที่ไม่ตรงกัน (ซึ่งจะทำให้ไม่รู้ว่าค่าไหนถูก)
 *
 * วิธี deploy — ดู README.md ในโฟลเดอร์เดียวกัน
 */

// ── นิยามทุกหมวดหมู่ข้อมูล: ชื่อชีต, สีประจำหมวด (ใช้ย้อมหัวตาราง+แท็บให้แยกแยะง่ายด้วยตา), headers ──
const COLLECTIONS = {
  patients:     { sheet: 'Patients',             color: '#2563EB', appendOnly: false },
  visits:       { sheet: 'Visits',               color: '#0F766E', appendOnly: false },
  telepharmacy: { sheet: 'Telepharmacy',         color: '#0891B2', appendOnly: false },
  drp:          { sheet: 'DRP_Tracker',          color: '#DC2626', appendOnly: false },
  referrals:    { sheet: 'Referrals',            color: '#7C3AED', appendOnly: false },
  adr:          { sheet: 'ADR_Reports',          color: '#B91C1C', appendOnly: false },
  medrec:       { sheet: 'MedReconciliation',    color: '#CA8A04', appendOnly: false },
  discharge:    { sheet: 'Discharge_Counseling', color: '#059669', appendOnly: false },
  rca:          { sheet: 'RCA',                  color: '#9333EA', appendOnly: false },
  kpi_snapshot: { sheet: 'KPI_Snapshots',         color: '#DB2777', appendOnly: true },
};

const HEADERS = {
  patients: [
    'Patient ID', 'HN', 'เลขบัตรประชาชน', 'คำนำหน้า', 'ชื่อ', 'นามสกุล', 'อายุ', 'เพศ', 'วันเกิด',
    'การวินิจฉัย', 'GOLD Grade', 'Asthma Control', 'โรคร่วม', 'เบอร์โทร', 'ที่อยู่', 'สิทธิ์การรักษา',
    'ประวัติแพ้ยา', 'รายละเอียดแพ้ยา', 'eGFR', 'น้ำหนัก (กก.)', 'สถานะสูบบุหรี่', 'Pack-years',
    'วัคซีนไข้หวัดใหญ่', 'วัคซีน PCV13', 'วัคซีน PPSV23', 'วัคซีน COVID',
    'ความเสี่ยง', 'ปัจจัยเสี่ยง', 'วันที่ลงทะเบียน', 'ซิงค์ล่าสุด',
  ],
  visits: [
    'Visit ID', 'วันที่', 'HN', 'ชื่อ-นามสกุล', 'อายุ', 'การวินิจฉัย', 'ความเสี่ยง', 'Chief Complaint',
    'Ex. ครั้ง/ปี', 'นอน รพ.', 'เข้า ER', 'ความรุนแรง Ex.', 'ปัจจัยกระตุ้น', 'Rescue Use',
    'ยาที่ใช้', 'Adherence รายยา', 'Adherence ระดับ', 'เทคนิคยาพ่น', 'นำอุปกรณ์เดิมมา',
    'CAT', 'mMRC', 'ACT', 'SpO2', 'RR', 'BP',
    'Subjective', 'Objective', 'Assessment', 'Plan', 'หัวข้อให้คำปรึกษา',
    'จำนวน DRP ที่พบ', 'เภสัชกร', 'นัดถัดไป', 'ซิงค์ล่าสุด',
  ],
  telepharmacy: [
    'Record ID', 'HN', 'ชื่อ-นามสกุล', 'วันที่นัดโทร', 'วันที่โทรจริง', 'เวลาที่โทร', 'สถานะ',
    'อาการ', 'มีอาการกำเริบ', 'ใช้ยา Rescue', 'ปัญหาการใช้ยา', 'คำแนะนำที่ให้', 'นัดติดตามถัดไป',
    'บันทึกเภสัชกร', 'ซิงค์ล่าสุด',
  ],
  drp: [
    'DRP Entry ID', 'HN', 'ชื่อ-นามสกุล', 'วันที่ Visit', 'PCNE Code', 'หมวดปัญหา', 'รายละเอียดปัญหา',
    'ความรุนแรง', 'แนวทางแก้ไขที่แนะนำ', 'สถานะ', 'มอบหมายให้', 'ประเภทการแทรกแซง',
    'Action ที่ทำ', 'หมายเหตุ', 'วันที่ปิด', 'ปิดโดย', 'ผลปิดวงจร (ตรวจซ้ำ visit ถัดไป)', 'ซิงค์ล่าสุด',
  ],
  referrals: [
    'Referral ID', 'HN', 'ชื่อ-นามสกุล', 'วันที่ส่งต่อ', 'ส่งต่อถึง', 'ความเร่งด่วน', 'ปัญหาที่พบ',
    'การดำเนินการของเภสัชกร', 'ข้อเสนอแนะ', 'เภสัชกรผู้ส่งต่อ', 'ได้รับ Feedback แล้ว', 'Feedback',
    'Exacerbation ตอนส่งต่อ (ครั้ง/ปี)', 'เคยนอน รพ. ตอนส่งต่อ', 'ซิงค์ล่าสุด',
  ],
  adr: [
    'ADR ID', 'HN', 'ชื่อ-นามสกุล', 'วันที่รายงาน', 'ยาที่สงสัย', 'ขนาดยา', 'อาการไม่พึงประสงค์',
    'วันที่เริ่มมีอาการ', 'ความรุนแรง', 'Causality', 'Rechallenge', 'Dechallenge',
    'การจัดการ', 'ผลลัพธ์', 'ผู้รายงาน', 'บันทึกเพิ่มเติม', 'ผูกกับประวัติแพ้ยา', 'ซิงค์ล่าสุด',
  ],
  medrec: [
    'MedRec ID', 'HN', 'ชื่อ-นามสกุล', 'วันที่', 'ประเภท', 'จำนวนรายการยา', 'จำนวน Discrepancy',
    'รายละเอียดยา', 'หมายเหตุ', 'เภสัชกร', 'ซิงค์ล่าสุด',
  ],
  discharge: [
    'Discharge ID', 'HN', 'ชื่อ-นามสกุล', 'วันที่', 'รายการที่ทำแล้ว', 'จำนวนรายการที่ทำ/ทั้งหมด',
    'ผู้ป่วยยินยอม/เข้าใจ', 'วันนัดติดตาม', 'เภสัชกร', 'หมายเหตุ', 'ซิงค์ล่าสุด',
  ],
  rca: [
    'RCA ID', 'HN', 'ชื่อ-นามสกุล', 'วันที่บันทึก', 'เหตุการณ์ที่กระตุ้น', 'วันที่เกิดเหตุ', 'ความรุนแรง',
    'What (เกิดอะไรขึ้น)', 'Why 1', 'Why 2', 'Why 3', 'Why 4', 'Why 5',
    'สาเหตุที่แท้จริง (Root Cause)', 'ปัจจัยร่วม', 'การแก้ไขเฉพาะหน้า', 'การแก้ไขเชิงระบบ',
    'ป้องกันได้หรือไม่', 'เภสัชกร', 'ซิงค์ล่าสุด',
  ],
  kpi_snapshot: [
    'Snapshot ID', 'วันที่ซิงค์', 'ช่วงเริ่ม', 'ช่วงสิ้นสุด',
    'KPI1 COPD Exacerbation Rate', 'KPI1 เศษ', 'KPI1 ส่วน',
    'KPI2 Asthma ER Rate', 'KPI2 เศษ', 'KPI2 ส่วน',
    'KPI3 Asthma+ICS %', 'KPI3 เศษ', 'KPI3 ส่วน',
    'KPI4 COPD LABA/LAMA %', 'KPI4 เศษ', 'KPI4 ส่วน',
    'KPI5 เทคนิคผ่านเกณฑ์ %', 'KPI5 เศษ', 'KPI5 ส่วน',
    'KPI6 มาตามนัด %', 'KPI6 เศษ', 'KPI6 ส่วน',
    'KPI7 Adherence ดี %', 'KPI7 เศษ', 'KPI7 ส่วน',
    'นำอุปกรณ์เดิมมา %', 'ผู้ป่วยทั้งหมด', 'Visit ในช่วงเวลา',
  ],
};

// ── Web App entry points ──────────────────────────────────────────────────
function doGet(e) {
  return jsonOut({ ok: true, service: 'RxClinic Sheets Sync', collections: Object.keys(COLLECTIONS) });
}

function doPost(e) {
  try {
    const payload = JSON.parse(e.postData.contents || '{}');
    const secret = PropertiesService.getScriptProperties().getProperty('SHARED_SECRET');
    if (!secret) return jsonOut({ ok: false, error: 'ยังไม่ได้ตั้งค่า SHARED_SECRET ใน Script Properties ของโปรเจกต์นี้' });
    if (payload.token !== secret) return jsonOut({ ok: false, error: 'Token ไม่ถูกต้อง' });
    if (payload.ping) return jsonOut({ ok: true, pong: true });

    const collection = payload.collection;
    if (!COLLECTIONS[collection]) {
      return jsonOut({ ok: false, error: `ไม่รู้จักหมวดหมู่ "${collection}" — ต้องเป็นหนึ่งใน: ${Object.keys(COLLECTIONS).join(', ')}` });
    }
    const rows = Array.isArray(payload.rows) ? payload.rows : [];
    const written = writeRows(collection, rows);
    return jsonOut({ ok: true, collection, written });
  } catch (err) {
    return jsonOut({ ok: false, error: String(err && err.message || err) });
  }
}

function jsonOut(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function writeRows(collection, rows) {
  if (rows.length === 0) return 0;
  const meta = COLLECTIONS[collection];
  const sheet = getOrCreateSheet(collection);
  const now = new Date();
  if (meta.appendOnly) {
    // KPI_Snapshots: เก็บประวัติทุก snapshot ไว้เป็น time-series สำหรับดูแนวโน้มย้อนหลัง ไม่ทับของเดิม
    sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, HEADERS[collection].length).setValues(rows);
    return rows.length;
  }
  // หมวดอื่นทั้งหมด: upsert ด้วย ID คอลัมน์แรก (แก้ไขข้อมูลเดิมในแอพ = อัปเดตแถวเดิม ไม่สร้างซ้ำ)
  const lastRow = sheet.getLastRow();
  const idToRowNum = new Map();
  if (lastRow > 1) {
    const ids = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
    ids.forEach((r, i) => { if (r[0]) idToRowNum.set(String(r[0]), i + 2); });
  }
  const toAppend = [];
  rows.forEach(row => {
    const id = String(row[0]);
    const fullRow = [...row, now];
    const existingRowNum = idToRowNum.get(id);
    if (existingRowNum) {
      sheet.getRange(existingRowNum, 1, 1, fullRow.length).setValues([fullRow]);
    } else {
      toAppend.push(fullRow);
    }
  });
  if (toAppend.length > 0) {
    sheet.getRange(sheet.getLastRow() + 1, 1, toAppend.length, HEADERS[collection].length).setValues(toAppend);
  }
  return rows.length;
}

// getOrCreateSheet: ใช้ตอนเขียนข้อมูลจริง (writeRows) ต้องเบา/เร็ว — แค่สร้างชีต+หัวตารางถ้ายังไม่มี
// ไม่จัดสไตล์หนักๆ ที่นี่ (กันการ sync ทีละแถวบ่อยๆ ช้าลงจากการจัดรูปแบบซ้ำทุกครั้ง) ส่วนการจัดสวยงาม
// เต็มรูปแบบ (สี/ความกว้างคอลัมน์/conditional format) ทำแยกใน styleSheet ซึ่งเรียกจาก setupDashboard
// เท่านั้น (รันเป็นครั้งคราว ไม่ใช่ทุกครั้งที่มีข้อมูลเข้า)
function getOrCreateSheet(collection) {
  const meta = COLLECTIONS[collection];
  const headers = HEADERS[collection];
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(meta.sheet);
  if (!sheet) {
    sheet = ss.insertSheet(meta.sheet);
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  }
  return sheet;
}

// ธีมสีลายแถบสลับ (banding) ต่อหมวด — ให้ตรง/เข้าชุดกับสีหัวตารางของแต่ละชีต แทนสีเทาจางๆ เดิมที่ดู
// จืดชืดเหมือนกันหมดทุกชีต แยกแยะหมวดด้วยสายตาได้ยาก
const BANDING_BY_COLLECTION = {
  patients: SpreadsheetApp.BandingTheme.BLUE,
  visits: SpreadsheetApp.BandingTheme.TEAL,
  telepharmacy: SpreadsheetApp.BandingTheme.CYAN,
  drp: SpreadsheetApp.BandingTheme.RED,
  referrals: SpreadsheetApp.BandingTheme.PURPLE,
  adr: SpreadsheetApp.BandingTheme.ORANGE,
  medrec: SpreadsheetApp.BandingTheme.YELLOW,
  discharge: SpreadsheetApp.BandingTheme.GREEN,
  rca: SpreadsheetApp.BandingTheme.PURPLE,
  kpi_snapshot: SpreadsheetApp.BandingTheme.PINK,
};

// จัดรูปแบบเต็มรูปแบบ: หัวตารางสีประจำหมวด + ลายแถบสลับสีที่เข้าชุดกัน (ไม่ใช่เทาจืดๆ เหมือนกันหมด) +
// ปรับความกว้างคอลัมน์ให้พอดีเนื้อหาจริง (เดิมความกว้าง default ของ Sheets แคบมาก ทำให้ข้อความยาวๆ
// เช่นชื่อโรค/SOAP note ถูกตัดจนอ่านไม่ออก) + ตัดคำ/จัดแนวข้อความแถวข้อมูลให้อ่านง่าย + แช่แข็งหัวตาราง
// เรียกจาก setupDashboard เท่านั้น (ไม่เรียกจาก getOrCreateSheet ที่ใช้ตอน sync ข้อมูลจริง เพราะหนักเกิน
// ไปที่จะรันซ้ำทุกครั้งที่มีการบันทึกข้อมูลใหม่ 1 แถว) — รันซ้ำได้ปลอดภัย ลบ banding เดิมก่อนใส่ใหม่เสมอ
// กัน error "already has banding" ตอนกดรันซ้ำรอบที่ 2 เป็นต้นไป
function styleSheet(sheet, numCols, color, collection) {
  const numRows = Math.max(sheet.getMaxRows(), 200);
  const header = sheet.getRange(1, 1, 1, numCols);
  header.setBackground(color).setFontColor('#FFFFFF').setFontWeight('bold').setFontSize(11)
    .setHorizontalAlignment('center').setVerticalAlignment('middle').setWrap(true);
  sheet.setRowHeight(1, 44);
  sheet.setFrozenRows(1);
  sheet.setFrozenColumns(2);
  sheet.setTabColor(color);

  // ลบ banding เดิมทั้งหมดก่อน (ถ้ามี) แล้วค่อยใส่ธีมสีใหม่ที่เข้าชุดกับหมวดนี้ — ครอบ try/catch เพราะ
  // บาง BandingTheme อาจไม่รองรับในบาง locale/เวอร์ชัน API ถ้าใส่ธีมที่ต้องการไม่ได้ ให้ fallback เป็น
  // LIGHT_GREY (ใช้ได้แน่นอนเสมอ) แทนที่จะปล่อยให้ทั้งฟังก์ชัน throw แล้วหยุดจัดสไตล์ชีตที่เหลือ
  sheet.getBandings().forEach(b => b.remove());
  const theme = BANDING_BY_COLLECTION[collection] || SpreadsheetApp.BandingTheme.LIGHT_GREY;
  try {
    sheet.getRange(1, 1, numRows, numCols).applyRowBanding(theme, true, false);
  } catch (e) {
    try { sheet.getRange(1, 1, numRows, numCols).applyRowBanding(SpreadsheetApp.BandingTheme.LIGHT_GREY, true, false); } catch (e2) { /* ข้ามได้ */ }
  }

  // ความกว้างคอลัมน์: กำหนดจาก "ความยาวข้อความหัวตาราง" แทนการใช้ autoResizeColumns (ซึ่งต้องสแกนเนื้อหา
  // ทุกแถวเพื่อวัดความกว้างจริง — ช้ามากถ้าชีตมีข้อมูลหลายพันแถวอย่าง Visits/DRP_Tracker ของคลินิกที่ใช้
  // งานจริง เสี่ยงพาสคริปต์ไปชนลิมิตเวลา 6 นาทีซ้ำอีกรอบ) วิธีนี้เร็วแน่นอนไม่ว่าชีตจะมีข้อมูลกี่แถว
  const headerTexts = sheet.getRange(1, 1, 1, numCols).getValues()[0];
  headerTexts.forEach((text, i) => {
    const len = String(text || '').length;
    const width = Math.max(90, Math.min(260, len * 9 + 40));
    sheet.setColumnWidth(i + 1, width);
  });
  const lastRow = sheet.getLastRow();
  if (lastRow > 1) {
    sheet.getRange(2, 1, lastRow - 1, numCols).setWrap(true).setVerticalAlignment('top').setFontSize(10);
  }

  applyConditionalFormatting(sheet, collection, numRows);

  // เพิ่มปุ่มกรอง/เรียงข้อมูล (filter) ที่หัวตาราง — กดลูกศรที่หัวคอลัมน์ใดก็ได้เพื่อกรอง/เรียงข้อมูล
  // ได้ทันทีโดยไม่ต้องสร้างชีตสำรอง ลบของเดิมก่อนเสมอกัน error "already has a filter" ตอนรันซ้ำ
  const existingFilter = sheet.getFilter();
  if (existingFilter) existingFilter.remove();
  const filterRows = Math.max(sheet.getLastRow(), 2);
  try { sheet.getRange(1, 1, filterRows, numCols).createFilter(); } catch (e) { /* ข้ามได้ถ้าชีตว่างเกินไป */ }
}

// ป้ายสีเน้นคอลัมน์สำคัญ (สถานะ/ความรุนแรง/ความเสี่ยง) ให้เด่นชัดด้วยสายตาทันที ไม่ต้องอ่านข้อความทีละ
// แถว — ตั้งใจเขียนทับกฎเดิมทั้งหมดทุกครั้งที่รัน (setConditionalFormatRules แทนที่ทั้งชุด ไม่ append)
// กันกฎซ้ำซ้อนสะสมเวลารัน setupDashboard หลายรอบ
function applyConditionalFormatting(sheet, collection, numRows) {
  const rules = [];
  const colorRule = (range, text, bg, fg) => SpreadsheetApp.newConditionalFormatRule()
    .whenTextContains(text).setBackground(bg).setFontColor(fg || '#FFFFFF').setRanges([range]).build();

  if (collection === 'visits' || collection === 'patients') {
    const riskCol = collection === 'visits' ? 7 : 27; // G (visits) / AA (patients) — 1-indexed
    const range = sheet.getRange(2, riskCol, numRows - 1, 1);
    rules.push(colorRule(range, 'High', '#FEF2F2', '#DC2626'));
    rules.push(colorRule(range, 'Medium', '#FFFBEB', '#D97706'));
    rules.push(colorRule(range, 'Low', '#F0FDF4', '#059669'));
  }
  if (collection === 'drp') {
    const sevRange = sheet.getRange(2, 8, numRows - 1, 1); // H ความรุนแรง
    rules.push(colorRule(sevRange, 'High', '#FEF2F2', '#DC2626'));
    rules.push(colorRule(sevRange, 'Medium', '#FFFBEB', '#D97706'));
    rules.push(colorRule(sevRange, 'Low', '#F1F5F9', '#475569'));
    const statusRange = sheet.getRange(2, 10, numRows - 1, 1); // J สถานะ
    rules.push(colorRule(statusRange, 'ยังไม่แก้ไข', '#FEF2F2', '#DC2626'));
    rules.push(colorRule(statusRange, 'กำลังดำเนินการ', '#FFFBEB', '#D97706'));
    rules.push(colorRule(statusRange, 'แก้ไขแล้ว', '#F0FDF4', '#059669'));
  }
  if (collection === 'referrals') {
    // ค่าที่ setValues() เขียนเป็น boolean จริง (ไม่ใช่ string) จะแสดงผล/เทียบข้อความเป็น "TRUE"/"FALSE"
    // ตัวพิมพ์ใหญ่เสมอใน Sheets — ต้องเทียบด้วยตัวพิมพ์ใหญ่ ไม่ใช่ "true"/"false"
    const fbRange = sheet.getRange(2, 11, numRows - 1, 1); // K ได้รับ Feedback แล้ว
    rules.push(SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo('TRUE')
      .setBackground('#DCFCE7').setFontColor('#166534').setRanges([fbRange]).build());
    rules.push(SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo('FALSE')
      .setBackground('#FEF3C7').setFontColor('#92400E').setRanges([fbRange]).build());
  }
  if (collection === 'adr') {
    const sevRange = sheet.getRange(2, 9, numRows - 1, 1); // I ความรุนแรง
    rules.push(colorRule(sevRange, 'severe', '#FEF2F2', '#DC2626'));
    rules.push(colorRule(sevRange, 'fatal', '#FEF2F2', '#DC2626'));
    rules.push(colorRule(sevRange, 'moderate', '#FFFBEB', '#D97706'));
    rules.push(colorRule(sevRange, 'mild', '#F0FDF4', '#059669'));
  }
  sheet.setConditionalFormatRules(rules);
}

/**
 * รันครั้งเดียวจาก Apps Script editor (เลือกฟังก์ชันนี้จาก dropdown ด้านบนแล้วกด ▶ Run) เพื่อสร้าง/
 * จัดรูปแบบชีตข้อมูลทุกหมวด + ชีต "Dashboard" สรุปภาพรวมให้สวยงาม ทันสมัย พร้อมใช้งาน — รันซ้ำได้
 * ปลอดภัย (ไม่ลบข้อมูลที่มีอยู่แล้วในชีตข้อมูล แต่จะสร้างกราฟ/การ์ดสรุปใน Dashboard ใหม่ทุกครั้งที่รัน)
 */
function setupDashboard() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  // สร้างชีตที่ยังไม่มี + จัดสวยงามทุกชีตใหม่ทั้งหมด (รวมชีตที่มีข้อมูลอยู่แล้วจากก่อนหน้านี้ ที่เดิม
  // เคยถูกสร้างแบบเรียบๆ ตอน sync ครั้งแรกโดยไม่มีสี/ไม่ได้ปรับความกว้างคอลัมน์) — คือขั้นตอนที่ทำให้
  // ชีตข้อมูลดูสวยงาม ไม่ใช่แค่ชีต Dashboard เท่านั้น
  Object.keys(COLLECTIONS).forEach(key => {
    const sheet = getOrCreateSheet(key);
    styleSheet(sheet, HEADERS[key].length, COLLECTIONS[key].color, key);
  });

  // ลบชีต Dashboard เดิมทิ้งแล้วสร้างใหม่ทั้งแผ่นทุกครั้งที่รัน (แทนการ clear() เฉยๆ) — เดิมถ้าเคยรัน
  // setupDashboard ของโค้ดเวอร์ชันก่อนหน้ามาแล้ว (เช่น หัวตารางเดิมเป็น A1:H1 แต่เวอร์ชันนี้เปลี่ยนเป็น
  // A1:J1) การ merge() ทับช่วงที่ merge ไว้เดิมแบบไม่ตรงกันเป๊ะจะ throw error กลางคัน (Range.clear()
  // ไม่ล้าง merge/banding ให้) ทำให้ setupDashboard หยุดทำงานก่อนถึงส่วนสร้างกราฟ/การ์ด เหลือแต่ชีตที่
  // จัดรูปแบบไม่ครบ ดูเหมือน "มีแต่ข้อมูล ไม่มีกราฟ ไม่สวย" ตามที่ผู้ใช้เจอ — ลบทิ้งทั้งแผ่นแล้วสร้างใหม่
  // ชัวร์กว่า ไม่มีเศษการจัดรูปแบบเก่าตกค้างให้ชนกันแน่นอน
  let dash = ss.getSheetByName('Dashboard');
  if (dash) ss.deleteSheet(dash);
  dash = ss.insertSheet('Dashboard', 0);
  // #1E3A8A คือสีหลัก (primary) จริงของแอพ RxClinic (--c-primary) — ใช้ตรงนี้แทนสีเทาเข้มทั่วไป
  // ให้เปิด Dashboard มาแล้วรู้สึกเหมือนเปิดแอพตัวเดียวกัน ไม่ใช่สเปรดชีตแยกต่างหากที่หน้าตาคนละชุด
  dash.setTabColor('#1E3A8A');
  dash.setColumnWidths(1, 10, 140);
  dash.setHiddenGridlines(true);

  // ── Title ── (เซลล์เดี่ยวใส่ gradient ไม่ได้ — ใช้สีพื้นหลังเดียวกับแถบหัวแอพ/sidebar แทน)
  dash.getRange('A1:J1').merge().setValue('🏥 Rx-COPD/Asthma Clinic — ภาพรวมการบริบาลเภสัชกรรมทั้งหมด')
    .setFontSize(19).setFontWeight('bold').setFontColor('#FFFFFF').setBackground('#1E3A8A')
    .setHorizontalAlignment('center').setVerticalAlignment('middle');
  dash.setRowHeight(1, 46);
  dash.getRange('A2:J2').merge()
    .setFormula('="อัปเดตล่าสุด: " & TEXT(NOW(), "dd/MM/yyyy HH:mm") & "   ·   ข้อมูลตัวชี้วัดคุณภาพล่าสุดจาก KPI_Snapshots"')
    .setFontSize(10).setFontColor('#64748B').setHorizontalAlignment('center');

  // ── แถบหมวดหมู่ข้อมูล (แผนที่นำทางไปแต่ละชีต พร้อมสีประจำหมวด) ──
  dash.getRange('A4').setValue('📂 หมวดหมู่ข้อมูลทั้งหมด').setFontSize(12).setFontWeight('bold').setFontColor('#0F172A');
  const catLabels = {
    patients: '👤 ผู้ป่วย', visits: '📝 Visit', telepharmacy: '📞 Telepharmacy', drp: '🧪 DRP Tracker',
    referrals: '📨 ส่งต่อแพทย์', adr: '⚠️ ADR', medrec: '💊 Med Reconciliation', discharge: '🏠 Discharge Counseling',
    rca: '🔍 RCA',
  };
  Object.keys(catLabels).forEach((key, i) => {
    const meta = COLLECTIONS[key];
    dash.getRange(5, i + 1).setValue(catLabels[key]).setBackground(meta.color).setFontColor('#FFFFFF')
      .setFontWeight('bold').setHorizontalAlignment('center').setFontSize(10);
  });
  dash.setRowHeight(5, 30);

  // ── Scorecards: ภาพรวมปฏิบัติการ (แถว 7-8) ──
  const opsCards = [
    { label: 'Visit ทั้งหมด', formula: '=COUNTA(Visits!A2:A)', color: '#0F766E' },
    { label: 'ผู้ป่วยในระบบ', formula: '=COUNTA(Patients!A2:A)', color: '#2563EB' },
    { label: 'DRP ยังไม่ปิด', formula: '=COUNTIF(DRP_Tracker!J2:J,"🔴 ยังไม่แก้ไข")+COUNTIF(DRP_Tracker!J2:J,"🟡 กำลังดำเนินการ")', color: '#DC2626' },
    { label: 'ส่งต่อรอ Feedback', formula: '=COUNTIF(Referrals!K2:K,false)', color: '#7C3AED' },
    { label: 'ADR รุนแรง', formula: '=COUNTIF(ADR_Reports!I2:I,"severe")+COUNTIF(ADR_Reports!I2:I,"fatal")', color: '#B91C1C' },
    { label: 'นำอุปกรณ์เดิมมา %', formula: '=IFERROR(INDEX(KPI_Snapshots!Z:Z,COUNTA(KPI_Snapshots!A:A))&"%","—")', color: '#059669' },
  ];
  renderCardRow(dash, 7, opsCards);

  // ── Scorecards: ตัวชี้วัดคุณภาพ 7 ตัวหลัก (จาก snapshot ล่าสุด, แถว 10-11) ──
  dash.getRange('A9').setValue('📊 ตัวชี้วัดคุณภาพ (KPI1-7) — จาก snapshot ล่าสุด').setFontSize(12).setFontWeight('bold').setFontColor('#0F172A');
  const kpiCards = [
    { label: 'KPI1 COPD Exacerb.\n(เป้า <110)', col: 'E', color: '#EA580C' },
    { label: 'KPI2 Asthma ER\n(เป้า <20)', col: 'H', color: '#DC2626' },
    { label: 'KPI3 Asthma+ICS\n(เป้า ≥80%)', col: 'K', color: '#7C3AED' },
    { label: 'KPI4 COPD LABA/LAMA\n(เป้า ≥80%)', col: 'N', color: '#059669' },
    { label: 'KPI5 เทคนิคผ่านเกณฑ์\n(เป้า ≥80%)', col: 'Q', color: '#D97706' },
    { label: 'KPI6 มาตามนัด\n(เป้า ≥80%)', col: 'T', color: '#2563EB' },
    { label: 'KPI7 Adherence ดี\n(เป้า ≥80%)', col: 'W', color: '#DB2777' },
  ];
  kpiCards.forEach((c, i) => {
    const col = i + 1;
    const lastRowFormula = `INDEX(KPI_Snapshots!${c.col}:${c.col},COUNTA(KPI_Snapshots!A:A))`;
    const cell = dash.getRange(10, col);
    cell.setFormula(`=IFERROR(${lastRowFormula}&"","—")`).setFontSize(20).setFontWeight('bold').setFontColor(c.color)
      .setHorizontalAlignment('center').setBackground('#F8FAFC');
    dash.getRange(11, col).setValue(c.label).setFontSize(9).setFontColor('#64748B')
      .setHorizontalAlignment('center').setBackground('#F8FAFC').setWrap(true);
    // เส้นแนวโน้มเล็กๆ (sparkline) ใต้ตัวเลข — ดึงค่าทั้งคอลัมน์จาก KPI_Snapshots (ประวัติทุกครั้งที่
    // เคยกดซิงค์ KPI) ให้เห็นทิศทางว่าตัวชี้วัดนี้ดีขึ้น/แย่ลงเมื่อเทียบกับ snapshot ก่อนๆ โดยไม่ต้อง
    // เปิดไปดูชีต KPI_Snapshots เอง — ถ้ามี snapshot แค่ 0-1 รายการจะไม่มีเส้นให้เห็น (เป็นปกติ)
    dash.getRange(12, col).setFormula(
      `=IFERROR(SPARKLINE(FILTER(KPI_Snapshots!${c.col}2:${c.col},KPI_Snapshots!A2:A<>""),{"charttype","line";"color","${c.color}";"linewidth",2}),"")`
    ).setBackground('#F8FAFC').setHorizontalAlignment('center');
  });
  dash.setRowHeight(10, 40);
  dash.setRowHeight(11, 44);
  dash.setRowHeight(12, 26);
  dash.getRange(10, 1, 3, kpiCards.length).setBorder(true, true, true, true, true, true, '#E2E8F0', SpreadsheetApp.BorderStyle.SOLID);
  // เดิม INDEX(...) ดึงค่าคอลัมน์ C/D ของ KPI_Snapshots มาต่อด้วย "&" ตรงๆ — ถ้า Sheets ตีความค่าที่ส่ง
  // มาจากแอพ (string วันที่ "2026-11-11") เป็น "วันที่" จริงโดยอัตโนมัติตอนเขียนลงเซลล์ (พฤติกรรม
  // ปกติของ Sheets) การต่อด้วย & จะโชว์เป็นเลข serial date ดิบๆ (เช่น 46337) แทนวันที่อ่านออก ต้องครอบ
  // ด้วย TEXT(...) ให้บังคับแปลงเป็นข้อความวันที่เสมอไม่ว่าเซลล์จะถูกตีความเป็นชนิดไหนก็ตาม
  dash.getRange('A13').setFormula('="⏱ คำนวณจากช่วงวันที่: " & IFERROR(TEXT(INDEX(KPI_Snapshots!C:C,COUNTA(KPI_Snapshots!A:A)),"yyyy-mm-dd"),"—") & " ถึง " & IFERROR(TEXT(INDEX(KPI_Snapshots!D:D,COUNTA(KPI_Snapshots!A:A)),"yyyy-mm-dd"),"—") & "   ·   เส้นเล็กใต้ตัวเลข = แนวโน้มย้อนหลังจากทุกครั้งที่เคยกดซิงค์ KPI"')
    .setFontSize(9).setFontColor('#94A3B8');

  // ── Helper columns สำหรับกราฟ (คอลัมน์ L เป็นต้นไป ไม่ต้องแก้ไข) ──
  dash.getRange('L1').setValue('— ตารางช่วยสร้างกราฟ (ไม่ต้องแก้ไข) —').setFontColor('#94A3B8').setFontSize(9);

  dash.getRange('L2').setValue('การวินิจฉัย'); dash.getRange('M2').setValue('จำนวน');
  dash.getRange('L3').setValue('COPD').setBackground('#FFF7ED');   dash.getRange('M3').setFormula('=COUNTIF(Visits!F2:F,"COPD")');
  dash.getRange('L4').setValue('Asthma').setBackground('#FAF5FF'); dash.getRange('M4').setFormula('=COUNTIF(Visits!F2:F,"Asthma")');
  dash.getRange('L5').setValue('Both').setBackground('#F0F9FF');   dash.getRange('M5').setFormula('=COUNTIF(Visits!F2:F,"Both")');

  // เดิมใช้ COUNTIF แบบ wildcard ("2026-11*") เทียบกับคอลัมน์วันที่ — ใช้ไม่ได้เลยถ้า Sheets ตีความ
  // ค่าที่แอพส่งมา ("2026-11-02") เป็น "วันที่" จริงโดยอัตโนมัติตอนเขียนลงเซลล์ (ซึ่งเป็นพฤติกรรม
  // ปกติของ Sheets กับ string รูปแบบวันที่ — เจอปัญหาคลาสเดียวกันกับที่แก้ไปแล้วในบรรทัดสรุปช่วงวันที่
  // ด้านบน) ทำให้กราฟ "จำนวน Visit ต่อเดือน" นับได้ 0 ทุกเดือนเสมอ ไม่ว่าจะมี visit จริงกี่ครั้งก็ตาม
  // แก้โดยเทียบช่วงวันที่ด้วย COUNTIFS (>= ต้นเดือน, < ต้นเดือนถัดไป) ซึ่งถูกต้องไม่ว่าเซลล์จะถูก
  // Sheets ตีความเป็น Date จริงหรือยังเป็นข้อความอยู่ก็ตาม (เปรียบเทียบแบบวันที่/ตัวอักษร ISO ให้ผล
  // ตรงกันทั้งคู่)
  dash.getRange('L8').setValue('เดือน'); dash.getRange('M8').setValue('จำนวน Visit');
  for (let m = 0; m < 12; m++) {
    const d = new Date(); d.setMonth(d.getMonth() - (11 - m));
    const y = d.getFullYear(), mo = d.getMonth() + 1;
    const ym = Utilities.formatDate(d, Session.getScriptTimeZone(), 'yyyy-MM');
    dash.getRange(9 + m, 12).setValue(ym);
    dash.getRange(9 + m, 13).setFormula(
      `=COUNTIFS(Visits!B:B,">="&DATE(${y},${mo},1),Visits!B:B,"<"&EDATE(DATE(${y},${mo},1),1))`
    );
  }

  dash.getRange('L22').setValue('Adherence'); dash.getRange('M22').setValue('จำนวน');
  ['Good', 'Fair', 'Poor'].forEach((lvl, i) => {
    dash.getRange(23 + i, 12).setValue(lvl);
    dash.getRange(23 + i, 13).setFormula(`=COUNTIF(Visits!Q2:Q,"${lvl}")`);
  });

  dash.getRange('L27').setValue('สถานะ DRP'); dash.getRange('M27').setValue('จำนวน');
  [['open', '🔴 ยังไม่แก้ไข'], ['in_progress', '🟡 กำลังดำเนินการ'], ['resolved', '✅ แก้ไขแล้ว']].forEach((pair, i) => {
    dash.getRange(28 + i, 12).setValue(pair[1]);
    dash.getRange(28 + i, 13).setFormula(`=COUNTIF(DRP_Tracker!J2:J,"${pair[1]}")`);
  });

  // ── Charts ── สไตล์เดียวกันทุกกราฟ: พื้นหลังขาวสะอาด ไม่มีเส้นขอบ หัวข้อ/แกนใช้สีเดียวกับธีมแอพ
  // (ฟอนต์ยังเป็นของ Sheets เอง — Charts API ไม่รองรับฟอนต์เว็บเหมือน cell ปกติ เป็นข้อจำกัดของ Sheets)
  const chartBase = {
    backgroundColor: { fill: 'transparent' },
    titleTextStyle: { color: '#0F172A', fontSize: 13, bold: true },
    fontName: 'Arial',
  };
  dash.insertChart(dash.newChart().setChartType(Charts.ChartType.PIE)
    .addRange(dash.getRange('L2:M5')).setPosition(14, 1, 0, 0)
    .setOption('title', 'สัดส่วนการวินิจฉัย (COPD / Asthma / Both)')
    .setOption('pieHole', 0.5).setOption('colors', ['#0369A1', '#7C3AED', '#0F766E'])
    .setOption('pieSliceTextStyle', { color: '#fff', fontSize: 11 })
    .setOption('backgroundColor', chartBase.backgroundColor).setOption('titleTextStyle', chartBase.titleTextStyle)
    .setOption('width', 420).setOption('height', 280).build());

  dash.insertChart(dash.newChart().setChartType(Charts.ChartType.COLUMN)
    .addRange(dash.getRange('L8:M20')).setPosition(14, 4, 0, 0)
    .setOption('title', 'จำนวน Visit ต่อเดือน (12 เดือนล่าสุด)')
    .setOption('colors', ['#2563EB']).setOption('legend', 'none')
    .setOption('backgroundColor', chartBase.backgroundColor).setOption('titleTextStyle', chartBase.titleTextStyle)
    .setOption('hAxis', { textStyle: { color: '#64748B', fontSize: 9 }, slantedText: true })
    .setOption('vAxis', { textStyle: { color: '#64748B' }, gridlines: { color: '#F1F5F9' }, minValue: 0 })
    .setOption('width', 480).setOption('height', 280).build());

  dash.insertChart(dash.newChart().setChartType(Charts.ChartType.BAR)
    .addRange(dash.getRange('L22:M25')).setPosition(30, 1, 0, 0)
    .setOption('title', 'ระดับ Adherence ของผู้ป่วย')
    .setOption('colors', ['#059669']).setOption('legend', 'none')
    .setOption('backgroundColor', chartBase.backgroundColor).setOption('titleTextStyle', chartBase.titleTextStyle)
    .setOption('hAxis', { textStyle: { color: '#64748B' }, gridlines: { color: '#F1F5F9' }, minValue: 0 })
    .setOption('vAxis', { textStyle: { color: '#64748B' } })
    .setOption('width', 420).setOption('height', 240).build());

  dash.insertChart(dash.newChart().setChartType(Charts.ChartType.PIE)
    .addRange(dash.getRange('L27:M30')).setPosition(30, 4, 0, 0)
    .setOption('title', 'สถานะ DRP ทั้งหมด')
    .setOption('pieHole', 0.5).setOption('colors', ['#DC2626', '#D97706', '#059669'])
    .setOption('pieSliceTextStyle', { color: '#fff', fontSize: 11 })
    .setOption('backgroundColor', chartBase.backgroundColor).setOption('titleTextStyle', chartBase.titleTextStyle)
    .setOption('width', 480).setOption('height', 240).build());

  // ป้องกันพื้นที่สูตร/การ์ด/กราฟของ Dashboard จากการแก้ไขโดยไม่ตั้งใจ (เช่น พิมพ์ทับตัวเลขการ์ดเล่นๆ
  // แล้วสูตรหาย) — ใช้ warning-only (ไม่ได้ล็อกแบบเขียนไม่ได้เด็ดขาด) เพื่อไม่ต้องตั้งค่าสิทธิ์ผู้ใช้
  // เพิ่ม แค่ขึ้นข้อความเตือนให้คิดอีกครั้งก่อนแก้ไข ลบ protection เดิมก่อนเสมอกันซ้อนกันเวลารันซ้ำ
  dash.getProtections(SpreadsheetApp.ProtectionType.RANGE).forEach(p => p.remove());
  const guardRange = dash.getRange(1, 1, 30, 13);
  const protection = guardRange.protect().setDescription('พื้นที่สูตร Dashboard — แก้ไขเองได้แต่โปรดระวังสูตรเสียหาย');
  protection.setWarningOnly(true);

  SpreadsheetApp.flush();
  dash.activate();
  // เดิมใช้ SpreadsheetApp.getUi().alert(...) ซึ่งเป็น modal dialog ที่ "บล็อก" การทำงานของสคริปต์
  // ไว้จนกว่าจะมีคนกด OK ในแท็บ Google Sheet เอง — ถ้าผู้ใช้รันจากแท็บ Apps Script editor แล้วไม่ได้
  // สลับไปดูแท็บ Sheet จะไม่เห็น dialog นี้เลย สคริปต์จะค้างอยู่อย่างนั้นจนโดน Apps Script บังคับตัด
  // การทำงานที่ลิมิต 6 นาที (ขึ้น error "Exceeded maximum execution time" ทั้งที่จริงๆ ทุกขั้นตอนก่อน
  // หน้านี้ทำงานสำเร็จไปหมดแล้ว) — เปลี่ยนเป็น toast แบบไม่บล็อกแทน (ขึ้นมุมขวาล่างของ Sheet สักพักแล้ว
  // หายไปเอง) และ log ไว้ด้วยเผื่อดูย้อนหลังใน Executions
  SpreadsheetApp.getActiveSpreadsheet().toast(
    'การ์ด/กราฟ/ตัวชี้วัดจะอัปเดตอัตโนมัติเมื่อแอพซิงค์ข้อมูลใหม่เข้ามา (ตัวชี้วัด KPI1-7 จะขึ้น "—" จนกว่าจะกดปุ่ม "ซิงค์ตัวชี้วัด KPI" จากในแอพอย่างน้อย 1 ครั้ง)',
    '✅ ตั้งค่า Dashboard สำเร็จ', 10
  );
  Logger.log('setupDashboard เสร็จสมบูรณ์');
}

// วางการ์ดสรุปเป็นแถวคู่ (ตัวเลข + label) เริ่มที่แถว startRow คอลัมน์ 1 เป็นต้นไป
function renderCardRow(dash, startRow, cards) {
  cards.forEach((c, i) => {
    const col = i + 1;
    dash.getRange(startRow, col).setFormula(c.formula).setFontSize(20).setFontWeight('bold')
      .setFontColor(c.color).setHorizontalAlignment('center').setBackground('#F8FAFC');
    dash.getRange(startRow + 1, col).setValue(c.label).setFontSize(9.5).setFontColor('#64748B')
      .setHorizontalAlignment('center').setBackground('#F8FAFC').setWrap(true);
  });
  dash.setRowHeight(startRow, 40);
  dash.setRowHeight(startRow + 1, 38);
  dash.getRange(startRow, 1, 2, cards.length).setBorder(true, true, true, true, true, true, '#E2E8F0', SpreadsheetApp.BorderStyle.SOLID);
}

// ── เมนูลัดบนแถบเมนูของ Google Sheet เอง — ทำงานอัตโนมัติทุกครั้งที่เปิดสเปรดชีตนี้ ──
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('🏥 RxClinic')
    .addItem('📊 เปิดแผงควบคุม (Control Panel)', 'showSidebar')
    .addSeparator()
    .addItem('🔄 รีเฟรช/จัดรูปแบบ Dashboard ใหม่ทั้งหมด', 'setupDashboard')
    .addToUi();
}

// ── Sidebar: แผงควบคุมแบบ HTML/CSS/JS จริง (ต้องสร้างไฟล์ Sidebar.html แยกในโปรเจกต์นี้ด้วย — ดู
// gas-sync/Sidebar.html และขั้นตอนใน README.md) ให้มุมมองสรุป + ค้นหาผู้ป่วยแบบ interactive โดยไม่ต้อง
// สลับไปมาระหว่างชีต ──
function showSidebar() {
  const html = HtmlService.createHtmlOutputFromFile('Sidebar').setTitle('🏥 RxClinic Control Panel');
  SpreadsheetApp.getUi().showSidebar(html);
}

// เรียกจาก Sidebar.html (google.script.run) — สรุปตัวเลขภาพรวมสดจากชีตข้อมูลจริงตรงๆ (ไม่ใช่แค่
// snapshot ล่าสุด) ให้ตรงกับข้อมูลปัจจุบันเสมอแม้ยังไม่เคยกดซิงค์ KPI
function getSidebarSummary() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const countRows = (name) => {
    const sheet = ss.getSheetByName(name);
    return sheet ? Math.max(sheet.getLastRow() - 1, 0) : 0;
  };
  const drpSheet = ss.getSheetByName('DRP_Tracker');
  let openDrp = 0, highDrp = 0;
  if (drpSheet && drpSheet.getLastRow() > 1) {
    const data = drpSheet.getRange(2, 8, drpSheet.getLastRow() - 1, 3).getValues(); // H ความรุนแรง, I แนวทาง, J สถานะ
    data.forEach(row => {
      const severity = row[0], status = String(row[2] || '');
      if (status.indexOf('แก้ไขแล้ว') === -1) {
        openDrp++;
        if (severity === 'High') highDrp++;
      }
    });
  }
  return {
    patients: countRows('Patients'),
    visits: countRows('Visits'),
    openDrp, highDrp,
    referrals: countRows('Referrals'),
    updatedAt: Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'dd/MM/yyyy HH:mm'),
  };
}

// เรียกจาก Sidebar.html — ค้นหาผู้ป่วยด้วยชื่อหรือ HN จากชีต Patients คืนผลลัพธ์สูงสุด 15 รายการ
function searchPatients(query) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('Patients');
  if (!sheet || sheet.getLastRow() < 2 || !query) return [];
  const q = String(query).trim().toLowerCase();
  if (!q) return [];
  const data = sheet.getRange(2, 1, sheet.getLastRow() - 1, 10).getValues(); // ถึงคอลัมน์ J (การวินิจฉัย)
  const results = [];
  for (let i = 0; i < data.length && results.length < 15; i++) {
    const row = data[i];
    const hn = String(row[1] || ''), firstName = String(row[4] || ''), lastName = String(row[5] || '');
    const name = (firstName + ' ' + lastName).toLowerCase();
    if (hn.toLowerCase().indexOf(q) !== -1 || name.indexOf(q) !== -1) {
      results.push({ hn, name: firstName + ' ' + lastName, age: row[6], diagnosis: row[9] });
    }
  }
  return results;
}
