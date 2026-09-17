import {
  generateReportHtml,
  getLatestTestResult,
  runStagingHealthSuite
} from '../../services/stagingHealthTestRunner.js';

/** Registers adaptive staging checks and the deployment health report. */
export function registerDiagnosticSuiteRoutes(router) {
  router.get('/test-suite', async (_req, res) => {
    let result = getLatestTestResult();
    if (result.status === 'PENDING') {
      result = await runStagingHealthSuite('MANUAL_QUERY');
    }
    res.json(result);
  });

  router.post('/run-suite', async (_req, res) => {
    const result = await runStagingHealthSuite('MANUAL_TRIGGER');
    res.json(result);
  });

  router.get('/report-pdf', async (_req, res) => {
    let result = getLatestTestResult();
    if (result.status === 'PENDING') {
      result = await runStagingHealthSuite('PDF_REQUEST');
    }
    const html = generateReportHtml(result);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Content-Disposition', `inline; filename="ragenodes_deployment_report_${Date.now()}.html"`);
    res.send(html);
  });
}
