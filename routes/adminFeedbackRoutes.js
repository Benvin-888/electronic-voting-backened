const express = require('express');
const router = express.Router();
const {
  getAllFeedback,
  getFeedbackById,
  updateFeedbackStatus,
  bulkUpdateFeedback,
  deleteFeedback,
  getFeedbackAnalytics,
  exportFeedback
} = require('../controllers/feedbackController');
const { protect, authorize } = require('../middlewares/authMiddleware');

// All routes here are protected and for admins only
// Adjust roles based on your actual database values
router.use(protect, authorize('admin', 'super_admin', 'super-admin'));

// Feedback management routes
router.get('/', getAllFeedback);
router.get('/analytics', getFeedbackAnalytics);
router.get('/export', exportFeedback);
router.get('/:id', getFeedbackById);
router.patch('/:id/status', updateFeedbackStatus);
router.post('/bulk-update', bulkUpdateFeedback);
router.delete('/:id', deleteFeedback);

module.exports = router;