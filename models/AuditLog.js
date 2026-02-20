const mongoose = require('mongoose');

const auditLogSchema = new mongoose.Schema({
  adminId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Admin'
  },
  action: {
    type: String,
    required: true,
    trim: true
  },
  entity: {
    type: String,
    required: true,
    trim: true
  },
  entityId: {
    type: mongoose.Schema.Types.Mixed
  },
  details: {
    type: mongoose.Schema.Types.Mixed
  },
  ipAddress: {
    type: String
  },
  userAgent: {
    type: String
  },
  timestamp: {
    type: Date,
    default: Date.now,
    immutable: true
  }
}, {
  timestamps: false
});

// Index for faster queries
auditLogSchema.index({ timestamp: -1 });
auditLogSchema.index({ adminId: 1, timestamp: -1 });
auditLogSchema.index({ action: 1, timestamp: -1 });

module.exports = mongoose.model('AuditLog', auditLogSchema);