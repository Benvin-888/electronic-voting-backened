const mongoose = require('mongoose');

const feedbackSchema = new mongoose.Schema({
  rating: {
    type: Number,
    required: [true, 'Rating is required'],
    min: 1,
    max: 5
  },
  category: {
    type: String,
    required: [true, 'Category is required'],
    enum: ['technical', 'complicated', 'suggestion', 'other']
  },
  comment: {
    type: String,
    trim: true,
    maxlength: [500, 'Comment cannot exceed 500 characters']
  },
  isAnonymous: {
    type: Boolean,
    default: true
  },
  // Only populated if not anonymous
  voter: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Voter',
    required: function() {
      return !this.isAnonymous;
    }
  },
  // For non-anonymous users who want reply
  contactEmail: {
    type: String,
    match: [
      /^\w+([\.-]?\w+)*@\w+([\.-]?\w+)*(\.\w{2,3})+$/,
      'Please provide a valid email'
    ],
    required: function() {
      return !this.isAnonymous && this.wantsReply;
    }
  },
  wantsReply: {
    type: Boolean,
    default: false
  },
  // System info (optional, helps debugging)
  systemInfo: {
    userAgent: String,
    platform: String,
    language: String
  },
  // Admin fields
  status: {
    type: String,
    enum: ['new', 'in-review', 'resolved', 'archived'],
    default: 'new'
  },
  adminNotes: {
    type: String,
    trim: true
  },
  // Timestamps
  submittedAt: {
    type: Date,
    default: Date.now
  },
  reviewedAt: Date,
  reviewedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Admin'
  }
}, {
  timestamps: true
});

// Index for faster queries
feedbackSchema.index({ rating: 1 });
feedbackSchema.index({ category: 1 });
feedbackSchema.index({ status: 1 });
feedbackSchema.index({ submittedAt: -1 });
feedbackSchema.index({ isAnonymous: 1 });

module.exports = mongoose.model('Feedback', feedbackSchema);