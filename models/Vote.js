// models/Vote.js
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
  // New fields for signature verification
  signatureVerified: {
    type: Boolean,
    default: false,
    description: 'Whether the voter signature was verified during voting'
  },
  signatureHash: {
    type: String,
    description: 'Hash of the signature for verification without storing full signature'
  },
  verificationMethod: {
    type: String,
    enum: ['signature', 'biometric', 'manual', 'other'],
    default: 'signature',
    description: 'Method used to verify voter identity'
  },
  verificationTimestamp: {
    type: Date,
    description: 'When the verification was completed'
  },
  // Enhanced tracking fields
  ipAddress: {
    type: String,
    index: true
  },
  userAgent: {
    type: String
  },
  deviceId: {
    type: String,
    description: 'Unique identifier for the device used'
  },
  location: {
    type: {
      type: String,
      enum: ['Point'],
      default: 'Point'
    },
    coordinates: {
      type: [Number], // [longitude, latitude]
      index: '2dsphere'
    },
    accuracy: Number,
    timestamp: Date
  },
  sessionId: {
    type: String,
    description: 'Unique session identifier for this voting session'
  },
  // Audit fields
  verificationAttempts: {
    type: Number,
    default: 1
  },
  previousVerificationFailures: {
    type: Number,
    default: 0
  },
  // Timestamps
  votedAt: {
    type: Date,
    default: Date.now,
    index: true
  }
}, {
  timestamps: true, // Adds createdAt and updatedAt
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Compound indexes for efficient querying
voteSchema.index({ votingNumber: 1, position: 1 }, { unique: true });
voteSchema.index({ candidateId: 1, position: 1 });
voteSchema.index({ constituency: 1, ward: 1 });
voteSchema.index({ votedAt: -1 });
voteSchema.index({ signatureVerified: 1 });
voteSchema.index({ verificationMethod: 1 });

// Index for geospatial queries
voteSchema.index({ location: '2dsphere' });

// Virtual for voter info (populated when needed)
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

// Methods
voteSchema.methods.getVerificationSummary = function() {
  return {
    verified: this.signatureVerified,
    method: this.verificationMethod,
    timestamp: this.verificationTimestamp || this.votedAt
  };
};

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
        count: { $sum: 1 },
        verifiedCount: {
          $sum: { $cond: [{ $eq: ['$signatureVerified', true] }, 1, 0] }
        }
      }
    }
  ]);
};

voteSchema.statics.getVerificationStats = async function() {
  return this.aggregate([
    {
      $group: {
        _id: null,
        totalVotes: { $sum: 1 },
        verifiedVotes: {
          $sum: { $cond: [{ $eq: ['$signatureVerified', true] }, 1, 0] }
        },
        signatureVerification: {
          $sum: { $cond: [{ $eq: ['$verificationMethod', 'signature'] }, 1, 0] }
        },
        manualVerification: {
          $sum: { $cond: [{ $eq: ['$verificationMethod', 'manual'] }, 1, 0] }
        }
      }
    },
    {
      $project: {
        _id: 0,
        totalVotes: 1,
        verifiedVotes: 1,
        verificationRate: {
          $multiply: [
            { $divide: ['$verifiedVotes', '$totalVotes'] },
            100
          ]
        },
        methods: {
          signature: '$signatureVerification',
          manual: '$manualVerification'
        }
      }
    }
  ]);
};

// Pre-save middleware
voteSchema.pre('save', async function(next) {
  // Set verification timestamp if signature is verified
  if (this.signatureVerified && !this.verificationTimestamp) {
    this.verificationTimestamp = new Date();
  }
  
  // Generate a simple hash of the signature if needed (optional)
  // This would require crypto module
  // if (this.signatureHash && !this.signatureHash.startsWith('hash_')) {
  //   const crypto = require('crypto');
  //   this.signatureHash = 'hash_' + crypto.createHash('sha256')
  //     .update(this.signatureHash)
  //     .digest('hex')
  //     .substring(0, 16);
  // }
  
  next();
});

// Post-save middleware for audit logging
voteSchema.post('save', function(doc) {
  // You could trigger events or logging here
  console.log(`Vote recorded for position ${doc.position} at ${doc.votedAt}`);
});

// Create the model
const Vote = mongoose.model('Vote', voteSchema);

// Ensure indexes are created
Vote.createIndexes().catch(error => {
  console.error('Error creating Vote indexes:', error);
});

module.exports = Vote;