const Feedback = require('../models/Feedback');

// ======================
// USER CONTROLLERS
// ======================

/**
 * @desc    Submit new feedback
 */
exports.submitFeedback = async (req, res) => {
  try {
    const { rating, category, comment, isAnonymous, wantsReply, contactEmail } = req.body;

    if (!rating || !category) {
      return res.status(400).json({
        success: false,
        message: 'Rating and category are required'
      });
    }

    const feedbackData = {
      rating,
      category,
      comment: comment || '',
      isAnonymous: isAnonymous !== undefined ? isAnonymous : true,
      wantsReply: wantsReply || false,
      contactEmail: (!isAnonymous && wantsReply) ? contactEmail : undefined,
      systemInfo: {
        userAgent: req.headers['user-agent'],
        platform: req.headers['sec-ch-ua-platform'] || 'unknown',
        language: req.headers['accept-language']
      }
    };

    if (req.voter && !isAnonymous) {
      feedbackData.voter = req.voter.id;
    }

    const feedback = await Feedback.create(feedbackData);

    // Emit real‑time notification if Socket.io is attached
    if (req.io) {
      req.io.to('admin-feedbacks').emit('new-feedback', {
        id: feedback._id,
        rating: feedback.rating,
        category: feedback.category,
        time: feedback.submittedAt
      });
    }

    res.status(201).json({
      success: true,
      message: 'Feedback submitted successfully',
      data: {
        id: feedback._id,
        reference: `FB-${feedback._id.toString().slice(-6).toUpperCase()}`
      }
    });

  } catch (error) {
    console.error('Feedback submission error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to submit feedback',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

/**
 * @desc    Get feedback status by ID
 */
exports.getFeedbackStatus = async (req, res) => {
  try {
    const feedback = await Feedback.findById(req.params.id)
      .select('status submittedAt reviewedAt');

    if (!feedback) {
      return res.status(404).json({
        success: false,
        message: 'Feedback not found'
      });
    }

    res.status(200).json({
      success: true,
      data: {
        status: feedback.status,
        submittedAt: feedback.submittedAt,
        reviewedAt: feedback.reviewedAt
      }
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve feedback status'
    });
  }
};

/**
 * @desc    Get feedback history for authenticated voter
 */
exports.getMyFeedback = async (req, res) => {
  try {
    const feedbacks = await Feedback.find({
      voter: req.voter.id,
      isAnonymous: false
    })
      .select('rating category comment status submittedAt')
      .sort('-submittedAt')
      .limit(20);

    res.status(200).json({
      success: true,
      count: feedbacks.length,
      data: feedbacks
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve your feedback'
    });
  }
};

// ======================
// ADMIN CONTROLLERS
// ======================

/**
 * @desc    Get all feedback with filters and pagination
 */
exports.getAllFeedback = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;

    const filter = {};
    if (req.query.status) filter.status = req.query.status;
    if (req.query.category) filter.category = req.query.category;
    if (req.query.rating) filter.rating = parseInt(req.query.rating);
    
    if (req.query.startDate || req.query.endDate) {
      filter.submittedAt = {};
      if (req.query.startDate) filter.submittedAt.$gte = new Date(req.query.startDate);
      if (req.query.endDate) filter.submittedAt.$lte = new Date(req.query.endDate);
    }

    let searchQuery = {};
    if (req.query.search) {
      searchQuery = {
        $or: [
          { comment: { $regex: req.query.search, $options: 'i' } },
          { adminNotes: { $regex: req.query.search, $options: 'i' } }
        ]
      };
    }

    const query = { ...filter, ...searchQuery };

    const feedbacks = await Feedback.find(query)
      .populate('voter', 'fullName email voterId')
      .populate('reviewedBy', 'username')
      .sort(req.query.sortBy || '-submittedAt')
      .skip(skip)
      .limit(limit);

    const total = await Feedback.countDocuments(query);

    // Optional statistics (simplified, remove if not needed)
    const stats = await Feedback.aggregate([
      { $match: query },
      {
        $group: {
          _id: null,
          averageRating: { $avg: '$rating' },
          totalFeedbacks: { $sum: 1 }
        }
      }
    ]);

    res.status(200).json({
      success: true,
      data: feedbacks,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit)
      },
      stats: {
        averageRating: stats[0]?.averageRating?.toFixed(1) || 0,
        totalFeedbacks: stats[0]?.totalFeedbacks || 0
      }
    });

  } catch (error) {
    console.error('Admin feedback fetch error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve feedbacks'
    });
  }
};

/**
 * @desc    Get single feedback by ID
 */
exports.getFeedbackById = async (req, res) => {
  try {
    const feedback = await Feedback.findById(req.params.id)
      .populate('voter', 'fullName email voterId phoneNumber')
      .populate('reviewedBy', 'username email');

    if (!feedback) {
      return res.status(404).json({
        success: false,
        message: 'Feedback not found'
      });
    }

    res.status(200).json({
      success: true,
      data: feedback
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve feedback'
    });
  }
};

