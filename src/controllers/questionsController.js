const prisma = require('../config/db');

/**
 * Get all questions with filters, search, and pagination
 */
const getQuestions = async (req, res, next) => {
  try {
    const {
      page = 1,
      limit = 10,
      search,
      category,
      difficulty,
      company,
      tag,
    } = req.query;

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const take = parseInt(limit);

    // Build Prisma query filters
    const where = {};

    // 1. Search filter
    if (search) {
      where.questionText = {
        contains: search,
      };
    }

    // 2. Category filter
    if (category) {
      where.category = {
        slug: category,
      };
    }

    // 3. Difficulty filter
    if (difficulty) {
      where.difficulty = difficulty;
    }

    // 4. Company filter (many-to-many through QuestionCompany)
    if (company) {
      where.companies = {
        some: {
          company: {
            slug: company,
          },
        },
      };
    }

    // 5. Tag filter (many-to-many through QuestionTag)
    if (tag) {
      where.tags = {
        some: {
          tag: {
            slug: tag,
          },
        },
      };
    }

    // Run query and count concurrently
    const [questions, total] = await prisma.$transaction([
      prisma.question.findMany({
        where,
        skip,
        take,
        include: {
          category: {
            select: { id: true, name: true, slug: true },
          },
          options: {
            select: { id: true, optionText: true }, // Hide isCorrect for security during general practice
          },
          companies: {
            include: { company: true },
          },
          tags: {
            include: { tag: true },
          },
        },
        orderBy: { id: 'asc' },
      }),
      prisma.question.count({ where }),
    ]);

    // Format output to simplify company and tag returns
    const formattedQuestions = questions.map((q) => ({
      ...q,
      companies: q.companies.map((c) => c.company.name),
      tags: q.tags.map((t) => t.tag.name),
    }));

    return res.status(200).json({
      success: true,
      data: formattedQuestions,
      pagination: {
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Get question details by ID
 */
const getQuestionById = async (req, res, next) => {
  try {
    const id = parseInt(req.params.id);

    const question = await prisma.question.findUnique({
      where: { id },
      include: {
        category: true,
        options: true, // Includes correctness for review/admin
        companies: { include: { company: true } },
        tags: { include: { tag: true } },
      },
    });

    if (!question) {
      return res.status(404).json({
        success: false,
        message: 'Question not found.',
      });
    }

    const formatted = {
      ...question,
      companies: question.companies.map((c) => c.company.name),
      tags: question.tags.map((t) => t.tag.name),
    };

    return res.status(200).json({
      success: true,
      data: formatted,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Toggle bookmarking a question for a user.
 * Bookmarks are tracked as UserAnswer records where `bookmarked = true`.
 */
const toggleBookmark = async (req, res, next) => {
  try {
    const questionId = parseInt(req.params.id);
    const userId = req.user.id;

    // 1. Verify question exists
    const question = await prisma.question.findUnique({ where: { id: questionId } });
    if (!question) {
      return res.status(404).json({ success: false, message: 'Question not found.' });
    }

    // 2. Find or create an active attempt for practice questions
    // Practice is represented as a null quizId attempt, or the user's latest attempt
    let attempt = await prisma.quizAttempt.findFirst({
      where: {
        userId,
        status: 'IN_PROGRESS',
      },
      orderBy: { startedAt: 'desc' },
    });

    if (!attempt) {
      attempt = await prisma.quizAttempt.create({
        data: {
          userId,
          status: 'IN_PROGRESS',
        },
      });
    }

    // 3. Check if user already has a UserAnswer for this question in this attempt
    const existingAnswer = await prisma.userAnswer.findFirst({
      where: {
        attemptId: attempt.id,
        questionId,
      },
    });

    let bookmarkedState = true;

    if (existingAnswer) {
      // Toggle it
      bookmarkedState = !existingAnswer.bookmarked;
      await prisma.userAnswer.update({
        where: { id: existingAnswer.id },
        data: { bookmarked: bookmarkedState },
      });
    } else {
      // Create new placeholder UserAnswer with bookmarked = true
      await prisma.userAnswer.create({
        data: {
          attemptId: attempt.id,
          questionId,
          bookmarked: true,
          isCorrect: false,
        },
      });
    }

    return res.status(200).json({
      success: true,
      message: bookmarkedState ? 'Question bookmarked successfully.' : 'Bookmark removed successfully.',
      bookmarked: bookmarkedState,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Get all available categories, tags, and companies for frontend filters
 */
const getFilters = async (req, res, next) => {
  try {
    const [categories, companies, tags] = await prisma.$transaction([
      prisma.category.findMany({ select: { name: true, slug: true } }),
      prisma.company.findMany({ select: { name: true, slug: true } }),
      prisma.tag.findMany({ select: { name: true, slug: true } }),
    ]);

    return res.status(200).json({
      success: true,
      categories,
      companies,
      tags,
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getQuestions,
  getQuestionById,
  toggleBookmark,
  getFilters,
};
