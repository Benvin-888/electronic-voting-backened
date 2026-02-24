const mongoose = require('mongoose');

const voteSchema = new mongoose.Schema({
  votingNumber: {
    type: String,
    required: [true, 'Voting number is required'],
    ref: 'Voter'
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
  ipAddress: {
    type: String
  },
  userAgent: {
    type: String
  }
}, {
  timestamps: true
});

// One vote per position per voter
voteSchema.index({ votingNumber: 1, position: 1 }, { unique: true });

module.exports = mongoose.model('Vote', voteSchema);