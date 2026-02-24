const { body, param, query } = require('express-validator');

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

module.exports = {
  validateVoterRegistration,
  validateCandidate,
  validateVote
};