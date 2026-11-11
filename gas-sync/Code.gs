/**
 * Rx-COPD/Asthma Clinic — Google Sheets Sync (Google Apps Script)
 *
 * รับข้อมูลการบริบาลเภสัชกรรม (visit) ที่ส่งมาจาก RxClinic.html ผ่าน Web App นี้ แล้วเขียน/อัปเดต
 * (upsert ด้วย Visit ID คอลัมน์แรก) ลงชีต "Visits" ของสเปรดชีตนี้ พร้อมสร้างชีต "Dashboard" สรุปภาพรวม
 * ให้อัตโนมัติด้วยฟังก์ชัน setupDashboard()
 *
 * สเปรดชีตนี้เป็นแค่ "สำเนาสำหรับทำรายงาน/แดชบอร์ด" — Firestore ในแอพยังเป็นฐานข้อมูลหลักเสมอ
 * ถ้าสเปรดชีตนี้ล่ม/ตั้งค่าผิด แอพยังทำงานได้ปกติ (ฝั่งแอพออกแบบให้ sync แบบ fire-and-forget)
 *
 * วิธี deploy — ดู README.md ในโฟลเดอร์เดียวกัน
 */

const SHEET_VISITS = 'Visits';
const SHEET_DASHBOARD = 'Dashboard';

const VISITS_HEADERS = [
  'Visit ID', 'วันที่', 'HN', 'ชื่อ-นามสกุล', 'อายุ', 'การวินิจฉัย', 'ความเสี่ยง', 'Chief Complaint',
  'Ex. ครั้ง/ปี', 'นอน รพ.', 'เข้า ER', 'ความรุนแรง Ex.', 'ปัจจัยกระตุ้น', 'Rescue Use',
  'ยาที่ใช้', 'Adherence รายยา', 'Adherence ระดับ', 'เทคนิคยาพ่น', 'นำอุปกรณ์เดิมมา',
  'CAT', 'mMRC', 'ACT', 'SpO2', 'RR', 'BP',
  'Subjective', 'Objective', 'Assessment', 'Plan', 'หัวข้อให้คำปรึกษา',
  'จำนวน DRP ที่พบ', 'เภสัชกร', 'นัดถัดไป', 'ซิงค์ล่าสุด',
];

// ── Web App entry points ──────────────────────────────────────────────────
function doGet(e) {
  return ContentService.createTextOutput(JSON.stringify({ ok: true, service: 'RxClinic Sheets Sync' }))
    .setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {
  try {
    const payload = JSON.parse(e.postData.contents || '{}');
    const secret = PropertiesService.getScriptProperties().getProperty('SHARED_SECRET');
    if (!secret) {
      return jsonOut({ ok: false, error: 'ยังไม่ได้ตั้งค่า SHARED_SECRET ใน Script Properties ของโปรเจกต์นี้' });
    }
    if (payload.token !== secret) {
      return jsonOut({ ok: false, error: 'Token ไม่ถูกต้อง' });
    }
    if (payload.ping) {
      return jsonOut({ ok: true, pong: true });
    }
    const rows = Array.isArray(payload.rows) ? payload.rows : [];
    const written = upsertVisitRows(rows);
    return jsonOut({ ok: true, written });
  } catch (err) {
    return jsonOut({ ok: false, error: String(err && err.message || err) });
  }
}

function jsonOut(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

// ── Upsert: อัปเดตแถวเดิมถ้า Visit ID ตรงกัน ไม่งั้นเพิ่มแถวใหม่ ──────────────
// โหลดคอลัมน์ Visit ID ทั้งชีตมาทำ index ครั้งเดียว (ไม่ loop หา cell ทีละแถว) ให้เร็วพอสำหรับ
// การซิงค์ทั้งคลินิกย้อนหลัง (อาจมีหลายพันแถว) โดยไม่ชนลิมิตเวลาการรันของ Apps Script
function upsertVisitRows(rows) {
  if (rows.length === 0) return 0;
  const sheet = getOrCreateVisitsSheet();
  const lastRow = sheet.getLastRow();
  const idToRowNum = new Map();
  if (lastRow > 1) {
    const ids = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
    ids.forEach((r, i) => { if (r[0]) idToRowNum.set(String(r[0]), i + 2); });
  }
  const now = new Date();
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
    sheet.getRange(sheet.getLastRow() + 1, 1, toAppend.length, VISITS_HEADERS.length).setValues(toAppend);
  }
  return rows.length;
}

function getOrCreateVisitsSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEET_VISITS);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_VISITS);
    sheet.getRange(1, 1, 1, VISITS_HEADERS.length).setValues([VISITS_HEADERS]);
    styleHeaderRow(sheet, VISITS_HEADERS.length);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function styleHeaderRow(sheet, numCols) {
  const header = sheet.getRange(1, 1, 1, numCols);
  header.setBackground('#0F766E').setFontColor('#FFFFFF').setFontWeight('bold')
    .setHorizontalAlignment('center').setVerticalAlignment('middle');
  sheet.setRowHeight(1, 32);
  sheet.setFrozenRows(1);
}

