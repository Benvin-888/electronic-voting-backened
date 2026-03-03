// controllers/voterController.js
const Voter = require('../models/Voter');
const TempVoterData = require('../models/TempVoterData'); // IMPORT TempVoterData
const { sendRegistrationEmail } = require('../utils/emailService');
const auditLogger = require('../utils/auditLogger');
const constituencyData = require('../utils/constituencyData');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto'); // ADD for generateToken

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

// Helper: Generate a secure random token
const generateToken = () => {
  return crypto.randomBytes(32).toString('hex');
};

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

// ===== NEW: Signature validation helper =====
const validateSignature = (signature) => {
  if (!signature) {
    return { valid: false, error: 'Signature is required' };
  }
  
  // Check if it's a valid base64 image
  const signatureRegex = /^data:image\/(png|jpeg|jpg);base64,/;
  if (!signatureRegex.test(signature)) {
    return { 
      valid: false, 
      error: 'Invalid signature format. Must be a base64 encoded image (PNG, JPEG, JPG)' 
    };
  }
  
  try {
    // Check size (max 1MB)
    const base64Data = signature.split(',')[1];
    const signatureSize = Buffer.from(base64Data, 'base64').length;
    
    if (signatureSize > 1024 * 1024) {
      return { 
        valid: false, 
        error: 'Signature image too large. Maximum size is 1MB' 
      };
    }
    
    if (signatureSize < 100) {
      return { 
        valid: false, 
        error: 'Signature appears to be empty or too small' 
      };
    }
    
    return { valid: true };
  } catch (err) {
    return { 
      valid: false, 
      error: 'Invalid signature data format' 
    };
  }
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
    .replace(/[^\w\s\/\-:]/g, '') // Remove remaining special chars except slashes, dashes, colons
    .trim();
  
  return cleaned;
}

