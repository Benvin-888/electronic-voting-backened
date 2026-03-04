const mongoose = require('mongoose');

const voteSchema = new mongoose.Schema({
  votingNumber: {
    type: String,
    required: [true, 'Voting number is required'],
    ref: 'Voter',
    index: true
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
    required: [true, 'County is required'],
    default: 'Kirinyaga'
  },
  constituency: {
    type: String,
    required: [true, 'Constituency is required']
  },
  ward: {
    type: String,
    required: [true, 'Ward is required']
  },
  // Tracking fields
  ipAddress: {
    type: String,
    index: true
  },
  userAgent: {
    type: String
  },
  sessionId: {
    type: String,
    index: true
  },
  // Timestamps
  votedAt: {
    type: Date,
    default: Date.now,
    index: true
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Compound indexes
voteSchema.index({ votingNumber: 1, position: 1 }, { unique: true });
voteSchema.index({ candidateId: 1, position: 1 });
voteSchema.index({ constituency: 1, ward: 1 });
voteSchema.index({ votedAt: -1 });

// Virtual for voter info
voteSchema.virtual('voterDetails', {
  ref: 'Voter',
  localField: 'votingNumber',
  foreignField: 'votingNumber',
  justOne: true
});

// Virtual for candidate info
voteSchema.virtual('candidateDetails', {
  ref: 'Candidate',
  localField: 'candidateId',
  foreignField: '_id',
  justOne: true
});

// Statics
voteSchema.statics.getVoteCountByPosition = async function(constituency, ward) {
  const match = {};
  if (constituency) match.constituency = constituency;
  if (ward) match.ward = ward;
  
  return this.aggregate([
    { $match: match },
    {
      $group: {
        _id: '$position',
        count: { $sum: 1 }
      }
    }
  ]);
};

voteSchema.statics.getVotingStats = async function() {
  return this.aggregate([
    {
      $group: {
        _id: null,
        totalVotes: { $sum: 1 }
      }
    },
    {
      $project: {
        _id: 0,
        totalVotes: 1
      }
    }
  ]);
};

const Vote = mongoose.model('Vote', voteSchema);

module.exports = Vote;