const { body, param, query } = require('express-validator');

// Voter Registration Validation
const validateVoterRegistration = [
  body('nationalId')
    .notEmpty().withMessage('National ID is required')
    .isLength({ min: 7, max: 10 }).withMessage('National ID must be 7-10 characters'),
  
  body('fullName')
    .notEmpty().withMessage('Full name is required')
    .trim()
    .isLength({ min: 2 }).withMessage('Full name must be at least 2 characters'),
  
  body('email')
    .notEmpty().withMessage('Email is required')
    .isEmail().withMessage('Please provide a valid email')
    .normalizeEmail(),
  
  body('phoneNumber')
    .notEmpty().withMessage('Phone number is required')
    .matches(/^[0-9]{10}$/).withMessage('Phone number must be 10 digits'),
  
  body('constituency')
    .notEmpty().withMessage('Constituency is required')
    .isIn(['Kirinyaga Central', 'Kirinyaga East', 'Mwea', 'Gichugu', 'Ndia'])
    .withMessage('Invalid constituency'),
  
  body('ward')
    .notEmpty().withMessage('Ward is required')
    .custom((value, { req }) => {
      const wardsByConstituency = {
        'Kirinyaga Central': ['Kiamuturi', 'Mutithi', 'Kangai', 'Thiba', 'Wamumu'],
        'Kirinyaga East': ['Kanyeki-Inoi', 'Kerugoya', 'Inoi', 'Mutonguni', 'Kiamaciri'],
        'Mwea': ['Thiba', 'Kangai', 'Mutithi', 'Wamumu', 'Mwea'],
        'Gichugu': ['Ngariama', 'Kanyekini', 'Murinduko', 'Gathigiriri', 'Tebere'],
        'Ndia': ['Baragwi', 'Njukiini', 'Gichugu', 'Mukure', 'Kiaritha']
      };
      
      const validWards = wardsByConstituency[req.body.constituency] || [];
      if (!validWards.includes(value)) {
        throw new Error(`Invalid ward for constituency ${req.body.constituency}`);
      }
      return true;
    })
];

// Candidate Validation
const validateCandidate = [
  body('fullName')
    .notEmpty().withMessage('Full name is required')
    .trim(),
  
  body('position')
    .notEmpty().withMessage('Position is required')
    .isIn(['Governor', 'Women Representative', 'MP', 'MCA'])
    .withMessage('Invalid position'),
  
  body('politicalParty')
    .notEmpty().withMessage('Political party is required')
    .trim(),
  
  body('constituency')
    .custom((value, { req }) => {
      if (req.body.position === 'MP' || req.body.position === 'MCA') {
        if (!value) {
          throw new Error('Constituency is required for MP and MCA positions');
        }
        const validConstituencies = ['Kirinyaga Central', 'Kirinyaga East', 'Mwea', 'Gichugu', 'Ndia'];
        if (!validConstituencies.includes(value)) {
          throw new Error('Invalid constituency');
        }
      }
      return true;
    }),
  
  body('ward')
    .custom((value, { req }) => {
      if (req.body.position === 'MCA') {
        if (!value) {
          throw new Error('Ward is required for MCA position');
        }
      }
      return true;
    })
];

// Vote Validation
const validateVote = [
  body('votingNumber')
    .notEmpty().withMessage('Voting number is required'),
  
  body('votes')
    .isArray({ min: 4 }).withMessage('Must vote for all 4 positions')
    .custom((value) => {
      const positions = value.map(v => v.position);
      const requiredPositions = ['Governor', 'Women Representative', 'MP', 'MCA'];
      
      const hasAllPositions = requiredPositions.every(pos => positions.includes(pos));
      if (!hasAllPositions) {
        throw new Error('Must vote for all positions: Governor, Women Representative, MP, and MCA');
      }
      
      const uniquePositions = [...new Set(positions)];
      if (uniquePositions.length !== positions.length) {
        throw new Error('Duplicate positions in vote');
      }
      
      return true;
    })
];

// ======================
// FEEDBACK VALIDATION
// ======================

/**
 * Feedback categories based on common feedback types
 */
const FEEDBACK_CATEGORIES = [
  'general',
  'bug',
  'feature',
  'complaint', 
  'suggestion',
  'user-experience',
  'technical-issue',
  'other'
];

/**
 * Validate feedback submission
 */
