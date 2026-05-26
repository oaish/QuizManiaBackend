# QuizMania Backend | Production Deployment Manual

This is the production-ready Node.js + Express backend server for **QuizMania**, integrated with Prisma ORM and MySQL.

---

## Technical Features

1. **Security Protections**:
   - `Helmet` middleware secures header flags to mitigate XSS, injection, and clickjacking risks.
   - `CORS` allows secure connections from the Vercel-deployed frontend domain.
   - IP-level `express-rate-limit` prevents DOS attacks and brute-force login attempts.
2. **Database Resilience**:
   - Employs `Prisma Client` connection pooling Native to MySQL.
   - Prepared SQL statements fully prevent SQL Injection.
   - Relational cascading deletes (`onDelete: Cascade` / `SetNull`) maintain database referential integrity.
3. **Robust Orchestrators**:
   - Advanced eval engine calculates negative marking, correctness metrics, active countdowns, and mathematical percentiles relative to database stats.
   - Advanced JSON uploader parses and creates categories, company relations, tags, and options in a single transaction.

---

## Local Development Startup

### 1. Database Configuration
Ensure a local MySQL instance is active. Edit your `.env` file (based on `.env.example`) to match your credentials:
```env
DATABASE_URL="mysql://username:password@localhost:3306/quizmania"
```

### 2. Generate Prisma Client & Run Migrations
Run the following scripts inside `backend/` to run migrations and establish active database connections:
```bash
# Install dependencies
npm install

# Run database schema migrations
npx prisma migrate dev --name init

# Generate the Prisma Client wrapper
npm run prisma:generate
```

### 3. Seed Database with 50+ Aptitude Questions
Populate the MySQL database with the comprehensive diagnostic test and daily challenge queries:
```bash
npm run prisma:seed
```

### 4. Boot Development Server
Run nodemon to monitor server edits on Port 5000:
```bash
npm run dev
```
Verify status at: `http://localhost:5000/health`.

---

## Render Deployed Target Instructions (Production)

Deploy this server as a **Web Service** on Render:

1. **GitHub Repository**: Push this repository to GitHub.
2. **Service Type**: Create a new **Web Service** pointing to the repository.
3. **Environment**: Select `Node` as the runtime.
4. **Build & Start Commands**:
   - Build Command: `npm install && npx prisma generate`
   - Start Command: `npm start`
5. **Environment Variables**:
   Configure the following variables in the Render Dashboard's "Environment" tab:
   - `DATABASE_URL`: Set to your production MySQL hosting URL (e.g. Aiven, AWS RDS, or PlanetScale).
   - `JWT_SECRET`: Define a long random secret key.
   - `JWT_EXPIRATION`: `24h`
   - `NODE_ENV`: `production`
   - `FRONTEND_URL`: Set to your deployed Vercel domain.
6. **Health Check Path**: Configure `/health` as Render's health check path.
