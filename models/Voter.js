// models/Voter.js
const mongoose = require('mongoose');
const validator = require('validator');

const voterSchema = new mongoose.Schema({
  nationalId: {
    type: String,
    required: [true, 'National ID is required'],
    unique: true,
    trim: true,
    minlength: [7, 'National ID must be at least 7 characters'],
    maxlength: [10, 'National ID cannot exceed 10 characters']
    // Remove index: true - unique creates index automatically
  },
  fullName: {
    type: String,
    required: [true, 'Full name is required'],
    trim: true
  },
  email: {
    type: String,
    required: [true, 'Email is required'],
    unique: true,
    lowercase: true,
    trim: true,
    validate: [validator.isEmail, 'Please provide a valid email']
    // Remove index: true - unique creates index automatically
  },
  phoneNumber: {
    type: String,
    required: [true, 'Phone number is required'],
    trim: true,
    validate: {
      validator: function(v) {
        return /^[0-9]{10}$/.test(v);
      },
      message: 'Phone number must be 10 digits'
    }
  },
  county: {
    type: String,
    default: 'Kirinyaga',
    enum: ['Kirinyaga']
  },
  constituency: {
    type: String,
    required: [true, 'Constituency is required'],
    enum: ['Kirinyaga Central', 'Kirinyaga East', 'Mwea', 'Gichugu', 'Ndia']
  },
  ward: {
    type: String,
    required: [true, 'Ward is required']
  },
  votingNumber: {
    type: String,
    unique: true,
    sparse: true
    // Remove index: true - unique creates index automatically
  },
  hasVoted: {
    type: Boolean,
    default: false
  },
  registrationDate: {
    type: Date,
    default: Date.now
  },
  isActive: {
    type: Boolean,
    default: true
  },
  // Signature field
  signature: {
    type: String,
    required: [true, 'Signature is required'],
    validate: {
      validator: function(v) {
        return /^data:image\/(png|jpeg|jpg);base64,/.test(v);
      },
      message: 'Signature must be a valid base64 encoded image'
    }
  }
}, {
  timestamps: true
});

// Pre-save middleware to generate voting number
voterSchema.pre('save', async function(next) {
  if (!this.votingNumber) {
    const generateVotingNumber = require('../utils/generateVotingNumber');
    this.votingNumber = generateVotingNumber(this);
  }
  next();
});

// Method to get public voter info (safe for API responses)
voterSchema.methods.getPublicInfo = function() {
  return {
    id: this._id,
    fullName: this.fullName,
    votingNumber: this.votingNumber,
    constituency: this.constituency,
    ward: this.ward,
    hasVoted: this.hasVoted,
    hasSignature: !!this.signature
  };
};

// Keep only these indexes - remove duplicates
voterSchema.index({ constituency: 1, ward: 1 });
voterSchema.index({ registrationDate: -1 });
voterSchema.index({ hasVoted: 1 });

module.exports = mongoose.model('Voter', voterSchema);