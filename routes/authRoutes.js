const express = require('express');
const router = express.Router();
const {
  adminLogin,
  adminLogout,
  changePassword,
  getCurrentAdmin
} = require('../controllers/authController');

// Admin authentication routes
router.post('/admin/login', adminLogin);
router.post('/admin/logout', adminLogout);
router.put('/admin/change-password', changePassword);
router.get('/admin/me', getCurrentAdmin);

module.exports = router;