const Voter = require('../models/Voter');
const TempVoterData = require('../models/TempVoterData');
const { sendRegistrationEmail } = require('../utils/emailService');
const auditLogger = require('../utils/auditLogger');
const constituencyData = require('../utils/constituencyData');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const axios = require('axios');

// ========== IMPORTS FOR SELF-REGISTRATION ==========
const multer = require('multer');
const Tesseract = require('tesseract.js');
const sharp = require('sharp');

// Configure multer (files stored in memory for processing)
const storage = multer.memoryStorage();
const upload = multer({
  storage: storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB max per file
  fileFilter: (req, file, cb) => {
    const allowedTypes = /jpeg|jpg|png|gif/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);
    if (mimetype && extname) return cb(null, true);
    cb(new Error('Only images are allowed (JPEG, PNG, GIF)'));
  }
});

// Helper: Add timeout to promises
const withTimeout = (promise, ms = 30000) => {
  const timeout = new Promise((_, reject) => {
    setTimeout(() => reject(new Error(`Operation timed out after ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]);
};

// Helper: Validate email format
const validateEmail = (email) => {
  const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return re.test(email);
};

// Helper: Validate phone number format (Kenyan format)
const validatePhoneNumber = (phone) => {
  // Remove any non-digit characters
  const cleaned = phone.replace(/\D/g, '');
  // Check if it's a valid Kenyan number (07XX XXX XXX or 2547XX XXX XXX)
  return /^(?:(?:(?:254|0)[17]\d{8})|(?:254|0)[17]\d{8})$/.test(cleaned);
};

// Helper: Detect blur using Laplacian variance (via sharp)
async function isImageBlurry(buffer, threshold = 100) {
  try {
    const { data, info } = await sharp(buffer)
      .grayscale()
      .raw()
      .toBuffer({ resolveWithObject: true });

    const width = info.width;
    const height = info.height;
    const pixels = new Uint8Array(data);

    let sum = 0, sumSq = 0;
    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        const idx = y * width + x;
        const laplacian =
          pixels[idx - width] +
          pixels[idx - 1] +
          -4 * pixels[idx] +
          pixels[idx + 1] +
          pixels[idx + width];
        sum += laplacian;
        sumSq += laplacian * laplacian;
      }
    }
    const variance = (sumSq / ((width - 2) * (height - 2))) - (sum / ((width - 2) * (height - 2))) ** 2;
    return variance < threshold;
  } catch (err) {
    console.error('Blur detection error:', err);
    return false;
  }
}

// Helper: Clean OCR text
function cleanOCRText(text) {
  if (!text) return '';
  
  // Replace common OCR artifacts
  let cleaned = text
    .replace(/[|\\{}[\]_~`]/g, ' ') // Replace special characters with spaces
    .replace(/\s+/g, ' ') // Normalize spaces
    .replace(/[^\w\s\/\-:.,]/g, '') // Keep periods and commas too
    .trim();
  
  return cleaned;
}

// ========== UPDATED OCR EXTRACTION FOR KENYAN ID CARD FORMAT ==========
// Helper: Extract ID fields from OCR text (Kenyan ID card)
function extractIDInfo(ocrText) {
  try {
    if (!ocrText || typeof ocrText !== 'string') {
      console.error('Invalid OCR text provided to extractIDInfo');
      return { 
        nationalId: null, 
        fullName: null, 
        dateOfBirth: null,
        surname: null,
        givenNames: null,
        sex: null,
        nationality: null,
        placeOfBirth: null,
        dateOfExpiry: null,
        placeOfIssue: null,
        cardSerialNumber: null
      };
    }
    
    // First, clean the text
    const cleaned = cleanOCRText(ocrText);
    console.log('Cleaned OCR text:', cleaned);
    
    // Parse the JSON-like structure if present
    let extracted = {
      nationalId: null,
      fullName: null,
      dateOfBirth: null,
      surname: null,
      givenNames: null,
      sex: null,
      nationality: null,
      placeOfBirth: null,
      dateOfExpiry: null,
      placeOfIssue: null,
      cardSerialNumber: null
    };
    
    // Try to find JSON-like structure first (if OCR captures the exact format)
    const jsonPattern = /"personalInfo"\s*:\s*{([^}]+)}/i;
    const jsonMatch = cleaned.match(jsonPattern);
    
    if (jsonMatch) {
      console.log('Found JSON-like structure, parsing...');
      const jsonStr = '{' + jsonMatch[1] + '}';
      
      // Extract individual fields from the JSON structure
      const surnameMatch = jsonStr.match(/"surname"\s*:\s*"([^"]*)"/i);
      const givenNamesMatch = jsonStr.match(/"givenNames"\s*:\s*"([^"]*)"/i);
      const sexMatch = jsonStr.match(/"sex"\s*:\s*"([^"]*)"/i);
      const nationalityMatch = jsonStr.match(/"nationality"\s*:\s*"([^"]*)"/i);
      const dobMatch = jsonStr.match(/"dateOfBirth"\s*:\s*"([^"]*)"/i);
      const pobMatch = jsonStr.match(/"placeOfBirth"\s*:\s*"([^"]*)"/i);
      
      if (surnameMatch) extracted.surname = surnameMatch[1];
      if (givenNamesMatch) extracted.givenNames = givenNamesMatch[1];
      if (sexMatch) extracted.sex = sexMatch[1];
      if (nationalityMatch) extracted.nationality = nationalityMatch[1];
      if (dobMatch) extracted.dateOfBirth = dobMatch[1];
      if (pobMatch) extracted.placeOfBirth = pobMatch[1];
      
      // Create full name from surname and given names
      if (extracted.givenNames || extracted.surname) {
        const nameParts = [];
        if (extracted.givenNames) nameParts.push(extracted.givenNames);
        if (extracted.surname) nameParts.push(extracted.surname);
        extracted.fullName = nameParts.join(' ').trim();
      }
    }
    
    // Try to find identification section
    const identificationPattern = /"identification"\s*:\s*{([^}]+)}/i;
    const identificationMatch = cleaned.match(identificationPattern);
    
    if (identificationMatch) {
      console.log('Found identification structure, parsing...');
      const idStr = '{' + identificationMatch[1] + '}';
      
      const idNumberMatch = idStr.match(/"idNumber"\s*:\s*"([^"]*)"/i);
      const expiryMatch = idStr.match(/"dateOfExpiry"\s*:\s*"([^"]*)"/i);
      const placeIssueMatch = idStr.match(/"placeOfIssue"\s*:\s*"([^"]*)"/i);
      const cardSerialMatch = idStr.match(/"cardSerialNumber"\s*:\s*"([^"]*)"/i);
      
      if (idNumberMatch) extracted.nationalId = idNumberMatch[1];
      if (expiryMatch) extracted.dateOfExpiry = expiryMatch[1];
      if (placeIssueMatch) extracted.placeOfIssue = placeIssueMatch[1];
      if (cardSerialMatch) extracted.cardSerialNumber = cardSerialMatch[1];
    }
    
    // Try to find document info
    const documentPattern = /"documentInfo"\s*:\s*{([^}]+)}/i;
    const documentMatch = cleaned.match(documentPattern);
    
    if (documentMatch) {
      console.log('Found document structure, parsing...');
      const docStr = '{' + documentMatch[1] + '}';
      
      const countryMatch = docStr.match(/"country"\s*:\s*"([^"]*)"/i);
      const docTypeMatch = docStr.match(/"documentType"\s*:\s*"([^"]*)"/i);
      
      // We might not need to store these, but we can log them
      if (countryMatch) console.log('Country:', countryMatch[1]);
      if (docTypeMatch) console.log('Document Type:', docTypeMatch[1]);
    }
    
    // If JSON parsing failed or fields are missing, fall back to regex patterns
    if (!extracted.nationalId) {
      // Look for ID number pattern (781105227 in your example)
      const idPattern = /\b(\d{7,10})\b/; // 7-10 digit ID numbers
      const idMatch = cleaned.match(idPattern);
      if (idMatch) extracted.nationalId = idMatch[1];
    }
    
    if (!extracted.dateOfBirth) {
      // Look for date of birth pattern (2006-10-16 in your example)
      const dobPattern = /\b(\d{4}-\d{2}-\d{2})\b/; // YYYY-MM-DD format
      const dobMatch = cleaned.match(dobPattern);
      if (dobMatch) extracted.dateOfBirth = dobMatch[1];
    }
    
    if (!extracted.dateOfExpiry) {
      // Look for expiry date pattern (2035-03-06 in your example)
      const expiryPattern = /\b(20\d{2}-\d{2}-\d{2})\b/; // Future dates starting with 20
      const expiryMatch = cleaned.match(expiryPattern);
      if (expiryMatch && expiryMatch[1] !== extracted.dateOfBirth) {
        extracted.dateOfExpiry = expiryMatch[1];
      }
    }
    
    if (!extracted.cardSerialNumber) {
      // Look for card serial number (2564680419 in your example)
      const serialPattern = /\b(\d{10})\b/; // 10-digit serial
      const serialMatch = cleaned.match(serialPattern);
      if (serialMatch && serialMatch[1] !== extracted.nationalId) {
        extracted.cardSerialNumber = serialMatch[1];
      }
    }
    
    if (!extracted.placeOfIssue) {
      // Look for place of issue (SAGANA in your example)
      const placePattern = /"placeOfIssue"\s*:\s*"([^"]*)"/i;
      const placeMatch = cleaned.match(placePattern);
      if (placeMatch) {
        extracted.placeOfIssue = placeMatch[1];
      } else {
        // Try to find capitalized place names
        const capitalPattern = /\b([A-Z]{3,})\b/g;
        const capitals = cleaned.match(capitalPattern);
        if (capitals && capitals.length > 0) {
          // Filter out common false positives
          const possiblePlace = capitals.find(c => 
            !['KEN', 'MALE', 'FEMALE', 'ID', 'REPUBLIC', 'OF', 'NATIONAL'].includes(c)
          );
          if (possiblePlace) extracted.placeOfIssue = possiblePlace;
        }
      }
    }
    
    // Try to extract surname and given names if not found yet
    if (!extracted.surname && !extracted.givenNames) {
      // Try to extract name components from full name pattern
      const surnameKeywordMatch = cleaned.match(/"surname"\s*:\s*"([^"]*)"/i);
      const givenKeywordMatch = cleaned.match(/"givenNames"\s*:\s*"([^"]*)"/i);
      
      if (surnameKeywordMatch) extracted.surname = surnameKeywordMatch[1];
      if (givenKeywordMatch) extracted.givenNames = givenKeywordMatch[1];
      
      // If we still don't have surname/given, try to parse a full name
      if (!extracted.surname && !extracted.givenNames) {
        const namePatterns = [
          /"fullName"\s*:\s*"([^"]*)"/i,
          /"name"\s*:\s*"([^"]*)"/i,
          /([A-Z]{2,}(?:\s+[A-Z]{2,})+)/ // All caps words
        ];
        
        for (const pattern of namePatterns) {
          const nameMatch = cleaned.match(pattern);
          if (nameMatch && nameMatch[1]) {
            const fullName = nameMatch[1].trim();
            // Try to split into surname and given names (assuming surname is last)
            const nameParts = fullName.split(' ');
            if (nameParts.length > 1) {
              extracted.givenNames = nameParts.slice(0, -1).join(' ');
              extracted.surname = nameParts[nameParts.length - 1];
            } else {
              extracted.surname = fullName;
            }
            extracted.fullName = fullName; // Store the original full name
            break;
          }
        }
      }
    }
    
    // If we have surname and given names but no fullName, construct it
    if (!extracted.fullName && extracted.surname && extracted.givenNames) {
      extracted.fullName = `${extracted.givenNames} ${extracted.surname}`.trim();
    } else if (!extracted.fullName && extracted.surname) {
      extracted.fullName = extracted.surname;
    } else if (!extracted.fullName && extracted.givenNames) {
      extracted.fullName = extracted.givenNames;
    }
    
    if (!extracted.sex) {
      const sexMatch = cleaned.match(/"sex"\s*:\s*"([^"]*)"/i) || 
                       cleaned.match(/\b(MALE|FEMALE)\b/i);
      if (sexMatch) extracted.sex = sexMatch[1] || sexMatch[0];
    }
    
    if (!extracted.nationality) {
      const nationalityMatch = cleaned.match(/"nationality"\s*:\s*"([^"]*)"/i) ||
                               cleaned.match(/\b(KEN|KENYA|KENYAN)\b/i);
      if (nationalityMatch) extracted.nationality = nationalityMatch[1] || nationalityMatch[0];
    }
    
    // Convert date format if needed (from YYYY-MM-DD to DD/MM/YYYY)
    if (extracted.dateOfBirth && extracted.dateOfBirth.includes('-')) {
      const parts = extracted.dateOfBirth.split('-');
      if (parts.length === 3) {
        // Assuming YYYY-MM-DD format
        extracted.dateOfBirth = `${parts[2]}/${parts[1]}/${parts[0]}`;
      }
    }
    
    console.log('Extracted ID Info (detailed):', extracted);
    return extracted;
  } catch (error) {
    console.error('Error in extractIDInfo:', error);
    return { 
      nationalId: null, 
      fullName: null, 
      dateOfBirth: null,
      surname: null,
      givenNames: null,
      sex: null,
      nationality: null,
      placeOfBirth: null,
      dateOfExpiry: null,
      placeOfIssue: null,
      cardSerialNumber: null
    };
  }
}