/**
 * รันครั้งเดียวจาก Apps Script editor (เลือกฟังก์ชันนี้จาก dropdown ด้านบนแล้วกด ▶ Run) เพื่อสร้าง/
 * จัดรูปแบบชีต "Visits" และ "Dashboard" ให้สวยงาม ทันสมัย พร้อมใช้งาน — รันซ้ำได้ปลอดภัย (ไม่ลบข้อมูลที่
 * มีอยู่แล้วในชีต Visits แต่จะจัดรูปแบบ/สร้างกราฟใหม่ใน Dashboard ทุกครั้งที่รัน)
 */
function setupDashboard() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  getOrCreateVisitsSheet();

  let dash = ss.getSheetByName(SHEET_DASHBOARD);
  if (dash) {
    dash.clear();
    dash.getCharts().forEach(c => dash.removeChart(c));
  } else {
    dash = ss.insertSheet(SHEET_DASHBOARD, 0);
  }

  dash.setTabColor('#0F766E');
  dash.setColumnWidths(1, 8, 150);
  dash.setHiddenGridlines(true);

  // ── Title ──
  dash.getRange('A1:H1').merge().setValue('🏥 Rx-COPD/Asthma Clinic — ภาพรวมการบริบาลเภสัชกรรม')
    .setFontSize(18).setFontWeight('bold').setFontColor('#FFFFFF').setBackground('#0F766E')
    .setHorizontalAlignment('center').setVerticalAlignment('middle');
  dash.setRowHeight(1, 44);
  dash.getRange('A2:H2').merge()
    .setFormula('="อัปเดตล่าสุด: " & TEXT(NOW(), "dd/MM/yyyy HH:mm")')
    .setFontSize(10).setFontColor('#64748B').setHorizontalAlignment('center');

  // ── Scorecards (แถว 4-6) — สูตรอ้างอิงชีต Visits ตรงๆ อัปเดตอัตโนมัติทุกครั้งที่มีข้อมูลใหม่ ──
  const cards = [
    { label: 'Visit ทั้งหมด', formula: '=COUNTA(Visits!A2:A)', color: '#0F766E' },
    { label: 'ผู้ป่วยไม่ซ้ำ (unique HN)', formula: '=COUNTA(UNIQUE(Visits!C2:C))-IF(COUNTBLANK(Visits!C2:C)>0,1,0)', color: '#2563EB' },
    { label: 'COPD', formula: '=COUNTIF(Visits!F2:F,"COPD")', color: '#EA580C' },
    { label: 'Asthma', formula: '=COUNTIF(Visits!F2:F,"Asthma")', color: '#7C3AED' },
    { label: 'นำอุปกรณ์เดิมมา %', formula: '=IFERROR(ROUND(COUNTIF(Visits!S2:S,"นำมาทุกชิ้น")/COUNTIF(Visits!S2:S,"<>")*100,1)&"%","—")', color: '#059669' },
    { label: 'DRP ที่พบรวม', formula: '=SUM(Visits!AE2:AE)', color: '#DC2626' },
  ];
  cards.forEach((c, i) => {
    const col = 1 + i * 1; // ใช้คอลัมน์เดียวแต่ขยายผ่าน setColumnWidths ด้านบน (150px/คอลัมน์) ให้พอดีการ์ด
    const cell = dash.getRange(4, col);
    cell.setFormula(c.formula).setFontSize(22).setFontWeight('bold').setFontColor(c.color)
      .setHorizontalAlignment('center').setBackground('#F8FAFC');
    dash.getRange(5, col).setValue(c.label).setFontSize(10).setFontColor('#64748B')
      .setHorizontalAlignment('center').setBackground('#F8FAFC').setWrap(true);
    dash.setRowHeight(4, 40);
    dash.setRowHeight(5, 34);
  });
  dash.getRange(4, 1, 2, cards.length).setBorder(true, true, true, true, true, true, '#E2E8F0', SpreadsheetApp.BorderStyle.SOLID);

  // ── Helper columns สำหรับกราฟ (ซ่อนไว้ด้านขวา คอลัมน์ J เป็นต้นไป) ──
  dash.getRange('J1').setValue('— ตารางช่วยสร้างกราฟ (ไม่ต้องแก้ไข) —').setFontColor('#94A3B8').setFontSize(9);
  dash.getRange('J2').setValue('การวินิจฉัย');
  dash.getRange('K2').setValue('จำนวน');
  dash.getRange('J3').setValue('COPD').setBackground('#FFF7ED');
  dash.getRange('K3').setFormula('=COUNTIF(Visits!F2:F,"COPD")');
  dash.getRange('J4').setValue('Asthma').setBackground('#FAF5FF');
  dash.getRange('K4').setFormula('=COUNTIF(Visits!F2:F,"Asthma")');
  dash.getRange('J5').setValue('Both').setBackground('#F0F9FF');
  dash.getRange('K5').setFormula('=COUNTIF(Visits!F2:F,"Both")');

  dash.getRange('J8').setValue('เดือน');
  dash.getRange('K8').setValue('จำนวน Visit');
  // เดือนย้อนหลัง 12 เดือน (yyyy-mm) + COUNTIFS นับจากคอลัมน์วันที่ (B) ที่ขึ้นต้นด้วยเดือนนั้น
  for (let m = 0; m < 12; m++) {
    const d = new Date(); d.setMonth(d.getMonth() - (11 - m));
    const ym = Utilities.formatDate(d, Session.getScriptTimeZone(), 'yyyy-MM');
    dash.getRange(9 + m, 10).setValue(ym);
    dash.getRange(9 + m, 11).setFormula(`=COUNTIF(Visits!B2:B,"${ym}*")`);
  }

  dash.getRange('J22').setValue('Adherence');
  dash.getRange('K22').setValue('จำนวน');
  ['Good', 'Fair', 'Poor'].forEach((lvl, i) => {
    dash.getRange(23 + i, 10).setValue(lvl);
    dash.getRange(23 + i, 11).setFormula(`=COUNTIF(Visits!Q2:Q,"${lvl}")`);
  });

  // ── Charts ──
  const pieChart = dash.newChart().setChartType(Charts.ChartType.PIE)
    .addRange(dash.getRange('J2:K5'))
    .setPosition(8, 1, 0, 0)
    .setOption('title', 'สัดส่วนการวินิจฉัย (COPD / Asthma / Both)')
    .setOption('pieHole', 0.45)
    .setOption('colors', ['#EA580C', '#7C3AED', '#0EA5E9'])
    .setOption('width', 420).setOption('height', 280)
    .build();
  dash.insertChart(pieChart);

  const lineChart = dash.newChart().setChartType(Charts.ChartType.COLUMN)
    .addRange(dash.getRange('J8:K20'))
    .setPosition(8, 4, 0, 0)
    .setOption('title', 'จำนวน Visit ต่อเดือน (12 เดือนล่าสุด)')
    .setOption('colors', ['#0F766E'])
    .setOption('width', 480).setOption('height', 280)
    .setOption('legend', 'none')
    .build();
  dash.insertChart(lineChart);

  const adherenceChart = dash.newChart().setChartType(Charts.ChartType.BAR)
    .addRange(dash.getRange('J22:K25'))
    .setPosition(24, 1, 0, 0)
    .setOption('title', 'ระดับ Adherence ของผู้ป่วย')
    .setOption('colors', ['#059669'])
    .setOption('width', 420).setOption('height', 260)
    .setOption('legend', 'none')
    .build();
  dash.insertChart(adherenceChart);

  SpreadsheetApp.flush();
  dash.activate();
  SpreadsheetApp.getUi().alert('✅ ตั้งค่า Dashboard สำเร็จ — กราฟ/การ์ดสรุปจะอัปเดตอัตโนมัติเมื่อมีข้อมูลใหม่เข้ามา');
}