/**
 * @desc    Update feedback status
 */
exports.updateFeedbackStatus = async (req, res) => {
  try {
    const { status, adminNotes } = req.body;

    if (!['new', 'in-review', 'resolved', 'archived'].includes(status)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid status value'
      });
    }

    const feedback = await Feedback.findByIdAndUpdate(
      req.params.id,
      {
        status,
        adminNotes: adminNotes || undefined,
        reviewedAt: status === 'resolved' ? Date.now() : undefined,
        reviewedBy: req.admin?.id
      },
      { new: true, runValidators: true }
    );

    if (!feedback) {
      return res.status(404).json({
        success: false,
        message: 'Feedback not found'
      });
    }

    res.status(200).json({
      success: true,
      message: 'Feedback status updated',
      data: feedback
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to update feedback status'
    });
  }
};

/**
 * @desc    Bulk update feedback status
 */
exports.bulkUpdateFeedback = async (req, res) => {
  try {
    const { feedbackIds, status } = req.body;

    if (!feedbackIds || !Array.isArray(feedbackIds) || feedbackIds.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Please provide feedback IDs array'
      });
    }

    if (!['new', 'in-review', 'resolved', 'archived'].includes(status)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid status value'
      });
    }

    const result = await Feedback.updateMany(
      { _id: { $in: feedbackIds } },
      {
        status,
        reviewedAt: status === 'resolved' ? Date.now() : undefined,
        reviewedBy: req.admin?.id
      }
    );

    res.status(200).json({
      success: true,
      message: `Updated ${result.modifiedCount} feedback items`
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to bulk update feedback'
    });
  }
};

/**
 * @desc    Delete feedback
 */
exports.deleteFeedback = async (req, res) => {
  try {
    const feedback = await Feedback.findByIdAndDelete(req.params.id);

    if (!feedback) {
      return res.status(404).json({
        success: false,
        message: 'Feedback not found'
      });
    }

    res.status(200).json({
      success: true,
      message: 'Feedback deleted successfully'
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to delete feedback'
    });
  }
};

/**
 * @desc    Get feedback analytics
 */
exports.getFeedbackAnalytics = async (req, res) => {
  try {
    const { from, to } = req.query;
    
    const dateFilter = {};
    if (from || to) {
      dateFilter.submittedAt = {};
      if (from) dateFilter.submittedAt.$gte = new Date(from);
      if (to) dateFilter.submittedAt.$lte = new Date(to);
    }

    const overall = await Feedback.aggregate([
      { $match: dateFilter },
      {
        $group: {
          _id: null,
          total: { $sum: 1 },
          avgRating: { $avg: '$rating' },
          responseRate: {
            $avg: { $cond: [{ $ne: ['$reviewedAt', null] }, 1, 0] }
          }
        }
      }
    ]);

    const ratingDistribution = await Feedback.aggregate([
      { $match: dateFilter },
      { $group: { _id: '$rating', count: { $sum: 1 } } },
      { $sort: { _id: 1 } }
    ]);

    const categoryDistribution = await Feedback.aggregate([
      { $match: dateFilter },
      {
        $group: {
          _id: '$category',
          count: { $sum: 1 },
          avgRating: { $avg: '$rating' }
        }
      }
    ]);

    res.status(200).json({
      success: true,
      data: {
        overall: overall[0] || { total: 0, avgRating: 0, responseRate: 0 },
        ratingDistribution,
        categoryDistribution
      }
    });

  } catch (error) {
    console.error('Analytics error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to generate analytics'
    });
  }
};

/**
 * @desc    Export feedback as JSON or CSV
 */
exports.exportFeedback = async (req, res) => {
  try {
    const { format = 'json' } = req.query;
    
    const feedbacks = await Feedback.find()
      .populate('voter', 'fullName email voterId')
      .populate('reviewedBy', 'username')
      .lean();

    if (format === 'csv') {
      const fields = ['_id', 'rating', 'category', 'comment', 'isAnonymous', 
                      'status', 'submittedAt', 'voter.fullName', 'voter.email'];
      
      const csvRows = feedbacks.map(f => {
        return fields.map(field => {
          if (field.includes('.')) {
            const [parent, child] = field.split('.');
            return f[parent]?.[child] || '';
          }
          return f[field] || '';
        }).join(',');
      });

      csvRows.unshift(fields.join(','));

      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', 'attachment; filename=feedback-export.csv');
      return res.status(200).send(csvRows.join('\n'));
    }

    // Default JSON
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', 'attachment; filename=feedback-export.json');
    res.status(200).json(feedbacks);

  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to export feedback'
    });
  }
};