// Helper: Validate age (not older than 100 years, not younger than 18)
function isValidAge(dateOfBirthStr) {
  try {
    if (!dateOfBirthStr) return false;
    
    let parts;
    if (dateOfBirthStr.includes('-')) {
      parts = dateOfBirthStr.split('-');
    } else if (dateOfBirthStr.includes('/')) {
      parts = dateOfBirthStr.split('/');
    } else {
      return false;
    }
    
    if (parts.length !== 3) return false;
    
    let year, month, day;
    
    // Check format (YYYY-MM-DD or DD/MM/YYYY)
    if (dateOfBirthStr.includes('-')) {
      // YYYY-MM-DD format
      year = parseInt(parts[0]);
      month = parseInt(parts[1]) - 1;
      day = parseInt(parts[2]);
    } else {
      // DD/MM/YYYY format
      day = parseInt(parts[0]);
      month = parseInt(parts[1]) - 1;
      year = parseInt(parts[2]);
    }
    
    if (isNaN(year) || isNaN(month) || isNaN(day)) return false;
    
    const dob = new Date(year, month, day);
    if (isNaN(dob.getTime())) return false;
    
    const today = new Date();
    const age = today.getFullYear() - dob.getFullYear();
    const monthDiff = today.getMonth() - dob.getMonth();
    
    // Adjust age if birthday hasn't occurred this year
    const adjustedAge = monthDiff < 0 || (monthDiff === 0 && today.getDate() < dob.getDate()) 
      ? age - 1 
      : age;
    
    return adjustedAge >= 18 && adjustedAge < 100;
  } catch (error) {
    console.error('Error in isValidAge:', error);
    return false;
  }
}

