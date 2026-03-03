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
  },
  hasVoted: {
    type: Boolean,
    default: false
  },
  votedAt: {
    type: Date
  },
  registrationDate: {
    type: Date,
    default: Date.now
  },
  isActive: {
    type: Boolean,
    default: true
  },
  // ===== NEW REQUIRED FIELDS =====
  signature: {
    type: String,
    required: [true, 'Signature is required'],
    validate: {
      validator: function(v) {
        // Validate base64 image format
        return /^data:image\/(png|jpeg|jpg);base64,/.test(v);
      },
      message: 'Signature must be a valid base64 encoded image'
    }
  },
  webauthnCredential: {
    id: { 
      type: String, 
      required: [true, 'WebAuthn credential ID is required'],
      unique: true,
      sparse: true,
      validate: {
        validator: function(v) {
          // Validate base64url format
          return /^[A-Za-z0-9_-]+$/.test(v);
        },
        message: 'Invalid WebAuthn credential ID format'
      }
    },
    publicKey: { 
      type: String, 
      required: [true, 'WebAuthn public key is required'],
      validate: {
        validator: function(v) {
          // Validate base64url format
          return /^[A-Za-z0-9_-]+$/.test(v);
        },
        message: 'Invalid WebAuthn public key format'
      }
    },
    signCount: { 
      type: Number, 
      default: 0,
      min: [0, 'Sign count cannot be negative']
    },
    deviceName: {
      type: String,
      default: 'Unknown Device'
    },
    lastUsed: {
      type: Date,
      default: Date.now
    }
  },
  // Optional: Track multiple WebAuthn credentials
  webauthnCredentials: [{
    id: { type: String, required: true },
    publicKey: { type: String, required: true },
    signCount: { type: Number, default: 0 },
    deviceName: { type: String },
    registeredAt: { type: Date, default: Date.now },
    lastUsed: { type: Date }
  }]
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

// Method to verify WebAuthn assertion
voterSchema.methods.verifyWebAuthnAssertion = async function(assertion) {
  try {
    const { id, signCount } = this.webauthnCredential;
    
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
      this.webauthnCredential.signCount = assertion.response.authenticatorData.signCount;
      this.webauthnCredential.lastUsed = new Date();
      await this.save();
    }
    
    // In production, you'd verify the cryptographic signature here
    // using the stored public key
    
    return { valid: true };
  } catch (error) {
    return { valid: false, error: error.message };
  }
};

// Method to get public voter info (safe for API responses)
voterSchema.methods.getPublicInfo = function() {
  return {
    id: this._id,
    fullName: this.fullName,
    votingNumber: this.votingNumber,
    constituency: this.constituency,
    ward: this.ward,
    hasVoted: this.hasVoted,
    hasSignature: !!this.signature,
    hasWebAuthn: !!this.webauthnCredential
  };
};

// Index for faster queries
voterSchema.index({ nationalId: 1 });
voterSchema.index({ email: 1 });
voterSchema.index({ votingNumber: 1 });
voterSchema.index({ constituency: 1, ward: 1 });
voterSchema.index({ 'webauthnCredential.id': 1 });

module.exports = mongoose.model('Voter', voterSchema);