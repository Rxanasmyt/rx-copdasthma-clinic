// tests/quality-kpis.test.js
// ── ทดสอบ calculateQualityKPIs (7 ตัวชี้วัด HA Accreditation) จากโค้ดจริงใน RxClinic.html ──
const { readApp, extractBlocks } = require('./extract');

// stub ที่จำเป็นสำหรับ calculateQualityKPIs: classifyRespiratoryMed, RX_KPI_ENUMS, isTechniquePass, isAdherenceGood
const src = readApp();
const code = extractBlocks(src, [
  'RX_KPI_ENUMS', 'isTechniquePass', 'isAdherenceGood',
  'COMMON_MEDICATIONS', 'RESP_DRUG_KEYWORDS', 'classifyRespiratoryMed', 'calculateQualityKPIs',
]);
// eslint-disable-next-line no-eval
eval(code + `
global.calculateQualityKPIs = calculateQualityKPIs;
global.classifyRespiratoryMed = classifyRespiratoryMed;
global.RX_KPI_ENUMS = RX_KPI_ENUMS;
global.isTechniquePass = isTechniquePass;
`);

const mkPatient = (id, dx) => ({ id, hn: 'HN' + id, prefix: '', firstName: 'P' + id, lastName: '', diagnosis: dx });

function run(t) {
  // ─── KPI1/KPI2: exacerbation-rate KPIs exclude "Both" diagnosis (no cross-counting the same event) ───
  {
    const data = {
      patients: [mkPatient('p1', 'COPD'), mkPatient('p2', 'Asthma'), mkPatient('p3', 'Both')],
      visits: [
        { id: 'v1', patientId: 'p1', visitDate: '2026-07-01', exacerbation: { countThisYear: 2, hospitalized: false, erVisit: false } },
        { id: 'v2', patientId: 'p2', visitDate: '2026-07-02', exacerbation: { countThisYear: 0, hospitalized: true, erVisit: false } },
        { id: 'v3', patientId: 'p3', visitDate: '2026-07-03', exacerbation: { countThisYear: 5, hospitalized: true, erVisit: true } },
      ],
      telepharmacy: [], clinicDayRosters: [],
    };
    const kpis = calculateQualityKPIs(data, '2026-07-01', '2026-07-31');
    t.ok('KPI1 den excludes Both diagnosis', kpis.copdExacerbRate.den === 1);
    // fallback (ไม่มี exacerbationEvents) ปรับสัดส่วนตามความยาวช่วงเวลาที่เลือกเทียบกับหน้าต่าง recall
    // 12 เดือน (365 วัน) ของฟิลด์ countThisYear — ช่วง 31 วันจาก countThisYear=2 -> round(2*31/365) = 0
    t.ok('KPI1 num = ค่า countThisYear ปรับสัดส่วนตามความยาวช่วงเวลาที่เลือก (fallback, ไม่มี event log)', kpis.copdExacerbRate.num === 0);
    t.ok('KPI2 den excludes Both diagnosis', kpis.asthmaErRate.den === 1);
    t.ok('KPI2 num = only Asthma patient\'s ER/admit', kpis.asthmaErRate.num === 1);
  }

  // ─── KPI3/KPI4: medication KPIs also exclude "Both" ───
  {
    const data = {
      patients: [mkPatient('p1', 'Asthma'), mkPatient('p2', 'COPD'), mkPatient('p3', 'Both')],
      visits: [
        { id: 'v1', patientId: 'p1', visitDate: '2026-07-01', medications: [{ name: 'Budesonide (Pulmicort) MDI 200 mcg/dose' }] },
        { id: 'v2', patientId: 'p2', visitDate: '2026-07-02', medications: [{ name: 'Tiotropium (Spiriva) Handihaler 18 mcg' }], exacerbation: { countThisYear: 1 } },
        { id: 'v3', patientId: 'p3', visitDate: '2026-07-03', medications: [{ name: 'Budesonide (Pulmicort) MDI 200 mcg/dose' }, { name: 'Tiotropium (Spiriva) Handihaler 18 mcg' }], exacerbation: { countThisYear: 3 } },
      ],
      telepharmacy: [], clinicDayRosters: [],
    };
    const kpis = calculateQualityKPIs(data, '2026-07-01', '2026-07-31');
    t.ok('KPI3 (Asthma+ICS) den excludes Both', kpis.asthmaIcsPercent.den === 1);
    t.ok('KPI4 (COPD LABA/LAMA) den excludes Both', kpis.copdTherapyPercent.den === 1);
  }

  // ─── KPI5-7: stay combined (Both counts) but expose per-disease breakdown that excludes Both ───
  {
    const data = {
      patients: [mkPatient('p1', 'COPD'), mkPatient('p2', 'Asthma'), mkPatient('p3', 'Both')],
      visits: [
        { id: 'v1', patientId: 'p1', visitDate: '2026-07-01', inhalerTechnique: [{ device: 'pMDI', overallScore: 'Good' }], adherence: { level: 'Good' } },
        { id: 'v2', patientId: 'p2', visitDate: '2026-07-02', inhalerTechnique: [{ device: 'pMDI', overallScore: 'Poor' }], adherence: { level: 'Poor' } },
        { id: 'v3', patientId: 'p3', visitDate: '2026-07-03', inhalerTechnique: [{ device: 'pMDI', overallScore: 'Good' }], adherence: { level: 'Good' } },
      ],
      telepharmacy: [], clinicDayRosters: [],
    };
    const kpis = calculateQualityKPIs(data, '2026-07-01', '2026-07-31');
    t.ok('KPI5 combined includes Both (den=3)', kpis.techniquePercent.den === 3);
    t.ok('KPI5 breakdown.copd excludes Both (den=1)', kpis.techniquePercent.breakdown.copd.den === 1);
    t.ok('KPI7 combined includes Both (den=3)', kpis.adherenceGoodPercent.den === 3);
    t.ok('KPI7 breakdown.asthma excludes Both (den=1)', kpis.adherenceGoodPercent.breakdown.asthma.den === 1);
  }

  // ─── Empty period must show 0, never silently fall back to all-time data ───
  {
    const data = {
      patients: [mkPatient('p1', 'Asthma')],
      visits: [{ id: 'v1', patientId: 'p1', visitDate: '2026-06-10', inhalerTechnique: [{ device: 'pMDI', overallScore: 'Good' }] }],
      telepharmacy: [], clinicDayRosters: [],
    };
    const kpis = calculateQualityKPIs(data, '2026-08-01', '2026-08-31'); // period with zero visits
    t.ok('empty period -> visitCount 0 (no leak from other months)', kpis.visitCount === 0);
    t.ok('empty period -> techniquePercent den 0', kpis.techniquePercent.den === 0);
  }

  // ─── KPI6 clinicDayRosters: manual roster overrides nextVisit-fallback for its date ───
  {
    const data = {
      patients: [mkPatient('p1', 'COPD')],
      visits: [{ id: 'v1', patientId: 'p1', visitDate: '2026-07-06' }],
      telepharmacy: [],
      clinicDayRosters: [{ id: 'r1', date: '2026-07-06', scheduledCount: 5, patientIds: ['p1'], extraCount: 4 }],
    };
    const kpis = calculateQualityKPIs(data, '2026-07-01', '2026-07-31');
    t.ok('KPI6 den = manual scheduledCount, not derived count', kpis.carePercent.den === 5);
    t.ok('KPI6 num = 1 (p1 visited on roster date)', kpis.carePercent.num === 1);
  }

  // ─── KPI6 bug fix: genuine no-show must not be credited as "came" by an unrelated visit ───
  // สถานการณ์จริงที่พบ: ผู้ป่วยมี visit ที่สร้าง nextVisit ไว้ แต่ไม่กลับมาตามนัดเลย — เดิม
  // cameByVisit เช็คแค่ "มี visit ไหนก็ได้ในช่วงเวลาที่เลือก" ทำให้ visit ที่สร้างนัดนั้นเองถูกนับ
  // เป็น "มาแล้ว" เสมอ (ต้องเช็คว่ามี visit ตั้งแต่วันนัดเป็นต้นไปเท่านั้น)
  {
    const data = {
      patients: [mkPatient('p1', 'COPD')],
      visits: [{ id: 'v1', patientId: 'p1', visitDate: '2026-07-01', nextVisit: '2026-07-15' }],
      telepharmacy: [], clinicDayRosters: [],
    };
    // todayStr หลัง 2026-07-15 เพื่อให้นัดนี้ "ถึงกำหนดแล้วจริง"
    const kpis = calculateQualityKPIs(data, '2026-07-01', '2026-07-31', '2026-07-20');
    t.ok('KPI6: genuine no-show (never returned) -> den=1 num=0, not 100%', kpis.carePercent.den === 1 && kpis.carePercent.num === 0);
    t.ok('KPI6: genuine no-show appears in noShowRoster', kpis.noShowRoster.some(r => r.id === 'p1'));
  }
  // ── same scenario but patient DID return after the due date -> counted as came ──
  {
    const data = {
      patients: [mkPatient('p1', 'COPD')],
      visits: [
        { id: 'v1', patientId: 'p1', visitDate: '2026-07-01', nextVisit: '2026-07-15' },
        { id: 'v2', patientId: 'p1', visitDate: '2026-07-16' },
      ],
      telepharmacy: [], clinicDayRosters: [],
    };
    const kpis = calculateQualityKPIs(data, '2026-07-01', '2026-07-31', '2026-07-20');
    t.ok('KPI6: patient who returns after due date counted as came (num=1)', kpis.carePercent.num === 1);
    t.ok('KPI6: not listed as no-show when they did return', !kpis.noShowRoster.some(r => r.id === 'p1'));
  }
  // ── future nextVisit (not due yet) must not be counted as due/no-show at all ──
  {
    const data = {
      patients: [mkPatient('p1', 'COPD')],
      visits: [{ id: 'v1', patientId: 'p1', visitDate: '2026-07-01', nextVisit: '2026-07-25' }],
      telepharmacy: [], clinicDayRosters: [],
    };
    // todayStr ก่อนวันนัด — นัดยังไม่ถึงกำหนด
    const kpis = calculateQualityKPIs(data, '2026-07-01', '2026-07-31', '2026-07-10');
    t.ok('KPI6: future appointment not yet due -> not counted in den/num at all', kpis.carePercent.den === 0);
    t.ok('KPI6: future appointment not listed as no-show', !kpis.noShowRoster.some(r => r.id === 'p1'));
  }
  // ── failed telepharmacy call (No Answer) must not count as "came" ──
  {
    const data = {
      patients: [mkPatient('p1', 'COPD')],
      visits: [{ id: 'v1', patientId: 'p1', visitDate: '2026-07-01', nextVisit: '2026-07-15' }],
      telepharmacy: [{ id: 't1', patientId: 'p1', status: 'No Answer', actualDate: '2026-07-16' }],
      clinicDayRosters: [],
    };
    const kpis = calculateQualityKPIs(data, '2026-07-01', '2026-07-31', '2026-07-20');
    t.ok('KPI6: failed telepharmacy call (No Answer) does not count as came', kpis.carePercent.num === 0);
  }
  // ── roster day: walk-ins beyond scheduledCount must not push carePercent past 100% ──
  {
    const data = {
      patients: [mkPatient('p1', 'COPD'), mkPatient('p2', 'COPD'), mkPatient('p3', 'COPD')],
      visits: [
        { id: 'v1', patientId: 'p1', visitDate: '2026-07-06' },
        { id: 'v2', patientId: 'p2', visitDate: '2026-07-06' },
        { id: 'v3', patientId: 'p3', visitDate: '2026-07-06' }, // walk-in, not on roster, not in extraCount
      ],
      telepharmacy: [],
      clinicDayRosters: [{ id: 'r1', date: '2026-07-06', scheduledCount: 2, patientIds: ['p1', 'p2'], extraCount: 0 }],
    };
    const kpis = calculateQualityKPIs(data, '2026-07-01', '2026-07-31');
    t.ok('KPI6: unscheduled walk-in does not push carePercent past 100%', parseFloat(kpis.carePercent.value) <= 100);
    t.ok('KPI6: num capped at scheduledCount (2), not 3', kpis.carePercent.num === 2);
  }

  // ── regression: walk-in must NOT substitute for a genuine no-show (real inflation bug, not just
  // the >100% cap) — เดิมนับ cameSet.size ตรงๆ (แค่ capped ที่ scheduledCount) ทำให้ walk-in ที่ไม่ได้
  // นัดไว้เข้ามาแทนที่คนที่นัดไว้จริงแต่ไม่มา กลายเป็น 100% ทั้งที่ noShowRoster ยังมีรายชื่อคนไม่มาอยู่ ──
  {
    const data = {
      patients: [mkPatient('p1', 'COPD'), mkPatient('p2', 'COPD'), mkPatient('p3', 'COPD')],
      visits: [
        { id: 'v1', patientId: 'p1', visitDate: '2026-07-06' }, // p1 มาตามนัด
        // p2 นัดไว้แต่ไม่มาเลย (no-show จริง)
        { id: 'v3', patientId: 'p3', visitDate: '2026-07-06' }, // p3 walk-in ไม่ได้นัดไว้ ไม่อยู่ใน extraCount
      ],
      telepharmacy: [],
      clinicDayRosters: [{ id: 'r1', date: '2026-07-06', scheduledCount: 2, patientIds: ['p1', 'p2'], extraCount: 0 }],
    };
    const kpis = calculateQualityKPIs(data, '2026-07-01', '2026-07-31');
    t.ok('regression KPI6: walk-in (p3) ต้องไม่ถูกนับแทนคนที่นัดไว้จริงแต่ไม่มา (p2) — num ต้องเป็น 1 ไม่ใช่ 2',
      kpis.carePercent.num === 1);
    t.ok('regression KPI6: p2 ต้องยังอยู่ใน noShowRoster (ไม่ถูกกลบด้วย walk-in)',
      kpis.noShowRoster.some(r => r.id === 'p2'));
  }

  // ── walk-in ที่อยู่ในโควตา extraCount (นัดไว้แต่ไม่รู้ตัวตนล่วงหน้า) ต้องนับเป็น "มา" ได้ ──
  {
    const data = {
      patients: [mkPatient('p1', 'COPD'), mkPatient('p2', 'COPD')],
      visits: [
        { id: 'v1', patientId: 'p1', visitDate: '2026-07-06' },
        { id: 'v2', patientId: 'p2', visitDate: '2026-07-06' }, // p2 ไม่ได้อยู่ใน patientIds แต่มีโควตา extraCount รองรับ
      ],
      telepharmacy: [],
      clinicDayRosters: [{ id: 'r1', date: '2026-07-06', scheduledCount: 2, patientIds: ['p1'], extraCount: 1 }],
    };
    const kpis = calculateQualityKPIs(data, '2026-07-01', '2026-07-31');
    t.ok('KPI6: walk-in ที่อยู่ในโควตา extraCount ถูกนับเป็น "มา" ได้ (num=2)', kpis.carePercent.num === 2);
  }

  // ─── TECHNIQUE_SCORE_RANK: 'Acceptable' must be a distinct rank, not dropped/merged with 'Poor' ───
  // บั๊กที่พบ: หลายจุดในไฟล์เคยใช้ map ที่ไม่มี 'Acceptable' เอง ทำให้ถูกนับเป็น 0 เท่ากับ 'Poor'
  // หรือหลุดออกจากผลรวมไปเลย (?? null) — ตอนนี้รวมเป็น RX_KPI_ENUMS.TECHNIQUE_SCORE_RANK ตัวเดียว
  {
    t.ok('TECHNIQUE_SCORE_RANK: Good=2', RX_KPI_ENUMS.TECHNIQUE_SCORE_RANK.Good === 2);
    t.ok('TECHNIQUE_SCORE_RANK: Acceptable=1 (distinct from Poor)', RX_KPI_ENUMS.TECHNIQUE_SCORE_RANK.Acceptable === 1);
    t.ok('TECHNIQUE_SCORE_RANK: Poor=0', RX_KPI_ENUMS.TECHNIQUE_SCORE_RANK.Poor === 0);
    t.ok('isTechniquePass: Acceptable counts as pass', isTechniquePass('Acceptable') === true);
    t.ok('isTechniquePass: Poor does not pass', isTechniquePass('Poor') === false);
  }

  // ─── classifyRespiratoryMed: preset + keyword fallback, no false positives ───
  {
    t.ok('classifyRespiratoryMed: exact preset ICS+LABA', (() => {
      const r = classifyRespiratoryMed('Fluticasone/Salmeterol (Seretide) MDI 25/250 mcg');
      return r.ICS && r.LABA;
    })());
    t.ok('classifyRespiratoryMed: free-text keyword fallback still detects', (() => {
      const r = classifyRespiratoryMed('Symbicort Turbuhaler 160');
      return r.ICS && r.LABA;
    })());
    t.ok('classifyRespiratoryMed: unrelated drug -> all false', (() => {
      const r = classifyRespiratoryMed('Amlodipine 5 mg');
      return !r.ICS && !r.LABA && !r.LAMA && !r.SABA && !r.SAMA;
    })());
    t.ok('classifyRespiratoryMed: null/empty input does not throw', (() => {
      classifyRespiratoryMed(null); classifyRespiratoryMed(''); classifyRespiratoryMed(undefined);
      return true;
    })());
  }

  // ─── Performance: index แบบ Map (allVisitsByPatient/periodVisitsByPatient/allVisitsByDate) ต้อง
  // ทำให้เวลาคำนวณโตแบบเชิงเส้น (O(n)) ไม่ใช่ O(patients×visits) — กันไม่ให้ hotspot เดิมกลับมา
  // (คลินิกจริงมีผู้ป่วยหลักพัน/visit หลักหมื่น หน้า Analytics ต้องคำนวณทันที ไม่ค้าง)
  {
    const mkBigData = (nPatients, visitsPerPatient) => {
      const dxList = ['COPD', 'Asthma', 'Both'];
      const patients = Array.from({ length: nPatients }, (_, i) => mkPatient('bp' + i, dxList[i % 3]));
      const visits = [];
      patients.forEach((p, i) => {
        for (let j = 0; j < visitsPerPatient; j++) {
          const month = 1 + ((i + j) % 12);
          const day = 1 + ((i * 7 + j) % 27);
          visits.push({
            id: `bv${i}_${j}`, patientId: p.id,
            visitDate: `2026-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
            exacerbation: { countThisYear: j % 3, hospitalized: j % 11 === 0, erVisit: j % 13 === 0 },
            medications: [{ name: 'Symbicort Turbuhaler 160' }],
            inhalerTechnique: { overall: j % 2 === 0 ? 'Good' : 'Acceptable' },
            adherence: 'Good',
          });
        }
      });
      const clinicDayRosters = Array.from({ length: 40 }, (_, d) => ({
        date: `2026-01-${String(1 + (d % 28)).padStart(2, '0')}`,
        patientIds: patients.slice(0, 20).map(p => p.id),
        scheduledCount: 20,
      }));
      return { patients, visits, telepharmacy: [], clinicDayRosters };
    };

    const bigData = mkBigData(300, 6); // 300 คน × 6 visit = 1800 visit — พอวัด O(n) ได้โดยไม่ทำ CI ช้าเกินจำเป็น
    const t0 = Date.now();
    const kpis1 = calculateQualityKPIs(bigData, '2026-01-01', '2026-12-31', '2026-08-07');
    const elapsed1 = Date.now() - t0;

    const doubledData = mkBigData(600, 6); // จำนวนผู้ป่วยเพิ่มเป็น 2 เท่า
    const t1 = Date.now();
    const kpis2 = calculateQualityKPIs(doubledData, '2026-01-01', '2026-12-31', '2026-08-07');
    const elapsed2 = Date.now() - t1;

    t.ok('perf: calculateQualityKPIs returns valid numeric results on large dataset',
      Number.isFinite(kpis1.copdExacerbRate.den) && Number.isFinite(kpis2.copdExacerbRate.den));
    t.ok('perf: doubling patients does NOT roughly square runtime (no O(P×V) hotspot regression)',
      elapsed2 < Math.max(elapsed1 * 4, 200)); // O(n) ควรโตเชิงเส้น (~2x); ยอมสูงถึง 4x + floor 200ms กัน jitter บนเครื่อง CI ช้า
    t.ok('perf: large-dataset calculation completes well under 1s (point-of-care responsiveness)',
      elapsed2 < 1000);
  }

  // ─── regression: KPI1 fallback (ไม่มี exacerbationEvents) ต้องไม่นับ visit ที่อยู่นอกช่วงเวลาที่เลือก ───
  // เดิมใช้ latestVisit (visit ล่าสุดเท่าที่มี ไม่สนช่วงเวลา) ทำให้ visit เก่ากว่าช่วงที่เลือกไปหลายปี
  // ยังถูกบวกเข้า numerator อยู่ — ทั้งที่ผู้ใช้กำลังดูรายงานของช่วงเวลาที่ไม่เกี่ยวข้องกับ visit นั้นเลย
  {
    const data = {
      patients: [mkPatient('p1', 'COPD')],
      visits: [
        // visit เดียวของผู้ป่วยคนนี้อยู่ปี 2019 (ไม่มี exacerbationEvents -> fallback)
        { id: 'v1', patientId: 'p1', visitDate: '2019-03-02', exacerbation: { countThisYear: 4, hospitalized: false, erVisit: false } },
      ],
      telepharmacy: [], clinicDayRosters: [],
    };
    // ดูรายงานช่วง ม.ค.-ก.พ. 2026 — ไม่มี visit ไหนอยู่ในช่วงนี้เลย
    const kpis = calculateQualityKPIs(data, '2026-01-01', '2026-02-28');
    t.ok('regression KPI1: ผู้ป่วยยังอยู่ใน denominator (มี visit ก่อนหน้า endDate)', kpis.copdExacerbRate.den === 1);
    t.ok('regression KPI1: numerator ต้องเป็น 0 เพราะไม่มี visit ไหนอยู่ในช่วงที่เลือกจริงๆ (ไม่ใช่ 4 จาก visit ปี 2019)',
      kpis.copdExacerbRate.num === 0);
  }

  // ─── regression: KPI1 fallback ปรับสัดส่วน countThisYear ตามความยาวช่วงเวลาที่เลือก (ฟิลด์นี้เป็น
  // ค่า recall 12 เดือนล่าสุดตามฟอร์ม — แก้ให้ VisitForm คำนวณย้อนหลัง 12 เดือนจริงแล้ว ตรงกับชื่อฟิลด์
  // countThisYear และเกณฑ์ GOLD "≥2 ครั้ง/ปี" ที่ใช้ค่านี้ทั่วทั้งแอป) ───
  {
    const patients = [mkPatient('p1', 'COPD')];
    const visits = [{ id: 'v1', patientId: 'p1', visitDate: '2026-06-15', exacerbation: { countThisYear: 6, hospitalized: false, erVisit: false } }];
    const data = { patients, visits, telepharmacy: [], clinicDayRosters: [] };
    // ช่วงยาวเท่าหน้าต่าง recall จริง (~365 วัน, 12 เดือน) -> ควรได้ค่าประมาณเดิมคืนมาเกือบเต็ม
    const kpisFullWindow = calculateQualityKPIs(data, '2025-06-16', '2026-06-15'); // 365 วัน
    t.ok('regression KPI1: ช่วงเวลาเท่าหน้าต่าง recall (~12 เดือน) ได้ค่าใกล้เคียง countThisYear เดิม',
      kpisFullWindow.copdExacerbRate.num === 6);
    // ช่วงสั้นกว่ามาก (1 เดือน ~30 วัน) ต้องได้ค่าน้อยกว่าเดิมมาก ไม่ใช่ 6 เต็มๆ เหมือนเดิม
    const kpisShortWindow = calculateQualityKPIs(data, '2026-06-01', '2026-06-30');
    t.ok('regression KPI1: ช่วงเวลาสั้นกว่าหน้าต่าง recall มาก ต้องได้ค่าน้อยกว่าเดิมตามสัดส่วน (ไม่ใช่ 6 เต็มๆ)',
      kpisShortWindow.copdExacerbRate.num < 6 && kpisShortWindow.copdExacerbRate.num >= 0);
  }
}

module.exports = { run };
