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

function getOrCreateSheet(collection) {
  const meta = COLLECTIONS[collection];
  const headers = HEADERS[collection];
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(meta.sheet);
  if (!sheet) {
    sheet = ss.insertSheet(meta.sheet);
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    styleSheet(sheet, headers.length, meta.color);
  }
  return sheet;
}

// จัดรูปแบบหัวตาราง (สีประจำหมวด) + ลายแถบสลับสี (banding) ให้อ่านแถวข้อมูลยาวๆ ง่ายขึ้น + แช่แข็งหัวตาราง
function styleSheet(sheet, numCols, color) {
  const header = sheet.getRange(1, 1, 1, numCols);
  header.setBackground(color).setFontColor('#FFFFFF').setFontWeight('bold')
    .setHorizontalAlignment('center').setVerticalAlignment('middle').setWrap(true);
  sheet.setRowHeight(1, 40);
  sheet.setFrozenRows(1);
  sheet.setFrozenColumns(2);
  sheet.setTabColor(color);
  try {
    sheet.getRange(1, 1, Math.max(sheet.getMaxRows(), 200), numCols)
      .applyRowBanding(SpreadsheetApp.BandingTheme.LIGHT_GREY, true, false);
  } catch (e) { /* banding ชนกับของเดิมถ้ารันซ้ำ — ข้ามได้ ไม่กระทบข้อมูล */ }
}

/**
 * รันครั้งเดียวจาก Apps Script editor (เลือกฟังก์ชันนี้จาก dropdown ด้านบนแล้วกด ▶ Run) เพื่อสร้าง/
 * จัดรูปแบบชีตข้อมูลทุกหมวด + ชีต "Dashboard" สรุปภาพรวมให้สวยงาม ทันสมัย พร้อมใช้งาน — รันซ้ำได้
 * ปลอดภัย (ไม่ลบข้อมูลที่มีอยู่แล้วในชีตข้อมูล แต่จะสร้างกราฟ/การ์ดสรุปใน Dashboard ใหม่ทุกครั้งที่รัน)
 */
function setupDashboard() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  Object.keys(COLLECTIONS).forEach(getOrCreateSheet);

  let dash = ss.getSheetByName('Dashboard');
  if (dash) {
    dash.clear();
    dash.getCharts().forEach(c => dash.removeChart(c));
  } else {
    dash = ss.insertSheet('Dashboard', 0);
  }
  dash.setTabColor('#0F766E');
  dash.setColumnWidths(1, 10, 140);
  dash.setHiddenGridlines(true);

  // ── Title ──
  dash.getRange('A1:J1').merge().setValue('🏥 Rx-COPD/Asthma Clinic — ภาพรวมการบริบาลเภสัชกรรมทั้งหมด')
    .setFontSize(19).setFontWeight('bold').setFontColor('#FFFFFF').setBackground('#0F172A')
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
  });
  dash.setRowHeight(10, 40);
  dash.setRowHeight(11, 44);
  dash.getRange(10, 1, 2, kpiCards.length).setBorder(true, true, true, true, true, true, '#E2E8F0', SpreadsheetApp.BorderStyle.SOLID);
  dash.getRange('A12').setFormula('="⏱ คำนวณจากช่วงวันที่: " & IFERROR(INDEX(KPI_Snapshots!C:C,COUNTA(KPI_Snapshots!A:A)),"—") & " ถึง " & IFERROR(INDEX(KPI_Snapshots!D:D,COUNTA(KPI_Snapshots!A:A)),"—")')
    .setFontSize(9).setFontColor('#94A3B8');

  // ── Helper columns สำหรับกราฟ (คอลัมน์ L เป็นต้นไป ไม่ต้องแก้ไข) ──
  dash.getRange('L1').setValue('— ตารางช่วยสร้างกราฟ (ไม่ต้องแก้ไข) —').setFontColor('#94A3B8').setFontSize(9);

  dash.getRange('L2').setValue('การวินิจฉัย'); dash.getRange('M2').setValue('จำนวน');
  dash.getRange('L3').setValue('COPD').setBackground('#FFF7ED');   dash.getRange('M3').setFormula('=COUNTIF(Visits!F2:F,"COPD")');
  dash.getRange('L4').setValue('Asthma').setBackground('#FAF5FF'); dash.getRange('M4').setFormula('=COUNTIF(Visits!F2:F,"Asthma")');
  dash.getRange('L5').setValue('Both').setBackground('#F0F9FF');   dash.getRange('M5').setFormula('=COUNTIF(Visits!F2:F,"Both")');

  dash.getRange('L8').setValue('เดือน'); dash.getRange('M8').setValue('จำนวน Visit');
  for (let m = 0; m < 12; m++) {
    const d = new Date(); d.setMonth(d.getMonth() - (11 - m));
    const ym = Utilities.formatDate(d, Session.getScriptTimeZone(), 'yyyy-MM');
    dash.getRange(9 + m, 12).setValue(ym);
    dash.getRange(9 + m, 13).setFormula(`=COUNTIF(Visits!B2:B,"${ym}*")`);
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

  // ── Charts ──
  dash.insertChart(dash.newChart().setChartType(Charts.ChartType.PIE)
    .addRange(dash.getRange('L2:M5')).setPosition(14, 1, 0, 0)
    .setOption('title', 'สัดส่วนการวินิจฉัย (COPD / Asthma / Both)')
    .setOption('pieHole', 0.45).setOption('colors', ['#EA580C', '#7C3AED', '#0EA5E9'])
    .setOption('width', 420).setOption('height', 280).build());

  dash.insertChart(dash.newChart().setChartType(Charts.ChartType.COLUMN)
    .addRange(dash.getRange('L8:M20')).setPosition(14, 4, 0, 0)
    .setOption('title', 'จำนวน Visit ต่อเดือน (12 เดือนล่าสุด)')
    .setOption('colors', ['#0F766E']).setOption('legend', 'none')
    .setOption('width', 480).setOption('height', 280).build());

  dash.insertChart(dash.newChart().setChartType(Charts.ChartType.BAR)
    .addRange(dash.getRange('L22:M25')).setPosition(30, 1, 0, 0)
    .setOption('title', 'ระดับ Adherence ของผู้ป่วย')
    .setOption('colors', ['#059669']).setOption('legend', 'none')
    .setOption('width', 420).setOption('height', 240).build());

  dash.insertChart(dash.newChart().setChartType(Charts.ChartType.PIE)
    .addRange(dash.getRange('L27:M30')).setPosition(30, 4, 0, 0)
    .setOption('title', 'สถานะ DRP ทั้งหมด')
    .setOption('pieHole', 0.45).setOption('colors', ['#DC2626', '#D97706', '#059669'])
    .setOption('width', 480).setOption('height', 240).build());

  SpreadsheetApp.flush();
  dash.activate();
  SpreadsheetApp.getUi().alert('✅ ตั้งค่า Dashboard สำเร็จ — การ์ด/กราฟ/ตัวชี้วัดจะอัปเดตอัตโนมัติเมื่อแอพซิงค์ข้อมูลใหม่เข้ามา (ตัวชี้วัด KPI1-7 จะขึ้น "—" จนกว่าจะกดปุ่ม "ซิงค์ตัวชี้วัด KPI" จากในแอพอย่างน้อย 1 ครั้ง)');
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
