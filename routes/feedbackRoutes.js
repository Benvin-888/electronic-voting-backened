const express = require('express');
const router = express.Router();

// Import controllers – verify that all names match exports in feedbackController.js
const {
  submitFeedback,
  getFeedbackStatus,
  getMyFeedback,
  getAllFeedback,
  getFeedbackById,
  updateFeedbackStatus,
  bulkUpdateFeedback,
  deleteFeedback,
  getFeedbackAnalytics,
  exportFeedback
} = require('../controllers/feedbackController');

// Import middleware
const { protect, authorize } = require('../middlewares/authMiddleware');
const { validateFeedback } = require('../middlewares/validationMiddleware'); // Ensure this exports a function

// ======================
// USER ROUTES
// ======================
router.post('/', validateFeedback, submitFeedback);               // Public
router.get('/:id/status', getFeedbackStatus);                     // Public
router.get('/my-feedback', protect, authorize('voter'), getMyFeedback); // Voter only

// ======================
// ADMIN ROUTES
// ======================
router.get('/admin/feedback', protect, authorize('admin'), getAllFeedback);
router.get('/admin/feedback/analytics', protect, authorize('admin'), getFeedbackAnalytics);
router.get('/admin/feedback/export', protect, authorize('admin'), exportFeedback);
router.get('/admin/feedback/:id', protect, authorize('admin'), getFeedbackById);
router.patch('/admin/feedback/:id/status', protect, authorize('admin'), updateFeedbackStatus);
router.post('/admin/feedback/bulk-update', protect, authorize('admin'), bulkUpdateFeedback);
router.delete('/admin/feedback/:id', protect, authorize('admin'), deleteFeedback);

module.exports = router;