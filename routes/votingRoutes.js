// routes/votingRoutes.js
const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const auditLogMiddleware = require('../middlewares/auditMiddleware');

const {
  checkEligibility,
  verifySignatureAndGetCandidates, // Renamed from verifyWebAuthnAndGetCandidates
  submitVote,
  getVoteReceipt
} = require('../controllers/votingController');

// Apply audit logging to all routes
router.use(auditLogMiddleware);

// Rate limiting for voting endpoints (stricter limits)
const votingLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // 10 attempts per IP
  message: { success: false, error: 'Too many voting attempts, please try again later.' }
});

const verificationLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 20, // 20 verification attempts
  message: { success: false, error: 'Too many verification attempts, please try again later.' }
});

const submitLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 5, // 5 submissions per IP
  message: { success: false, error: 'Too many vote submissions, please try again later.' }
});

// ========== VOTING ENDPOINTS ==========

// @route   POST /api/v1/voting/check-eligibility
// @desc    Step 1: Check voting number and get voter info
// @access  Public
router.post('/check-eligibility', votingLimiter, checkEligibility);

// @route   POST /api/v1/voting/verify-signature
// @desc    Step 2: Verify signature and get candidates
// @access  Public
router.post('/verify-signature', verificationLimiter, verifySignatureAndGetCandidates);

// @route   POST /api/v1/voting/submit
// @desc    Step 3: Submit votes (after signature verification)
// @access  Public
router.post('/submit', submitLimiter, submitVote);

// @route   POST /api/v1/voting/receipt
// @desc    Get vote receipt (verify vote was counted)
// @access  Public
router.post('/receipt', votingLimiter, getVoteReceipt);

module.exports = router;