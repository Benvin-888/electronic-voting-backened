const Voter = require('../models/Voter');
const Candidate = require('../models/Candidate');
const Vote = require('../models/Vote');
const SystemSetting = require('../models/SystemSetting');
const { sendVoteConfirmationEmail } = require('../utils/emailService');
const auditLogger = require('../utils/auditLogger');
const config = require('../config');

// @desc    Check voting eligibility
// @route   GET /api/v1/voting/eligibility/:votingNumber
// @access  Public
const checkEligibility = async (req, res, next) => {
  try {
    const { votingNumber } = req.params;

    // Check if voting portal is open
    const portalStatus = await SystemSetting.findOne({ key: 'voting_portal_open' });
    if (!portalStatus || !portalStatus.value) {
      return res.status(400).json({
        success: false,
        error: 'Voting portal is currently closed'
      });
    }

    // Find voter
    const voter = await Voter.findOne({ votingNumber, isActive: true });
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

    // Get eligible candidates
    const eligibleCandidates = await getEligibleCandidates(voter);

    res.status(200).json({
      success: true,
      data: {
        voter: {
          fullName: voter.fullName,
          constituency: voter.constituency,
          ward: voter.ward
        },
        eligibleCandidates,
        votingDeadline: await getVotingDeadline()
      }
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Submit vote
// @route   POST /api/v1/voting/submit
// @access  Public
const submitVote = async (req, res, next) => {
  try {
    const { votingNumber, votes } = req.body;
    const ipAddress = req.ip;
    const userAgent = req.get('User-Agent');

    // Validate input
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

    // Find voter
    const voter = await Voter.findOne({ votingNumber, isActive: true });
    if (!voter) {
      return res.status(404).json({
        success: false,
        error: 'Invalid voting number'
      });
    }

    if (voter.hasVoted) {
      return res.status(400).json({
        success: false,
        error: 'This voting number has already been used'
      });
    }

    // Validate votes structure
    const requiredPositions = ['Governor', 'Women Representative', 'MP', 'MCA'];
    const votedPositions = votes.map(v => v.position);
    
    // Check for duplicate positions
    const uniquePositions = [...new Set(votedPositions)];
    if (uniquePositions.length !== votedPositions.length) {
      return res.status(400).json({
        success: false,
        error: 'Duplicate positions in vote submission'
      });
    }

    // Validate all required positions are present
    for (const position of requiredPositions) {
      if (!votedPositions.includes(position)) {
        return res.status(400).json({
          success: false,
          error: `Missing vote for position: ${position}`
        });
      }
    }

    // Process each vote
    const votePromises = votes.map(async (vote) => {
      // Validate candidate
      const candidate = await Candidate.findById(vote.candidateId);
      if (!candidate || !candidate.isActive) {
        throw new Error(`Invalid candidate for ${vote.position}`);
      }

      // Validate candidate is eligible for voter's area
      if (!isCandidateEligible(candidate, voter, vote.position)) {
        throw new Error(`Candidate ${candidate.fullName} is not eligible for ${vote.position} in your area`);
      }

      // Create vote record
      const voteRecord = await Vote.create({
        votingNumber,
        position: vote.position,
        candidateId: vote.candidateId,
        county: voter.county,
        constituency: voter.constituency,
        ward: voter.ward,
        ipAddress,
        userAgent
      });

      // Update candidate vote count
      await Candidate.findByIdAndUpdate(vote.candidateId, {
        $inc: { voteCount: 1 }
      });

      return voteRecord;
    });

    await Promise.all(votePromises);

    // Mark voter as voted
    voter.hasVoted = true;
    await voter.save();

    // Send confirmation email
    await sendVoteConfirmationEmail(voter);

    // Log the vote (without voter identification)
    await auditLogger.log(null, 'VOTE', 'Vote', null, {
      constituency: voter.constituency,
      ward: voter.ward,
      positions: votes.map(v => v.position)
    });

    // Emit vote update via Socket.io
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
        positions: votes.map(v => v.position)
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
  }).select('fullName politicalParty photo');

  // Women Representative (county-wide)
  eligibleCandidates['Women Representative'] = await Candidate.find({
    position: 'Women Representative',
    county: 'Kirinyaga',
    isActive: true
  }).select('fullName politicalParty photo');

  // MP (constituency)
  eligibleCandidates.MP = await Candidate.find({
    position: 'MP',
    constituency: voter.constituency,
    isActive: true
  }).select('fullName politicalParty photo');

  // MCA (ward)
  eligibleCandidates.MCA = await Candidate.find({
    position: 'MCA',
    constituency: voter.constituency,
    ward: voter.ward,
    isActive: true
  }).select('fullName politicalParty photo');

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
  submitVote
};