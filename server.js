const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const xss = require('xss-clean');
const mongoSanitize = require('express-mongo-sanitize');
const http = require('http');
const socketIo = require('socket.io');

console.log("🚀 Starting Voting System Server...");

const config = require('./config');
const connectDB = require('./config/database');
const errorHandler = require('./middlewares/errorMiddleware');

// Import routes
const voterRoutes = require('./routes/voterRoutes');
const candidateRoutes = require('./routes/candidateRoutes');
const votingRoutes = require('./routes/votingRoutes');
const resultsRoutes = require('./routes/resultRoutes');
const adminRoutes = require('./routes/adminRoutes');
const authRoutes = require('./routes/authRoutes');

console.log("📦 All routes imported successfully");

// Initialize express
const app = express();
const server = http.createServer(app);

console.log("🌐 Express app initialized");

const io = socketIo(server, {
  cors: {
    origin: [
      'http://127.0.0.1:5500',
      'http://localhost:5500',
      'http://localhost:3000',
      'https://user-voting-site-2026-ke.web.app'
    ],
    methods: ["GET", "POST", "PUT", "DELETE"]
  }
});

console.log("🔌 Socket.io initialized");

// Connect to MongoDB
console.log("🗄️ Attempting MongoDB connection...");
connectDB();
mongoose.connection.on("connected", () => {
  console.log("✅ MongoDB connected successfully");
});
mongoose.connection.on("error", (err) => {
  console.log("❌ MongoDB connection error:", err.message);
});

// Security middleware
console.log("🛡️ Applying security middleware...");
app.use(helmet());
app.use(cors());
//app.use(xss());
//app.use(mongoSanitize());

app.set('trust proxy', 1);

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100
});
app.use('/api', limiter);

console.log("⏳ Rate limiter configured");

// Body parser
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
console.log("📥 Body parsers enabled");

// Log every incoming request
app.use((req, res, next) => {
  console.log(`📌 ${req.method} ${req.originalUrl}`);
  next();
});

// Make io accessible to router
app.use((req, res, next) => {
  req.io = io;
  next();
});

// Routes
console.log("🛣️ Registering API routes...");
app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/voters', voterRoutes);
app.use('/api/v1/candidates', candidateRoutes);
app.use('/api/v1/voting', votingRoutes);
app.use('/api/v1/results', resultsRoutes);
app.use('/api/v1/admin', adminRoutes);

console.log("✅ All routes registered successfully");

// Health check endpoint
app.get('/health', (req, res) => {
  console.log("💓 Health check endpoint hit");
  res.status(200).json({
    success: true,
    message: 'Voting System API is running',
    timestamp: new Date().toISOString()
  });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.log("🔥 Global Error Handler Triggered:", err.message);
  next(err);
});
app.use(errorHandler);

// Socket.io connection
io.on('connection', (socket) => {
  console.log(`🔗 New client connected: ${socket.id}`);
  
  socket.on('subscribe', (room) => {
    socket.join(room);
    console.log(`📡 Client ${socket.id} subscribed to room: ${room}`);
  });
  
  socket.on('disconnect', () => {
    console.log(`❌ Client disconnected: ${socket.id}`);
  });
});

// Start server
const PORT = config.port;
server.listen(PORT, () => {
  console.log("======================================");
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`🌍 Mode: ${process.env.NODE_ENV}`);
  console.log("======================================");
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (err) => {
  console.log("💥 Unhandled Rejection:", err.message);
  server.close(() => process.exit(1));
});
