
const express = require('express');
const router = express.Router();
const { protect, authorize } = require('../middlewares/authMiddleware');
const auditLogMiddleware = require('../middlewares/auditMiddleware');

const {
  getDashboardStats,
  updateSystemSettings,
  getSystemSettings,
  openVotingPortal,
  closeVotingPortal,
  scheduleVoting,
  getAuditLogs,
  exportAuditLogs,
  getSuspiciousActivity,
  getSystemStatus,
  exportElectionData,
  exportFullReport,
  generatePDFReport,
  getParticipationReport,
  getFullElectionReport,
  getReportsList,
  getReportById,
  verifyReport
} = require('../controllers/adminController');

// Apply audit logging to all routes
router.use(auditLogMiddleware);

// All routes require admin authentication
router.use(protect);

// Admin dashboard stats
router.get('/dashboard', authorize('admin', 'super_admin'), getDashboardStats);

// System settings
router.get('/settings', authorize('admin', 'super_admin'), getSystemSettings);
router.put('/settings', authorize('super_admin'), updateSystemSettings);

// Voting portal control
router.post('/voting/open', authorize('super_admin'), openVotingPortal);
router.post('/voting/close', authorize('super_admin'), closeVotingPortal);
router.post('/voting/schedule', authorize('super_admin'), scheduleVoting);

// Audit logs
router.get('/audit-logs', authorize('super_admin'), getAuditLogs);
router.get('/audit-logs/export', authorize('super_admin'), exportAuditLogs);
router.get('/suspicious-activity', authorize('super_admin'), getSuspiciousActivity);

// Export routes
router.get('/export/:type', authorize('admin', 'super_admin'), exportElectionData);
router.get('/export/full-report', authorize('super_admin'), exportFullReport);

// Reports routes
router.get('/reports/generate', authorize('admin', 'super_admin'), generatePDFReport);
router.get('/reports/participation', authorize('admin', 'super_admin'), getParticipationReport);
router.get('/reports/full', authorize('admin', 'super_admin'), getFullElectionReport);
router.get('/reports/list', authorize('admin', 'super_admin'), getReportsList);
router.get('/reports/:id', authorize('admin', 'super_admin'), getReportById);
router.post('/reports/:id/verify', authorize('super_admin'), verifyReport);

// System status
router.get('/status', authorize('admin', 'super_admin'), getSystemStatus);

module.exports = router;