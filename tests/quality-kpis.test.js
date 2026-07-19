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
    t.ok('KPI1 num = only COPD patient\'s events', kpis.copdExacerbRate.num === 2);
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
}

module.exports = { run };
