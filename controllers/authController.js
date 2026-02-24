const jwt = require('jsonwebtoken');
const Admin = require('../models/Admin');
const config = require('../config');
const auditLogger = require('../utils/auditLogger');

// Generate JWT Token
const generateToken = (id) => {
  return jwt.sign({ id }, config.jwtSecret, {
    expiresIn: config.jwtExpire
  });
};

// @desc    Admin login
// @route   POST /api/v1/auth/admin/login
// @access  Public
const adminLogin = async (req, res, next) => {
  try {
    const { email, password } = req.body;
    const ipAddress = req.ip;
    const userAgent = req.get('User-Agent');

    // Validate email & password
    if (!email || !password) {
      return res.status(400).json({
        success: false,
        error: 'Please provide email and password'
      });
    }

    // Check for admin
    const admin = await Admin.findOne({ email }).select('+password');
    
    if (!admin) {
      await auditLogger.log(null, 'LOGIN_FAILED', 'Admin', null, {
        email,
        ipAddress,
        userAgent,
        reason: 'Invalid email'
      });
      
      return res.status(401).json({
        success: false,
        error: 'Invalid credentials'
      });
    }

    // Check if admin is active
    if (!admin.isActive) {
      await auditLogger.log(null, 'LOGIN_FAILED', 'Admin', admin._id, {
        email,
        ipAddress,
        userAgent,
        reason: 'Account disabled'
      });
      
      return res.status(401).json({
        success: false,
        error: 'Account is disabled. Please contact system administrator.'
      });
    }

    // Check password
    const isPasswordMatch = await admin.comparePassword(password);
    
    if (!isPasswordMatch) {
      await auditLogger.log(null, 'LOGIN_FAILED', 'Admin', admin._id, {
        email,
        ipAddress,
        userAgent,
        reason: 'Invalid password'
      });
      
      return res.status(401).json({
        success: false,
        error: 'Invalid credentials'
      });
    }

    // Update last login
    admin.lastLogin = new Date();
    await admin.save();

    // Create token
    const token = generateToken(admin._id);

    // Log successful login
    await auditLogger.log(admin._id, 'LOGIN_SUCCESS', 'Admin', admin._id, {
      ipAddress,
      userAgent
    });

    res.status(200).json({
      success: true,
      token,
      data: {
        id: admin._id,
        email: admin.email,
        fullName: admin.fullName,
        role: admin.role,
        lastLogin: admin.lastLogin
      }
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Get current logged in admin
// @route   GET /api/v1/auth/admin/me
// @access  Private (Admin)
const getCurrentAdmin = async (req, res, next) => {
  try {
    const admin = await Admin.findById(req.admin._id);
    
    res.status(200).json({
      success: true,
      data: admin
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Change password
// @route   PUT /api/v1/auth/admin/change-password
// @access  Private (Admin)
const changePassword = async (req, res, next) => {
  try {
    const { currentPassword, newPassword } = req.body;
    
    if (!currentPassword || !newPassword) {
      return res.status(400).json({
        success: false,
        error: 'Please provide current password and new password'
      });
    }
    
    if (newPassword.length < 8) {
      return res.status(400).json({
        success: false,
        error: 'New password must be at least 8 characters'
      });
    }
    
    const admin = await Admin.findById(req.admin._id).select('+password');
    
    // Check current password
    const isPasswordMatch = await admin.comparePassword(currentPassword);
    if (!isPasswordMatch) {
      return res.status(401).json({
        success: false,
        error: 'Current password is incorrect'
      });
    }
    
    // Update password
    admin.password = newPassword;
    await admin.save();
    
    // Log password change
    await auditLogger.log(admin._id, 'PASSWORD_CHANGE', 'Admin', admin._id);
    
    res.status(200).json({
      success: true,
      message: 'Password changed successfully'
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Admin logout
// @route   POST /api/v1/auth/admin/logout
// @access  Private (Admin)
const adminLogout = async (req, res, next) => {
  try {
    await auditLogger.log(req.admin._id, 'LOGOUT', 'Admin', req.admin._id, {
      timestamp: new Date()
    });
    
    res.status(200).json({
      success: true,
      message: 'Logged out successfully'
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  adminLogin,
  adminLogout,
  changePassword,
  getCurrentAdmin
};