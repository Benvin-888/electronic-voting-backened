// models/Vote.js
const mongoose = require('mongoose');

// Check if the model already exists to prevent overwriting
const Vote = mongoose.models.Vote || mongoose.model('Vote', (() => {
  const voteSchema = new mongoose.Schema({
    votingNumber: {
      type: String,
      required: [true, 'Voting number is required'],
      index: true
      // Removed ref: 'Voter' to maintain anonymity - stores hashed value
    },
    position: {
      type: String,
      required: [true, 'Position is required'],
      enum: ['Governor', 'Women Representative', 'MP', 'MCA']
    },
    candidateId: {
      type: mongoose.Schema.Types.ObjectId,
      required: [true, 'Candidate ID is required'],
      ref: 'Candidate'
    },
    county: {
      type: String,
      required: [true, 'County is required']
    },
    constituency: {
      type: String,
      required: [true, 'Constituency is required']
    },
    ward: {
      type: String,
      required: [true, 'Ward is required']
    },
    votedAt: {
      type: Date,
      default: Date.now
    },
    verifiedAt: {
      type: Date,
      default: Date.now
    },
    verificationMethod: {
      type: String,
      enum: ['signature', 'manual'],
      default: 'signature'
    },
    ipAddress: {
      type: String
    },
    userAgent: {
      type: String
    },
    transactionHash: {
      type: String,
      unique: true,
      sparse: true
    }
  }, {
    timestamps: true
  });

  // One vote per position per voter (using hashed voting number)
  voteSchema.index({ votingNumber: 1, position: 1 }, { unique: true });

  // Index for faster queries
  voteSchema.index({ constituency: 1, position: 1 });
  voteSchema.index({ candidateId: 1 });
  voteSchema.index({ votedAt: -1 });

  // Static method to verify vote integrity
  voteSchema.statics.verifyVoteIntegrity = async function(votingNumber, position) {
    try {
      const vote = await this.findOne({ 
        votingNumber: hashVotingNumber(votingNumber), 
        position 
      }).populate('candidateId');
      
      if (!vote) {
        return { valid: false, error: 'Vote not found' };
      }
      
      return {
        valid: true,
        vote: {
          position: vote.position,
          candidate: vote.candidateId?.fullName,
          votedAt: vote.votedAt,
          verifiedAt: vote.verifiedAt,
          verificationMethod: vote.verificationMethod
        }
      };
    } catch (error) {
      return { valid: false, error: error.message };
    }
  };

  // Method to get public vote info (without sensitive data)
  voteSchema.methods.getPublicInfo = function() {
    return {
      position: this.position,
      candidateId: this.candidateId,
      constituency: this.constituency,
      ward: this.ward,
      votedAt: this.votedAt,
      verificationMethod: this.verificationMethod
    };
  };

  // Helper function to hash voting number (matching the one in votingController)
  function hashVotingNumber(votingNumber) {
    const crypto = require('crypto');
    return crypto.createHash('sha256').update(votingNumber).digest('hex');
  }

  return voteSchema;
})());

module.exports = Vote;