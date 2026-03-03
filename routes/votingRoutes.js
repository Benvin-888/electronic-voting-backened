// routes/votingRoutes.js
const express = require('express');
const router = express.Router();
const { validateVote } = require('../middlewares/validationMiddleware');
const rateLimit = require('express-rate-limit');

const {
  checkEligibility,
  submitVote,
  getVoterSignatureForVerification
} = require('../controllers/votingController');

// Rate limiting for signature verification to prevent abuse
const signatureLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // limit each IP to 5 requests per windowMs
  message: {
    success: false,
    error: 'Too many signature verification attempts. Please try again after 15 minutes.'
  },
  standardHeaders: true,
  legacyHeaders: false
});

// Rate limiting for vote submission (stricter limits)
const voteSubmissionLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 3, // limit each IP to 3 vote submissions per hour
  message: {
    success: false,
    error: 'Too many vote submission attempts. Please try again later.'
  },
  standardHeaders: true,
  legacyHeaders: false
});

// Public voting routes (no authentication required)

/**
 * @route   GET /api/v1/voting/eligibility/:votingNumber
 * @desc    Check voting eligibility and get voter info
 * @access  Public
 */
router.get('/eligibility/:votingNumber', checkEligibility);

/**
 * @route   GET /api/v1/voting/signature/:votingNumber
 * @desc    Get voter's signature for verification (with rate limiting)
 * @access  Public (rate limited)
 */
router.get('/signature/:votingNumber', signatureLimiter, getVoterSignatureForVerification);

/**
 * @route   POST /api/v1/voting/submit
 * @desc    Submit vote with signature verification
 * @access  Public (rate limited)
 */
router.post('/submit', voteSubmissionLimiter, validateVote, submitVote);

// Optional: Add a route to check voting status (if needed)
/**
 * @route   GET /api/v1/voting/status
 * @desc    Check if voting is currently open
 * @access  Public
 */
router.get('/status', async (req, res) => {
  try {
    const SystemSetting = require('../models/SystemSetting');
    const portalStatus = await SystemSetting.findOne({ key: 'voting_portal_open' });
    const deadline = await SystemSetting.findOne({ key: 'voting_deadline' });
    
    res.status(200).json({
      success: true,
      data: {
        isOpen: portalStatus ? portalStatus.value : false,
        deadline: deadline ? deadline.value : null,
        timestamp: new Date()
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Error fetching voting status'
    });
  }
});

module.exports = router;