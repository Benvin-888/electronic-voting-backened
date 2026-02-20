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
    required: [true, 'Ward is required'],
    validate: {
      validator: function(v) {
        const wardsByConstituency = {
          'Kirinyaga Central': ['Kiamuturi', 'Mutithi', 'Kangai', 'Thiba', 'Wamumu'],
          'Kirinyaga East': ['Kanyeki-Inoi', 'Kerugoya', 'Inoi', 'Mutonguni', 'Kiamaciri'],
          'Mwea': ['Thiba', 'Kangai', 'Mutithi', 'Wamumu', 'Mwea'],
          'Gichugu': ['Ngariama', 'Kanyekini', 'Murinduko', 'Gathigiriri', 'Tebere'],
          'Ndia': ['Baragwi', 'Njukiini', 'Gichugu', 'Mukure', 'Kiaritha']
        };
        return wardsByConstituency[this.constituency]?.includes(v);
      }
    }
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
  registrationDate: {
    type: Date,
    default: Date.now
  },
  isActive: {
    type: Boolean,
    default: true
  }
}, {
  timestamps: true
});

// Pre-save hook to generate voting number
voterSchema.pre('save', async function(next) {
  if (!this.votingNumber) {
    const generateVotingNumber = require('../utils/generateVotingNumber');
    this.votingNumber = generateVotingNumber(this);
  }
  next();
});

module.exports = mongoose.model('Voter', voterSchema);