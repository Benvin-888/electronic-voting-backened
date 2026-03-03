// models/Vote.js
const mongoose = require('mongoose');

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
    enum: ['webauthn', 'manual'],
    default: 'webauthn'
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

module.exports = mongoose.model('Vote', voteSchema);