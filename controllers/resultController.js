const Vote = require('../models/Vote');
const Candidate = require('../models/Candidate');
const Voter = require('../models/Voter');
const SystemSetting = require('../models/SystemSetting');
const fs = require('fs');
const PDFDocument = require('pdfkit');
const createCsvWriter = require('csv-writer').createObjectCsvWriter;

// @desc    Get live election results
// @route   GET /api/v1/results/live
// @access  Public
const getLiveResults = async (req, res, next) => {
  try {
    const { position, constituency, ward } = req.query;
    
    // Build match filter
    const matchFilter = {};
    if (position) matchFilter.position = position;
    if (constituency) matchFilter.constituency = constituency;
    if (ward) matchFilter.ward = ward;
    
    // Get portal status
    const portalStatus = await SystemSetting.findOne({ key: 'voting_portal_open' });
    
    // Get all positions if none specified
    let positions = [];
    if (position) {
      positions = [position];
    } else {
      positions = ['Governor', 'Women Representative', 'MP', 'MCA'];
    }
    
    const results = {};
    
    for (const pos of positions) {
      const filter = { ...matchFilter, position: pos };
      
      // Get votes per candidate for this position
      const votesByCandidate = await Vote.aggregate([
        { $match: filter },
        {
          $group: {
            _id: '$candidateId',
            votes: { $sum: 1 },
            constituencies: { $addToSet: '$constituency' },
            wards: { $addToSet: '$ward' }
          }
        },
        { $sort: { votes: -1 } }
      ]);
      
      // Get candidate details
      const candidateIds = votesByCandidate.map(v => v._id);
      const candidates = await Candidate.find({ _id: { $in: candidateIds } })
        .select('fullName politicalParty constituency ward photo');
      
      // Combine vote counts with candidate details
      const candidateResults = votesByCandidate.map(vote => {
        const candidate = candidates.find(c => c._id.toString() === vote._id.toString());
        return {
          candidateId: vote._id,
          candidateName: candidate ? candidate.fullName : 'Unknown Candidate',
          party: candidate ? candidate.politicalParty : 'Unknown Party',
          constituency: candidate ? candidate.constituency : null,
          ward: candidate ? candidate.ward : null,
          photo: candidate ? candidate.photo : null,
          votes: vote.votes,
          constituencies: vote.constituencies,
          wards: vote.wards
        };
      });
      
      // Calculate total votes for this position
      const totalVotes = candidateResults.reduce((sum, candidate) => sum + candidate.votes, 0);
      
      // Add percentages
      const candidateResultsWithPercent = candidateResults.map(candidate => ({
        ...candidate,
        percentage: totalVotes > 0 ? ((candidate.votes / totalVotes) * 100).toFixed(2) : 0
      }));
      
      results[pos] = {
        candidates: candidateResultsWithPercent,
        totalVotes,
        lastUpdated: new Date()
      };
    }
    
    // Get voter turnout statistics
    const totalVoters = await Voter.countDocuments({ isActive: true });
    const votedCount = await Voter.countDocuments({ hasVoted: true });
    const turnoutRate = totalVoters > 0 ? ((votedCount / totalVoters) * 100).toFixed(2) : 0;
    
    res.status(200).json({
      success: true,
      data: {
        results,
        summary: {
          totalVoters,
          votedCount,
          pendingCount: totalVoters - votedCount,
          turnoutRate: `${turnoutRate}%`,
          votingPortalOpen: portalStatus ? portalStatus.value : false,
          lastUpdated: new Date()
        }
      }
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Get results by position
// @route   GET /api/v1/results/position/:position
// @access  Public
const getResultsByPosition = async (req, res, next) => {
  try {
    const { position } = req.params;
    const { constituency, ward } = req.query;
    
    // Build filter
    const filter = { position };
    if (constituency) filter.constituency = constituency;
    if (ward) filter.ward = ward;
    
    // Aggregate votes
    const votes = await Vote.aggregate([
      { $match: filter },
      {
        $group: {
          _id: '$candidateId',
          votes: { $sum: 1 }
        }
      },
      { $sort: { votes: -1 } }
    ]);
    
    // Get candidate details
    const candidateIds = votes.map(v => v._id);
    const candidates = await Candidate.find({ _id: { $in: candidateIds } })
      .select('fullName politicalParty constituency ward photo');
    
    // Combine results
    const results = votes.map(vote => {
      const candidate = candidates.find(c => c._id.toString() === vote._id.toString());
      return {
        candidateId: vote._id,
        candidateName: candidate ? candidate.fullName : 'Unknown Candidate',
        party: candidate ? candidate.politicalParty : 'Unknown Party',
        constituency: candidate ? candidate.constituency : null,
        ward: candidate ? candidate.ward : null,
        photo: candidate ? candidate.photo : null,
        votes: vote.votes
      };
    });
    
    // Calculate total votes
    const totalVotes = results.reduce((sum, candidate) => sum + candidate.votes, 0);
    
    // Add percentages
    const resultsWithPercent = results.map(candidate => ({
      ...candidate,
      percentage: totalVotes > 0 ? ((candidate.votes / totalVotes) * 100).toFixed(2) : 0
    }));
    
    res.status(200).json({
      success: true,
      data: {
        position,
        results: resultsWithPercent,
        totalVotes,
        lastUpdated: new Date()
      }
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Get results by constituency
// @route   GET /api/v1/results/constituency/:constituency
// @access  Public
const getResultsByConstituency = async (req, res, next) => {
  try {
    const { constituency } = req.params;
    
    // Get all votes in this constituency
    const votes = await Vote.aggregate([
      { $match: { constituency } },
      {
        $group: {
          _id: { position: '$position', candidateId: '$candidateId', ward: '$ward' },
          votes: { $sum: 1 }
        }
      },
      { $sort: { '_id.position': 1, 'votes': -1 } }
    ]);
    
    // Get candidate details
    const candidateIds = [...new Set(votes.map(v => v._id.candidateId))];
    const candidates = await Candidate.find({ _id: { $in: candidateIds } })
      .select('fullName politicalParty photo');
    
    // Organize results by position
    const resultsByPosition = {};
    
    votes.forEach(vote => {
      const position = vote._id.position;
      const ward = vote._id.ward;
      const candidate = candidates.find(c => c._id.toString() === vote._id.candidateId.toString());
      
      if (!resultsByPosition[position]) {
        resultsByPosition[position] = {
          candidates: [],
          totalVotes: 0
        };
      }
      
      resultsByPosition[position].candidates.push({
        candidateId: vote._id.candidateId,
        candidateName: candidate ? candidate.fullName : 'Unknown Candidate',
        party: candidate ? candidate.politicalParty : 'Unknown Party',
        ward: ward,
        photo: candidate ? candidate.photo : null,
        votes: vote.votes
      });
      
      resultsByPosition[position].totalVotes += vote.votes;
    });
    
    // Calculate percentages for each position
    Object.keys(resultsByPosition).forEach(position => {
      const totalVotes = resultsByPosition[position].totalVotes;
      resultsByPosition[position].candidates = resultsByPosition[position].candidates.map(candidate => ({
        ...candidate,
        percentage: totalVotes > 0 ? ((candidate.votes / totalVotes) * 100).toFixed(2) : 0
      }));
    });
    
    res.status(200).json({
      success: true,
      data: {
        constituency,
        results: resultsByPosition,
        lastUpdated: new Date()
      }
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Get results by ward
// @route   GET /api/v1/results/ward/:ward
// @access  Public
const getResultsByWard = async (req, res, next) => {
  try {
    const { ward } = req.params;
    
    // Get all votes in this ward
    const votes = await Vote.aggregate([
      { $match: { ward } },
      {
        $group: {
          _id: { position: '$position', candidateId: '$candidateId' },
          votes: { $sum: 1 }
        }
      },
      { $sort: { '_id.position': 1, 'votes': -1 } }
    ]);
    
    // Get candidate details
    const candidateIds = [...new Set(votes.map(v => v._id.candidateId))];
    const candidates = await Candidate.find({ _id: { $in: candidateIds } })
      .select('fullName politicalParty photo');
    
    // Organize results by position
    const resultsByPosition = {};
    
    votes.forEach(vote => {
      const position = vote._id.position;
      const candidate = candidates.find(c => c._id.toString() === vote._id.candidateId.toString());
      
      if (!resultsByPosition[position]) {
        resultsByPosition[position] = {
          candidates: [],
          totalVotes: 0
        };
      }
      
      resultsByPosition[position].candidates.push({
        candidateId: vote._id.candidateId,
        candidateName: candidate ? candidate.fullName : 'Unknown Candidate',
        party: candidate ? candidate.politicalParty : 'Unknown Party',
        photo: candidate ? candidate.photo : null,
        votes: vote.votes
      });
      
      resultsByPosition[position].totalVotes += vote.votes;
    });
    
    // Calculate percentages for each position
    Object.keys(resultsByPosition).forEach(position => {
      const totalVotes = resultsByPosition[position].totalVotes;
      resultsByPosition[position].candidates = resultsByPosition[position].candidates.map(candidate => ({
        ...candidate,
        percentage: totalVotes > 0 ? ((candidate.votes / totalVotes) * 100).toFixed(2) : 0
      }));
    });
    
    res.status(200).json({
      success: true,
      data: {
        ward,
        results: resultsByPosition,
        lastUpdated: new Date()
      }
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Export results as CSV
// @route   GET /api/v1/results/export/csv
// @access  Private (Admin)
const exportResultsCSV = async (req, res, next) => {
  try {
    // Check if user is admin
    if (!req.admin) {
      return res.status(401).json({
        success: false,
        error: 'Not authorized to access this route'
      });
    }

    // Get all votes with candidate details
    const votes = await Vote.aggregate([
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
            candidateId: '$candidateId',
            constituency: '$constituency',
            ward: '$ward'
          },
          votes: { $sum: 1 },
          candidateName: { $first: '$candidate.fullName' },
          party: { $first: '$candidate.politicalParty' }
        }
      },
      {
        $sort: {
          '_id.position': 1,
          '_id.constituency': 1,
          '_id.ward': 1,
          'votes': -1
        }
      }
    ]);
    
    // Prepare CSV data
    const csvData = votes.map(row => ({
      Position: row._id.position,
      Constituency: row._id.constituency || 'County-wide',
      Ward: row._id.ward || 'N/A',
      Candidate: row.candidateName,
      Party: row.party,
      Votes: row.votes
    }));
    
    // Create CSV writer
    const csvWriter = createCsvWriter({
      path: 'temp/election-results.csv',
      header: [
        { id: 'Position', title: 'POSITION' },
        { id: 'Constituency', title: 'CONSTITUENCY' },
        { id: 'Ward', title: 'WARD' },
        { id: 'Candidate', title: 'CANDIDATE' },
        { id: 'Party', title: 'POLITICAL PARTY' },
        { id: 'Votes', title: 'VOTES' }
      ]
    });
    
    // Ensure temp directory exists
    if (!fs.existsSync('temp')) {
      fs.mkdirSync('temp');
    }
    
    // Write CSV file
    await csvWriter.writeRecords(csvData);
    
    // Send file
    res.download('temp/election-results.csv', 'kirinyaga-election-results.csv', (err) => {
      if (err) {
        console.error('Error downloading file:', err);
      }
      // Clean up temp file
      fs.unlinkSync('temp/election-results.csv');
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Export results as PDF
// @route   GET /api/v1/results/export/pdf
// @access  Private (Admin)
const exportResultsPDF = async (req, res, next) => {
  try {
    // Check if user is admin
    if (!req.admin) {
      return res.status(401).json({
        success: false,
        error: 'Not authorized to access this route'
      });
    }

    // Get overall results
    const votesByPosition = await Vote.aggregate([
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
            candidateId: '$candidateId'
          },
          votes: { $sum: 1 },
          candidateName: { $first: '$candidate.fullName' },
          party: { $first: '$candidate.politicalParty' }
        }
      },
      {
        $sort: {
          '_id.position': 1,
          'votes': -1
        }
      }
    ]);
    
    // Organize by position
    const resultsByPosition = {};
    votesByPosition.forEach(row => {
      const position = row._id.position;
      if (!resultsByPosition[position]) {
        resultsByPosition[position] = [];
      }
      resultsByPosition[position].push({
        candidate: row.candidateName,
        party: row.party,
        votes: row.votes
      });
    });
    
    // Create PDF document
    const doc = new PDFDocument({ margin: 50 });
    
    // Set response headers
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename=kirinyaga-election-results.pdf');
    
    // Pipe PDF to response
    doc.pipe(res);
    
    // Add title
    doc.fontSize(20).text('Kirinyaga County Election Results', { align: 'center' });
    doc.moveDown();
    doc.fontSize(12).text(`Report generated: ${new Date().toLocaleString()}`, { align: 'center' });
    doc.moveDown(2);
    
    // Add results by position
    Object.keys(resultsByPosition).forEach(position => {
      doc.fontSize(16).text(position, { underline: true });
      doc.moveDown(0.5);
      
      // Add table headers
      doc.fontSize(10).text('Candidate', 50, doc.y, { continued: true, width: 200 });
      doc.text('Party', 250, doc.y, { continued: true, width: 150 });
      doc.text('Votes', 400, doc.y, { width: 100 });
      doc.moveDown(0.5);
      
      // Add candidates
      resultsByPosition[position].forEach((candidate, index) => {
        doc.fontSize(10).text(candidate.candidate, 50, doc.y, { continued: true, width: 200 });
        doc.text(candidate.party, 250, doc.y, { continued: true, width: 150 });
        doc.text(candidate.votes.toString(), 400, doc.y, { width: 100 });
        doc.moveDown(0.5);
      });
      
      doc.moveDown();
    });
    
    // Add summary
    doc.addPage();
    doc.fontSize(16).text('Voter Turnout Summary', { align: 'center' });
    doc.moveDown();
    
    // Get turnout statistics
    const totalVoters = await Voter.countDocuments({ isActive: true });
    const votedCount = await Voter.countDocuments({ hasVoted: true });
    const turnoutRate = totalVoters > 0 ? ((votedCount / totalVoters) * 100).toFixed(2) : 0;
    
    doc.fontSize(12).text(`Total Registered Voters: ${totalVoters}`);
    doc.text(`Voters Who Voted: ${votedCount}`);
    doc.text(`Voters Who Did Not Vote: ${totalVoters - votedCount}`);
    doc.text(`Turnout Rate: ${turnoutRate}%`);
    
    // Add footer
    doc.moveDown(2);
    doc.fontSize(10).text('Kirinyaga County Election Commission', { align: 'center' });
    doc.text('Official Election Results', { align: 'center' });
    
    // Finalize PDF
    doc.end();
  } catch (error) {
    next(error);
  }
};

// @desc    Get detailed participation report
// @route   GET /api/v1/results/participation
// @access  Private (Admin)
const getParticipationReport = async (req, res, next) => {
  try {
    // Check if user is admin
    if (!req.admin) {
      return res.status(401).json({
        success: false,
        error: 'Not authorized to access this route'
      });
    }

    const { constituency, ward } = req.query;
    
    // Build filter
    const filter = {};
    if (constituency) filter.constituency = constituency;
    if (ward) filter.ward = ward;
    
    // Get voters who voted
    const votedVoters = await Voter.find({ ...filter, hasVoted: true })
      .select('votingNumber constituency ward')
      .sort({ constituency: 1, ward: 1 });
    
    // Get voters who didn't vote
    const nonVotedVoters = await Voter.find({ ...filter, hasVoted: false })
      .select('votingNumber constituency ward')
      .sort({ constituency: 1, ward: 1 });
    
    // Get participation statistics by area
    const participationStats = await Voter.aggregate([
      { $match: filter },
      {
        $group: {
          _id: { constituency: '$constituency', ward: '$ward' },
          total: { $sum: 1 },
          voted: { $sum: { $cond: [{ $eq: ['$hasVoted', true] }, 1, 0] } },
          notVoted: { $sum: { $cond: [{ $eq: ['$hasVoted', false] }, 1, 0] } }
        }
      },
      {
        $addFields: {
          turnoutRate: {
            $cond: [
              { $eq: ['$total', 0] },
              0,
              { $multiply: [{ $divide: ['$voted', '$total'] }, 100] }
            ]
          }
        }
      },
      { $sort: { '_id.constituency': 1, '_id.ward': 1 } }
    ]);
    
    res.status(200).json({
      success: true,
      data: {
        summary: {
          totalVoted: votedVoters.length,
          totalNotVoted: nonVotedVoters.length,
          totalVoters: votedVoters.length + nonVotedVoters.length,
          turnoutRate: ((votedVoters.length / (votedVoters.length + nonVotedVoters.length)) * 100).toFixed(2)
        },
        votedVoters: {
          count: votedVoters.length,
          list: votedVoters
        },
        nonVotedVoters: {
          count: nonVotedVoters.length,
          list: nonVotedVoters
        },
        participationStats
      }
    });
  } catch (error) {
    next(error);
  }
};

// ============================================
// POST-ELECTION REPORTING FUNCTIONS
// ============================================

// @desc    Get list of all constituencies
// @route   GET /api/v1/results/constituencies
// @access  Public
const getConstituenciesList = async (req, res, next) => {
  try {
    const constituencies = await Vote.distinct('constituency');
    
    res.status(200).json({
      success: true,
      data: constituencies.sort()
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Get comprehensive post-election report
// @route   GET /api/v1/results/post-election/full-report
// @access  Private (Admin)
const getFullElectionReport = async (req, res, next) => {
  try {
    // Check if user is admin
    if (!req.admin) {
      return res.status(401).json({
        success: false,
        error: 'Not authorized to access this route'
      });
    }

    // Check if voting portal is closed
    const portalStatus = await SystemSetting.findOne({ key: 'voting_portal_open' });
    
    if (portalStatus && portalStatus.value === true) {
      return res.status(400).json({
        success: false,
        message: 'Voting portal is still open. Cannot generate final report.'
      });
    }

    const { constituency, ward } = req.query;
    
    // Build filter
    const filter = {};
    if (constituency) filter.constituency = constituency;
    if (ward) filter.ward = ward;

    // 1. Get votes per candidate per ward
    const wardResults = await Vote.aggregate([
      { $match: filter },
      {
        $group: {
          _id: {
            position: '$position',
            constituency: '$constituency',
            ward: '$ward',
            candidateId: '$candidateId'
          },
          votes: { $sum: 1 }
        }
      },
      {
        $lookup: {
          from: 'candidates',
          localField: '_id.candidateId',
          foreignField: '_id',
          as: 'candidate'
        }
      },
      { $unwind: '$candidate' },
      {
        $project: {
          _id: 0,
          position: '$_id.position',
          constituency: '$_id.constituency',
          ward: '$_id.ward',
          candidateId: '$_id.candidateId',
          candidateName: '$candidate.fullName',
          party: '$candidate.politicalParty',
          votes: 1
        }
      },
      { $sort: { position: 1, constituency: 1, ward: 1, votes: -1 } }
    ]);

    // 2. Get aggregated votes per constituency
    const constituencyResults = await Vote.aggregate([
      { $match: filter },
      {
        $group: {
          _id: {
            position: '$position',
            constituency: '$constituency',
            candidateId: '$candidateId'
          },
          votes: { $sum: 1 }
        }
      },
      {
        $lookup: {
          from: 'candidates',
          localField: '_id.candidateId',
          foreignField: '_id',
          as: 'candidate'
        }
      },
      { $unwind: '$candidate' },
      {
        $project: {
          _id: 0,
          position: '$_id.position',
          constituency: '$_id.constituency',
          candidateId: '$_id.candidateId',
          candidateName: '$candidate.fullName',
          party: '$candidate.politicalParty',
          votes: 1
        }
      },
      { $sort: { position: 1, constituency: 1, votes: -1 } }
    ]);

    // 3. Get county-level totals
    const countyResults = await Vote.aggregate([
      { $match: filter },
      {
        $group: {
          _id: {
            position: '$position',
            candidateId: '$candidateId'
          },
          votes: { $sum: 1 }
        }
      },
      {
        $lookup: {
          from: 'candidates',
          localField: '_id.candidateId',
          foreignField: '_id',
          as: 'candidate'
        }
      },
      { $unwind: '$candidate' },
      {
        $project: {
          _id: 0,
          position: '$_id.position',
          candidateId: '$_id.candidateId',
          candidateName: '$candidate.fullName',
          party: '$candidate.politicalParty',
          votes: 1
        }
      },
      { $sort: { position: 1, votes: -1 } }
    ]);

    // 4. Calculate percentages for each level
    const countyWithPercent = {};
    const positions = [...new Set(countyResults.map(r => r.position))];
    
    positions.forEach(position => {
      const positionResults = countyResults.filter(r => r.position === position);
      const totalVotes = positionResults.reduce((sum, r) => sum + r.votes, 0);
      
      countyWithPercent[position] = positionResults.map(result => ({
        ...result,
        percentage: totalVotes > 0 ? ((result.votes / totalVotes) * 100).toFixed(2) : 0
      }));
    });

    // 5. Get winners for each position at each level
    const winners = {
      county: {},
      constituency: {},
      ward: {}
    };

    // County winners
    positions.forEach(position => {
      const positionResults = countyResults.filter(r => r.position === position);
      if (positionResults.length > 0) {
        winners.county[position] = positionResults[0];
      }
    });

    // Constituency winners
    const constituencies = [...new Set(constituencyResults.map(r => r.constituency))];
    constituencies.forEach(constituency => {
      winners.constituency[constituency] = {};
      positions.forEach(position => {
        const positionResults = constituencyResults.filter(
          r => r.constituency === constituency && r.position === position
        );
        if (positionResults.length > 0) {
          winners.constituency[constituency][position] = positionResults[0];
        }
      });
    });

    // Ward winners
    const wards = [...new Set(wardResults.map(r => r.ward))];
    wards.forEach(ward => {
      winners.ward[ward] = {};
      positions.forEach(position => {
        const positionResults = wardResults.filter(
          r => r.ward === ward && r.position === position
        );
        if (positionResults.length > 0) {
          winners.ward[ward][position] = positionResults[0];
        }
      });
    });

    // 6. Get voter participation data
    const participationStats = await Voter.aggregate([
      { $match: filter },
      {
        $group: {
          _id: { constituency: '$constituency', ward: '$ward' },
          totalVoters: { $sum: 1 },
          voted: { $sum: { $cond: [{ $eq: ['$hasVoted', true] }, 1, 0] } },
          notVoted: { $sum: { $cond: [{ $eq: ['$hasVoted', false] }, 1, 0] } }
        }
      },
      {
        $addFields: {
          turnoutRate: {
            $cond: [
              { $eq: ['$totalVoters', 0] },
              0,
              { $multiply: [{ $divide: ['$voted', '$totalVoters'] }, 100] }
            ]
          }
        }
      },
      { $sort: { '_id.constituency': 1, '_id.ward': 1 } }
    ]);

    // Detailed voter lists
    const votedVoters = await Voter.find({ ...filter, hasVoted: true })
      .select('votingNumber constituency ward')
      .sort({ constituency: 1, ward: 1, votingNumber: 1 });

    const nonVotedVoters = await Voter.find({ ...filter, hasVoted: false })
      .select('votingNumber constituency ward')
      .sort({ constituency: 1, ward: 1, votingNumber: 1 });

    res.status(200).json({
      success: true,
      data: {
        summary: {
          totalVotes: countyResults.reduce((sum, r) => sum + r.votes, 0),
          totalVoters: await Voter.countDocuments(filter),
          totalCandidates: await Candidate.countDocuments({}),
          positionsCount: positions.length,
          reportGenerated: new Date()
        },
        wardResults,
        constituencyResults,
        countyResults: countyWithPercent,
        winners,
        participation: {
          summary: {
            totalVoters: votedVoters.length + nonVotedVoters.length,
            voted: votedVoters.length,
            notVoted: nonVotedVoters.length,
            overallTurnout: ((votedVoters.length / (votedVoters.length + nonVotedVoters.length)) * 100).toFixed(2)
          },
          detailed: participationStats,
          votedVoters: {
            count: votedVoters.length,
            list: votedVoters
          },
          nonVotedVoters: {
            count: nonVotedVoters.length,
            list: nonVotedVoters
          }
        }
      }
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Export post-election report as CSV
// @route   GET /api/v1/results/post-election/export/csv
// @access  Private (Admin)
const exportPostElectionCSV = async (req, res, next) => {
  try {
    // Check if user is admin
    if (!req.admin) {
      return res.status(401).json({
        success: false,
        error: 'Not authorized to access this route'
      });
    }

    const { type } = req.query; // 'ward', 'constituency', 'county', 'participation', 'voters'
    
    // Check if voting portal is closed
    const portalStatus = await SystemSetting.findOne({ key: 'voting_portal_open' });
    
    if (portalStatus && portalStatus.value === true) {
      return res.status(400).json({
        success: false,
        message: 'Voting portal is still open. Cannot export final report.'
      });
    }

    let csvData = [];
    let filename = 'post-election-report';
    let headers = [];

    switch (type) {
      case 'ward':
        const wardResults = await Vote.aggregate([
          {
            $group: {
              _id: {
                position: '$position',
                constituency: '$constituency',
                ward: '$ward',
                candidateId: '$candidateId'
              },
              votes: { $sum: 1 }
            }
          },
          {
            $lookup: {
              from: 'candidates',
              localField: '_id.candidateId',
              foreignField: '_id',
              as: 'candidate'
            }
          },
          { $unwind: '$candidate' },
          { $sort: { '_id.position': 1, '_id.constituency': 1, '_id.ward': 1, votes: -1 } }
        ]);

        csvData = wardResults.map(row => ({
          Position: row._id.position,
          Constituency: row._id.constituency,
          Ward: row._id.ward,
          Candidate: row.candidate.fullName,
          Party: row.candidate.politicalParty,
          Votes: row.votes
        }));

        headers = [
          { id: 'Position', title: 'POSITION' },
          { id: 'Constituency', title: 'CONSTITUENCY' },
          { id: 'Ward', title: 'WARD' },
          { id: 'Candidate', title: 'CANDIDATE' },
          { id: 'Party', title: 'POLITICAL PARTY' },
          { id: 'Votes', title: 'VOTES' }
        ];
        filename = 'ward-level-results.csv';
        break;

      case 'constituency':
        const constituencyResults = await Vote.aggregate([
          {
            $group: {
              _id: {
                position: '$position',
                constituency: '$constituency',
                candidateId: '$candidateId'
              },
              votes: { $sum: 1 }
            }
          },
          {
            $lookup: {
              from: 'candidates',
              localField: '_id.candidateId',
              foreignField: '_id',
              as: 'candidate'
            }
          },
          { $unwind: '$candidate' },
          { $sort: { '_id.position': 1, '_id.constituency': 1, votes: -1 } }
        ]);

        csvData = constituencyResults.map(row => ({
          Position: row._id.position,
          Constituency: row._id.constituency,
          Candidate: row.candidate.fullName,
          Party: row.candidate.politicalParty,
          Votes: row.votes
        }));

        headers = [
          { id: 'Position', title: 'POSITION' },
          { id: 'Constituency', title: 'CONSTITUENCY' },
          { id: 'Candidate', title: 'CANDIDATE' },
          { id: 'Party', title: 'POLITICAL PARTY' },
          { id: 'Votes', title: 'VOTES' }
        ];
        filename = 'constituency-level-results.csv';
        break;

      case 'county':
        const countyResults = await Vote.aggregate([
          {
            $group: {
              _id: {
                position: '$position',
                candidateId: '$candidateId'
              },
              votes: { $sum: 1 }
            }
          },
          {
            $lookup: {
              from: 'candidates',
              localField: '_id.candidateId',
              foreignField: '_id',
              as: 'candidate'
            }
          },
          { $unwind: '$candidate' },
          { $sort: { '_id.position': 1, votes: -1 } }
        ]);

        csvData = countyResults.map(row => ({
          Position: row._id.position,
          Candidate: row.candidate.fullName,
          Party: row.candidate.politicalParty,
          Votes: row.votes
        }));

        headers = [
          { id: 'Position', title: 'POSITION' },
          { id: 'Candidate', title: 'CANDIDATE' },
          { id: 'Party', title: 'POLITICAL PARTY' },
          { id: 'Votes', title: 'VOTES' }
        ];
        filename = 'county-level-results.csv';
        break;

      case 'participation':
        const participation = await Voter.aggregate([
          {
            $group: {
              _id: { constituency: '$constituency', ward: '$ward' },
              totalVoters: { $sum: 1 },
              voted: { $sum: { $cond: [{ $eq: ['$hasVoted', true] }, 1, 0] } },
              notVoted: { $sum: { $cond: [{ $eq: ['$hasVoted', false] }, 1, 0] } }
            }
          },
          {
            $addFields: {
              turnoutRate: {
                $cond: [
                  { $eq: ['$totalVoters', 0] },
                  0,
                  { $multiply: [{ $divide: ['$voted', '$totalVoters'] }, 100] }
                ]
              }
            }
          },
          { $sort: { '_id.constituency': 1, '_id.ward': 1 } }
        ]);

        csvData = participation.map(row => ({
          Constituency: row._id.constituency,
          Ward: row._id.ward,
          'Total Voters': row.totalVoters,
          'Voted': row.voted,
          'Not Voted': row.notVoted,
          'Turnout Rate': `${row.turnoutRate.toFixed(2)}%`
        }));

        headers = [
          { id: 'Constituency', title: 'CONSTITUENCY' },
          { id: 'Ward', title: 'WARD' },
          { id: 'Total Voters', title: 'TOTAL VOTERS' },
          { id: 'Voted', title: 'VOTED' },
          { id: 'Not Voted', title: 'NOT VOTED' },
          { id: 'Turnout Rate', title: 'TURNOUT RATE (%)' }
        ];
        filename = 'voter-participation-report.csv';
        break;

      case 'voters':
        const { voted } = req.query; // true or false
        const voterFilter = {};
        if (voted !== undefined) voterFilter.hasVoted = voted === 'true';
        
        const voters = await Voter.find(voterFilter)
          .select('votingNumber constituency ward hasVoted')
          .sort({ constituency: 1, ward: 1, votingNumber: 1 });

        csvData = voters.map(voter => ({
          'Voting Number': voter.votingNumber,
          'Constituency': voter.constituency,
          'Ward': voter.ward,
          'Voted': voter.hasVoted ? 'Yes' : 'No',
          'Status': voter.hasVoted ? 'VOTED' : 'DID NOT VOTE'
        }));

        headers = [
          { id: 'Voting Number', title: 'VOTING NUMBER' },
          { id: 'Constituency', title: 'CONSTITUENCY' },
          { id: 'Ward', title: 'WARD' },
          { id: 'Voted', title: 'VOTED (YES/NO)' },
          { id: 'Status', title: 'STATUS' }
        ];
        filename = voted === 'true' ? 'voters-who-voted.csv' : 
                  voted === 'false' ? 'voters-who-did-not-vote.csv' : 
                  'all-voters.csv';
        break;

      default:
        return res.status(400).json({
          success: false,
          message: 'Invalid export type. Use: ward, constituency, county, participation, or voters'
        });
    }

    // Create CSV writer
    const csvWriter = createCsvWriter({
      path: `temp/${filename}`,
      header: headers
    });

    // Ensure temp directory exists
    if (!fs.existsSync('temp')) {
      fs.mkdirSync('temp');
    }

    // Write CSV file
    await csvWriter.writeRecords(csvData);

    // Send file
    res.download(`temp/${filename}`, filename, (err) => {
      if (err) {
        console.error('Error downloading file:', err);
      }
      // Clean up temp file
      fs.unlinkSync(`temp/${filename}`);
    });

  } catch (error) {
    next(error);
  }
};

// @desc    Export post-election report as PDF
// @route   GET /api/v1/results/post-election/export/pdf
// @access  Private (Admin)
const exportPostElectionPDF = async (req, res, next) => {
  try {
    // Check if user is admin
    if (!req.admin) {
      return res.status(401).json({
        success: false,
        error: 'Not authorized to access this route'
      });
    }

    // Check if voting portal is closed
    const portalStatus = await SystemSetting.findOne({ key: 'voting_portal_open' });
    
    if (portalStatus && portalStatus.value === true) {
      return res.status(400).json({
        success: false,
        message: 'Voting portal is still open. Cannot generate final report.'
      });
    }

    // Get comprehensive data
    const fullReport = await getFullReportData();

    // Create PDF document
    const doc = new PDFDocument({ margin: 50, size: 'A4', layout: 'portrait' });
    
    // Set response headers
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename=kirinyaga-post-election-report.pdf');
    
    // Pipe PDF to response
    doc.pipe(res);

    // Add header
    doc.fontSize(24).text('KIRINYAGA COUNTY', { align: 'center' });
    doc.fontSize(18).text('POST-ELECTION OFFICIAL REPORT', { align: 'center' });
    doc.moveDown();
    doc.fontSize(12).text(`Report generated: ${new Date().toLocaleString()}`, { align: 'center' });
    doc.moveDown(2);

    // Add county-level summary
    doc.fontSize(16).text('COUNTY-LEVEL ELECTION RESULTS', { underline: true });
    doc.moveDown(0.5);

    const positions = ['Governor', 'Women Representative', 'MP', 'MCA'];
    
    positions.forEach(position => {
      if (fullReport.countyResults[position]) {
        doc.fontSize(14).text(position.toUpperCase(), { underline: true });
        doc.moveDown(0.3);
        
        // Table headers
        doc.fontSize(10);
        let y = doc.y;
        doc.text('Candidate', 50, y, { width: 180 });
        doc.text('Party', 230, y, { width: 120 });
        doc.text('Votes', 350, y, { width: 80 });
        doc.text('%', 430, y, { width: 50 });
        
        doc.moveDown(0.5);
        doc.moveTo(50, doc.y).lineTo(480, doc.y).stroke();
        doc.moveDown(0.3);
        
        // Table rows
        fullReport.countyResults[position].forEach((candidate, index) => {
          y = doc.y;
          doc.text(candidate.candidateName, 50, y, { width: 180 });
          doc.text(candidate.party, 230, y, { width: 120 });
          doc.text(candidate.votes.toString(), 350, y, { width: 80 });
          doc.text(candidate.percentage + '%', 430, y, { width: 50 });
          
          // Highlight winner
          if (index === 0) {
            doc.rect(45, y - 2, 440, 15).stroke('#2e7d32');
          }
          
          doc.moveDown(0.5);
        });
        
        doc.moveDown();
      }
    });

    // Add new page for constituency results
    doc.addPage();
    doc.fontSize(16).text('CONSTITUENCY-LEVEL RESULTS', { align: 'center', underline: true });
    doc.moveDown();

    // Add constituency winners summary
    const constituencies = Object.keys(fullReport.winners.constituency);
    
    constituencies.forEach(constituency => {
      doc.fontSize(12).text(constituency.toUpperCase(), { underline: true });
      doc.moveDown(0.3);
      
      positions.forEach(position => {
        const winner = fullReport.winners.constituency[constituency]?.[position];
        if (winner) {
          doc.fontSize(10).text(
            `${position}: ${winner.candidateName} (${winner.party}) - ${winner.votes} votes`,
            { indent: 20 }
          );
          doc.moveDown(0.2);
        }
      });
      
      doc.moveDown(0.5);
    });

    // Add new page for voter participation
    doc.addPage();
    doc.fontSize(16).text('VOTER PARTICIPATION REPORT', { align: 'center', underline: true });
    doc.moveDown();

    // Overall statistics
    doc.fontSize(14).text('Overall Statistics', { underline: true });
    doc.moveDown(0.3);
    
    doc.fontSize(12).text(`Total Registered Voters: ${fullReport.participation.summary.totalVoters}`);
    doc.text(`Voters Who Voted: ${fullReport.participation.summary.voted}`);
    doc.text(`Voters Who Did Not Vote: ${fullReport.participation.summary.notVoted}`);
    doc.text(`Overall Turnout Rate: ${fullReport.participation.summary.overallTurnout}%`);
    doc.moveDown();

    // Add detailed participation by ward
    doc.fontSize(14).text('Participation by Ward', { underline: true });
    doc.moveDown(0.3);

    if (fullReport.participation.detailed.length > 0) {
      // Table headers
      doc.fontSize(10);
      let y = doc.y;
      doc.text('Constituency', 50, y, { width: 100 });
      doc.text('Ward', 150, y, { width: 100 });
      doc.text('Total', 250, y, { width: 60 });
      doc.text('Voted', 310, y, { width: 60 });
      doc.text('Not Voted', 370, y, { width: 60 });
      doc.text('Turnout %', 430, y, { width: 60 });
      
      doc.moveDown(0.5);
      doc.moveTo(50, doc.y).lineTo(490, doc.y).stroke();
      doc.moveDown(0.3);

      // Table rows
      fullReport.participation.detailed.forEach(stat => {
        y = doc.y;
        doc.text(stat._id.constituency, 50, y, { width: 100 });
        doc.text(stat._id.ward, 150, y, { width: 100 });
        doc.text(stat.totalVoters.toString(), 250, y, { width: 60 });
        doc.text(stat.voted.toString(), 310, y, { width: 60 });
        doc.text(stat.notVoted.toString(), 370, y, { width: 60 });
        doc.text(stat.turnoutRate.toFixed(2) + '%', 430, y, { width: 60 });
        
        doc.moveDown(0.5);
      });
    }

    // Add footer
    doc.addPage();
    doc.moveDown(5);
    doc.fontSize(12).text('ELECTION COMMISSION OFFICIAL STAMP', { align: 'center' });
    doc.moveDown(2);
    doc.fontSize(10).text('________________________________', { align: 'center' });
    doc.text('Chairperson, Kirinyaga County Election Commission', { align: 'center' });
    doc.moveDown();
    doc.text('Date: _________________________', { align: 'center' });
    doc.moveDown(2);
    doc.fontSize(8).text('This is an official document. Unauthorized reproduction is prohibited.', { align: 'center' });

    // Finalize PDF
    doc.end();

  } catch (error) {
    next(error);
  }
};

// @desc    Get graphical data for charts - UPDATED WITH AUTH CHECK
// @route   GET /api/v1/results/post-election/charts
// @access  Private (Admin)
const getChartData = async (req, res, next) => {
  try {
    // CHECK ADMIN AUTHENTICATION - FIX FOR 401 ERROR
    if (!req.admin) {
      return res.status(401).json({
        success: false,
        error: 'Not authorized to access chart data. Please login as admin.'
      });
    }

    const { chartType } = req.query; // 'turnout', 'results', 'comparison'

    let chartData = {};

    switch (chartType) {
      case 'turnout':
        // Voter turnout by ward
        const turnoutData = await Voter.aggregate([
          {
            $group: {
              _id: { constituency: '$constituency', ward: '$ward' },
              total: { $sum: 1 },
              voted: { $sum: { $cond: [{ $eq: ['$hasVoted', true] }, 1, 0] } }
            }
          },
          {
            $addFields: {
              turnoutRate: {
                $cond: [
                  { $eq: ['$total', 0] },
                  0,
                  { $multiply: [{ $divide: ['$voted', '$total'] }, 100] }
                ]
              }
            }
          },
          { $sort: { turnoutRate: -1 } },
          { $limit: 10 }
        ]);

        chartData = {
          labels: turnoutData.map(d => `${d._id.ward}`),
          datasets: [{
            label: 'Turnout Rate (%)',
            data: turnoutData.map(d => parseFloat(d.turnoutRate.toFixed(2))),
            backgroundColor: 'rgba(46, 125, 50, 0.7)',
            borderColor: 'rgb(46, 125, 50)',
            borderWidth: 1
          }]
        };
        break;

      case 'results':
        // Top candidates by position
        const topCandidates = await Vote.aggregate([
          {
            $group: {
              _id: {
                position: '$position',
                candidateId: '$candidateId'
              },
              votes: { $sum: 1 }
            }
          },
          {
            $lookup: {
              from: 'candidates',
              localField: '_id.candidateId',
              foreignField: '_id',
              as: 'candidate'
            }
          },
          { $unwind: '$candidate' },
          { $sort: { '_id.position': 1, votes: -1 } },
          { $group: {
              _id: '$_id.position',
              candidates: { $push: {
                name: '$candidate.fullName',
                party: '$candidate.politicalParty',
                votes: '$votes'
              }},
              totalVotes: { $sum: '$votes' }
            }
          }
        ]);

        // Process for chart
        const positions = topCandidates.map(d => d._id);
        const datasets = positions.map((position, index) => {
          const positionData = topCandidates.find(d => d._id === position);
          const colors = [
            'rgba(46, 125, 50, 0.7)',
            'rgba(255, 152, 0, 0.7)',
            'rgba(33, 150, 243, 0.7)',
            'rgba(156, 39, 176, 0.7)'
          ];
          
          return {
            label: position,
            data: positionData.candidates.slice(0, 3).map(c => c.votes),
            backgroundColor: colors[index % colors.length]
          };
        });

        chartData = {
          labels: ['1st', '2nd', '3rd'],
          datasets: datasets
        };
        break;

      case 'comparison':
        // Comparison of voting patterns
        const comparisonData = await Vote.aggregate([
          {
            $group: {
              _id: {
                position: '$position',
                constituency: '$constituency'
              },
              votes: { $sum: 1 }
            }
          },
          { $sort: { '_id.constituency': 1, '_id.position': 1 } }
        ]);

        // Group by constituency
        const constituencies = [...new Set(comparisonData.map(d => d._id.constituency))];
        const positionsList = [...new Set(comparisonData.map(d => d._id.position))];
        
        chartData = {
          labels: positionsList,
          datasets: constituencies.slice(0, 5).map((constituency, index) => {
            const colors = [
              'rgba(46, 125, 50, 0.7)',
              'rgba(255, 152, 0, 0.7)',
              'rgba(33, 150, 243, 0.7)',
              'rgba(156, 39, 176, 0.7)',
              'rgba(244, 67, 54, 0.7)'
            ];
            
            const data = positionsList.map(position => {
              const item = comparisonData.find(d => 
                d._id.constituency === constituency && d._id.position === position
              );
              return item ? item.votes : 0;
            });
            
            return {
              label: constituency,
              data: data,
              backgroundColor: colors[index % colors.length],
              borderColor: colors[index % colors.length].replace('0.7', '1'),
              borderWidth: 2
            };
          })
        };
        break;

      default:
        // Default: overall statistics
        const overallStats = {
          totalVoters: await Voter.countDocuments({}),
          voted: await Voter.countDocuments({ hasVoted: true }),
          totalCandidates: await Candidate.countDocuments({}),
          totalVotes: await Vote.countDocuments({}),
          positions: await Vote.distinct('position')
        };

        chartData = {
          overall: overallStats,
          voterStatus: {
            labels: ['Voted', 'Did Not Vote'],
            datasets: [{
              data: [overallStats.voted, overallStats.totalVoters - overallStats.voted],
              backgroundColor: ['#2e7d32', '#f44336']
            }]
          }
        };
        break;
    }

    res.status(200).json({
      success: true,
      data: chartData
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Publish final results (make them public)
// @route   POST /api/v1/results/post-election/publish
// @access  Private (Admin)
const publishFinalResults = async (req, res, next) => {
  try {
    // Check if user is admin
    if (!req.admin) {
      return res.status(401).json({
        success: false,
        error: 'Not authorized to access this route'
      });
    }

    // Check if voting portal is closed
    const portalStatus = await SystemSetting.findOne({ key: 'voting_portal_open' });
    
    if (portalStatus && portalStatus.value === true) {
      return res.status(400).json({
        success: false,
        message: 'Cannot publish results while voting portal is still open.'
      });
    }

    // Create a system setting for published results
    const publishSetting = await SystemSetting.findOneAndUpdate(
      { key: 'results_published' },
      { 
        key: 'results_published',
        value: true,
        description: 'Election results have been officially published',
        updatedAt: new Date()
      },
      { upsert: true, new: true }
    );

    // Create a results snapshot
    const resultsSnapshot = {
      timestamp: new Date(),
      publishedBy: req.admin._id,
      summary: {
        totalVoters: await Voter.countDocuments({}),
        totalVotes: await Vote.countDocuments({}),
        totalCandidates: await Candidate.countDocuments({})
      }
    };

    // Log the publication
    await SystemSetting.findOneAndUpdate(
      { key: 'last_results_publication' },
      { 
        key: 'last_results_publication',
        value: resultsSnapshot,
        description: 'Last election results publication',
        updatedAt: new Date()
      },
      { upsert: true, new: true }
    );

    res.status(200).json({
      success: true,
      message: 'Election results have been officially published',
      data: {
        publishedAt: new Date(),
        publishedBy: req.admin.fullName || req.admin.email,
        snapshot: resultsSnapshot
      }
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Check if results are published
// @route   GET /api/v1/results/post-election/status
// @access  Public
const getPublicationStatus = async (req, res, next) => {
  try {
    const portalStatus = await SystemSetting.findOne({ key: 'voting_portal_open' });
    const resultsPublished = await SystemSetting.findOne({ key: 'results_published' });
    const lastPublication = await SystemSetting.findOne({ key: 'last_results_publication' });

    res.status(200).json({
      success: true,
      data: {
        votingPortalOpen: portalStatus ? portalStatus.value : false,
        resultsPublished: resultsPublished ? resultsPublished.value : false,
        lastPublication: lastPublication ? lastPublication.value : null,
        canPublish: portalStatus ? !portalStatus.value : true,
        currentTime: new Date()
      }
    });
  } catch (error) {
    next(error);
  }
};

// Helper function to get full report data for PDF export
async function getFullReportData() {
  const countyResults = await Vote.aggregate([
    {
      $group: {
        _id: {
          position: '$position',
          candidateId: '$candidateId'
        },
        votes: { $sum: 1 }
      }
    },
    {
      $lookup: {
        from: 'candidates',
        localField: '_id.candidateId',
        foreignField: '_id',
        as: 'candidate'
      }
    },
    { $unwind: '$candidate' },
    { $sort: { '_id.position': 1, votes: -1 } }
  ]);

  // Process county results with percentages
  const countyWithPercent = {};
  const positions = [...new Set(countyResults.map(r => r._id.position))];
  
  positions.forEach(position => {
    const positionResults = countyResults.filter(r => r._id.position === position);
    const totalVotes = positionResults.reduce((sum, r) => sum + r.votes, 0);
    
    countyWithPercent[position] = positionResults.map(result => ({
      candidateName: result.candidate.fullName,
      party: result.candidate.politicalParty,
      votes: result.votes,
      percentage: totalVotes > 0 ? ((result.votes / totalVotes) * 100).toFixed(2) : 0
    }));
  });

  // Get winners
  const winners = { constituency: {} };
  
  // Get constituency winners
  const constituencyResults = await Vote.aggregate([
    {
      $group: {
        _id: {
          position: '$position',
          constituency: '$constituency',
          candidateId: '$candidateId'
        },
        votes: { $sum: 1 }
      }
    },
    {
      $lookup: {
        from: 'candidates',
        localField: '_id.candidateId',
        foreignField: '_id',
        as: 'candidate'
      }
    },
    { $unwind: '$candidate' },
    { $sort: { '_id.position': 1, '_id.constituency': 1, votes: -1 } }
  ]);

  const constituencies = [...new Set(constituencyResults.map(r => r._id.constituency))];
  constituencies.forEach(constituency => {
    winners.constituency[constituency] = {};
    positions.forEach(position => {
      const positionResults = constituencyResults.filter(
        r => r._id.constituency === constituency && r._id.position === position
      );
      if (positionResults.length > 0) {
        winners.constituency[constituency][position] = {
          candidateName: positionResults[0].candidate.fullName,
          party: positionResults[0].candidate.politicalParty,
          votes: positionResults[0].votes
        };
      }
    });
  });

  // Get participation data
  const participationStats = await Voter.aggregate([
    {
      $group: {
        _id: { constituency: '$constituency', ward: '$ward' },
        totalVoters: { $sum: 1 },
        voted: { $sum: { $cond: [{ $eq: ['$hasVoted', true] }, 1, 0] } },
        notVoted: { $sum: { $cond: [{ $eq: ['$hasVoted', false] }, 1, 0] } }
      }
    },
    {
      $addFields: {
        turnoutRate: {
          $cond: [
            { $eq: ['$totalVoters', 0] },
            0,
            { $multiply: [{ $divide: ['$voted', '$totalVoters'] }, 100] }
          ]
        }
      }
    },
    { $sort: { '_id.constituency': 1, '_id.ward': 1 } }
  ]);

  const totalVoters = await Voter.countDocuments({});
  const votedVoters = await Voter.countDocuments({ hasVoted: true });

  return {
    countyResults: countyWithPercent,
    winners,
    participation: {
      summary: {
        totalVoters,
        voted: votedVoters,
        notVoted: totalVoters - votedVoters,
        overallTurnout: totalVoters > 0 ? ((votedVoters / totalVoters) * 100).toFixed(2) : 0
      },
      detailed: participationStats
    }
  };
}

module.exports = {
  getLiveResults,
  getResultsByPosition,
  getResultsByConstituency,
  getResultsByWard,
  exportResultsCSV,
  exportResultsPDF,
  getParticipationReport,
  getConstituenciesList,
  getFullElectionReport,
  exportPostElectionCSV,
  exportPostElectionPDF,
  getChartData,
  publishFinalResults,
  getPublicationStatus
};