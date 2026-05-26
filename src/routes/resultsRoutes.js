const express = require('express');
const {
  getAttemptResult,
  getUserDashboardData,
  getLeaderboard
} = require('../controllers/resultsController');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

router.use(authenticate);

// Fetch user dashboard analytics, attempts history, and bookmarks
router.get('/dashboard', getUserDashboardData);

// Fetch global leaderboard rankings
router.get('/leaderboard', getLeaderboard);

// Fetch detailed answers review sheet for a completed attempt
router.get('/attempts/:attemptId', getAttemptResult);

module.exports = router;
