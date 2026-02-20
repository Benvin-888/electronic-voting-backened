const Candidate = require('../models/Candidate');
const auditLogger = require('../utils/auditLogger');
const constituencyData = require('../utils/constituencyData');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

// Configure multer for photo uploads
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const uploadDir = 'uploads/candidates';
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, 'candidate-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const fileFilter = (req, file, cb) => {
  if (file.mimetype.startsWith('image/')) {
    cb(null, true);
  } else {
    cb(new Error('Not an image! Please upload only images.'), false);
  }
};

const upload = multer({
  storage: storage,
  fileFilter: fileFilter,
  limits: {
    fileSize: 5 * 1024 * 1024 // 5MB max file size
  }
});

// @desc    Add new candidate
// @route   POST /api/v1/candidates
// @access  Private (Admin)
const addCandidate = async (req, res, next) => {
  try {
    const { fullName, position, politicalParty, constituency, ward } = req.body;
    
    // Validate position-specific requirements
    if ((position === 'MP' || position === 'MCA') && !constituency) {
      return res.status(400).json({
        success: false,
        error: `Constituency is required for ${position} position`
      });
    }
    
    if (position === 'MCA' && !ward) {
      return res.status(400).json({
        success: false,
        error: 'Ward is required for MCA position'
      });
    }
    
    // Check for duplicate candidate (same party, position, area)
    const duplicateFilter = {
      position,
      politicalParty,
      county: 'Kirinyaga',
      isActive: true
    };
    
    if (position === 'MP' || position === 'MCA') {
      duplicateFilter.constituency = constituency;
    }
    
    if (position === 'MCA') {
      duplicateFilter.ward = ward;
    }
    
    const existingCandidate = await Candidate.findOne(duplicateFilter);
    
    if (existingCandidate) {
      return res.status(400).json({
        success: false,
        error: 'Candidate for this party and position already exists in the specified area'
      });
    }
    
    // Handle photo upload
    let photoUrl = '';
    if (req.file) {
      photoUrl = `/uploads/candidates/${req.file.filename}`;
    }
    
    // Create candidate
    const candidate = await Candidate.create({
      fullName,
      position,
      politicalParty,
      constituency: position === 'Governor' || position === 'Women Representative' ? null : constituency,
      ward: position === 'MCA' ? ward : null,
      photo: photoUrl,
      county: 'Kirinyaga'
    });
    
    // Log the action
    await auditLogger.log(req.admin._id, 'CREATE', 'Candidate', candidate._id, {
      name: candidate.fullName,
      position: candidate.position,
      party: candidate.politicalParty
    });
    
    res.status(201).json({
      success: true,
      data: candidate
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Get all candidates
// @route   GET /api/v1/candidates
// @access  Public (for voting portal) / Private (for admin)
const getCandidates = async (req, res, next) => {
  try {
    const { position, constituency, ward, party, page = 1, limit = 50 } = req.query;
    
    // Build filter
    const filter = { isActive: true };
    if (position) filter.position = position;
    if (constituency) filter.constituency = constituency;
    if (ward) filter.ward = ward;
    if (party) filter.politicalParty = party;
    
    // Pagination
    const skip = (page - 1) * limit;
    
    const candidates = await Candidate.find(filter)
      .select('fullName position politicalParty constituency ward photo voteCount')
      .sort({ position: 1, constituency: 1, ward: 1, fullName: 1 })
      .skip(skip)
      .limit(parseInt(limit));
    
    const total = await Candidate.countDocuments(filter);
    
    res.status(200).json({
      success: true,
      count: candidates.length,
      total,
      pages: Math.ceil(total / limit),
      currentPage: parseInt(page),
      data: candidates
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Get candidate by ID
// @route   GET /api/v1/candidates/:id
// @access  Public
const getCandidate = async (req, res, next) => {
  try {
    const candidate = await Candidate.findById(req.params.id);
    
    if (!candidate) {
      return res.status(404).json({
        success: false,
        error: 'Candidate not found'
      });
    }
    
    res.status(200).json({
      success: true,
      data: candidate
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Update candidate
// @route   PUT /api/v1/candidates/:id
// @access  Private (Admin)
const updateCandidate = async (req, res, next) => {
  try {
    let candidate = await Candidate.findById(req.params.id);
    
    if (!candidate) {
      return res.status(404).json({
        success: false,
        error: 'Candidate not found'
      });
    }
    
    // Check for duplicate candidate (excluding current candidate)
    const { position, politicalParty, constituency, ward } = req.body;
    const duplicateFilter = {
      _id: { $ne: req.params.id },
      position: position || candidate.position,
      politicalParty: politicalParty || candidate.politicalParty,
      county: 'Kirinyaga',
      isActive: true
    };
    
    const targetPosition = position || candidate.position;
    const targetConstituency = constituency || candidate.constituency;
    const targetWard = ward || candidate.ward;
    
    if (targetPosition === 'MP' || targetPosition === 'MCA') {
      duplicateFilter.constituency = targetConstituency;
    }
    
    if (targetPosition === 'MCA') {
      duplicateFilter.ward = targetWard;
    }
    
    const existingCandidate = await Candidate.findOne(duplicateFilter);
    
    if (existingCandidate) {
      return res.status(400).json({
        success: false,
        error: 'Another candidate for this party and position already exists in the specified area'
      });
    }
    
    // Handle photo update
    if (req.file) {
      // Delete old photo if exists
      if (candidate.photo) {
        const oldPhotoPath = `uploads/candidates/${path.basename(candidate.photo)}`;
        if (fs.existsSync(oldPhotoPath)) {
          fs.unlinkSync(oldPhotoPath);
        }
      }
      req.body.photo = `/uploads/candidates/${req.file.filename}`;
    }
    
    // Update candidate
    candidate = await Candidate.findByIdAndUpdate(
      req.params.id,
      req.body,
      {
        new: true,
        runValidators: true
      }
    );
    
    // Log the action
    await auditLogger.log(req.admin._id, 'UPDATE', 'Candidate', candidate._id, {
      updates: Object.keys(req.body)
    });
    
    res.status(200).json({
      success: true,
      data: candidate
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Delete/Deactivate candidate
// @route   DELETE /api/v1/candidates/:id
// @access  Private (Admin)
const deleteCandidate = async (req, res, next) => {
  try {
    const candidate = await Candidate.findById(req.params.id);
    
    if (!candidate) {
      return res.status(404).json({
        success: false,
        error: 'Candidate not found'
      });
    }
    
    // Check if candidate has votes
    if (candidate.voteCount > 0) {
      // Soft delete (deactivate) instead of hard delete
      candidate.isActive = false;
      await candidate.save();
    } else {
      // Hard delete if no votes
      // Delete photo if exists
      if (candidate.photo) {
        const photoPath = `uploads/candidates/${path.basename(candidate.photo)}`;
        if (fs.existsSync(photoPath)) {
          fs.unlinkSync(photoPath);
        }
      }
      await candidate.deleteOne();
    }
    
    // Log the action
    await auditLogger.log(req.admin._id, 'DELETE', 'Candidate', candidate._id, {
      name: candidate.fullName,
      votes: candidate.voteCount
    });
    
    res.status(200).json({
      success: true,
      message: candidate.voteCount > 0 
        ? 'Candidate deactivated (has votes)' 
        : 'Candidate deleted successfully',
      data: {}
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Get candidate statistics
// @route   GET /api/v1/candidates/statistics/overview
// @access  Private (Admin)
const getCandidateStatistics = async (req, res, next) => {
  try {
    const statistics = await Candidate.aggregate([
      {
        $match: { isActive: true }
      },
      {
        $group: {
          _id: {
            position: '$position',
            constituency: '$constituency'
          },
          count: { $sum: 1 },
          totalVotes: { $sum: '$voteCount' }
        }
      },
      {
        $group: {
          _id: '$_id.position',
          constituencies: {
            $push: {
              constituency: '$_id.constituency',
              count: '$count',
              totalVotes: '$totalVotes'
            }
          },
          totalCandidates: { $sum: '$count' },
          totalVotes: { $sum: '$totalVotes' }
        }
      },
      {
        $sort: { _id: 1 }
      }
    ]);
    
    // Get party distribution
    const partyStats = await Candidate.aggregate([
      {
        $match: { isActive: true }
      },
      {
        $group: {
          _id: '$politicalParty',
          candidates: { $sum: 1 },
          totalVotes: { $sum: '$voteCount' }
        }
      },
      {
        $sort: { candidates: -1 }
      }
    ]);
    
    res.status(200).json({
      success: true,
      data: {
        byPosition: statistics,
        byParty: partyStats
      }
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Get candidates by position and area
// @route   GET /api/v1/candidates/by-position/:position
// @access  Public
const getCandidatesByPosition = async (req, res, next) => {
  try {
    const { position } = req.params;
    const { constituency, ward } = req.query;
    
    const filter = {
      position,
      isActive: true
    };
    
    if (position === 'MP' || position === 'MCA') {
      if (!constituency) {
        return res.status(400).json({
          success: false,
          error: 'Constituency parameter is required for MP and MCA positions'
        });
      }
      filter.constituency = constituency;
    }
    
    if (position === 'MCA') {
      if (!ward) {
        return res.status(400).json({
          success: false,
          error: 'Ward parameter is required for MCA position'
        });
      }
      filter.ward = ward;
    }
    
    const candidates = await Candidate.find(filter)
      .select('fullName politicalParty photo voteCount')
      .sort({ voteCount: -1 });
    
    res.status(200).json({
      success: true,
      count: candidates.length,
      data: candidates
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Upload candidate photo
// @route   POST /api/v1/candidates/:id/photo
// @access  Private (Admin)
const uploadCandidatePhoto = async (req, res, next) => {
  try {
    const candidate = await Candidate.findById(req.params.id);
    
    if (!candidate) {
      return res.status(404).json({
        success: false,
        error: 'Candidate not found'
      });
    }
    
    if (!req.file) {
      return res.status(400).json({
        success: false,
        error: 'Please upload a photo'
      });
    }
    
    // Delete old photo if exists
    if (candidate.photo) {
      const oldPhotoPath = `uploads/candidates/${path.basename(candidate.photo)}`;
      if (fs.existsSync(oldPhotoPath)) {
        fs.unlinkSync(oldPhotoPath);
      }
    }
    
    // Update candidate with new photo
    candidate.photo = `/uploads/candidates/${req.file.filename}`;
    await candidate.save();
    
    // Log the action
    await auditLogger.log(req.admin._id, 'UPDATE', 'Candidate', candidate._id, {
      action: 'photo_upload'
    });
    
    res.status(200).json({
      success: true,
      data: {
        photo: candidate.photo
      }
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  addCandidate,
  getCandidates,
  getCandidate,
  updateCandidate,
  deleteCandidate,
  getCandidateStatistics,
  getCandidatesByPosition,
  uploadCandidatePhoto,
  upload
};