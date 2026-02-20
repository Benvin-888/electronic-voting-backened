const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const xss = require('xss-clean');
const mongoSanitize = require('express-mongo-sanitize');
const http = require('http');
const socketIo = require('socket.io');

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

// Initialize express
const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: ['http://127.0.0.1:5500', 'http://localhost:5500', 'http://localhost:3000','https://user-voting-site-2026-ke.web.app'],
    methods: ["GET", "POST", "PUT", "DELETE"]
  }
});

// Connect to MongoDB
connectDB();

// Security middleware
app.use(helmet());
app.use(cors());
//app.use(xss());
//app.use(mongoSanitize());

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100 // limit each IP to 100 requests per windowMs
});
app.use('/api', limiter);

// Body parser
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Make io accessible to our router
app.use((req, res, next) => {
  req.io = io;
  next();
});

// Routes
app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/voters', voterRoutes);
app.use('/api/v1/candidates', candidateRoutes);
app.use('/api/v1/voting', votingRoutes);
app.use('/api/v1/results', resultsRoutes);
app.use('/api/v1/admin', adminRoutes);

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({
    success: true,
    message: 'Voting System API is running',
    timestamp: new Date().toISOString()
  });
});

// Error handling middleware
app.use(errorHandler);

// Socket.io connection
io.on('connection', (socket) => {
  console.log('New client connected');
  
  socket.on('subscribe', (room) => {
    socket.join(room);
    console.log(`Client subscribed to room: ${room}`);
  });
  
  socket.on('disconnect', () => {
    console.log('Client disconnected');
  });
});

// Start server
const PORT = config.port;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT} in ${process.env.NODE_ENV} mode`);
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (err, promise) => {
  console.log(`Error: ${err.message}`);
  // Close server & exit process
  server.close(() => process.exit(1));
});