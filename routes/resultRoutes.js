const express = require('express');
const router = express.Router();
const { protect, authorize } = require('../middlewares/authMiddleware');
const auditLogMiddleware = require('../middlewares/auditMiddleware');

const {
  getLiveResults,
  getResultsByPosition,
  getResultsByConstituency,
  getResultsByWard,
  exportResultsCSV,
  exportResultsPDF,
  getParticipationReport,
  getConstituenciesList,
  getFullElectionReport,
  exportPostElectionCSV,
  exportPostElectionPDF,
  getChartData,
  publishFinalResults,
  getPublicationStatus
} = require('../controllers/resultController');

// Apply audit logging to all routes
router.use(auditLogMiddleware);

// Public routes (no authentication required)
router.get('/live', getLiveResults);
router.get('/position/:position', getResultsByPosition);
router.get('/constituency/:constituency', getResultsByConstituency);
router.get('/ward/:ward', getResultsByWard);
router.get('/constituencies', getConstituenciesList);
router.get('/post-election/status', getPublicationStatus);

// Admin routes (require authentication)
router.use(protect);
router.use(authorize('admin', 'super_admin'));

// Export routes
router.get('/export/csv', exportResultsCSV);
router.get('/export/pdf', exportResultsPDF);

// Participation report
router.get('/participation', getParticipationReport);

// Post-election routes
router.get('/post-election/full-report', getFullElectionReport);
router.get('/post-election/export/csv', exportPostElectionCSV);
router.get('/post-election/export/pdf', exportPostElectionPDF);
router.get('/post-election/charts', getChartData);
router.post('/post-election/publish', publishFinalResults);

module.exports = router;