// Helper: Extract ID fields from OCR text (Kenyan ID card) - IMPROVED VERSION
function extractIDInfo(ocrText) {
  try {
    if (!ocrText || typeof ocrText !== 'string') {
      console.error('Invalid OCR text provided to extractIDInfo');
      return { nationalId: null, fullName: null, dateOfBirth: null };
    }
    
    // First, clean the text
    const cleaned = cleanOCRText(ocrText);
    console.log('Cleaned OCR text:', cleaned);
    
    // More flexible patterns for Kenyan ID cards
    const text = cleaned;
    
    // Pattern for National ID - look for 7-8 digit numbers
    // Try to find ID number near common keywords first
    let nationalId = null;
    
    // Look for ID number after keywords
    const idKeywordPattern = /(?:id|identity|national|serial)\s*(?:no|number|#)?\s*[:.]?\s*(\d{7,8})/i;
    const idKeywordMatch = text.match(idKeywordPattern);
    
    if (idKeywordMatch) {
      nationalId = idKeywordMatch[1];
    } else {
      // If no keyword match, look for any 7-8 digit number
      const anyIdPattern = /\b(\d{7,8})\b/;
      const anyIdMatch = text.match(anyIdPattern);
      if (anyIdMatch) {
        nationalId = anyIdMatch[1];
      }
    }
    
    // Pattern for Full Name - look for name after NAME keyword or between common patterns
    let fullName = null;
    
    // Try multiple name patterns
    const namePatterns = [
      /(?:name|fullname|full name)\s*[:.]?\s*([A-Z\s]+?)(?=\s+(?:date|dob|sex|birth|place|citizen|$))/i,
      /([A-Z]{2,}(?:\s+[A-Z]{2,})+)/ // Look for all caps words (likely a name)
    ];
    
    for (const pattern of namePatterns) {
      const nameMatch = text.match(pattern);
      if (nameMatch && nameMatch[1]) {
        fullName = nameMatch[1].trim();
        // Clean up the name (remove extra spaces, fix case)
        fullName = fullName.replace(/\s+/g, ' ').trim();
        // Convert to title case (each word first letter capital)
        fullName = fullName.toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
        break;
      }
    }
    
    // Pattern for Date of Birth - very flexible
    let dateOfBirth = null;
    
    // Try multiple date patterns
    const datePatterns = [
      /(?:dob|date of birth|birth date|birthday|dateofbirth)\s*[:.]?\s*(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/i,
      /\b(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})\b/
    ];
    
    for (const pattern of datePatterns) {
      const dateMatch = text.match(pattern);
      if (dateMatch) {
        // Try to extract from named groups or indices
        if (dateMatch.length >= 4) {
          // Format as DD/MM/YYYY
          const day = dateMatch[1].padStart(2, '0');
          const month = dateMatch[2].padStart(2, '0');
          let year = dateMatch[3];
          if (year.length === 2) {
            year = '19' + year; // Assume 19xx for 2-digit years
          }
          dateOfBirth = `${day}/${month}/${year}`;
          break;
        }
      }
    }
    
    const result = {
      nationalId: nationalId,
      fullName: fullName,
      dateOfBirth: dateOfBirth
    };
    
    console.log('Extracted ID Info:', result);
    return result;
  } catch (error) {
    console.error('Error in extractIDInfo:', error);
    return { nationalId: null, fullName: null, dateOfBirth: null };
  }
}

// Helper: Validate age (not older than 100 years, not younger than 18)
function isValidAge(dateOfBirthStr) {
  try {
    if (!dateOfBirthStr) return false;
    
    const parts = dateOfBirthStr.split(/[/-]/);
    if (parts.length !== 3) return false;
    
    let year = parseInt(parts[2]);
    if (isNaN(year)) return false;
    
    if (year < 100) year += 2000;
    
    const month = parseInt(parts[1]) - 1;
    const day = parseInt(parts[0]);
    
    if (isNaN(month) || isNaN(day)) return false;
    
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

// ========== ADMIN FUNCTIONS ==========

// @desc    Register new voter (Admin only) with signature
// @route   POST /api/v1/voters/register
// @access  Private (Admin)
const registerVoter = async (req, res, next) => {
  try {
    const { 
      nationalId, 
      fullName, 
      email, 
      phoneNumber, 
      constituency, 
      ward,
      signature  // New signature field
    } = req.body;

    // Validate all required fields
    if (!nationalId || !fullName || !email || !phoneNumber || !constituency || !ward) {
      return res.status(400).json({
        success: false,
        error: 'All basic fields are required'
      });
    }

    // Validate signature
    const signatureValidation = validateSignature(signature);
    if (!signatureValidation.valid) {
      return res.status(400).json({
        success: false,
        error: signatureValidation.error
      });
    }

    // Validate email
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

    // Create voter with signature
    const voterData = {
      nationalId,
      fullName,
      email,
      phoneNumber,
      constituency,
      ward,
      county: 'Kirinyaga',
      signature  // Add the signature
    };

    // Create voter
    const voter = await Voter.create(voterData);

    // Send registration email
    await sendRegistrationEmail(voter, voter.votingNumber);

    // Log the action
    await auditLogger.log(req.admin._id, 'CREATE', 'Voter', voter._id, {
      nationalId: voter.nationalId,
      constituency: voter.constituency,
      ward: voter.ward,
      hasSignature: true
    });

    res.status(201).json({
      success: true,
      data: {
        votingNumber: voter.votingNumber,
        fullName: voter.fullName,
        constituency: voter.constituency,
        ward: voter.ward,
        hasSignature: true
      },
      message: 'Voter registered successfully with signature. Email sent with voting number.'
    });
  } catch (error) {
    console.error('Registration error:', error);
    
    // Check for duplicate key error
    if (error.code === 11000) {
      const field = Object.keys(error.keyPattern)[0];
      return res.status(400).json({
        success: false,
        error: `Duplicate value for ${field}. Please use unique values.`
      });
    }
    
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
      .select('votingNumber fullName constituency ward signature hasVoted')
      .sort({ registrationDate: -1 });
    
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
      .select('votingNumber fullName constituency ward signature hasVoted votedAt')
      .sort({ registrationDate: -1 });
    
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

// @desc    Get voter's signature
// @route   GET /api/v1/voters/:voterId/signature
// @access  Private (Admin)
const getVoterSignature = async (req, res, next) => {
  try {
    const { voterId } = req.params;
    
    const voter = await Voter.findById(voterId).select('fullName votingNumber signature');
    
    if (!voter) {
      return res.status(404).json({
        success: false,
        error: 'Voter not found'
      });
    }
    
    if (!voter.signature) {
      return res.status(404).json({
        success: false,
        error: 'No signature found for this voter'
      });
    }
    
    res.status(200).json({
      success: true,
      data: {
        fullName: voter.fullName,
        votingNumber: voter.votingNumber,
        signature: voter.signature
      }
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
    const withSignatureCount = await Voter.countDocuments({ signature: { $exists: true, $ne: null } });
    
    // Count by constituency
    const byConstituency = await Voter.aggregate([
      {
        $group: {
          _id: '$constituency',
          total: { $sum: 1 },
          voted: { $sum: { $cond: [{ $eq: ['$hasVoted', true] }, 1, 0] } },
          pending: { $sum: { $cond: [{ $eq: ['$hasVoted', false] }, 1, 0] } },
          withSignature: { $sum: { $cond: [{ $and: [{ $ne: ['$signature', null] }, { $ne: ['$signature', ''] }] }, 1, 0] } }
        }
      },
      { $sort: { _id: 1 } }
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
      { $sort: { '_id.constituency': 1, '_id.ward': 1 } }
    ]);
    
    res.status(200).json({
      success: true,
      data: {
        summary: {
          total: totalVoters,
          voted: votedCount,
          pending: pendingCount,
          withSignature: withSignatureCount,
          percentageVoted: totalVoters > 0 ? ((votedCount / totalVoters) * 100).toFixed(2) : 0,
          percentageWithSignature: totalVoters > 0 ? ((withSignatureCount / totalVoters) * 100).toFixed(2) : 0
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
      .select('fullName votingNumber constituency registrationDate hasVoted signature')
      .sort({ registrationDate: -1 })
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
      registrationDate: {
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
    
    const existingVoter = await Voter.findOne({ email });
    
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

    // Validate input
    if (!tempToken || !fullName) {
      return res.status(400).json({
        success: false,
        error: 'Token and full name are required'
      });
    }

    // Validate name format (at least 2 words, only letters and spaces)
    const nameParts = fullName.trim().split(/\s+/);
    if (nameParts.length < 2) {
      return res.status(400).json({
        success: false,
        error: 'Full name must include at least first name and surname'
      });
    }

    // Validate each part contains only letters and common name characters
    const nameRegex = /^[A-Za-z\s'-]+$/;
    if (!nameRegex.test(fullName)) {
      return res.status(400).json({
        success: false,
        error: 'Name can only contain letters, spaces, hyphens, and apostrophes'
      });
    }

    // Find temp data by token
    const tempData = await TempVoterData.findOne({ token: tempToken });
    
    if (!tempData) {
      return res.status(404).json({
        success: false,
        error: 'Invalid or expired token. Please restart registration.'
      });
    }

    // Check if token has expired (optional, since MongoDB TTL will auto-delete)
    const tokenAge = Date.now() - tempData.createdAt.getTime();
    const oneHour = 60 * 60 * 1000; // 1 hour in milliseconds
    
    if (tokenAge > oneHour) {
      // Optionally delete expired token
      await tempData.deleteOne();
      return res.status(410).json({
        success: false,
        error: 'Token has expired. Please restart registration.'
      });
    }

    // Store the original name for logging
    const oldName = tempData.fullName;

    // Update the fullName in tempData
    tempData.fullName = fullName.trim();
    
    // Optional: Also update surname/givenNames if you want to keep them in sync
    // This helps if you need to use them separately later
    const namePartsArray = fullName.trim().split(/\s+/);
    if (namePartsArray.length >= 2) {
      // Assume last part is surname, everything else is given names
      tempData.surname = namePartsArray.pop(); // Last word as surname
      tempData.givenNames = namePartsArray.join(' '); // Remaining as given names
    }

    await tempData.save();

    console.log('✅ Updated tempData:', {
      token: tempToken,
      oldName,
      newName: tempData.fullName,
      surname: tempData.surname,
      givenNames: tempData.givenNames
    });

    // Log the update
    await auditLogger.log(null, 'UPDATE_TEMP_NAME', 'TempVoterData', tempData._id, {
      nationalId: tempData.nationalId,
      oldName,
      newName: tempData.fullName
    });

    res.status(200).json({
      success: true,
      message: 'Name updated successfully',
      data: {
        fullName: tempData.fullName,
        surname: tempData.surname,
        givenNames: tempData.givenNames
      }
    });
  } catch (error) {
    console.error('UPDATE NAME ERROR:', error);
    
    // Handle MongoDB errors
    if (error.name === 'CastError') {
      return res.status(400).json({
        success: false,
        error: 'Invalid token format'
      });
    }
    
    next(error);
  }
};

// @desc    Upload ID images, perform OCR & quality checks
// @route   POST /api/v1/voters/self/upload-id
// @access  Public
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
    console.log('Extracted data:', extracted);

    // Validate extracted essential fields - be more lenient
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

    // Age validation using DOB - make DOB optional for now if extraction fails
    if (extracted.dateOfBirth) {
      if (!isValidAge(extracted.dateOfBirth)) {
        return res.status(400).json({
          success: false,
          error: 'Age validation failed: You must be at least 18 years old and not older than 100 years.'
        });
      }
    } else {
      console.log('Date of birth not extracted, continuing without age validation');
      // Set a placeholder date - user can enter manually in step 3
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
    const { 
      tempToken,
      email, 
      phoneNumber, 
      constituency, 
      ward,
      signature  // Add signature for self-registration
    } = req.body;

    // Validate required fields
    if (!tempToken || !email || !phoneNumber || !constituency || !ward) {
      return res.status(400).json({ 
        success: false, 
        error: 'All fields are required' 
      });
    }

    // Validate signature
    const signatureValidation = validateSignature(signature);
    if (!signatureValidation.valid) {
      return res.status(400).json({
        success: false,
        error: signatureValidation.error
      });
    }

    // Find temp data by token
    const tempData = await TempVoterData.findOne({ token: tempToken });
    
    if (!tempData) {
      return res.status(404).json({
        success: false,
        error: 'Invalid or expired token. Please restart registration.'
      });
    }

    // Check if token has expired
    const tokenAge = Date.now() - tempData.createdAt.getTime();
    const oneHour = 60 * 60 * 1000;
    
    if (tokenAge > oneHour) {
      await tempData.deleteOne();
      return res.status(410).json({
        success: false,
        error: 'Token has expired. Please restart registration.'
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

    // Check for duplicates
    const existingVoter = await Voter.findOne({
      $or: [{ nationalId: tempData.nationalId }, { email }]
    });
    
    if (existingVoter) {
      // Clean up temp data since it's no longer needed
      await tempData.deleteOne();
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

    // Use the updated name from tempData
    const fullName = tempData.fullName;

    console.log('✅ Registering voter with name:', fullName);

    // Create voter with data from temp record and signature
    const voter = await Voter.create({
      nationalId: tempData.nationalId,
      fullName: fullName, // This is the user-edited name
      email,
      phoneNumber,
      constituency,
      ward,
      county: 'Kirinyaga',
      signature  // Add signature
    });

    // Store additional info from tempData if needed
    if (tempData.dateOfBirth && tempData.dateOfBirth !== 'Not extracted - will enter manually') {
      // You might want to store DOB in a separate field if you add it to the model
      console.log('Date of birth from ID:', tempData.dateOfBirth);
    }

    // Delete temp data after successful registration
    await tempData.deleteOne();

    // Send email with voting number
    await sendRegistrationEmail(voter, voter.votingNumber);

    // Log self-registration (adminId = null)
    await auditLogger.log(null, 'SELF_REGISTER', 'Voter', voter._id, {
      nationalId: voter.nationalId,
      constituency: voter.constituency,
      ward: voter.ward,
      hasSignature: true,
      nameEdited: fullName !== tempData.fullName // Log if name was edited
    });

    res.status(201).json({
      success: true,
      data: {
        votingNumber: voter.votingNumber,
        fullName: voter.fullName,
        constituency: voter.constituency,
        ward: voter.ward,
        hasSignature: true
      },
      message: 'Registration successful with signature. Email sent with voting number.'
    });
  } catch (error) {
    console.error('SELF REGISTER ERROR:', error);
    
    // Check for duplicate key error
    if (error.code === 11000) {
      const field = Object.keys(error.keyPattern)[0];
      return res.status(400).json({
        success: false,
        error: `Duplicate value for ${field}. Please use unique values.`
      });
    }
    
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
  getVoterSignature,  // New function
  
  // Self-registration functions
  uploadIDForSelfRegistration,
  selfRegisterVoter,
  updateTempVoterName, // ADDED: Export the update function
  
  // Multer instance for routes
  upload
};