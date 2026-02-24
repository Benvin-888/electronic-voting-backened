const mongoose = require('mongoose');

const tempVoterSchema = new mongoose.Schema({
  token: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  nationalId: {
    type: String,
    required: true,
    trim: true,
    index: true
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
  createdAt: {
    type: Date,
    default: Date.now,
    expires: 3600 // automatically delete after 1 hour
  }
});

tempVoterSchema.index({ nationalId: 1, createdAt: -1 });

module.exports = mongoose.model('TempVoterData', tempVoterSchema);
