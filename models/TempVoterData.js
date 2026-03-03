// models/TempVoterData.js
const mongoose = require('mongoose');

const tempVoterSchema = new mongoose.Schema({
  token: {
    type: String,
    required: true,
    unique: true
    // Remove index: true - unique creates index automatically
  },
  nationalId: {
    type: String,
    required: true,
    trim: true
    // Remove index: true - we'll create composite index below
  },
  fullName: {
    type: String,
    required: true,
    trim: true
  },
  dateOfBirth: {
    type: String,
    trim: true
  },
  surname: {
    type: String,
    trim: true
  },
  givenNames: {
    type: String,
    trim: true
  },
  sex: {
    type: String,
    trim: true
  },
  nationality: {
    type: String,
    trim: true
  },
  placeOfBirth: {
    type: String,
    trim: true
  },
  dateOfExpiry: {
    type: String,
    trim: true
  },
  placeOfIssue: {
    type: String,
    trim: true
  },
  cardSerialNumber: {
    type: String,
    trim: true
  },
  createdAt: {
    type: Date,
    default: Date.now,
    expires: 3600 // automatically delete after 1 hour
  }
});

// Composite indexes - only one index per combination
tempVoterSchema.index({ token: 1 }); // For token lookups
tempVoterSchema.index({ nationalId: 1, createdAt: -1 }); // For checking recent registrations

module.exports = mongoose.model('TempVoterData', tempVoterSchema);