const mongoose = require('mongoose');

const candidateSchema = new mongoose.Schema({
  fullName: {
    type: String,
    required: [true, 'Full name is required'],
    trim: true
  },
  position: {
    type: String,
    required: [true, 'Position is required'],
    enum: ['Governor', 'Women Representative', 'MP', 'MCA']
  },
  politicalParty: {
    type: String,
    required: [true, 'Political party is required'],
    trim: true
  },
  county: {
    type: String,
    required: [true, 'County is required'],
    default: 'Kirinyaga'
  },
  constituency: {
    type: String,
    required: function() {
      return this.position === 'MP' || this.position === 'MCA';
    },
    enum: ['Kirinyaga Central', 'Kirinyaga East', 'Mwea', 'Gichugu', 'Ndia', null]
  },
  ward: {
    type: String,
    required: function() {
      return this.position === 'MCA';
    }
  },
  photo: {
    type: String,
    default: ''
  },
  voteCount: {
    type: Number,
    default: 0
  },
  isActive: {
    type: Boolean,
    default: true
  },
  registrationDate: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: true
});

// Prevent duplicate candidates per party/position/area
candidateSchema.index({ 
  position: 1, 
  politicalParty: 1, 
  county: 1, 
  constituency: 1, 
  ward: 1 
}, { 
  unique: true,
  partialFilterExpression: { isActive: true }
});

module.exports = mongoose.model('Candidate', candidateSchema);