const validateFeedback = [
  // Rating validation (required, 1-5)
  body('rating')
    .notEmpty().withMessage('Rating is required')
    .isInt({ min: 1, max: 5 }).withMessage('Rating must be an integer between 1 and 5'),
  
  // Category validation (required, must be in allowed list)
  body('category')
    .notEmpty().withMessage('Category is required')
    .isIn(FEEDBACK_CATEGORIES).withMessage(`Category must be one of: ${FEEDBACK_CATEGORIES.join(', ')}`),
  
  // Comment validation (optional, max length)
  body('comment')
    .optional()
    .trim()
    .isLength({ max: 2000 }).withMessage('Comment cannot exceed 2000 characters')
    .escape(), // Sanitize to prevent XSS
  
  // Anonymous flag (optional boolean)
  body('isAnonymous')
    .optional()
    .isBoolean().withMessage('isAnonymous must be a boolean value')
    .toBoolean(),
  
  // Wants reply flag (optional boolean)
  body('wantsReply')
    .optional()
    .isBoolean().withMessage('wantsReply must be a boolean value')
    .toBoolean(),
  
  // Contact email (required if wantsReply is true and not anonymous)
  body('contactEmail')
    .optional()
    .custom((value, { req }) => {
      // If user wants a reply and is not anonymous, email is required
      if (req.body.wantsReply === true && req.body.isAnonymous !== true) {
        if (!value) {
          throw new Error('Contact email is required when you want a reply and are not anonymous');
        }
      }
      return true;
    })
    .if(body('contactEmail').exists())
    .isEmail().withMessage('Please provide a valid email address')
    .normalizeEmail(),
  
  // Custom validation to ensure consistency between fields
  body('isAnonymous').custom((value, { req }) => {
    // If anonymous, can't provide voter info or request reply with email
    if (value === true) {
      if (req.body.wantsReply === true) {
        throw new Error('Cannot request reply when submitting anonymously');
      }
    }
    return true;
  })
];

/**
 * Validate feedback ID parameter
 */
const validateFeedbackId = [
  param('id')
    .notEmpty().withMessage('Feedback ID is required')
    .isMongoId().withMessage('Invalid feedback ID format')
];

/**
 * Validate feedback status update
 */
const validateFeedbackStatus = [
  param('id')
    .notEmpty().withMessage('Feedback ID is required')
    .isMongoId().withMessage('Invalid feedback ID format'),
  
  body('status')
    .notEmpty().withMessage('Status is required')
    .isIn(['new', 'in-review', 'resolved', 'archived'])
    .withMessage('Status must be one of: new, in-review, resolved, archived'),
  
  body('adminNotes')
    .optional()
    .trim()
    .isLength({ max: 1000 }).withMessage('Admin notes cannot exceed 1000 characters')
];

/**
 * Validate bulk update operation
 */
const validateBulkUpdate = [
  body('feedbackIds')
    .notEmpty().withMessage('Feedback IDs array is required')
    .isArray({ min: 1 }).withMessage('At least one feedback ID is required'),
  
  body('feedbackIds.*')
    .isMongoId().withMessage('Invalid feedback ID format in array'),
  
  body('status')
    .notEmpty().withMessage('Status is required')
    .isIn(['new', 'in-review', 'resolved', 'archived'])
    .withMessage('Status must be one of: new, in-review, resolved, archived')
];

/**
 * Validate feedback export query parameters
 */
const validateFeedbackExport = [
  query('format')
    .optional()
    .isIn(['json', 'csv']).withMessage('Format must be either json or csv')
];

/**
 * Validate feedback analytics query parameters
 */
const validateFeedbackAnalytics = [
  query('from')
    .optional()
    .isISO8601().withMessage('Invalid date format for "from" parameter'),
  
  query('to')
    .optional()
    .isISO8601().withMessage('Invalid date format for "to" parameter')
    .custom((value, { req }) => {
      if (req.query.from && value) {
        const fromDate = new Date(req.query.from);
        const toDate = new Date(value);
        if (toDate < fromDate) {
          throw new Error('"to" date must be after "from" date');
        }
      }
      return true;
    })
];

/**
 * Validate feedback list query parameters
 */
const validateFeedbackList = [
  query('page')
    .optional()
    .isInt({ min: 1 }).withMessage('Page must be a positive integer')
    .toInt(),
  
  query('limit')
    .optional()
    .isInt({ min: 1, max: 100 }).withMessage('Limit must be between 1 and 100')
    .toInt(),
  
  query('status')
    .optional()
    .isIn(['new', 'in-review', 'resolved', 'archived'])
    .withMessage('Invalid status filter'),
  
  query('category')
    .optional()
    .isIn(FEEDBACK_CATEGORIES)
    .withMessage(`Category must be one of: ${FEEDBACK_CATEGORIES.join(', ')}`),
  
  query('rating')
    .optional()
    .isInt({ min: 1, max: 5 }).withMessage('Rating must be between 1 and 5')
    .toInt(),
  
  query('startDate')
    .optional()
    .isISO8601().withMessage('Invalid start date format'),
  
  query('endDate')
    .optional()
    .isISO8601().withMessage('Invalid end date format')
    .custom((value, { req }) => {
      if (req.query.startDate && value) {
        const startDate = new Date(req.query.startDate);
        const endDate = new Date(value);
        if (endDate < startDate) {
          throw new Error('End date must be after start date');
        }
      }
      return true;
    }),
  
  query('search')
    .optional()
    .trim()
    .isLength({ min: 2 }).withMessage('Search term must be at least 2 characters')
];

// Export all validation middleware
module.exports = {
  // Voter validations
  validateVoterRegistration,
  
  // Candidate validations
  validateCandidate,
  
  // Vote validations
  validateVote,
  
  // Feedback validations
  validateFeedback,
  validateFeedbackId,
  validateFeedbackStatus,
  validateBulkUpdate,
  validateFeedbackExport,
  validateFeedbackAnalytics,
  validateFeedbackList,
  
  // Export constants if needed elsewhere
  FEEDBACK_CATEGORIES
};