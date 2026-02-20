
require('dotenv').config();
const Voter = require('../models/Voter');
const Candidate = require('../models/Candidate');
const Vote = require('../models/Vote');
const SystemSetting = require('../models/SystemSetting');
const Admin = require('../models/Admin');
const { sendPortalNotification } = require('../utils/emailService');
const auditLogger = require('../utils/auditLogger');
const mongoose = require('mongoose');
const PDFDocument = require('pdfkit');
const ExcelJS = require('exceljs');

// @desc    Get admin dashboard statistics
// @route   GET /api/v1/admin/dashboard
// @access  Private (Admin)
const getDashboardStats = async (req, res, next) => {
  try {
    // Get counts
    const totalVoters = await Voter.countDocuments();
    const totalCandidates = await Candidate.countDocuments();
    const totalVotes = await Vote.countDocuments();
    
    // Get voting portal status
    const portalStatus = await SystemSetting.findOne({ key: 'voting_portal_open' });
    
    // Get votes by position
    const votesByPosition = await Vote.aggregate([
      {
        $group: {
          _id: '$position',
          count: { $sum: 1 }
        }
      }
    ]);
    
    // Get voter participation rate
    const participationRate = totalVoters > 0 
      ? ((totalVotes / 4 / totalVoters) * 100).toFixed(2)
      : 0;
    
    // Get recent activity (last 24 hours)
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const recentVotes = await Vote.countDocuments({ createdAt: { $gte: oneDayAgo } });
    const recentRegistrations = await Voter.countDocuments({ registrationDate: { $gte: oneDayAgo } });
    
    res.status(200).json({
      success: true,
      data: {
        summary: {
          totalVoters,
          totalCandidates,
          totalVotes,
          votingPortalOpen: portalStatus ? portalStatus.value : false,
          participationRate: `${participationRate}%`
        },
        votesByPosition,
        recentActivity: {
          last24Hours: {
            votes: recentVotes,
            registrations: recentRegistrations
          }
        },
        timestamp: new Date()
      }
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Get system settings
// @route   GET /api/v1/admin/settings
// @access  Private (Admin)
const getSystemSettings = async (req, res, next) => {
  try {
    const settings = await SystemSetting.find({ isPublic: false });
    
    const settingsObject = {};
    settings.forEach(setting => {
      settingsObject[setting.key] = setting.value;
    });
    
    res.status(200).json({
      success: true,
      data: settingsObject
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Update system settings
// @route   PUT /api/v1/admin/settings
// @access  Private (Super Admin)
const updateSystemSettings = async (req, res, next) => {
  try {
    const updates = req.body;
    
    for (const [key, value] of Object.entries(updates)) {
      await SystemSetting.findOneAndUpdate(
        { key },
        { 
          value,
          updatedBy: req.admin._id
        },
        { upsert: true }
      );
    }
    
    await auditLogger.log(req.admin._id, 'UPDATE', 'SystemSetting', null, {
      updatedSettings: Object.keys(updates)
    });
    
    res.status(200).json({
      success: true,
      message: 'System settings updated successfully'
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Open voting portal
// @route   POST /api/v1/admin/voting/open
// @access  Private (Super Admin)
const openVotingPortal = async (req, res, next) => {
  try {
    // Update portal status
    await SystemSetting.findOneAndUpdate(
      { key: 'voting_portal_open' },
      { 
        value: true,
        updatedBy: req.admin._id
      }
    );
    
    // Notify voters
    const voters = await Voter.find({ hasVoted: false, isActive: true }).select('email phoneNumber');
    // await sendPortalNotification(voters, 'open');
    
    // Log the action
    await auditLogger.log(req.admin._id, 'UPDATE', 'VotingPortal', null, {
      action: 'opened',
      timestamp: new Date()
    });
    
    // Emit Socket.io event
    if (req.io) {
      req.io.emit('portalStatus', { status: 'open', timestamp: new Date() });
    }
    
    res.status(200).json({
      success: true,
      message: 'Voting portal opened successfully'
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Close voting portal
// @route   POST /api/v1/admin/voting/close
// @access  Private (Super Admin)
const closeVotingPortal = async (req, res, next) => {
  try {
    // Update portal status
    await SystemSetting.findOneAndUpdate(
      { key: 'voting_portal_open' },
      { 
        value: false,
        updatedBy: req.admin._id
      }
    );
    
    // Notify voters
    const voters = await Voter.find({ isActive: true }).select('email phoneNumber');
    // await sendPortalNotification(voters, 'close');
    
    // Log the action
    await auditLogger.log(req.admin._id, 'UPDATE', 'VotingPortal', null, {
      action: 'closed',
      timestamp: new Date()
    });
    
    // Emit Socket.io event
    if (req.io) {
      req.io.emit('portalStatus', { status: 'closed', timestamp: new Date() });
    }
    
    res.status(200).json({
      success: true,
      message: 'Voting portal closed successfully'
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Schedule voting
// @route   POST /api/v1/admin/voting/schedule
// @access  Private (Super Admin)
const scheduleVoting = async (req, res, next) => {
  try {
    const { startTime, endTime } = req.body;
    
    // Validate times
    if (!startTime || !endTime) {
      return res.status(400).json({
        success: false,
        error: 'Both start time and end time are required'
      });
    }
    
    const start = new Date(startTime);
    const end = new Date(endTime);
    
    if (start >= end) {
      return res.status(400).json({
        success: false,
        error: 'Start time must be before end time'
      });
    }
    
    // Save schedule
    await SystemSetting.findOneAndUpdate(
      { key: 'voting_schedule_start' },
      { 
        value: start,
        updatedBy: req.admin._id
      },
      { upsert: true }
    );
    
    await SystemSetting.findOneAndUpdate(
      { key: 'voting_schedule_end' },
      { 
        value: end,
        updatedBy: req.admin._id
      },
      { upsert: true }
    );
    
    await auditLogger.log(req.admin._id, 'UPDATE', 'VotingSchedule', null, {
      startTime: start,
      endTime: end
    });
    
    res.status(200).json({
      success: true,
      message: 'Voting scheduled successfully',
      data: {
        startTime: start,
        endTime: end
      }
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Get audit logs
// @route   GET /api/v1/admin/audit-logs
// @access  Private (Super Admin)
const getAuditLogs = async (req, res, next) => {
  try {
    const { page = 1, limit = 50, adminId, action, entity, startDate, endDate } = req.query;
    
    const AuditLog = require('../models/AuditLog');
    
    const query = {};
    if (adminId) query.adminId = adminId;
    if (action) query.action = action;
    if (entity) query.entity = entity;
    if (startDate || endDate) {
      query.timestamp = {};
      if (startDate) query.timestamp.$gte = new Date(startDate);
      if (endDate) query.timestamp.$lte = new Date(endDate);
    }
    
    const logs = await AuditLog.find(query)
      .sort({ timestamp: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .populate('adminId', 'email fullName');
    
    const total = await AuditLog.countDocuments(query);
    
    res.status(200).json({
      success: true,
      data: logs,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Export audit logs as CSV
// @route   GET /api/v1/admin/audit-logs/export
// @access  Private (Super Admin)
const exportAuditLogs = async (req, res, next) => {
  try {
    const { startDate, endDate } = req.query;
    
    const AuditLog = require('../models/AuditLog');
    
    const filters = {};
    if (startDate || endDate) {
      filters.timestamp = {};
      if (startDate) filters.timestamp.$gte = new Date(startDate);
      if (endDate) filters.timestamp.$lte = new Date(endDate);
    }
    
    const logs = await AuditLog.find(filters)
      .sort({ timestamp: -1 })
      .populate('adminId', 'email fullName')
      .limit(1000);
    
    // Convert to CSV
    const headers = ['Timestamp', 'Admin', 'Action', 'Entity', 'Entity ID', 'Details', 'IP Address'];
    const csvRows = logs.map(log => [
      log.timestamp.toISOString(),
      log.adminId ? log.adminId.email : 'System',
      log.action,
      log.entity,
      log.entityId || 'N/A',
      JSON.stringify(log.details || {}),
      log.ipAddress || 'N/A'
    ]);
    
    const csv = [headers.join(','), ...csvRows.map(row => row.map(cell => `"${cell}"`).join(','))].join('\n');
    
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename=audit-logs-${Date.now()}.csv`);
    res.send(csv);
  } catch (error) {
    next(error);
  }
};

// @desc    Get suspicious activity
// @route   GET /api/v1/admin/suspicious-activity
// @access  Private (Super Admin)
const getSuspiciousActivity = async (req, res, next) => {
  try {
    // Example: Find rapid voting from same IP
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    
    const rapidVotes = await Vote.aggregate([
      {
        $match: {
          createdAt: { $gte: oneHourAgo }
        }
      },
      {
        $group: {
          _id: '$ipAddress',
          count: { $sum: 1 }
        }
      },
      {
        $match: {
          count: { $gt: 10 } // More than 10 votes from same IP in 1 hour
        }
      }
    ]);
    
    res.status(200).json({
      success: true,
      data: {
        rapidVotes,
        timestamp: new Date()
      }
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Get system status
// @route   GET /api/v1/admin/status
// @access  Private (Admin)
const getSystemStatus = async (req, res, next) => {
  try {
    const portalStatus = await SystemSetting.findOne({ key: 'voting_portal_open' });
    const totalVotes = await Vote.countDocuments();
    const activeVoters = await Voter.countDocuments({ isActive: true });
    const activeCandidates = await Candidate.countDocuments({ isActive: true });
    
    // Check database connection
    const dbStatus = mongoose.connection.readyState === 1 ? 'connected' : 'disconnected';
    
    // Check email service (simplified check)
    const emailStatus = process.env.EMAIL_USER ? 'configured' : 'not configured';
    
    res.status(200).json({
      success: true,
      data: {
        votingPortalOpen: portalStatus ? portalStatus.value : false,
        database: dbStatus,
        emailService: emailStatus,
        counts: {
          voters: activeVoters,
          candidates: activeCandidates,
          votes: totalVotes
        },
        uptime: process.uptime(),
        timestamp: new Date()
      }
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Export election data in various formats
// @route   GET /api/v1/admin/export/:type
// @access  Private (Admin)
const exportElectionData = async (req, res, next) => {
  try {
    const { type } = req.params;
    const { format = 'pdf' } = req.query;
    
    switch(type) {
      case 'voters':
        await exportVotersData(req, res, format);
        break;
      case 'candidates':
        await exportCandidatesData(req, res, format);
        break;
      case 'votes':
        await exportVotesData(req, res, format);
        break;
      case 'results':
        await exportResultsData(req, res, format);
        break;
      case 'full-report':
        await exportFullReport(req, res, format);
        break;
      default:
        res.status(400).json({
          success: false,
          message: 'Invalid export type. Available: voters, candidates, votes, results, full-report'
        });
    }
  } catch (error) {
    next(error);
  }
};

// Helper function to export voters data
async function exportVotersData(req, res, format = 'pdf') {
  try {
    const voters = await Voter.find({})
      .select('votingNumber fullName idNumber gender constituency ward phone hasVoted createdAt')
      .sort({ constituency: 1, ward: 1, votingNumber: 1 });

    if (format === 'pdf') {
      const doc = new PDFDocument({ margin: 50 });
      
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename=voters-list-${Date.now()}.pdf`);
      
      doc.pipe(res);
      
      // Add title
      doc.fontSize(20).text('Kirinyaga County Voters List', { align: 'center' });
      doc.moveDown();
      doc.fontSize(12).text(`Report generated: ${new Date().toLocaleString()}`, { align: 'center' });
      doc.text(`Total Voters: ${voters.length}`, { align: 'center' });
      doc.moveDown(2);
      
      // Add table
      let y = doc.y;
      doc.fontSize(10);
      doc.text('Voting Number', 50, y, { width: 80 });
      doc.text('Full Name', 130, y, { width: 120 });
      doc.text('ID Number', 250, y, { width: 80 });
      doc.text('Constituency', 330, y, { width: 100 });
      doc.text('Ward', 430, y, { width: 80 });
      doc.text('Voted', 510, y, { width: 50 });
      
      doc.moveDown(0.5);
      doc.moveTo(50, doc.y).lineTo(560, doc.y).stroke();
      doc.moveDown(0.3);
      
      voters.forEach(voter => {
        if (doc.y > 700) {
          doc.addPage();
          y = doc.y;
        }
        
        y = doc.y;
        doc.text(voter.votingNumber, 50, y, { width: 80 });
        doc.text(voter.fullName || 'N/A', 130, y, { width: 120 });
        doc.text(voter.idNumber || 'N/A', 250, y, { width: 80 });
        doc.text(voter.constituency || 'N/A', 330, y, { width: 100 });
        doc.text(voter.ward || 'N/A', 430, y, { width: 80 });
        doc.text(voter.hasVoted ? 'Yes' : 'No', 510, y, { width: 50 });
        
        doc.moveDown(0.5);
      });
      
      doc.end();
    } else if (format === 'excel') {
      const workbook = new ExcelJS.Workbook();
      const worksheet = workbook.addWorksheet('Voters');
      
      // Add headers
      worksheet.columns = [
        { header: 'Voting Number', key: 'votingNumber', width: 15 },
        { header: 'Full Name', key: 'fullName', width: 25 },
        { header: 'ID Number', key: 'idNumber', width: 15 },
        { header: 'Gender', key: 'gender', width: 10 },
        { header: 'Constituency', key: 'constituency', width: 20 },
        { header: 'Ward', key: 'ward', width: 15 },
        { header: 'Phone', key: 'phone', width: 15 },
        { header: 'Voted', key: 'hasVoted', width: 10 },
        { header: 'Registered', key: 'createdAt', width: 20 }
      ];
      
      // Add data
      voters.forEach(voter => {
        worksheet.addRow({
          votingNumber: voter.votingNumber,
          fullName: voter.fullName || 'N/A',
          idNumber: voter.idNumber || 'N/A',
          gender: voter.gender || 'N/A',
          constituency: voter.constituency || 'N/A',
          ward: voter.ward || 'N/A',
          phone: voter.phone || 'N/A',
          hasVoted: voter.hasVoted ? 'Yes' : 'No',
          createdAt: voter.createdAt.toLocaleDateString()
        });
      });
      
      // Style header
      worksheet.getRow(1).font = { bold: true };
      
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename=voters-list-${Date.now()}.xlsx`);
      
      await workbook.xlsx.write(res);
      res.end();
    } else {
      // CSV format
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename=voters-list-${Date.now()}.csv`);
      
      res.write('Voting Number,Full Name,ID Number,Gender,Constituency,Ward,Phone,Voted,Registered Date\n');
      voters.forEach(voter => {
        res.write(`"${voter.votingNumber}","${voter.fullName || 'N/A'}","${voter.idNumber || 'N/A'}","${voter.gender || 'N/A'}","${voter.constituency || 'N/A'}","${voter.ward || 'N/A'}","${voter.phone || 'N/A'}","${voter.hasVoted ? 'Yes' : 'No'}","${voter.createdAt.toLocaleDateString()}"\n`);
      });
      res.end();
    }
  } catch (error) {
    throw error;
  }
}

// Helper function to export candidates data
async function exportCandidatesData(req, res, format = 'pdf') {
  try {
    const candidates = await Candidate.find({})
      .select('fullName idNumber gender constituency ward politicalParty position runningMate')
      .sort({ position: 1, constituency: 1 });

    if (format === 'pdf') {
      const doc = new PDFDocument({ margin: 50 });
      
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename=candidates-list-${Date.now()}.pdf`);
      
      doc.pipe(res);
      
      doc.fontSize(20).text('Kirinyaga County Candidates List', { align: 'center' });
      doc.moveDown();
      doc.fontSize(12).text(`Report generated: ${new Date().toLocaleString()}`, { align: 'center' });
      doc.text(`Total Candidates: ${candidates.length}`, { align: 'center' });
      doc.moveDown(2);
      
      let y = doc.y;
      doc.fontSize(10);
      doc.text('Name', 50, y, { width: 120 });
      doc.text('ID Number', 170, y, { width: 80 });
      doc.text('Position', 250, y, { width: 100 });
      doc.text('Party', 350, y, { width: 80 });
      doc.text('Constituency', 430, y, { width: 100 });
      
      doc.moveDown(0.5);
      doc.moveTo(50, doc.y).lineTo(530, doc.y).stroke();
      doc.moveDown(0.3);
      
      candidates.forEach(candidate => {
        if (doc.y > 700) {
          doc.addPage();
          y = doc.y;
        }
        
        y = doc.y;
        doc.text(candidate.fullName || 'N/A', 50, y, { width: 120 });
        doc.text(candidate.idNumber || 'N/A', 170, y, { width: 80 });
        doc.text(candidate.position || 'N/A', 250, y, { width: 100 });
        doc.text(candidate.politicalParty || 'N/A', 350, y, { width: 80 });
        doc.text(candidate.constituency || 'County-wide', 430, y, { width: 100 });
        
        doc.moveDown(0.5);
      });
      
      doc.end();
    } else {
      const structuredData = candidates.map(candidate => ({
        Name: candidate.fullName || 'N/A',
        'ID Number': candidate.idNumber || 'N/A',
        Gender: candidate.gender || 'N/A',
        Position: candidate.position || 'N/A',
        Party: candidate.politicalParty || 'N/A',
        Constituency: candidate.constituency || 'County-wide',
        Ward: candidate.ward || 'N/A',
        'Running Mate': candidate.runningMate || 'N/A'
      }));
      
      if (format === 'excel') {
        const workbook = new ExcelJS.Workbook();
        const worksheet = workbook.addWorksheet('Candidates');
        
        worksheet.columns = [
          { header: 'Name', key: 'Name', width: 25 },
          { header: 'ID Number', key: 'ID Number', width: 15 },
          { header: 'Gender', key: 'Gender', width: 10 },
          { header: 'Position', key: 'Position', width: 20 },
          { header: 'Party', key: 'Party', width: 20 },
          { header: 'Constituency', key: 'Constituency', width: 20 },
          { header: 'Ward', key: 'Ward', width: 15 },
          { header: 'Running Mate', key: 'Running Mate', width: 25 }
        ];
        
        structuredData.forEach(row => {
          worksheet.addRow(row);
        });
        
        worksheet.getRow(1).font = { bold: true };
        
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename=candidates-list-${Date.now()}.xlsx`);
        
        await workbook.xlsx.write(res);
        res.end();
      } else {
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', `attachment; filename=candidates-list-${Date.now()}.csv`);
        
        res.write('Name,ID Number,Gender,Position,Party,Constituency,Ward,Running Mate\n');
        structuredData.forEach(row => {
          res.write(`"${row.Name}","${row['ID Number']}","${row.Gender}","${row.Position}","${row.Party}","${row.Constituency}","${row.Ward}","${row['Running Mate']}"\n`);
        });
        res.end();
      }
    }
  } catch (error) {
    throw error;
  }
}

// Helper function to export votes data
async function exportVotesData(req, res, format = 'pdf') {
  try {
    const votes = await Vote.find({})
      .populate('voterId', 'votingNumber fullName')
      .populate('candidateId', 'fullName politicalParty')
      .sort({ createdAt: -1 })
      .limit(1000); // Limit to 1000 votes

    if (format === 'pdf') {
      const doc = new PDFDocument({ margin: 50, size: 'A4', layout: 'landscape' });
      
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename=votes-data-${Date.now()}.pdf`);
      
      doc.pipe(res);
      
      doc.fontSize(20).text('Kirinyaga County Votes Data', { align: 'center' });
      doc.moveDown();
      doc.fontSize(12).text(`Report generated: ${new Date().toLocaleString()}`, { align: 'center' });
      doc.text(`Total Votes in Report: ${votes.length}`, { align: 'center' });
      doc.moveDown(2);
      
      let y = doc.y;
      doc.fontSize(8);
      doc.text('Timestamp', 30, y, { width: 60 });
      doc.text('Voter ID', 90, y, { width: 80 });
      doc.text('Voter Name', 170, y, { width: 80 });
      doc.text('Position', 250, y, { width: 60 });
      doc.text('Candidate', 310, y, { width: 100 });
      doc.text('Party', 410, y, { width: 60 });
      doc.text('Constituency', 470, y, { width: 60 });
      doc.text('Ward', 530, y, { width: 50 });
      doc.text('Polling Station', 580, y, { width: 80 });
      
      doc.moveDown(0.5);
      doc.moveTo(30, doc.y).lineTo(660, doc.y).stroke();
      doc.moveDown(0.3);
      
      votes.forEach(vote => {
        if (doc.y > 500) {
          doc.addPage();
          y = doc.y;
        }
        
        y = doc.y;
        doc.text(vote.createdAt.toLocaleString(), 30, y, { width: 60 });
        doc.text(vote.voterId?.votingNumber || 'N/A', 90, y, { width: 80 });
        doc.text(vote.voterId?.fullName || 'N/A', 170, y, { width: 80 });
        doc.text(vote.position, 250, y, { width: 60 });
        doc.text(vote.candidateId?.fullName || 'N/A', 310, y, { width: 100 });
        doc.text(vote.candidateId?.politicalParty || 'N/A', 410, y, { width: 60 });
        doc.text(vote.constituency || 'N/A', 470, y, { width: 60 });
        doc.text(vote.ward || 'N/A', 530, y, { width: 50 });
        doc.text(vote.pollingStation || 'N/A', 580, y, { width: 80 });
        
        doc.moveDown(0.5);
      });
      
      doc.end();
    } else {
      const structuredData = votes.map(vote => ({
        Timestamp: vote.createdAt.toISOString(),
        'Voter ID': vote.voterId?.votingNumber || 'N/A',
        'Voter Name': vote.voterId?.fullName || 'N/A',
        Position: vote.position,
        Candidate: vote.candidateId?.fullName || 'N/A',
        Party: vote.candidateId?.politicalParty || 'N/A',
        Constituency: vote.constituency || 'N/A',
        Ward: vote.ward || 'N/A',
        'Polling Station': vote.pollingStation || 'N/A',
        'IP Address': vote.ipAddress || 'N/A'
      }));
      
      if (format === 'excel') {
        const workbook = new ExcelJS.Workbook();
        const worksheet = workbook.addWorksheet('Votes');
        
        worksheet.columns = [
          { header: 'Timestamp', key: 'Timestamp', width: 20 },
          { header: 'Voter ID', key: 'Voter ID', width: 15 },
          { header: 'Voter Name', key: 'Voter Name', width: 25 },
          { header: 'Position', key: 'Position', width: 15 },
          { header: 'Candidate', key: 'Candidate', width: 25 },
          { header: 'Party', key: 'Party', width: 20 },
          { header: 'Constituency', key: 'Constituency', width: 20 },
          { header: 'Ward', key: 'Ward', width: 15 },
          { header: 'Polling Station', key: 'Polling Station', width: 20 },
          { header: 'IP Address', key: 'IP Address', width: 15 }
        ];
        
        structuredData.forEach(row => {
          worksheet.addRow(row);
        });
        
        worksheet.getRow(1).font = { bold: true };
        
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename=votes-data-${Date.now()}.xlsx`);
        
        await workbook.xlsx.write(res);
        res.end();
      } else {
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', `attachment; filename=votes-data-${Date.now()}.csv`);
        
        res.write('Timestamp,Voter ID,Voter Name,Position,Candidate,Party,Constituency,Ward,Polling Station,IP Address\n');
        structuredData.forEach(row => {
          res.write(`"${row.Timestamp}","${row['Voter ID']}","${row['Voter Name']}","${row.Position}","${row.Candidate}","${row.Party}","${row.Constituency}","${row.Ward}","${row['Polling Station']}","${row['IP Address']}"\n`);
        });
        res.end();
      }
    }
  } catch (error) {
    throw error;
  }
}

// Helper function to export results data
async function exportResultsData(req, res, format = 'pdf') {
  try {
    // Get election results
    const results = await Vote.aggregate([
      {
        $lookup: {
          from: 'candidates',
          localField: 'candidateId',
          foreignField: '_id',
          as: 'candidate'
        }
      },
      { $unwind: '$candidate' },
      {
        $group: {
          _id: {
            position: '$position',
            constituency: '$constituency',
            ward: '$ward',
            candidateId: '$candidateId',
            candidateName: '$candidate.fullName',
            party: '$candidate.politicalParty'
          },
          votes: { $sum: 1 }
        }
      },
      { $sort: { '_id.position': 1, '_id.constituency': 1, '_id.ward': 1, votes: -1 } }
    ]);

    if (format === 'pdf') {
      const doc = new PDFDocument({ margin: 50, size: 'A4', layout: 'landscape' });
      
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename=election-results-${Date.now()}.pdf`);
      
      doc.pipe(res);
      
      // Add title
      doc.fontSize(20).text('Kirinyaga County Election Results', { align: 'center' });
      doc.moveDown();
      doc.fontSize(12).text(`Report generated: ${new Date().toLocaleString()}`, { align: 'center' });
      doc.moveDown(2);
      
      // Group by position
      const positions = [...new Set(results.map(r => r._id.position))];
      
      positions.forEach(position => {
        const positionResults = results.filter(r => r._id.position === position);
        
        doc.fontSize(16).text(position, { underline: true });
        doc.moveDown(0.5);
        
        // Table headers
        let y = doc.y;
        doc.fontSize(10);
        doc.text('Constituency', 50, y, { width: 100 });
        doc.text('Ward', 150, y, { width: 80 });
        doc.text('Candidate', 230, y, { width: 120 });
        doc.text('Party', 350, y, { width: 80 });
        doc.text('Votes', 430, y, { width: 60 });
        
        doc.moveDown(0.5);
        doc.moveTo(50, doc.y).lineTo(490, doc.y).stroke();
        doc.moveDown(0.3);
        
        // Table rows
        positionResults.forEach(result => {
          if (doc.y > 500) {
            doc.addPage();
            y = doc.y;
          }
          
          y = doc.y;
          doc.text(result._id.constituency || 'County-wide', 50, y, { width: 100 });
          doc.text(result._id.ward || 'N/A', 150, y, { width: 80 });
          doc.text(result._id.candidateName, 230, y, { width: 120 });
          doc.text(result._id.party, 350, y, { width: 80 });
          doc.text(result.votes.toString(), 430, y, { width: 60 });
          
          doc.moveDown(0.5);
        });
        
        doc.moveDown();
      });
      
      doc.end();
    } else {
      // For Excel/CSV, return structured data
      const structuredData = results.map(result => ({
        Position: result._id.position,
        Constituency: result._id.constituency || 'County-wide',
        Ward: result._id.ward || 'N/A',
        Candidate: result._id.candidateName,
        Party: result._id.party,
        Votes: result.votes
      }));
      
      if (format === 'excel') {
        const workbook = new ExcelJS.Workbook();
        const worksheet = workbook.addWorksheet('Election Results');
        
        worksheet.columns = [
          { header: 'Position', key: 'Position', width: 20 },
          { header: 'Constituency', key: 'Constituency', width: 20 },
          { header: 'Ward', key: 'Ward', width: 15 },
          { header: 'Candidate', key: 'Candidate', width: 25 },
          { header: 'Party', key: 'Party', width: 20 },
          { header: 'Votes', key: 'Votes', width: 10 }
        ];
        
        structuredData.forEach(row => {
          worksheet.addRow(row);
        });
        
        worksheet.getRow(1).font = { bold: true };
        
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename=election-results-${Date.now()}.xlsx`);
        
        await workbook.xlsx.write(res);
        res.end();
      } else {
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', `attachment; filename=election-results-${Date.now()}.csv`);
        
        res.write('Position,Constituency,Ward,Candidate,Party,Votes\n');
        structuredData.forEach(row => {
          res.write(`"${row.Position}","${row.Constituency}","${row.Ward}","${row.Candidate}","${row.Party}","${row.Votes}"\n`);
        });
        res.end();
      }
    }
  } catch (error) {
    throw error;
  }
}

// Export full comprehensive report
async function exportFullReport(req, res, format = 'pdf') {
  try {
    if (format !== 'pdf') {
      return res.status(400).json({
        success: false,
        message: 'Full report is only available in PDF format'
      });
    }
    
    const doc = new PDFDocument({ margin: 50 });
    
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=full-election-report-${Date.now()}.pdf`);
    
    doc.pipe(res);
    
    // Cover page
    doc.fontSize(24).text('KIRINYAGA COUNTY', { align: 'center' });
    doc.fontSize(20).text('ELECTION COMMISSION', { align: 'center' });
    doc.moveDown(2);
    doc.fontSize(28).text('COMPREHENSIVE ELECTION REPORT', { align: 'center' });
    doc.moveDown(3);
    doc.fontSize(16).text(`Report Date: ${new Date().toLocaleDateString()}`, { align: 'center' });
    doc.moveDown(5);
    doc.fontSize(12).text('OFFICIAL DOCUMENT', { align: 'center' });
    doc.text('Confidential - For Official Use Only', { align: 'center' });
    
    // Table of Contents
    doc.addPage();
    doc.fontSize(20).text('TABLE OF CONTENTS', { underline: true });
    doc.moveDown();
    
    const contents = [
      '1. Executive Summary',
      '2. Voter Statistics',
      '3. Election Results by Position',
      '4. Constituency Results',
      '5. Voter Turnout Analysis',
      '6. Candidate Performance',
      '7. Appendices'
    ];
    
    contents.forEach(item => {
      doc.fontSize(12).text(item, { indent: 20 });
      doc.moveDown(0.5);
    });
    
    // Get data for the report
    const totalVoters = await Voter.countDocuments({});
    const votedCount = await Voter.countDocuments({ hasVoted: true });
    const totalCandidates = await Candidate.countDocuments({});
    const totalVotes = await Vote.countDocuments({});
    
    // Executive Summary
    doc.addPage();
    doc.fontSize(20).text('1. EXECUTIVE SUMMARY', { underline: true });
    doc.moveDown();
    
    doc.fontSize(12).text(`Election Date: ${new Date().toLocaleDateString()}`);
    doc.text(`Total Registered Voters: ${totalVoters.toLocaleString()}`);
    doc.text(`Voters Who Voted: ${votedCount.toLocaleString()} (${((votedCount/totalVoters)*100).toFixed(2)}%)`);
    doc.text(`Total Candidates: ${totalCandidates.toLocaleString()}`);
    doc.text(`Total Votes Cast: ${totalVotes.toLocaleString()}`);
    doc.moveDown();
    
    doc.text('This report provides a comprehensive analysis of the election results for Kirinyaga County. The election was conducted in a free, fair, and transparent manner with proper oversight from election observers.');
    
    // Add more sections with data...
    // (You can expand this with more detailed sections)
    
    doc.addPage();
    doc.fontSize(16).text('CERTIFICATION', { align: 'center', underline: true });
    doc.moveDown(3);
    
    doc.text('I hereby certify that the information contained in this report is accurate and complete to the best of my knowledge.', { align: 'center' });
    doc.moveDown(4);
    
    doc.text('___________________________', { align: 'center' });
    doc.text('Chairperson', { align: 'center' });
    doc.text('Kirinyaga County Election Commission', { align: 'center' });
    doc.moveDown();
    doc.text(`Date: ${new Date().toLocaleDateString()}`, { align: 'center' });
    
    doc.end();
  } catch (error) {
    throw error;
  }
}

// @desc    Generate PDF report
// @route   GET /api/v1/admin/reports/generate
// @access  Private (Admin)
const generatePDFReport = async (req, res, next) => {
  try {
    // Call the existing export function
    await exportResultsData(req, res, 'pdf');
  } catch (error) {
    next(error);
  }
};

// @desc    Get participation report
// @route   GET /api/v1/admin/reports/participation
// @access  Private (Admin)
const getParticipationReport = async (req, res, next) => {
  try {
    const totalVoters = await Voter.countDocuments();
    const votedCount = await Voter.countDocuments({ hasVoted: true });
    const totalVotes = await Vote.countDocuments();
    
    // Get votes by constituency
    const votesByConstituency = await Vote.aggregate([
      {
        $group: {
          _id: '$constituency',
          votes: { $sum: 1 }
        }
      }
    ]);
    
    // Get votes by time of day
    const votesByHour = await Vote.aggregate([
      {
        $group: {
          _id: { $hour: '$createdAt' },
          votes: { $sum: 1 }
        }
      },
      { $sort: { '_id': 1 } }
    ]);
    
    res.status(200).json({
      success: true,
      data: {
        summary: {
          totalVoters,
          votedCount,
          totalVotes,
          turnoutRate: totalVoters > 0 ? ((votedCount / totalVoters) * 100).toFixed(2) : 0
        },
        byConstituency: votesByConstituency,
        byHour: votesByHour,
        timestamp: new Date()
      }
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Get full election report
// @route   GET /api/v1/admin/reports/full
// @access  Private (Admin)
const getFullElectionReport = async (req, res, next) => {
  try {
    const totalVoters = await Voter.countDocuments();
    const votedCount = await Voter.countDocuments({ hasVoted: true });
    const totalCandidates = await Candidate.countDocuments();
    const totalVotes = await Vote.countDocuments();
    
    // Get all positions
    const positions = await Vote.distinct('position');
    
    // Get winners for each position
    const winners = [];
    
    for (const position of positions) {
      const positionResults = await Vote.aggregate([
        { $match: { position } },
        {
          $lookup: {
            from: 'candidates',
            localField: 'candidateId',
            foreignField: '_id',
            as: 'candidate'
          }
        },
        { $unwind: '$candidate' },
        {
          $group: {
            _id: '$candidateId',
            candidateName: { $first: '$candidate.fullName' },
            party: { $first: '$candidate.politicalParty' },
            votes: { $sum: 1 }
          }
        },
        { $sort: { votes: -1 } },
        { $limit: 1 }
      ]);
      
      if (positionResults.length > 0) {
        winners.push({
          position,
          winner: positionResults[0]
        });
      }
    }
    
    res.status(200).json({
      success: true,
      data: {
        summary: {
          totalVoters,
          votedCount,
          totalCandidates,
          totalVotes,
          turnoutRate: totalVoters > 0 ? ((votedCount / totalVoters) * 100).toFixed(2) : 0
        },
        winners,
        positions,
        timestamp: new Date()
      }
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Get list of reports
// @route   GET /api/v1/admin/reports/list
// @access  Private (Admin)
const getReportsList = async (req, res, next) => {
  try {
    // Return list of available reports
    const reports = [
      {
        id: 'governor-results',
        title: 'Governor Election Results',
        description: 'Official results for Governor position',
        date: new Date().toISOString(),
        type: 'pdf',
        verified: true
      },
      {
        id: 'participation-report',
        title: 'Voter Participation Report',
        description: 'Detailed voter turnout analysis',
        date: new Date().toISOString(),
        type: 'pdf',
        verified: true
      },
      {
        id: 'full-election-report',
        title: 'Comprehensive Election Report',
        description: 'Complete election analysis and statistics',
        date: new Date().toISOString(),
        type: 'pdf',
        verified: true
      }
    ];
    
    res.status(200).json({
      success: true,
      reports
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Get specific report by ID
// @route   GET /api/v1/admin/reports/:id
// @access  Private (Admin)
const getReportById = async (req, res, next) => {
  try {
    const { id } = req.params;
    
    // Based on report ID, generate appropriate report
    switch(id) {
      case 'governor-results':
        await exportResultsData(req, res, 'pdf');
        break;
      case 'participation-report':
        await exportVotesData(req, res, 'pdf');
        break;
      case 'full-election-report':
        await exportFullReport(req, res, 'pdf');
        break;
      default:
        res.status(404).json({
          success: false,
          message: 'Report not found'
        });
    }
  } catch (error) {
    next(error);
  }
};

// @desc    Verify a report
// @route   POST /api/v1/admin/reports/:id/verify
// @access  Private (Super Admin)
const verifyReport = async (req, res, next) => {
  try {
    const { id } = req.params;
    
    // In a real system, you would update the report status in database
    await auditLogger.log(req.admin._id, 'VERIFY', 'Report', id, {
      action: 'verified',
      timestamp: new Date()
    });
    
    res.status(200).json({
      success: true,
      message: `Report ${id} verified successfully`
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getDashboardStats,
  updateSystemSettings,
  getSystemSettings,
  openVotingPortal,
  closeVotingPortal,
  scheduleVoting,
  getAuditLogs,
  exportAuditLogs,
  getSuspiciousActivity,
  getSystemStatus,
  exportElectionData,
  exportFullReport,
  generatePDFReport,
  getParticipationReport,
  getFullElectionReport,
  getReportsList,
  getReportById,
  verifyReport
};
