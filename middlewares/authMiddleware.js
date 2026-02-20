const jwt = require('jsonwebtoken');
const Admin = require('../models/Admin');
const config = require('../config');
const auditLogger = require('../utils/auditLogger');

// Protect routes - Admin authentication
const protect = async (req, res, next) => {
  let token;

  if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
    token = req.headers.authorization.split(' ')[1];
  }

  if (!token) {
    return res.status(401).json({
      success: false,
      error: 'Not authorized to access this route'
    });
  }

  try {
    // Verify token
    const decoded = jwt.verify(token, config.jwtSecret);

    // Get admin from token
    req.admin = await Admin.findById(decoded.id).select('-password');

    if (!req.admin) {
      return res.status(401).json({
        success: false,
        error: 'Not authorized to access this route'
      });
    }

    // Update last login
    req.admin.lastLogin = new Date();
    await req.admin.save();

    next();
  } catch (err) {
    return res.status(401).json({
      success: false,
      error: 'Not authorized to access this route'
    });
  }
};

// Role-based authorization
const authorize = (...roles) => {
  return (req, res, next) => {
    if (!roles.includes(req.admin.role)) {
      return res.status(403).json({
        success: false,
        error: `User role ${req.admin.role} is not authorized to access this route`
      });
    }
    next();
  };
};

module.exports = { protect, authorize };