const express = require('express');
const {
  getQuizzes,
  getQuizDetails,
  startQuiz,
  syncAnswer,
  submitQuiz,
  getDailyChallenge,
} = require('../controllers/quizzesController');
const { authenticate } = require('../middleware/auth');
const { validateBody } = require('../middleware/validation');

const router = express.Router();

// Apply auth protection to all Quiz actions
router.use(authenticate);

// Fetch all quizzes list
router.get('/', getQuizzes);

// Get specific Daily Challenge
router.get('/daily-challenge', getDailyChallenge);

// Get single quiz details (checking for active attempts)
router.get('/:id', getQuizDetails);

// Start a quiz (creates a QuizAttempt)
router.post('/start', validateBody(['quizId']), startQuiz);

// Sync intermediate option picks / bookmarks (autosave)
router.post('/attempts/:attemptId/sync', syncAnswer);

// Submit quiz and calculate scores
router.post('/attempts/:attemptId/submit', submitQuiz);

module.exports = router;
