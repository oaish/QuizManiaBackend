const prisma = require('../config/db');

/**
 * Retrieve system-wide usage statistics and metrics for the Admin Dashboard
 */
const getDashboardStats = async (req, res, next) => {
  try {
    const [usersCount, quizzesCount, questionsCount, attemptsCount] = await prisma.$transaction([
      prisma.user.count({ where: { role: 'user' } }),
      prisma.quiz.count(),
      prisma.question.count(),
      prisma.quizAttempt.count({ where: { status: 'COMPLETED' } }),
    ]);

    // Calculate system averages
    const results = await prisma.quizResult.findMany({
      select: { totalScore: true, accuracy: true }
    });

    let avgScore = 0.0;
    let avgAccuracy = 0.0;
    if (results.length > 0) {
      const scoreSum = results.reduce((acc, r) => acc + r.totalScore, 0);
      const accSum = results.reduce((acc, r) => acc + r.accuracy, 0);
      avgScore = scoreSum / results.length;
      avgAccuracy = accSum / results.length;
    }

    // Fetch quiz completions chart data (Attempts per quiz)
    const quizzesWithAttempts = await prisma.quiz.findMany({
      include: {
        _count: { select: { attempts: { where: { status: 'COMPLETED' } } } }
      }
    });

    const quizPopularity = quizzesWithAttempts.map(quiz => ({
      quizId: quiz.id,
      title: quiz.title,
      attemptsCount: quiz._count.attempts
    }));

    return res.status(200).json({
      success: true,
      stats: {
        totalUsers: usersCount,
        totalQuizzes: quizzesCount,
        totalQuestions: questionsCount,
        totalCompletedAttempts: attemptsCount,
        averageScore: parseFloat(avgScore.toFixed(2)),
        averageAccuracy: parseFloat(avgAccuracy.toFixed(2))
      },
      chartData: {
        quizPopularity
      }
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Bulk upload questions via JSON payload
 */
const bulkUploadQuestions = async (req, res, next) => {
  try {
    const questions = req.body; // Expecting array of question objects

    if (!Array.isArray(questions) || questions.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Invalid payload. Expecting a non-empty array of questions.'
      });
    }

    let insertedCount = 0;
    const errors = [];

    // Process questions one-by-one inside a loop
    for (let index = 0; index < questions.length; index++) {
      const q = questions[index];
      
      try {
        // Validate required fields
        if (!q.question || !q.options || !Array.isArray(q.options) || q.options.length < 2) {
          throw new Error('Question text or valid options array missing.');
        }

        // 1. Resolve Category (by slug or name)
        let categoryId;
        if (q.category) {
          const categorySlug = q.category.toLowerCase().replace(/[^a-z0-9]+/g, '-');
          let category = await prisma.category.findUnique({ where: { slug: categorySlug } });
          if (!category) {
            // Auto create category if not found
            category = await prisma.category.create({
              data: {
                name: q.category,
                slug: categorySlug,
                description: `Auto-created during bulk upload of question #${index + 1}`
              }
            });
          }
          categoryId = category.id;
        } else {
          // Default to Quantitative category if none provided
          const defaultCat = await prisma.category.findFirst();
          categoryId = defaultCat.id;
        }

        // 2. Create the main question record
        const createdQuestion = await prisma.question.create({
          data: {
            questionText: q.question,
            explanation: q.explanation || '',
            difficulty: q.difficulty || 'medium',
            categoryId,
            marks: parseFloat(q.marks) || 1.0,
            negativeMarks: parseFloat(q.negativeMarks) || 0.25,
            timeLimit: parseInt(q.timeLimit) || 60,
            type: q.type || 'mcq',
          }
        });

        // 3. Create options
        const correctIndex = parseInt(q.correctAnswer) || 0;
        for (let i = 0; i < q.options.length; i++) {
          await prisma.option.create({
            data: {
              questionId: createdQuestion.id,
              optionText: q.options[i],
              isCorrect: i === correctIndex
            }
          });
        }

        // 4. Resolve and create company relations
        if (q.companyTags && Array.isArray(q.companyTags)) {
          for (const compName of q.companyTags) {
            const compSlug = compName.toLowerCase().replace(/[^a-z0-9]+/g, '-');
            let company = await prisma.company.findUnique({ where: { slug: compSlug } });
            if (!company) {
              company = await prisma.company.create({
                data: { name: compName, slug: compSlug }
              });
            }
            await prisma.questionCompany.create({
              data: {
                questionId: createdQuestion.id,
                companyId: company.id
              }
            });
          }
        }

        // 5. Resolve and create tag relations
        if (q.tags && Array.isArray(q.tags)) {
          for (const tagName of q.tags) {
            const tagSlug = tagName.toLowerCase().replace(/[^a-z0-9]+/g, '-');
            let tag = await prisma.tag.findUnique({ where: { slug: tagSlug } });
            if (!tag) {
              tag = await prisma.tag.create({
                data: { name: tagName, slug: tagSlug }
              });
            }
            await prisma.questionTag.create({
              data: {
                questionId: createdQuestion.id,
                tagId: tag.id
              }
            });
          }
        }

        insertedCount++;
      } catch (err) {
        errors.push({
          index,
          questionText: q.question || 'Unknown',
          error: err.message
        });
      }
    }

    return res.status(200).json({
      success: true,
      message: `Bulk upload finished. Successfully inserted ${insertedCount} questions.`,
      insertedCount,
      failedCount: errors.length,
      errors
    });
  } catch (error) {
    next(error);
  }
};

// ==========================================
// QUESTIONS CRUD
// ==========================================

const createQuestion = async (req, res, next) => {
  try {
    const { questionText, explanation, difficulty, categoryId, marks, negativeMarks, timeLimit, options, companyTags, tags } = req.body;

    const newQuestion = await prisma.question.create({
      data: {
        questionText,
        explanation,
        difficulty,
        categoryId: parseInt(categoryId),
        marks: parseFloat(marks) || 1.0,
        negativeMarks: parseFloat(negativeMarks) || 0.0,
        timeLimit: parseInt(timeLimit) || 60,
      }
    });

    // Create Options
    if (options && Array.isArray(options)) {
      for (const opt of options) {
        await prisma.option.create({
          data: {
            questionId: newQuestion.id,
            optionText: opt.optionText,
            isCorrect: !!opt.isCorrect,
          }
        });
      }
    }

    // Companies link
    if (companyTags && Array.isArray(companyTags)) {
      for (const compId of companyTags) {
        await prisma.questionCompany.create({
          data: { questionId: newQuestion.id, companyId: parseInt(compId) }
        });
      }
    }

    // Tags link
    if (tags && Array.isArray(tags)) {
      for (const tagId of tags) {
        await prisma.questionTag.create({
          data: { questionId: newQuestion.id, tagId: parseInt(tagId) }
        });
      }
    }

    return res.status(201).json({ success: true, message: 'Question created successfully.', data: newQuestion });
  } catch (error) {
    next(error);
  }
};

const updateQuestion = async (req, res, next) => {
  try {
    const id = parseInt(req.params.id);
    const { questionText, explanation, difficulty, categoryId, marks, negativeMarks, timeLimit, options, companyTags, tags } = req.body;

    // Update main fields
    const updated = await prisma.question.update({
      where: { id },
      data: {
        questionText,
        explanation,
        difficulty,
        categoryId: categoryId ? parseInt(categoryId) : undefined,
        marks: marks ? parseFloat(marks) : undefined,
        negativeMarks: negativeMarks ? parseFloat(negativeMarks) : undefined,
        timeLimit: timeLimit ? parseInt(timeLimit) : undefined,
      }
    });

    // Clean options and replace
    if (options && Array.isArray(options)) {
      await prisma.option.deleteMany({ where: { questionId: id } });
      for (const opt of options) {
        await prisma.option.create({
          data: {
            questionId: id,
            optionText: opt.optionText,
            isCorrect: !!opt.isCorrect,
          }
        });
      }
    }

    // Clean company tags and replace
    if (companyTags && Array.isArray(companyTags)) {
      await prisma.questionCompany.deleteMany({ where: { questionId: id } });
      for (const compId of companyTags) {
        await prisma.questionCompany.create({
          data: { questionId: id, companyId: parseInt(compId) }
        });
      }
    }

    // Clean tags and replace
    if (tags && Array.isArray(tags)) {
      await prisma.questionTag.deleteMany({ where: { questionId: id } });
      for (const tagId of tags) {
        await prisma.questionTag.create({
          data: { questionId: id, tagId: parseInt(tagId) }
        });
      }
    }

    return res.status(200).json({ success: true, message: 'Question updated successfully.', data: updated });
  } catch (error) {
    next(error);
  }
};

const deleteQuestion = async (req, res, next) => {
  try {
    const id = parseInt(req.params.id);
    await prisma.question.delete({ where: { id } });
    return res.status(200).json({ success: true, message: 'Question deleted successfully.' });
  } catch (error) {
    next(error);
  }
};

// ==========================================
// QUIZZES CRUD
// ==========================================

const createQuiz = async (req, res, next) => {
  try {
    const { title, description, categoryId, timeLimit, isDailyChallenge, questionIds } = req.body;

    const newQuiz = await prisma.quiz.create({
      data: {
        title,
        description,
        categoryId: categoryId ? parseInt(categoryId) : null,
        timeLimit: parseInt(timeLimit) || 1800,
        isDailyChallenge: !!isDailyChallenge,
      }
    });

    // Link selected questions to this quiz
    if (questionIds && Array.isArray(questionIds)) {
      await prisma.question.updateMany({
        where: { id: { in: questionIds.map(id => parseInt(id)) } },
        data: { quizId: newQuiz.id }
      });
    }

    return res.status(201).json({ success: true, message: 'Quiz created successfully.', data: newQuiz });
  } catch (error) {
    next(error);
  }
};

const updateQuiz = async (req, res, next) => {
  try {
    const id = parseInt(req.params.id);
    const { title, description, categoryId, timeLimit, isDailyChallenge, questionIds } = req.body;

    const updated = await prisma.quiz.update({
      where: { id },
      data: {
        title,
        description,
        categoryId: categoryId !== undefined ? (categoryId ? parseInt(categoryId) : null) : undefined,
        timeLimit: timeLimit ? parseInt(timeLimit) : undefined,
        isDailyChallenge: isDailyChallenge !== undefined ? !!isDailyChallenge : undefined,
      }
    });

    if (questionIds && Array.isArray(questionIds)) {
      // Dissolve old associations
      await prisma.question.updateMany({
        where: { quizId: id },
        data: { quizId: null }
      });
      // Establish new associations
      await prisma.question.updateMany({
        where: { id: { in: questionIds.map(qid => parseInt(qid)) } },
        data: { quizId: id }
      });
    }

    return res.status(200).json({ success: true, message: 'Quiz updated successfully.', data: updated });
  } catch (error) {
    next(error);
  }
};

const deleteQuiz = async (req, res, next) => {
  try {
    const id = parseInt(req.params.id);
    await prisma.quiz.delete({ where: { id } });
    return res.status(200).json({ success: true, message: 'Quiz deleted successfully.' });
  } catch (error) {
    next(error);
  }
};

// ==========================================
// CATEGORIES CRUD
// ==========================================

const createCategory = async (req, res, next) => {
  try {
    const { name, description } = req.body;
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-');

    const newCategory = await prisma.category.create({
      data: { name, slug, description }
    });

    return res.status(201).json({ success: true, message: 'Category created successfully.', data: newCategory });
  } catch (error) {
    next(error);
  }
};

const updateCategory = async (req, res, next) => {
  try {
    const id = parseInt(req.params.id);
    const { name, description } = req.body;

    const updated = await prisma.category.update({
      where: { id },
      data: {
        name,
        slug: name ? name.toLowerCase().replace(/[^a-z0-9]+/g, '-') : undefined,
        description
      }
    });

    return res.status(200).json({ success: true, message: 'Category updated successfully.', data: updated });
  } catch (error) {
    next(error);
  }
};

const deleteCategory = async (req, res, next) => {
  try {
    const id = parseInt(req.params.id);
    await prisma.category.delete({ where: { id } });
    return res.status(200).json({ success: true, message: 'Category deleted successfully.' });
  } catch (error) {
    next(error);
  }
};

// ==========================================
// USERS CRUD
// ==========================================

const getUsers = async (req, res, next) => {
  try {
    const users = await prisma.user.findMany({
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' }
    });

    return res.status(200).json({ success: true, data: users });
  } catch (error) {
    next(error);
  }
};

const updateUserRole = async (req, res, next) => {
  try {
    const id = parseInt(req.params.id);
    const { role } = req.body; // Expecting 'admin' or 'user'

    const updated = await prisma.user.update({
      where: { id },
      data: { role },
      select: { id: true, name: true, role: true }
    });

    return res.status(200).json({ success: true, message: 'User role updated successfully.', data: updated });
  } catch (error) {
    next(error);
  }
};

const deleteUser = async (req, res, next) => {
  try {
    const id = parseInt(req.params.id);
    await prisma.user.delete({ where: { id } });
    return res.status(200).json({ success: true, message: 'User deleted successfully.' });
  } catch (error) {
    next(error);
  }
};

module.exports = {
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
};