// Helper: Generate a secure random token
const generateToken = () => {
  return crypto.randomBytes(32).toString('hex');
};

// Helper: Verify reCAPTCHA v2 token
const verifyRecaptcha = async (token) => {
  try {
    const secret = process.env.RECAPTCHA_SECRET_KEY;
    if (!secret) {
      console.error('RECAPTCHA_SECRET_KEY not set in environment variables');
      return false;
    }

    console.log('Verifying reCAPTCHA v2 token...');
    
    const url = `https://www.google.com/recaptcha/api/siteverify`;
    const params = new URLSearchParams();
    params.append('secret', secret);
    params.append('response', token);

    const { data } = await axios.post(url, params, {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      }
    });

    console.log('reCAPTCHA v2 verification response:', data);

    if (data.success) {
      const allowedHostnames = ['localhost', '127.0.0.1', 'yourdomain.com'];
      if (data.hostname && !allowedHostnames.includes(data.hostname)) {
        console.error('reCAPTCHA hostname mismatch:', data.hostname);
        return false;
      }
      return true;
    }

    if (data['error-codes']) {
      console.error('reCAPTCHA v2 error codes:', data['error-codes']);
    }

    return false;
  } catch (error) {
    console.error('reCAPTCHA v2 verification error:', error.message);
    if (error.response) {
      console.error('reCAPTCHA API response:', error.response.data);
    }
    return false;
  }
};

