const crypto = require('crypto');

const generateVotingNumber = (voter) => {
  const timestamp = Date.now().toString(36);
  const random = crypto.randomBytes(3).toString('hex').toUpperCase();
  const countyCode = 'KGY'; // Kirinyaga code
  
  // Create a hash of voter details for uniqueness
  const hashInput = `${voter.nationalId}${voter.constituency}${timestamp}`;
  const hash = crypto.createHash('md5').update(hashInput).digest('hex').substring(0, 4).toUpperCase();
  
  return `${countyCode}-${voter.constituency.substring(0, 3).toUpperCase()}-${random}-${hash}`;
};

module.exports = generateVotingNumber;