const express = require('express');
const {
  getDashboardStats,
  bulkUploadQuestions,
  createQuestion,
  updateQuestion,
  deleteQuestion,
  createQuiz,
  updateQuiz,
  deleteQuiz,
  createCategory,
  updateCategory,
  deleteCategory,
  getUsers,
  updateUserRole,
  deleteUser
} = require('../controllers/adminController');
const { authenticate, isAdmin } = require('../middleware/auth');
const { validateBody } = require('../middleware/validation');

const router = express.Router();

// Apply global admin authentications
router.use(authenticate);
router.use(isAdmin);

// Overall analytics metrics
router.get('/stats', getDashboardStats);

// Bulk upload questions
router.post('/questions/bulk', bulkUploadQuestions);

// Questions CRUD
router.post('/questions', validateBody(['questionText', 'categoryId', 'options']), createQuestion);
router.put('/questions/:id', updateQuestion);
router.delete('/questions/:id', deleteQuestion);

// Quizzes CRUD
router.post('/quizzes', validateBody(['title']), createQuiz);
router.put('/quizzes/:id', updateQuiz);
router.delete('/quizzes/:id', deleteQuiz);

// Categories CRUD
router.post('/categories', validateBody(['name']), createCategory);
router.put('/categories/:id', updateCategory);
router.delete('/categories/:id', deleteCategory);

// Users CRUD
router.get('/users', getUsers);
router.put('/users/:id/role', validateBody(['role']), updateUserRole);
router.delete('/users/:id', deleteUser);

module.exports = router;
