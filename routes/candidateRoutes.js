const express = require('express');
const router = express.Router();
const { protect, authorize } = require('../middlewares/authMiddleware');
const { validateCandidate } = require('../middlewares/validationMiddleware');
const auditLogMiddleware = require('../middlewares/auditMiddleware');

const {
  addCandidate,
  getCandidates,
  getCandidate,
  updateCandidate,
  deleteCandidate,
  getCandidateStatistics,
  getCandidatesByPosition,
  uploadCandidatePhoto,
  upload
} = require('../controllers/candidateController');

// Apply audit logging to all routes
router.use(auditLogMiddleware);

// Public routes (no authentication required)
router.get('/', getCandidates);
router.get('/by-position/:position', getCandidatesByPosition);
router.get('/:id', getCandidate);

// Admin routes (require authentication)
router.use(protect);
router.use(authorize('admin', 'super_admin'));

// Add new candidate with photo upload
router.post('/', upload.single('photo'), validateCandidate, addCandidate);

// Update candidate with optional photo upload
router.put('/:id', upload.single('photo'), validateCandidate, updateCandidate);

// Upload/update candidate photo
router.post('/:id/photo', upload.single('photo'), uploadCandidatePhoto);

// Delete candidate
router.delete('/:id', deleteCandidate);

// Get candidate statistics
router.get('/statistics/overview', getCandidateStatistics);

module.exports = router;