const express = require('express');
const router = express.Router();
const { validateVote } = require('../middlewares/validationMiddleware');

const {
  checkEligibility,
  submitVote
} = require('../controllers/votingController');

// Public voting routes (no authentication required)

// Check voting eligibility
router.get('/eligibility/:votingNumber', checkEligibility);

// Submit vote
router.post('/submit', validateVote, submitVote);

module.exports = router;