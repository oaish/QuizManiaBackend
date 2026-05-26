const prisma = require('../config/db');

/**
 * Fetch all available quizzes (e.g. standard quizzes and daily challenge)
 */
const getQuizzes = async (req, res, next) => {
  try {
    const quizzes = await prisma.quiz.findMany({
      include: {
        category: { select: { id: true, name: true, slug: true } },
        _count: { select: { questions: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    return res.status(200).json({
      success: true,
      data: quizzes,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Get single quiz metadata and check if there's an active incomplete attempt
 */
const getQuizDetails = async (req, res, next) => {
  try {
    const quizId = parseInt(req.params.id);
    const userId = req.user.id;

    const quiz = await prisma.quiz.findUnique({
      where: { id: quizId },
      include: {
        category: true,
        _count: { select: { questions: true } },
      },
    });

    if (!quiz) {
      return res.status(404).json({ success: false, message: 'Quiz not found.' });
    }

    // Check for any active (IN_PROGRESS) attempt to resume
    const activeAttempt = await prisma.quizAttempt.findFirst({
      where: {
        quizId,
        userId,
        status: 'IN_PROGRESS',
      },
      include: {
        userAnswers: true,
      },
    });

    return res.status(200).json({
      success: true,
      quiz,
      activeAttempt: activeAttempt ? {
        attemptId: activeAttempt.id,
        remainingTime: activeAttempt.remainingTime,
        answers: activeAttempt.userAnswers.map(ans => ({
          questionId: ans.questionId,
          selectedOptionId: ans.selectedOptionId,
          timeSpent: ans.timeSpent,
          bookmarked: ans.bookmarked,
        })),
      } : null,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Start a new quiz attempt or return the current active one
 */
const startQuiz = async (req, res, next) => {
  try {
    const quizId = parseInt(req.body.quizId);
    const userId = req.user.id;

    // 1. Verify quiz exists
    const quiz = await prisma.quiz.findUnique({
      where: { id: quizId },
      include: {
        questions: {
          include: {
            options: {
              select: { id: true, optionText: true } // Hide isCorrect for anti-cheating during active quiz
            }
          }
        }
      }
    });

    if (!quiz) {
      return res.status(404).json({ success: false, message: 'Quiz not found.' });
    }

    // 2. Check for active attempt to resume
    let attempt = await prisma.quizAttempt.findFirst({
      where: {
        quizId,
        userId,
        status: 'IN_PROGRESS',
      },
      include: {
        userAnswers: true
      }
    });

    if (!attempt) {
      // Create a brand new attempt
      attempt = await prisma.quizAttempt.create({
        data: {
          quizId,
          userId,
          status: 'IN_PROGRESS',
          remainingTime: quiz.timeLimit,
        },
        include: {
          userAnswers: true
        }
      });
    }

    // Randomized questions order
    const questionsList = [...quiz.questions];
    for (let i = questionsList.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [questionsList[i], questionsList[j]] = [questionsList[j], questionsList[i]];
    }

    return res.status(200).json({
      success: true,
      message: 'Quiz started successfully.',
      attemptId: attempt.id,
      remainingTime: attempt.remainingTime,
      quiz: {
        id: quiz.id,
        title: quiz.title,
        description: quiz.description,
        timeLimit: quiz.timeLimit,
      },
      questions: questionsList,
      savedAnswers: attempt.userAnswers.map(ans => ({
        questionId: ans.questionId,
        selectedOptionId: ans.selectedOptionId,
        timeSpent: ans.timeSpent,
        bookmarked: ans.bookmarked,
      })),
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Sync progress during the quiz (autosave answers)
 */
const syncAnswer = async (req, res, next) => {
  try {
    const attemptId = parseInt(req.params.attemptId);
    const { questionId, selectedOptionId, timeSpent, bookmarked, remainingTime } = req.body;
    const userId = req.user.id;

    // 1. Verify attempt belongs to user and is IN_PROGRESS
    const attempt = await prisma.quizAttempt.findUnique({
      where: { id: attemptId }
    });

    if (!attempt || attempt.userId !== userId) {
      return res.status(403).json({ success: false, message: 'Invalid attempt ID or unauthorized.' });
    }

    if (attempt.status !== 'IN_PROGRESS') {
      return res.status(400).json({ success: false, message: 'This quiz attempt has already been submitted.' });
    }

    // 2. Determine correctness of answer (for saving in DB userAnswers)
    let isCorrect = false;
    if (selectedOptionId) {
      const correctOption = await prisma.option.findFirst({
        where: {
          questionId: parseInt(questionId),
          isCorrect: true,
        }
      });
      if (correctOption && correctOption.id === parseInt(selectedOptionId)) {
        isCorrect = true;
      }
    }

    // 3. Upsert answer
    const existingAnswer = await prisma.userAnswer.findFirst({
      where: { attemptId, questionId: parseInt(questionId) }
    });

    if (existingAnswer) {
      await prisma.userAnswer.update({
        where: { id: existingAnswer.id },
        data: {
          selectedOptionId: selectedOptionId ? parseInt(selectedOptionId) : null,
          isCorrect,
          timeSpent: parseInt(timeSpent) || 0,
          bookmarked: bookmarked === undefined ? existingAnswer.bookmarked : bookmarked,
        }
      });
    } else {
      await prisma.userAnswer.create({
        data: {
          attemptId,
          questionId: parseInt(questionId),
          selectedOptionId: selectedOptionId ? parseInt(selectedOptionId) : null,
          isCorrect,
          timeSpent: parseInt(timeSpent) || 0,
          bookmarked: !!bookmarked,
        }
      });
    }

    // 4. Update attempt remaining time
    if (remainingTime !== undefined) {
      await prisma.quizAttempt.update({
        where: { id: attemptId },
        data: { remainingTime: parseInt(remainingTime) }
      });
    }

    return res.status(200).json({
      success: true,
      message: 'Progress successfully saved.'
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Submit quiz attempt and calculate detailed analytics
 */
const submitQuiz = async (req, res, next) => {
  try {
    const attemptId = parseInt(req.params.attemptId);
    const userId = req.user.id;

    // 1. Fetch attempt and answers
    const attempt = await prisma.quizAttempt.findUnique({
      where: { id: attemptId },
      include: {
        quiz: {
          include: {
            questions: {
              include: { options: true }
            }
          }
        },
        userAnswers: true,
      }
    });

    if (!attempt || attempt.userId !== userId) {
      return res.status(403).json({ success: false, message: 'Invalid attempt or unauthorized access.' });
    }

    if (attempt.status === 'COMPLETED') {
      // Find existing result
      const result = await prisma.quizResult.findUnique({ where: { attemptId } });
      return res.status(200).json({
        success: true,
        message: 'This quiz was already submitted.',
        attempt,
        result
      });
    }

    // If quiz is practice (quizId is null), we must construct mock quiz data
    const questions = attempt.quiz ? attempt.quiz.questions : [];

    // Calculate score details
    let totalScore = 0.0;
    let correctCount = 0;
    let incorrectCount = 0;
    let attemptedCount = 0;
    let skippedCount = 0;

    const categoryStats = {}; // To compile performance by category

    // Initialize category tracking
    if (attempt.quiz) {
      const dbCategories = await prisma.category.findMany();
      dbCategories.forEach(cat => {
        categoryStats[cat.id] = {
          name: cat.name,
          slug: cat.slug,
          totalQuestions: 0,
          attempted: 0,
          correct: 0,
          score: 0.0,
        };
      });
    }

    // Traverse all questions and cross-check with synced answers
    for (const q of questions) {
      const userAns = attempt.userAnswers.find(ans => ans.questionId === q.id);

      if (categoryStats[q.categoryId]) {
        categoryStats[q.categoryId].totalQuestions++;
      }

      if (userAns && userAns.selectedOptionId) {
        attemptedCount++;
        if (categoryStats[q.categoryId]) categoryStats[q.categoryId].attempted++;

        // Verify correct option
        const correctOpt = q.options.find(opt => opt.isCorrect);
        const isAnswerCorrect = correctOpt && correctOpt.id === userAns.selectedOptionId;

        // Sync local correctness in user_answers just in case
        if (userAns.isCorrect !== isAnswerCorrect) {
          await prisma.userAnswer.update({
            where: { id: userAns.id },
            data: { isCorrect: isAnswerCorrect }
          });
        }

        if (isAnswerCorrect) {
          correctCount++;
          totalScore += q.marks;
          if (categoryStats[q.categoryId]) {
            categoryStats[q.categoryId].correct++;
            categoryStats[q.categoryId].score += q.marks;
          }
        } else {
          incorrectCount++;
          totalScore -= q.negativeMarks; // Negative marking
          if (categoryStats[q.categoryId]) {
            categoryStats[q.categoryId].score -= q.negativeMarks;
          }
        }
      } else {
        skippedCount++;
      }
    }

    // Calculate Accuracy: correct / attempted
    const accuracy = attemptedCount > 0 ? (correctCount / attemptedCount) * 100.0 : 0.0;

    // Estimate Percentile: (Attempts with score < totalScore) / (Total attempts) * 100
    let percentile = 100.0;
    if (attempt.quizId) {
      const otherAttemptsCount = await prisma.quizResult.count({
        where: {
          attempt: { quizId: attempt.quizId },
          totalScore: { lt: totalScore }
        }
      });
      const totalQuizResults = await prisma.quizResult.count({
        where: { attempt: { quizId: attempt.quizId } }
      });
      if (totalQuizResults > 0) {
        percentile = (otherAttemptsCount / totalQuizResults) * 100.0;
      }
    }

    // Mark attempt as completed
    await prisma.quizAttempt.update({
      where: { id: attemptId },
      data: {
        status: 'COMPLETED',
        completedAt: new Date(),
        remainingTime: 0,
      }
    });

    // Create Result entry
    const finalResult = await prisma.quizResult.create({
      data: {
        attemptId,
        totalScore,
        accuracy,
        attemptedCount,
        skippedCount,
        correctCount,
        incorrectCount,
        percentile,
        categoryAnalysis: categoryStats,
      }
    });

    return res.status(200).json({
      success: true,
      message: 'Quiz successfully submitted and evaluated.',
      score: totalScore,
      accuracy,
      correctCount,
      incorrectCount,
      skippedCount,
      percentile,
      categoryAnalysis: categoryStats,
      resultId: finalResult.id,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Fetch designated Daily Challenge Quiz and its active leader rank
 */
const getDailyChallenge = async (req, res, next) => {
  try {
    const userId = req.user.id;

    // 1. Fetch daily quiz
    const dailyQuiz = await prisma.quiz.findFirst({
      where: { isDailyChallenge: true },
      include: {
        category: true,
        _count: { select: { questions: true } }
      }
    });

    if (!dailyQuiz) {
      return res.status(404).json({
        success: false,
        message: 'No active Daily Challenge quiz has been published today.'
      });
    }

    // 2. Check if user already completed it today
    const completedAttempt = await prisma.quizAttempt.findFirst({
      where: {
        quizId: dailyQuiz.id,
        userId,
        status: 'COMPLETED',
      },
      include: {
        quizResult: true
      }
    });

    // 3. Find top score for this challenge
    const topScoreCard = await prisma.quizResult.findFirst({
      where: {
        attempt: { quizId: dailyQuiz.id }
      },
      include: {
        attempt: { include: { user: { select: { name: true } } } }
      },
      orderBy: { totalScore: 'desc' }
    });

    return res.status(200).json({
      success: true,
      quiz: dailyQuiz,
      completedToday: !!completedAttempt,
      userScore: completedAttempt ? completedAttempt.quizResult.totalScore : null,
      topScore: topScoreCard ? {
        name: topScoreCard.attempt.user.name,
        score: topScoreCard.totalScore
      } : null,
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getQuizzes,
  getQuizDetails,
  startQuiz,
  syncAnswer,
  submitQuiz,
  getDailyChallenge,
};
