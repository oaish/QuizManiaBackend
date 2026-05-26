const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const authRoutes = require('./routes/authRoutes');
const questionsRoutes = require('./routes/questionsRoutes');
const quizzesRoutes = require('./routes/quizzesRoutes');
const resultsRoutes = require('./routes/resultsRoutes');
const adminRoutes = require('./routes/adminRoutes');
const { errorHandler } = require('./middleware/error');

const app = express();

// 1. Security Headers
app.use(helmet());

// 2. CORS Configuration (Allow frontend connections)
const allowedOrigin = process.env.FRONTEND_URL || 'http://localhost:5173';
app.use(cors({
  origin: allowedOrigin,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

// 3. Request Parsing
app.use(express.json({ limit: '10mb' })); // support larger bulk question uploads
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// 4. Rate Limiting Middleware
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 1000, // Limit each IP to 1000 requests per window
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: 'Too many requests from this IP. Please try again after 15 minutes.'
  }
});
app.use('/api/', apiLimiter);

// 5. Health Check Route
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'healthy',
    timestamp: new Date(),
    uptime: process.uptime(),
    mysql: 'connected'
  });
});

// 6. Registered Application Routes
app.use('/api/auth', authRoutes);
app.use('/api/questions', questionsRoutes);
app.use('/api/quizzes', quizzesRoutes);
app.use('/api/results', resultsRoutes);
app.use('/api/admin', adminRoutes);

// 7. Global Error Interceptor
app.use(errorHandler);

module.exports = app;