// ========== ADMIN FUNCTIONS ==========

// @desc    Register new voter
// @route   POST /api/v1/voters/register
// @access  Private (Admin)
const registerVoter = async (req, res, next) => {
  try {
    const { nationalId, fullName, email, phoneNumber, constituency, ward } = req.body;

    // Validate input
    if (!nationalId || !fullName || !email || !phoneNumber || !constituency || !ward) {
      return res.status(400).json({
        success: false,
        error: 'All fields are required'
      });
    }

    if (!validateEmail(email)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid email format'
      });
    }

    if (!validatePhoneNumber(phoneNumber)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid phone number format. Use Kenyan format (e.g., 0712345678 or 254712345678)'
      });
    }

    // Check if voter already exists
    const existingVoter = await Voter.findOne({ 
      $or: [{ nationalId }, { email }] 
    });

    if (existingVoter) {
      return res.status(400).json({
        success: false,
        error: 'Voter with this National ID or Email already exists'
      });
    }

    // Validate ward belongs to constituency
    const isValidWard = constituencyData.validateWard(constituency, ward);
    if (!isValidWard) {
      return res.status(400).json({
        success: false,
        error: 'Selected ward does not belong to the constituency'
      });
    }

    // Create voter
    const voter = await Voter.create({
      nationalId,
      fullName,
      email,
      phoneNumber,
      constituency,
      ward,
      county: 'Kirinyaga'
    });

    // Send registration email
    await sendRegistrationEmail(voter, voter.votingNumber);

    // Log the action
    await auditLogger.log(req.admin?._id || req.user?._id, 'CREATE', 'Voter', voter._id, {
      nationalId: voter.nationalId,
      constituency: voter.constituency,
      ward: voter.ward
    });

    res.status(201).json({
      success: true,
      data: {
        votingNumber: voter.votingNumber,
        fullName: voter.fullName,
        constituency: voter.constituency,
        ward: voter.ward
      },
      message: 'Voter registered successfully. Email sent with voting number.'
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Get voter count (no details)
// @route   GET /api/v1/voters/count
// @access  Private (Admin)
const getVoterCount = async (req, res, next) => {
  try {
    const count = await Voter.countDocuments();
    
    res.status(200).json({
      success: true,
      data: { totalVoters: count }
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Get voters who haven't voted
// @route   GET /api/v1/voters/pending
// @access  Private (Admin)
const getPendingVoters = async (req, res, next) => {
  try {
    const pendingVoters = await Voter.find({ hasVoted: false })
      .select('votingNumber fullName constituency ward registrationDate createdAt')
      .sort({ registrationDate: -1, createdAt: -1 });
    
    const count = pendingVoters.length;
    
    res.status(200).json({
      success: true,
      count,
      data: pendingVoters
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Get voters who have voted
// @route   GET /api/v1/voters/voted
// @access  Private (Admin)
const getVotedVoters = async (req, res, next) => {
  try {
    const votedVoters = await Voter.find({ hasVoted: true })
      .select('votingNumber fullName constituency ward registrationDate createdAt votedAt')
      .sort({ votedAt: -1, registrationDate: -1 });
    
    const count = votedVoters.length;
    
    res.status(200).json({
      success: true,
      count,
      data: votedVoters
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Get wards by constituency
// @route   GET /api/v1/voters/wards/:constituency
// @access  Private (Admin)
const getWardsByConstituency = async (req, res, next) => {
  try {
    const { constituency } = req.params;
    const wards = constituencyData.getWardsByConstituency(constituency);
    
    if (!wards) {
      return res.status(404).json({
        success: false,
        error: 'Constituency not found'
      });
    }
    
    res.status(200).json({
      success: true,
      data: wards
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Get voter statistics
// @route   GET /api/v1/voters/statistics
// @access  Private (Admin)
const getVoterStatistics = async (req, res, next) => {
  try {
    const totalVoters = await Voter.countDocuments();
    const votedCount = await Voter.countDocuments({ hasVoted: true });
    const pendingCount = totalVoters - votedCount;
    
    // Count by constituency
    const byConstituency = await Voter.aggregate([
      {
        $group: {
          _id: '$constituency',
          total: { $sum: 1 },
          voted: { $sum: { $cond: [{ $eq: ['$hasVoted', true] }, 1, 0] } },
          pending: { $sum: { $cond: [{ $eq: ['$hasVoted', false] }, 1, 0] } }
        }
      },
      {
        $project: {
          constituency: '$_id',
          total: 1,
          voted: 1,
          pending: 1,
          _id: 0
        }
      },
      { $sort: { constituency: 1 } }
    ]);
    
    // Count by ward
    const byWard = await Voter.aggregate([
      {
        $group: {
          _id: { constituency: '$constituency', ward: '$ward' },
          total: { $sum: 1 },
          voted: { $sum: { $cond: [{ $eq: ['$hasVoted', true] }, 1, 0] } },
          pending: { $sum: { $cond: [{ $eq: ['$hasVoted', false] }, 1, 0] } }
        }
      },
      {
        $project: {
          constituency: '$_id.constituency',
          ward: '$_id.ward',
          total: 1,
          voted: 1,
          pending: 1,
          _id: 0
        }
      },
      { $sort: { constituency: 1, ward: 1 } }
    ]);
    
    // Get recent registrations (last 7 days)
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    
    const recentRegistrations = await Voter.countDocuments({
      createdAt: { $gte: sevenDaysAgo }
    });
    
    res.status(200).json({
      success: true,
      data: {
        summary: {
          total: totalVoters,
          voted: votedCount,
          pending: pendingCount,
          percentageVoted: totalVoters > 0 ? ((votedCount / totalVoters) * 100).toFixed(2) : 0,
          recentRegistrations
        },
        byConstituency,
        byWard
      }
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Get recent registrations
// @route   GET /api/v1/voters/recent
// @access  Private (Admin)
const getRecentRegistrations = async (req, res, next) => {
  try {
    const limit = parseInt(req.query.limit) || 10;
    
    const recentVoters = await Voter.find()
      .select('fullName votingNumber constituency registrationDate createdAt')
      .sort({ registrationDate: -1, createdAt: -1 })
      .limit(limit);
    
    res.status(200).json({
      success: true,
      count: recentVoters.length,
      data: recentVoters,
      lastUpdated: new Date()
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Get today's registrations count
// @route   GET /api/v1/voters/today-count
// @access  Private (Admin)
const getTodaysRegistrationsCount = async (req, res, next) => {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    
    const count = await Voter.countDocuments({
      createdAt: {
        $gte: today,
        $lt: tomorrow
      }
    });
    
    res.status(200).json({
      success: true,
      data: { count }
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Check if national ID is available
// @route   GET /api/v1/voters/check-national-id/:nationalId
// @access  Public/Private
const checkNationalId = async (req, res, next) => {
  try {
    const { nationalId } = req.params;
    
    const existingVoter = await Voter.findOne({ nationalId });
    
    res.status(200).json({
      success: true,
      data: {
        available: !existingVoter,
        message: existingVoter ? 'National ID already registered' : 'National ID available'
      }
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Check if email is available
// @route   GET /api/v1/voters/check-email/:email
// @access  Public/Private
const checkEmail = async (req, res, next) => {
  try {
    const { email } = req.params;
    
    // Decode email if it contains special characters
    const decodedEmail = decodeURIComponent(email);
    
    const existingVoter = await Voter.findOne({ email: decodedEmail });
    
    res.status(200).json({
      success: true,
      data: {
        available: !existingVoter,
        message: existingVoter ? 'Email already registered' : 'Email available'
      }
    });
  } catch (error) {
    next(error);
  }
};

// ========== PUBLIC ENDPOINTS FOR SELF-REGISTRATION ==========

/**
 * @desc    Update temp voter data with edited name
 * @route   PUT /api/v1/voters/self/update-name
 * @access  Public
 */
const updateTempVoterName = async (req, res, next) => {
  try {
    const { tempToken, fullName } = req.body;

    if (!tempToken || !fullName) {
      return res.status(400).json({
        success: false,
        error: 'Token and full name are required'
      });
    }

    if (fullName.split(/\s+/).length < 2) {
      return res.status(400).json({
        success: false,
        error: 'Full name must include at least two words'
      });
    }

    const tempData = await TempVoterData.findOne({ token: tempToken });
    if (!tempData) {
      return res.status(400).json({
        success: false,
        error: 'Invalid or expired token'
      });
    }

    // Update the fullName in tempData
    tempData.fullName = fullName.trim();
    await tempData.save();

    console.log('✅ Updated tempData name to:', fullName);

    res.status(200).json({
      success: true,
      message: 'Name updated successfully'
    });
  } catch (error) {
    console.error('UPDATE NAME ERROR:', error);
    next(error);
  }
};

/**
 * @desc    Upload ID images, perform OCR & quality checks
 * @route   POST /api/v1/voters/self/upload-id
 * @access  Public
 */
const uploadIDForSelfRegistration = async (req, res, next) => {
  try {
    console.log('Upload request received');
    console.log('Files:', req.files ? Object.keys(req.files) : 'No files');
    
    if (!req.files || !req.files.front || !req.files.back) {
      console.log('Missing files:', { 
        files: req.files ? Object.keys(req.files) : null,
        front: req.files?.front,
        back: req.files?.back 
      });
      return res.status(400).json({ 
        success: false, 
        error: 'Both front and back images are required' 
      });
    }

    const frontBuffer = req.files.front[0].buffer;
    const backBuffer = req.files.back[0].buffer;

    console.log(`ID Upload - Front: ${(frontBuffer.length / 1024).toFixed(2)}KB, Back: ${(backBuffer.length / 1024).toFixed(2)}KB`);

    // Validate file sizes
    if (frontBuffer.length > 5 * 1024 * 1024 || backBuffer.length > 5 * 1024 * 1024) {
      return res.status(400).json({
        success: false,
        error: 'File size exceeds 5MB limit'
      });
    }

    // ----- Image quality check (blur) -----
    try {
      const [isFrontBlurry, isBackBlurry] = await Promise.all([
        withTimeout(isImageBlurry(frontBuffer), 5000),
        withTimeout(isImageBlurry(backBuffer), 5000)
      ]);
      
      if (isFrontBlurry || isBackBlurry) {
        return res.status(400).json({
          success: false,
          error: 'One or both images appear blurry. Please upload clearer photos.'
        });
      }
    } catch (blurError) {
      console.error('Blur detection failed:', blurError);
      // Continue without blur check rather than failing
    }

    // ----- Run OCR on both images concurrently with timeout -----
    let frontResult, backResult;
    try {
      console.log('Starting OCR...');
      [frontResult, backResult] = await withTimeout(
        Promise.all([
          Tesseract.recognize(frontBuffer, 'eng', {
            logger: process.env.NODE_ENV === 'development' ? m => console.log(m) : undefined
          }),
          Tesseract.recognize(backBuffer, 'eng')
        ]),
        60000 // 60 second timeout
      );
      console.log('OCR completed successfully');
    } catch (ocrError) {
      console.error('OCR failed:', ocrError);
      return res.status(500).json({
        success: false,
        error: 'Failed to process ID images. Please try again or ensure images are clear.'
      });
    }

    // Combine text from both sides
    const combinedText = (frontResult.data.text || '') + ' ' + (backResult.data.text || '');
    console.log('Combined text length:', combinedText.length);
    console.log('Raw OCR Text:', combinedText);
    
    const extracted = extractIDInfo(combinedText);
    console.log('Extracted data (detailed):', extracted);

    // Validate extracted essential fields
    if (!extracted.nationalId) {
      return res.status(400).json({
        success: false,
        error: 'Could not extract National ID. Please ensure the ID number is clearly visible.'
      });
    }

    if (!extracted.fullName) {
      return res.status(400).json({
        success: false,
        error: 'Could not extract Full Name. Please ensure the name on the ID is clearly visible.'
      });
    }

    // Validate national ID format (Kenyan ID can be 7-10 digits)
    if (!/^\d{7,10}$/.test(extracted.nationalId)) {
      return res.status(400).json({
        success: false,
        error: 'Extracted National ID has invalid format. Must be 7-10 digits.'
      });
    }

    // Age validation using DOB
    if (extracted.dateOfBirth) {
      if (!isValidAge(extracted.dateOfBirth)) {
        return res.status(400).json({
          success: false,
          error: 'Age validation failed: You must be at least 18 years old and not older than 100 years.'
        });
      }
    } else {
      console.log('Date of birth not extracted, continuing without age validation');
      extracted.dateOfBirth = 'Not extracted - will enter manually';
    }

    // Check if ID already registered
    const existingVoter = await Voter.findOne({ nationalId: extracted.nationalId });
    if (existingVoter) {
      return res.status(400).json({
        success: false,
        error: 'A voter with this National ID is already registered.'
      });
    }

    // Check for recent temp record
    const recentTemp = await TempVoterData.findOne({ 
      nationalId: extracted.nationalId,
      createdAt: { $gt: new Date(Date.now() - 24 * 60 * 60 * 1000) }
    });
    if (recentTemp) {
      return res.status(400).json({
        success: false,
        error: 'This National ID was recently used for registration. Please try again after 24 hours if you did not complete registration.'
      });
    }

    // Generate a secure token and store extracted data temporarily
    const token = generateToken();
    
    await TempVoterData.create({
      token,
      nationalId: extracted.nationalId,
      fullName: extracted.fullName, // Store the OCR-extracted name initially
      dateOfBirth: extracted.dateOfBirth === 'Not extracted - will enter manually' ? null : extracted.dateOfBirth,
      // Store all additional fields for reference
      surname: extracted.surname,
      givenNames: extracted.givenNames,
      sex: extracted.sex,
      nationality: extracted.nationality,
      placeOfBirth: extracted.placeOfBirth,
      dateOfExpiry: extracted.dateOfExpiry,
      placeOfIssue: extracted.placeOfIssue,
      cardSerialNumber: extracted.cardSerialNumber
    });

    // Log OCR success
    await auditLogger.log(null, 'OCR_SUCCESS', 'TempVoterData', null, {
      nationalId: extracted.nationalId,
      token
    });

    // Clear file buffers to help garbage collection
    req.files = null;

    // Return token and extracted data for user verification
    res.status(200).json({
      success: true,
      data: {
        tempToken: token,
        nationalId: extracted.nationalId,
        fullName: extracted.fullName, // User will have chance to edit this
        dateOfBirth: extracted.dateOfBirth,
        additionalInfo: {
          surname: extracted.surname,
          givenNames: extracted.givenNames,
          sex: extracted.sex,
          nationality: extracted.nationality,
          placeOfBirth: extracted.placeOfBirth,
          dateOfExpiry: extracted.dateOfExpiry,
          placeOfIssue: extracted.placeOfIssue,
          cardSerialNumber: extracted.cardSerialNumber
        }
      },
      message: 'ID data extracted successfully. Please verify and complete registration.'
    });
  } catch (error) {
    console.error('UPLOAD ID ERROR:', error);
    console.error('Error stack:', error.stack);
    
    // Clear file buffers on error
    if (req.files) req.files = null;
    
    res.status(500).json({
      success: false,
      error: 'An unexpected error occurred. Please try again.'
    });
  }
};

// @desc    Complete self-registration after user confirmation
// @route   POST /api/v1/voters/self/register
// @access  Public
const selfRegisterVoter = async (req, res, next) => {
  try {
    const { tempToken, email, phoneNumber, constituency, ward, declaration, recaptchaToken } = req.body;

    // Validate required fields
    if (!tempToken || !email || !phoneNumber || !constituency || !ward || declaration === undefined) {
      return res.status(400).json({ 
        success: false, 
        error: 'All fields are required' 
      });
    }

    // Verify reCAPTCHA v2 token
    if (!recaptchaToken) {
      return res.status(400).json({
        success: false,
        error: 'reCAPTCHA token is required'
      });
    }

    const isRecaptchaValid = await verifyRecaptcha(recaptchaToken);
    if (!isRecaptchaValid) {
      return res.status(400).json({
        success: false,
        error: 'reCAPTCHA verification failed. Please try again.'
      });
    }

    // Retrieve temp data
    const tempData = await TempVoterData.findOne({ token: tempToken });
    if (!tempData) {
      return res.status(400).json({
        success: false,
        error: 'Invalid or expired token. Please restart registration.'
      });
    }

    // Validate email format
    if (!validateEmail(email)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid email format'
      });
    }

    // Validate phone number
    if (!validatePhoneNumber(phoneNumber)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid phone number format. Use Kenyan format (e.g., 0712345678 or 254712345678)'
      });
    }

    // Check for duplicates (email and nationalId)
    const existingVoter = await Voter.findOne({
      $or: [{ nationalId: tempData.nationalId }, { email }]
    });
    
    if (existingVoter) {
      return res.status(400).json({
        success: false,
        error: 'Voter with this National ID or Email already exists'
      });
    }

    // Validate ward belongs to constituency
    const isValidWard = constituencyData.validateWard(constituency, ward);
    if (!isValidWard) {
      return res.status(400).json({
        success: false,
        error: 'Selected ward does not belong to the constituency'
      });
    }

    // ===== CRITICAL: Use the fullName from tempData as is =====
    // This contains the user-edited name if they updated it in Step 2
    // DO NOT reconstruct from surname/givenNames as that would override user edits
    const fullName = tempData.fullName;

    console.log('✅ Registering voter with name:', fullName);

    // Create voter using data from temp record with the user's confirmed/edited name
    const voter = await Voter.create({
      nationalId: tempData.nationalId,
      fullName: fullName, // This preserves the user's edits from Step 2
      email,
      phoneNumber,
      constituency,
      ward,
      county: 'Kirinyaga'
    });

    // Delete temp data after successful registration
    await tempData.deleteOne();

    // Send email with voting number
    await sendRegistrationEmail(voter, voter.votingNumber);

    // Log self-registration
    await auditLogger.log(null, 'SELF_REGISTER', 'Voter', voter._id, {
      nationalId: voter.nationalId,
      constituency: voter.constituency,
      ward: voter.ward
    });

    res.status(201).json({
      success: true,
      data: {
        votingNumber: voter.votingNumber,
        fullName: voter.fullName,
        constituency: voter.constituency,
        ward: voter.ward
      },
      message: 'Registration successful. Email sent with voting number.'
    });
  } catch (error) {
    console.error('SELF REGISTER ERROR:', error);
    next(error);
  }
};

// Export all functions and the multer upload instance
module.exports = {
  // Admin functions
  registerVoter,
  getVoterCount,
  getPendingVoters,
  getVotedVoters,
  getWardsByConstituency,
  getVoterStatistics,
  getRecentRegistrations,
  getTodaysRegistrationsCount,
  checkNationalId,
  checkEmail,
  
  // Self-registration functions
  uploadIDForSelfRegistration,
  selfRegisterVoter,
  updateTempVoterName,
  
  // Multer instance for routes
  upload
};
