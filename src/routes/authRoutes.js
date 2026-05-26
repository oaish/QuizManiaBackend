const express = require('express');
const { register, login, getProfile } = require('../controllers/authController');
const { authenticate } = require('../middleware/auth');
const { validateBody } = require('../middleware/validation');

const router = express.Router();

// Register a new user
router.post(
  '/register',
  validateBody(['name', 'email', 'password']),
  register
);

// Login user
router.post(
  '/login',
  validateBody(['email', 'password']),
  login
);

// Get current user profile (Protected)
router.get(
  '/profile',
  authenticate,
  getProfile
);

module.exports = router;
