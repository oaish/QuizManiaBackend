/**
 * Global Error Handler Middleware
 * Intercepts Express-level errors, formatting them into standard JSON structures.
 */
const errorHandler = (err, req, res, next) => {
  console.error('Unhandled Server Error:', err);

  const statusCode = err.statusCode || 500;
  const message = err.message || 'An unexpected error occurred on the server.';

  // Handle Prisma Database Specific Errors
  if (err.code === 'P2002') {
    // Unique constraint violation (e.g. email exists)
    return res.status(409).json({
      success: false,
      message: 'Database conflict: A record with this unique field already exists.',
      error: err.meta,
    });
  }

  if (err.code === 'P2025') {
    // Record not found
    return res.status(404).json({
      success: false,
      message: 'Database record not found.',
      error: err.meta,
    });
  }

  // General error response
  res.status(statusCode).json({
    success: false,
    message: message,
    stack: process.env.NODE_ENV === 'production' ? undefined : err.stack,
  });
};

module.exports = {
  errorHandler,
};
