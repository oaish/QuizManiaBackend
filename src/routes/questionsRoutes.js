const express = require('express');
const { getQuestions, getQuestionById, toggleBookmark, getFilters } = require('../controllers/questionsController');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

// Get list of filter values (Categories, Companies, Tags)
router.get('/filters', getFilters);

// List all questions (filtered & paginated)
router.get('/', getQuestions);

// Fetch a single question by id
router.get('/:id', getQuestionById);

// Toggle bookmark on a question (Protected)
router.post('/:id/bookmark', authenticate, toggleBookmark);

module.exports = router;
