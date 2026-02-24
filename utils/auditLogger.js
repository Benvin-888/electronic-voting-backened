const AuditLog = require('../models/AuditLog');

const auditLogger = {
  log: async (adminId, action, entity, entityId, details = {}) => {
    try {
      await AuditLog.create({
        adminId,
        action,
        entity,
        entityId,
        details,
        timestamp: new Date()
      });
    } catch (error) {
      console.error('Failed to log audit trail:', error);
    }
  },
  
  getLogs: async (filters = {}, page = 1, limit = 50) => {
    const skip = (page - 1) * limit;
    
    const query = {};
    
    if (filters.adminId) query.adminId = filters.adminId;
    if (filters.action) query.action = filters.action;
    if (filters.entity) query.entity = filters.entity;
    if (filters.startDate || filters.endDate) {
      query.timestamp = {};
      if (filters.startDate) query.timestamp.$gte = new Date(filters.startDate);
      if (filters.endDate) query.timestamp.$lte = new Date(filters.endDate);
    }
    
    const logs = await AuditLog.find(query)
      .sort({ timestamp: -1 })
      .skip(skip)
      .limit(limit)
      .populate('adminId', 'email fullName');
    
    const total = await AuditLog.countDocuments(query);
    
    return {
      logs,
      total,
      pages: Math.ceil(total / limit),
      currentPage: page
    };
  },
  
  getSuspiciousActivity: async () => {
    // Look for multiple failed login attempts in short period
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    
    const suspiciousLogs = await AuditLog.aggregate([
      {
        $match: {
          action: 'LOGIN_FAILED',
          timestamp: { $gte: oneHourAgo }
        }
      },
      {
        $group: {
          _id: { ipAddress: '$details.ipAddress' },
          count: { $sum: 1 },
          lastAttempt: { $max: '$timestamp' },
          attempts: { $push: '$$ROOT' }
        }
      },
      {
        $match: {
          count: { $gt: 3 } // More than 3 failed attempts in an hour
        }
      }
    ]);
    
    return suspiciousLogs;
  }
};

module.exports = auditLogger;