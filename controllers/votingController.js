// controllers/votingController.js
const Voter = require('../models/Voter');
const Candidate = require('../models/Candidate');
const Vote = require('../models/Vote');
const SystemSetting = require('../models/SystemSetting');
const { sendVoteConfirmationEmail } = require('../utils/emailService');
const auditLogger = require('../utils/auditLogger');
const config = require('../config');
const crypto = require('crypto');

// Helper: Hash voting number for storage (one-way hash)
const hashVotingNumber = (votingNumber) => {
  return crypto.createHash('sha256').update(votingNumber).digest('hex');
};

// Helper: Verify WebAuthn assertion
const verifyWebAuthnAssertion = async (voter, assertion) => {
  try {
    if (!voter.webauthnCredential) {
      return { valid: false, error: 'Voter does not have WebAuthn registered' };
    }

    const { id, signCount } = voter.webauthnCredential;
    
    // Check if credential ID matches
    if (assertion.id !== id) {
      return { valid: false, error: 'Credential ID mismatch' };
    }
    
    // Verify sign count to prevent replay attacks
    if (assertion.response.authenticatorData.signCount !== 0) {
      if (assertion.response.authenticatorData.signCount <= signCount) {
        return { valid: false, error: 'Sign count error - possible replay attack' };
      }
      
      // Update sign count
      voter.webauthnCredential.signCount = assertion.response.authenticatorData.signCount;
      voter.webauthnCredential.lastUsed = new Date();
      await voter.save();
    }
    
    // In production, you'd verify the cryptographic signature here
    // using the stored public key
    
    return { valid: true };
  } catch (error) {
    return { valid: false, error: error.message };
  }
};

