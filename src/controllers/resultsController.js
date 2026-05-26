const prisma = require('../config/db');

/**
 * Retrieve detailed report of a completed quiz attempt (with correct keys & explanations)
 */
const getAttemptResult = async (req, res, next) => {
  try {
    const attemptId = parseInt(req.params.attemptId);
    const userId = req.user.id;

    // 1. Fetch attempt, result, and answers
    const attempt = await prisma.quizAttempt.findUnique({
      where: { id: attemptId },
      include: {
        quiz: {
          select: { title: true, description: true }
        },
        quizResult: true,
        userAnswers: {
          include: {
            question: {
              include: {
                options: true,
                category: { select: { name: true } }
              }
            }
          }
        }
      }
    });

    if (!attempt || (attempt.userId !== userId && req.user.role !== 'admin')) {
      return res.status(403).json({ success: false, message: 'Invalid attempt or unauthorized access.' });
    }

    if (attempt.status !== 'COMPLETED') {
      return res.status(400).json({ success: false, message: 'This attempt is still in progress.' });
    }

    // Format output questions with user answer indicators
    const reviewQuestions = attempt.userAnswers.map(ans => {
      const q = ans.question;
      return {
        id: q.id,
        questionText: q.questionText,
        explanation: q.explanation,
        marks: q.marks,
        negativeMarks: q.negativeMarks,
        difficulty: q.difficulty,
        category: q.category.name,
        options: q.options.map(opt => ({
          id: opt.id,
          optionText: opt.optionText,
          isCorrect: opt.isCorrect,
          isSelected: opt.id === ans.selectedOptionId
        })),
        selectedOptionId: ans.selectedOptionId,
        isCorrect: ans.isCorrect,
        timeSpent: ans.timeSpent,
        bookmarked: ans.bookmarked
      };
    });

    return res.status(200).json({
      success: true,
      quizTitle: attempt.quiz ? attempt.quiz.title : 'General Practice Quiz',
      result: attempt.quizResult,
      startedAt: attempt.startedAt,
      completedAt: attempt.completedAt,
      review: reviewQuestions
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Retrieve user's overall performance metrics and history list for the Dashboard
 */
const getUserDashboardData = async (req, res, next) => {
  try {
    const userId = req.user.id;

    // 1. Fetch all completed attempts with their results
    const attempts = await prisma.quizAttempt.findMany({
      where: {
        userId,
        status: 'COMPLETED'
      },
      include: {
        quiz: { select: { title: true } },
        quizResult: true
      },
      orderBy: { completedAt: 'desc' }
    });

    // 2. Aggregate statistics
    let totalQuizzes = attempts.length;
    let cumulativeScore = 0.0;
    let averageAccuracy = 0.0;
    let totalQuestionsAttempted = 0;
    let totalQuestionsCorrect = 0;

    const categorySummary = {};

    attempts.forEach(att => {
      const res = att.quizResult;
      if (res) {
        cumulativeScore += res.totalScore;
        averageAccuracy += res.accuracy;
        totalQuestionsAttempted += res.attemptedCount;
        totalQuestionsCorrect += res.correctCount;

        // Parse category breakdown JSON
        if (res.categoryAnalysis) {
          const catData = res.categoryAnalysis;
          Object.keys(catData).forEach(catId => {
            const cat = catData[catId];
            if (!categorySummary[catId]) {
              categorySummary[catId] = {
                name: cat.name,
                slug: cat.slug,
                totalAttempted: 0,
                totalCorrect: 0,
                totalQuestions: 0
              };
            }
            categorySummary[catId].totalAttempted += cat.attempted;
            categorySummary[catId].totalCorrect += cat.correct;
            categorySummary[catId].totalQuestions += cat.totalQuestions;
          });
        }
      }
    });

    const averageAccuracyRate = totalQuizzes > 0 ? (averageAccuracy / totalQuizzes) : 0.0;

    // 3. Format category statistics with final accuracy
    const formattedCategories = Object.keys(categorySummary).map(id => {
      const cat = categorySummary[id];
      const acc = cat.totalAttempted > 0 ? (cat.totalCorrect / cat.totalAttempted) * 100 : 0.0;
      return {
        id: parseInt(id),
        name: cat.name,
        slug: cat.slug,
        attempted: cat.totalAttempted,
        correct: cat.totalCorrect,
        accuracy: parseFloat(acc.toFixed(2))
      };
    });

    // 4. Fetch list of user's bookmarks
    const bookmarkedAnswers = await prisma.userAnswer.findMany({
      where: {
        attempt: { userId },
        bookmarked: true
      },
      include: {
        question: {
          include: {
            category: { select: { name: true } },
            options: { select: { id: true, optionText: true } }
          }
        }
      }
    });

    const bookmarksList = bookmarkedAnswers.map(ans => ({
      id: ans.question.id,
      questionText: ans.question.questionText,
      category: ans.question.category.name,
      difficulty: ans.question.difficulty,
      options: ans.question.options
    }));

    return res.status(200).json({
      success: true,
      stats: {
        quizzesCompleted: totalQuizzes,
        cumulativeScore: parseFloat(cumulativeScore.toFixed(2)),
        averageAccuracy: parseFloat(averageAccuracyRate.toFixed(2)),
        totalAttempted: totalQuestionsAttempted,
        totalCorrect: totalQuestionsCorrect,
      },
      categoryAnalytics: formattedCategories,
      recentAttempts: attempts.map(att => ({
        attemptId: att.id,
        quizTitle: att.quiz ? att.quiz.title : 'General Practice Quiz',
        score: att.quizResult ? att.quizResult.totalScore : 0.0,
        accuracy: att.quizResult ? att.quizResult.accuracy : 0.0,
        completedAt: att.completedAt
      })),
      bookmarks: bookmarksList
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Retrieve Global Leaderboard ranked by overall cumulative score of completed quizzes
 */
const getLeaderboard = async (req, res, next) => {
  try {
    // Aggregates user scores
    const leaderboardRaw = await prisma.quizResult.groupBy({
      by: ['attemptId'],
      _sum: {
        totalScore: true
      }
    });

    // To make it efficient and simple, we aggregate cumulative score directly from all completed quiz results grouped by user
    // Prisma doesn't support complex deep joins inside groupBy easily, so we will pull from users with attempts & results
    const users = await prisma.user.findMany({
      where: {
        role: 'user' // Only normal users on the leaderboard
      },
      include: {
        attempts: {
          where: { status: 'COMPLETED' },
          include: { quizResult: true }
        }
      }
    });

    const leaderboard = users.map(user => {
      let cumulativeScore = 0.0;
      let quizzesCompleted = 0;
      let totalAccuracySum = 0.0;

      user.attempts.forEach(att => {
        if (att.quizResult) {
          cumulativeScore += att.quizResult.totalScore;
          quizzesCompleted++;
          totalAccuracySum += att.quizResult.accuracy;
        }
      });

      const avgAccuracy = quizzesCompleted > 0 ? (totalAccuracySum / quizzesCompleted) : 0.0;

      return {
        userId: user.id,
        name: user.name,
        email: user.email,
        cumulativeScore: parseFloat(cumulativeScore.toFixed(2)),
        avgAccuracy: parseFloat(avgAccuracy.toFixed(2)),
        quizzesCompleted
      };
    })
    .sort((a, b) => b.cumulativeScore - a.cumulativeScore || b.avgAccuracy - a.avgAccuracy) // Rank by score, then accuracy
    .slice(0, 50); // Get top 50

    return res.status(200).json({
      success: true,
      leaderboard
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getAttemptResult,
  getUserDashboardData,
  getLeaderboard
};
