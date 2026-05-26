// Load environment configurations
require('dotenv').config();

const app = require('./app');
const prisma = require('./config/db');

const PORT = process.env.PORT || 5000;

// Connect to Database and start server
async function startServer() {
  try {
    // Verify MySQL connection is responsive
    await prisma.$connect();
    console.log('Successfully connected to MySQL database via Prisma ORM.');

    app.listen(PORT, () => {
      console.log(`QuizMania backend listening on port ${PORT}...`);
      console.log(`- Health endpoint: http://localhost:${PORT}/health`);
      console.log(`- API root: http://localhost:${PORT}/api`);
    });
  } catch (error) {
    console.error('Fatal Database connection error during startup:', error);
    process.exit(1);
  }
}

// Global process exception bindings for graceful shutdowns
process.on('SIGINT', async () => {
  await prisma.$disconnect();
  console.log('Disconnected from database. Exiting server gracefully.');
  process.exit(0);
});

process.on('SIGTERM', async () => {
  await prisma.$disconnect();
  console.log('Disconnected from database. Exiting server gracefully.');
  process.exit(0);
});

startServer();