// @desc    Check voting eligibility (Step 1 - Enter voting number)
// @route   POST /api/v1/voting/check-eligibility
// @access  Public
const checkEligibility = async (req, res, next) => {
  try {
    const { votingNumber } = req.body;

    if (!votingNumber) {
      return res.status(400).json({
        success: false,
        error: 'Voting number is required'
      });
    }

    // Check if voting portal is open
    const portalStatus = await SystemSetting.findOne({ key: 'voting_portal_open' });
    if (!portalStatus || !portalStatus.value) {
      return res.status(400).json({
        success: false,
        error: 'Voting portal is currently closed'
      });
    }

    // Find voter by voting number
    const voter = await Voter.findOne({ votingNumber, isActive: true }).select(
      '_id fullName constituency ward hasVoted webauthnCredential votingNumber'
    );
    
    if (!voter) {
      return res.status(404).json({
        success: false,
        error: 'Invalid voting number'
      });
    }

    // Check if already voted
    if (voter.hasVoted) {
      return res.status(400).json({
        success: false,
        error: 'This voting number has already been used'
      });
    }

    // Check if voter has WebAuthn registered
    if (!voter.webauthnCredential) {
      return res.status(400).json({
        success: false,
        error: 'Voter does not have biometric authentication registered. Please contact administrator.'
      });
    }

    // Return voter info for WebAuthn verification
    res.status(200).json({
      success: true,
      data: {
        voterId: voter._id,
        fullName: voter.fullName,
        constituency: voter.constituency,
        ward: voter.ward,
        requiresWebAuthn: true,
        credentialId: voter.webauthnCredential.id
      }
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Verify WebAuthn and get eligible candidates (Step 2)
// @route   POST /api/v1/voting/verify-webauthn
// @access  Public
const verifyWebAuthnAndGetCandidates = async (req, res, next) => {
  try {
    const { voterId, assertion } = req.body;

    if (!voterId || !assertion) {
      return res.status(400).json({
        success: false,
        error: 'Voter ID and assertion are required'
      });
    }

    // Find voter
    const voter = await Voter.findById(voterId);
    if (!voter) {
      return res.status(404).json({
        success: false,
        error: 'Voter not found'
      });
    }

    // Check if already voted
    if (voter.hasVoted) {
      return res.status(400).json({
        success: false,
        error: 'This voter has already voted'
      });
    }

    // Verify WebAuthn assertion
    const verification = await verifyWebAuthnAssertion(voter, assertion);

    if (!verification.valid) {
      return res.status(401).json({
        success: false,
        error: verification.error || 'Biometric verification failed'
      });
    }

    // Get eligible candidates
    const eligibleCandidates = await getEligibleCandidates(voter);

    // Log successful verification
    await auditLogger.log(voterId, 'WEBAUTHN_VERIFY_SUCCESS', 'Voter', voter._id, {
      constituency: voter.constituency,
      ward: voter.ward
    });

    res.status(200).json({
      success: true,
      data: {
        voter: {
          id: voter._id,
          fullName: voter.fullName,
          constituency: voter.constituency,
          ward: voter.ward
        },
        eligibleCandidates,
        votingDeadline: await getVotingDeadline()
      }
    });
  } catch (error) {
    console.error('WebAuthn verification error:', error);
    next(error);
  }
};

// @desc    Submit vote (Step 3 - After biometric verification)
// @route   POST /api/v1/voting/submit
// @access  Public
const submitVote = async (req, res, next) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { voterId, votes } = req.body;
    const ipAddress = req.ip;
    const userAgent = req.get('User-Agent');

    // Validate input
    if (!voterId) {
      return res.status(400).json({
        success: false,
        error: 'Voter ID is required'
      });
    }

    if (!votes || !Array.isArray(votes) || votes.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'No votes provided'
      });
    }

    // Check voting portal status
    const portalStatus = await SystemSetting.findOne({ key: 'voting_portal_open' });
    if (!portalStatus || !portalStatus.value) {
      return res.status(400).json({
        success: false,
        error: 'Voting portal is closed'
      });
    }

    // Find voter with session
    const voter = await Voter.findOne({ 
      _id: voterId, 
      isActive: true 
    }).session(session);

    if (!voter) {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({
        success: false,
        error: 'Voter not found'
      });
    }

    if (voter.hasVoted) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({
        success: false,
        error: 'This voter has already voted'
      });
    }

    // Validate votes structure
    const requiredPositions = ['Governor', 'Women Representative', 'MP', 'MCA'];
    const votedPositions = votes.map(v => v.position);
    
    // Check for duplicate positions
    const uniquePositions = [...new Set(votedPositions)];
    if (uniquePositions.length !== votedPositions.length) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({
        success: false,
        error: 'Duplicate positions in vote submission'
      });
    }

    // Validate all required positions are present
    for (const position of requiredPositions) {
      if (!votedPositions.includes(position)) {
        await session.abortTransaction();
        session.endSession();
        return res.status(400).json({
          success: false,
          error: `Missing vote for position: ${position}`
        });
      }
    }

    // Hash the voting number for storage
    const hashedVotingNumber = hashVotingNumber(voter.votingNumber);

    // Process each vote
    const votePromises = votes.map(async (vote) => {
      // Validate candidate
      const candidate = await Candidate.findById(vote.candidateId).session(session);
      if (!candidate || !candidate.isActive) {
        throw new Error(`Invalid candidate for ${vote.position}`);
      }

      // Validate candidate is eligible for voter's area
      if (!isCandidateEligible(candidate, voter, vote.position)) {
        throw new Error(`Candidate ${candidate.fullName} is not eligible for ${vote.position} in your area`);
      }

      // Check if vote for this position already exists (shouldn't happen due to unique index)
      const existingVote = await Vote.findOne({
        votingNumber: hashedVotingNumber,
        position: vote.position
      }).session(session);

      if (existingVote) {
        throw new Error(`Vote already cast for position: ${vote.position}`);
      }

      // Create vote record with hashed voting number
      const voteRecord = await Vote.create([{
        votingNumber: hashedVotingNumber,
        position: vote.position,
        candidateId: vote.candidateId,
        county: voter.county,
        constituency: voter.constituency,
        ward: voter.ward,
        ipAddress,
        userAgent,
        verifiedAt: new Date(),
        verificationMethod: 'webauthn'
      }], { session });

      // Update candidate vote count
      await Candidate.findByIdAndUpdate(
        vote.candidateId, 
        { $inc: { voteCount: 1 } },
        { session }
      );

      return voteRecord[0];
    });

    await Promise.all(votePromises);

    // Mark voter as voted
    voter.hasVoted = true;
    voter.votedAt = new Date();
    await voter.save({ session });

    await session.commitTransaction();
    session.endSession();

    // Send confirmation email (without revealing voting number)
    await sendVoteConfirmationEmail(voter);

    // Log the vote (without voter identification, just hashed identifier)
    await auditLogger.log(null, 'VOTE_CAST', 'Vote', null, {
      hashedVotingNumber: hashedVotingNumber.substring(0, 8) + '...', // Only log partial hash
      constituency: voter.constituency,
      ward: voter.ward,
      positions: votes.map(v => v.position),
      timestamp: new Date()
    });

    // Emit vote update via Socket.io (anonymous)
    if (req.io) {
      req.io.emit('voteUpdate', {
        constituency: voter.constituency,
        ward: voter.ward,
        timestamp: new Date()
      });
    }

    res.status(200).json({
      success: true,
      message: 'Vote submitted successfully',
      data: {
        votedAt: new Date(),
        positions: votes.map(v => v.position),
        receipt: hashedVotingNumber.substring(0, 8) // Partial hash as receipt
      }
    });
  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    
    console.error('Vote submission error:', error);
    
    if (error.message.includes('Invalid candidate')) {
      return res.status(400).json({
        success: false,
        error: error.message
      });
    }
    
    if (error.code === 11000) {
      return res.status(400).json({
        success: false,
        error: 'Duplicate vote detected. You have already voted for this position.'
      });
    }
    
    next(error);
  }
};

