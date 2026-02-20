require('dotenv').config();
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const Admin = require('./models/Admin');
const SystemSetting = require('./models/SystemSetting');
const config = require('./config');

const initializeSystem = async () => {
  try {
    // Connect to MongoDB
    await mongoose.connect(config.mongodbUri || 'mongodb://localhost:27017/voting_system', {
      useNewUrlParser: true,
      useUnifiedTopology: false, // Remove this deprecated option
    });
    
    console.log('Connected to MongoDB');

    // Check if admin already exists
    const existingAdmin = await Admin.findOne({ email: process.env.INITIAL_ADMIN_EMAIL });
    
    if (existingAdmin) {
      console.log('Admin already exists. Skipping admin creation.');
    } else {
      // Create initial admin
      const admin = new Admin({
        email: process.env.INITIAL_ADMIN_EMAIL || 'admin@kirinyaga.go.ke',
        password: process.env.INITIAL_ADMIN_PASSWORD || 'Admin@12345',
        fullName: process.env.INITIAL_ADMIN_NAME || 'System Administrator',
        role: 'super_admin'
      });

      await admin.save();
      console.log('Initial admin created successfully');
      console.log(`Email: ${admin.email}`);
      console.log(`Password: ${process.env.INITIAL_ADMIN_PASSWORD || 'Admin@12345'}`);
    }

    // Initialize system settings with proper values (not null)
    const defaultSettings = [
      { 
        key: 'voting_portal_open', 
        value: false, 
        description: 'Voting portal status (true=open, false=closed)', 
        isPublic: true 
      },
      { 
        key: 'voting_deadline', 
        value: '', // Empty string instead of null
        description: 'Voting deadline date and time', 
        isPublic: true 
      },
      { 
        key: 'system_version', 
        value: '1.0.0', 
        description: 'System version', 
        isPublic: true 
      },
      { 
        key: 'county_name', 
        value: 'Kirinyaga', 
        description: 'County name', 
        isPublic: true 
      },
      { 
        key: 'allow_voter_registration', 
        value: true, 
        description: 'Allow new voter registration', 
        isPublic: false 
      },
      { 
        key: 'max_login_attempts', 
        value: 3, 
        description: 'Maximum login attempts before lockout', 
        isPublic: false 
      },
      { 
        key: 'session_timeout', 
        value: 30, 
        description: 'Session timeout in minutes', 
        isPublic: false 
      },
      { 
        key: 'voting_schedule_start', 
        value: '', 
        description: 'Scheduled voting start time', 
        isPublic: false 
      },
      { 
        key: 'voting_schedule_end', 
        value: '', 
        description: 'Scheduled voting end time', 
        isPublic: false 
      }
    ];

    for (const setting of defaultSettings) {
      const existingSetting = await SystemSetting.findOne({ key: setting.key });
      if (!existingSetting) {
        await SystemSetting.create(setting);
        console.log(`Created system setting: ${setting.key}`);
      } else {
        console.log(`System setting already exists: ${setting.key}`);
      }
    }

    console.log('\n=== System Initialization Completed Successfully ===');
    console.log('System is ready to use!');
    console.log('\nTo start the server, run: npm start');
    console.log('Default admin credentials have been created.');
    console.log('\nNext steps:');
    console.log('1. Start the server: npm start');
    console.log('2. Access the API at: http://localhost:5000');
    console.log('3. Use admin credentials to login and manage the system');
    
    process.exit(0);

  } catch (error) {
    console.error('Error during system initialization:', error.message);
    console.error('Full error:', error);
    process.exit(1);
  }
};

// Handle unhandled promise rejections
process.on('unhandledRejection', (err) => {
  console.error('Unhandled Promise Rejection:', err);
  process.exit(1);
});

initializeSystem();