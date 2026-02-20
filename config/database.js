const mongoose = require('mongoose');
const config = require('../config');

const connectDB = async () => {
  try {
    const conn = await mongoose.connect(config.mongodbUri, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    
    console.log(`MongoDB Connected: ${conn.connection.host}`);
    
    // Create indexes
    await mongoose.connection.db.collection('voters').createIndex({ votingNumber: 1 }, { unique: true });
    await mongoose.connection.db.collection('voters').createIndex({ nationalId: 1 }, { unique: true });
    await mongoose.connection.db.collection('votes').createIndex({ votingNumber: 1, position: 1 }, { unique: true });
    
  } catch (error) {
    console.error(`Error: ${error.message}`);
    process.exit(1);
  }
};

module.exports = connectDB;