// @desc    Get vote receipt (verify vote was counted)
// @route   POST /api/v1/voting/receipt
// @access  Public
const getVoteReceipt = async (req, res, next) => {
  try {
    const { votingNumber } = req.body;

    if (!votingNumber) {
      return res.status(400).json({
        success: false,
        error: 'Voting number is required'
      });
    }

    // Hash the voting number to find votes
    const hashedVotingNumber = hashVotingNumber(votingNumber);

    // Find votes by hashed voting number
    const votes = await Vote.find({ 
      votingNumber: hashedVotingNumber 
    }).populate('candidateId', 'fullName politicalParty');

    if (!votes || votes.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'No votes found for this voting number'
      });
    }

    // Return receipt without revealing voting number
    res.status(200).json({
      success: true,
      data: {
        receipt: hashedVotingNumber.substring(0, 8),
        votedAt: votes[0].votedAt,
        positions: votes.map(v => ({
          position: v.position,
          candidate: v.candidateId?.fullName || 'Unknown',
          party: v.candidateId?.politicalParty || 'Unknown',
          verifiedAt: v.verifiedAt
        }))
      }
    });
  } catch (error) {
    next(error);
  }
};

// Helper function to get eligible candidates
const getEligibleCandidates = async (voter) => {
  const eligibleCandidates = {};

  // Governor (county-wide)
  eligibleCandidates.Governor = await Candidate.find({
    position: 'Governor',
    county: 'Kirinyaga',
    isActive: true
  }).select('fullName politicalParty photo biography');

  // Women Representative (county-wide)
  eligibleCandidates['Women Representative'] = await Candidate.find({
    position: 'Women Representative',
    county: 'Kirinyaga',
    isActive: true
  }).select('fullName politicalParty photo biography');

  // MP (constituency)
  eligibleCandidates.MP = await Candidate.find({
    position: 'MP',
    constituency: voter.constituency,
    isActive: true
  }).select('fullName politicalParty photo biography');

  // MCA (ward)
  eligibleCandidates.MCA = await Candidate.find({
    position: 'MCA',
    constituency: voter.constituency,
    ward: voter.ward,
    isActive: true
  }).select('fullName politicalParty photo biography');

  return eligibleCandidates;
};

// Helper function to check candidate eligibility
const isCandidateEligible = (candidate, voter, position) => {
  switch (position) {
    case 'Governor':
      return candidate.position === 'Governor' && candidate.county === voter.county;
    case 'Women Representative':
      return candidate.position === 'Women Representative' && candidate.county === voter.county;
    case 'MP':
      return candidate.position === 'MP' && candidate.constituency === voter.constituency;
    case 'MCA':
      return candidate.position === 'MCA' && 
             candidate.constituency === voter.constituency && 
             candidate.ward === voter.ward;
    default:
      return false;
  }
};

// Helper function to get voting deadline
const getVotingDeadline = async () => {
  const deadline = await SystemSetting.findOne({ key: 'voting_deadline' });
  return deadline ? deadline.value : null;
};

module.exports = {
  checkEligibility,
  verifyWebAuthnAndGetCandidates,
  submitVote,
  getVoteReceipt
};