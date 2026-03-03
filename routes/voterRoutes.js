// routes/voterRoutes.js
const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const { protect, authorize } = require('../middlewares/authMiddleware');
const { validateVoterRegistration } = require('../middlewares/validationMiddleware');
const auditLogMiddleware = require('../middlewares/auditMiddleware');

// Import all controller functions
const {
  registerVoter,
  getVoterCount,
  getPendingVoters,
  getVotedVoters,
  getWardsByConstituency,
  getVoterStatistics,
  getRecentRegistrations,
  getTodaysRegistrationsCount,
  checkNationalId,
  checkEmail,
  // Self-registration functions
  uploadIDForSelfRegistration,
  selfRegisterVoter,
  updateTempVoterName,
  upload   // multer instance from controller
} = require('../controllers/voterController');

// Apply audit logging to all routes
router.use(auditLogMiddleware);

// ========== PUBLIC ROUTES (no authentication) ==========
// Rate limiters for public endpoints
const uploadLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // 5 uploads per IP
  message: { success: false, error: 'Too many upload attempts, please try again later.' }
});

const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 3, // 3 registrations per IP
  message: { success: false, error: 'Too many registration attempts from this IP, please try again later.' }
});

// Update temp voter name (public)
router.put('/self/update-name', registerLimiter, updateTempVoterName);

// Upload ID images for self-registration (multipart/form-data)
router.post(
  '/self/upload-id',
  uploadLimiter,
  upload.fields([
    { name: 'front', maxCount: 1 },
    { name: 'back', maxCount: 1 }
  ]),
  uploadIDForSelfRegistration
);

// Complete self-registration (JSON)
router.post('/self/register', registerLimiter, selfRegisterVoter);

// ========== PROTECTED ROUTES (require authentication) ==========
// All routes below this line require authentication
router.use(protect);

// Register new voter (admin only) - WITH SIGNATURE ONLY
router.post(
  '/register',
  authorize('admin', 'super_admin'),
  validateVoterRegistration,
  registerVoter
);

// Get voter count (admin only)
router.get('/count', authorize('admin', 'super_admin'), getVoterCount);

// Get voters who haven't voted (admin only)
router.get('/pending', authorize('admin', 'super_admin'), getPendingVoters);

// Get voters who have voted (admin only)
router.get('/voted', authorize('admin', 'super_admin'), getVotedVoters);

// Get wards by constituency (admin only)
router.get('/wards/:constituency', authorize('admin', 'super_admin'), getWardsByConstituency);

// Get voter statistics (admin only)
router.get('/statistics', authorize('admin', 'super_admin'), getVoterStatistics);

// Get recent registrations (admin only)
router.get('/recent', authorize('admin', 'super_admin'), getRecentRegistrations);

// Get today's registrations count (admin only)
router.get('/today-count', authorize('admin', 'super_admin'), getTodaysRegistrationsCount);

// Check National ID availability (admin only)
router.get('/check-id/:nationalId', authorize('admin', 'super_admin'), checkNationalId);

// Check Email availability (admin only)
router.get('/check-email/:email', authorize('admin', 'super_admin'), checkEmail);

module.exports = router;