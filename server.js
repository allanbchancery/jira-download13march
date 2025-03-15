const express = require('express');
const cors = require('cors');
const axios = require('axios');
const dotenv = require('dotenv');
const path = require('path');
const AdmZip = require('adm-zip');
const fs = require('fs');
const sqlite3 = require('sqlite3');

// Import debug helpers and logger
const debug = require('./server-debug');
const logger = debug.logger;

// Database setup
let db = new sqlite3.Database('jira_attachments.db');
// Wrap database with debug logging
db = debug.wrapDatabase(db);

// Database schema setup
db.serialize(() => {
  db.run("CREATE TABLE IF NOT EXISTS attachments (id INTEGER PRIMARY KEY, ticket TEXT, filename TEXT, filepath TEXT, size INTEGER)");
  db.run("CREATE TABLE IF NOT EXISTS projects (key TEXT PRIMARY KEY, name TEXT)");
  
  // New tables for background download functionality
  db.run(`CREATE TABLE IF NOT EXISTS download_jobs (
    id INTEGER PRIMARY KEY,
    job_id TEXT UNIQUE,
    username TEXT,
    api_key TEXT,
    project_key TEXT,
    download_type TEXT,
    file_format TEXT,
    download_path TEXT,
    status TEXT,
    created_at TEXT,
    updated_at TEXT,
    completed_at TEXT,
    error TEXT
  )`);
  
  db.run(`CREATE TABLE IF NOT EXISTS download_segments (
    id INTEGER PRIMARY KEY,
    job_id TEXT,
    segment_number INTEGER,
    total_segments INTEGER,
    status TEXT,
    file_path TEXT,
    file_count INTEGER,
    size_bytes INTEGER,
    created_at TEXT,
    updated_at TEXT
  )`);
});

// Load environment variables
dotenv.config();

// Import background processing modules
let queueManager = require('./workers/queue-manager');
// Wrap queue manager with debug logging
queueManager = debug.wrapQueueManager(queueManager);

const app = express();
const port = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(debug.debugMiddleware); // Add debug middleware for request logging

// Serve static files
app.use(express.static(__dirname));
app.use('/downloads', express.static(path.join(__dirname, 'downloads')));

// Initialize download queue
const downloadQueue = queueManager.initializeQueue(db);

// Schedule cleanup of old jobs
setInterval(() => {
  queueManager.cleanupOldJobs(db)
    .then(count => {
      if (count > 0) {
        console.log(`Cleaned up ${count} old jobs`);
      }
    })
    .catch(err => {
      console.error('Error cleaning up old jobs:', err);
    });
}, 24 * 60 * 60 * 1000); // Run once per day

// Utility function to create Jira API headers
const createJiraHeaders = (auth) => ({
  'Authorization': `Basic ${auth}`,
  'Accept': 'application/json',
  'Content-Type': 'application/json'
});

// Test connection endpoint
app.post('/api/test-connection', async (req, res, next) => {
  const { username, apiKey } = req.body;
  
  if (!username || !apiKey) {
    return res.status(400).json({
      success: false,
      error: 'Username and API key are required'
    });
  }
  
  const auth = Buffer.from(`${username}:${apiKey}`).toString('base64');
  logger.info('Testing connection with auth', { username });

  try {
    const response = await axios.get('https://thehut.atlassian.net/rest/api/2/myself', {
      headers: {
        'Authorization': `Basic ${auth}`,
        'Accept': 'application/json'
      }
    });
    logger.info('Connection successful', { 
      username, 
      displayName: response.data.displayName,
      accountId: response.data.accountId
    });
    res.json({ success: true, user: response.data });
  } catch (error) {
    logger.warn('Connection failed', { 
      username, 
      status: error.response?.status,
      statusText: error.response?.statusText,
      message: error.message
    });
    
    // Provide more detailed error information
    if (error.response) {
      // The request was made and the server responded with a status code
      // that falls out of the range of 2xx
      res.status(error.response.status).json({
        success: false,
        error: 'Failed to authenticate with Jira',
        details: error.response.data?.message || error.response.statusText
      });
    } else if (error.request) {
      // The request was made but no response was received
      logger.error('No response received from Jira API', { error: error.message });
      res.status(500).json({
        success: false,
        error: 'No response received from Jira API',
        details: 'The server may be down or unreachable'
      });
    } else {
      // Something happened in setting up the request that triggered an Error
      logger.error('Error setting up request', { error: error.message });
      next(error); // Pass to error handler
    }
  }
});

// Get projects endpoint
app.post('/api/get-projects', async (req, res, next) => {
  const { username, apiKey } = req.body;
  
  if (!username || !apiKey) {
    return res.status(400).json({
      success: false,
      error: 'Username and API key are required'
    });
  }
  
  const auth = Buffer.from(`${username}:${apiKey}`).toString('base64');

  try {
    logger.info('Fetching projects', { username });
    const response = await axios.get('https://thehut.atlassian.net/rest/api/2/project', {
      headers: createJiraHeaders(auth)
    });
    
    // Map the response to include both name and key
    const projects = response.data.map(project => ({
      key: project.key,
      name: project.name
    }));
    
    logger.info('Projects fetched successfully', { 
      username, 
      projectCount: projects.length 
    });
    
    res.json({ success: true, projects });
  } catch (error) {
    logger.error('Failed to fetch projects', { 
      username, 
      error: error.message,
      status: error.response?.status,
      data: error.response?.data
    });
    
    if (error.response) {
      res.status(error.response.status).json({
        success: false,
        error: 'Failed to fetch projects',
        details: error.response.data?.message || error.response.statusText
      });
    } else if (error.request) {
      res.status(500).json({
        success: false,
        error: 'No response received from Jira API',
        details: 'The server may be down or unreachable'
      });
    } else {
      next(error); // Pass to error handler
    }
  }
});

// Ensure downloads directory exists
const downloadsDir = path.join(__dirname, 'downloads');
if (!fs.existsSync(downloadsDir)) {
  fs.mkdirSync(downloadsDir);
}

// Download tickets endpoint
app.get('/api/download-tickets', async (req, res) => {
  const { username, apiKey, projectKey, downloadType = 'all', fileFormat = 'json' } = req.query;
  const auth = Buffer.from(`${username}:${apiKey}`).toString('base64');

  // Helper function to send periodic keep-alive messages
  const startKeepAlive = (res, projectKey, intervalMs = 15000) => {
    const keepAliveInterval = setInterval(() => {
      // Check if response is still writable
      if (!res.writableEnded) {
        try {
          // Send an empty progress update as a heartbeat
          res.write(`data: ${JSON.stringify({
            keepAlive: true,
            timestamp: new Date().toISOString(),
            projectKey
          })}\n\n`);
          
          logger.debug('Sent keep-alive message', {
            projectKey,
            timestamp: new Date().toISOString()
          });
        } catch (error) {
          logger.error('Error sending keep-alive message', {
            projectKey,
            error: error.message
          });
          clearInterval(keepAliveInterval);
        }
      } else {
        // Stop interval if response has ended
        clearInterval(keepAliveInterval);
      }
    }, intervalMs);
    
    return keepAliveInterval;
  };

  logger.info('Download request received', {
    projectKey,
    downloadType,
    fileFormat,
    username,
    timestamp: new Date().toISOString()
  });

  let keepAliveInterval;

  try {
    // Log downloads directory status
    logger.debug('Downloads directory status', {
      path: downloadsDir,
      exists: fs.existsSync(downloadsDir),
      isDirectory: fs.existsSync(downloadsDir) && fs.statSync(downloadsDir).isDirectory()
    });

    // Set headers for SSE
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive'
    });

    // Start keep-alive messages
    keepAliveInterval = startKeepAlive(res, projectKey);

    // Helper function to send SSE
    const sendProgress = (data) => {
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    // Get project info and total number of issues
    console.log('Fetching project info and issue count...');
    const jql = `project = ${projectKey}`;
    const [projectResponse, countResponse] = await Promise.all([
      axios.get(`https://thehut.atlassian.net/rest/api/2/project/${projectKey}`, {
        headers: createJiraHeaders(auth)
      }),
      axios.post('https://thehut.atlassian.net/rest/api/2/search', {
        jql,
        maxResults: 0
      }, {
        headers: createJiraHeaders(auth)
      })
    ]);

    console.log('Total issues from Jira:', countResponse.data.total);

    const projectInfo = projectResponse.data;
    const totalIssues = countResponse.data.total;

    console.log('Project info retrieved:', {
      projectKey: projectInfo.key,
      projectName: projectInfo.name,
      totalIssues,
      timestamp: new Date().toISOString()
    });

    let issues = [];
    const startTime = Date.now();
    const progress = {
      stage: 'init',
      message: 'Initializing download...',
      totalIssues,
      currentIssue: 0,
      batchProgress: 0,
      estimatedSize: '0 MB',
      downloadedSize: '0 MB',
      timeElapsed: '0s',
      estimatedTimeRemaining: 'Calculating...',
      currentOperation: 'Preparing download...',
      operationDetails: ''
    };

    // Helper function to update time estimates
    const updateTimeEstimates = () => {
      const elapsed = Math.floor((Date.now() - startTime) / 1000);
      progress.timeElapsed = `${elapsed}s`;
    };

    // Send initial progress with download type info
    progress.currentOperation = `Downloading ${downloadType === 'all' ? 'Everything' : downloadType === 'tickets' ? 'Tickets Only' : 'Attachments Only'}`;
    sendProgress(progress);

    // Fetch issues based on download type
    progress.stage = 'fetching';
    progress.currentOperation = 'Scanning Project';
    progress.message = 'Finding content...';
    progress.operationDetails = `Project: ${projectKey}`;
    sendProgress(progress);

    // Define fields to fetch based on download type
    let fields = [];
    if (downloadType === 'all' || downloadType === 'attachments') {
      fields.push('attachment');
    }
    if (downloadType === 'all' || downloadType === 'tickets') {
      fields.push('summary', 'description', 'comment', 'created', 'updated', 'status', 'priority', 'assignee', 'reporter');
    }

    // Fetch all issues with pagination
    const maxResultsPerPage = 100; // Jira's max per page
    let startAt = 0;
    do {
      const response = await axios.post('https://thehut.atlassian.net/rest/api/2/search', {
        jql,
        startAt,
        maxResults: maxResultsPerPage,
        fields
      }, {
        headers: createJiraHeaders(auth)
      });
      issues = issues.concat(response.data.issues);
      startAt += maxResultsPerPage;
    } while (startAt < totalIssues);

    console.log('Fetched issues count:', issues.length);
    progress.currentIssue = issues.length;
    progress.batchProgress = 100;
    sendProgress(progress);

    console.log('Processing issues:', {
      count: issues.length,
      downloadType,
      timestamp: new Date().toISOString()
    });

    // Process issues based on download type
    const ticketsData = issues.map(issue => ({
      key: issue.key || '',
      summary: issue.fields?.summary || '',
      description: issue.fields?.description || '',
      created: issue.fields?.created || '',
      updated: issue.fields?.updated || '',
      status: issue.fields?.status?.name || '',
      priority: issue.fields?.priority?.name || '',
      assignee: issue.fields?.assignee?.displayName || '',
      reporter: issue.fields?.reporter?.displayName || '',
      comments: (issue.fields?.comment?.comments || []).map(c => ({
        author: c?.author?.displayName || '',
        created: c?.created || '',
        body: c?.body || ''
      }))
    }));

    // For tickets-only or all content, create the tickets file
    if (downloadType === 'tickets' || downloadType === 'all') {
      const fileName = `${projectKey}_tickets_${new Date().toISOString().replace(/[:.]/g, '-')}.${fileFormat}`;
      const filePath = path.join(downloadsDir, fileName);

      console.log('Writing ticket data to file:', {
        fileName,
        format: fileFormat,
        ticketCount: ticketsData.length,
        path: filePath,
        timestamp: new Date().toISOString()
      });

      if (fileFormat === 'json') {
        fs.writeFileSync(filePath, JSON.stringify(ticketsData, null, 2));
        console.log('JSON file written successfully');
      } else {
        // Convert to CSV format
        const csvRows = [];
        // Add headers
        csvRows.push(['Key', 'Summary', 'Description', 'Created', 'Updated', 'Status', 'Priority', 'Assignee', 'Reporter', 'Comments']);
        // Add data
        ticketsData.forEach(ticket => {
          csvRows.push([
            ticket.key,
            ticket.summary,
            ticket.description,
            ticket.created,
            ticket.updated,
            ticket.status,
            ticket.priority,
            ticket.assignee,
            ticket.reporter,
            ticket.comments.map(c => `${c.author}: ${c.body}`).join(' | ')
          ]);
        });
        fs.writeFileSync(filePath, csvRows.map(row => row.join(',')).join('\n'));
      }

      // If tickets only, send file info for download
      if (downloadType === 'tickets') {
        sendProgress({
          success: true,
          data: {
            tickets: ticketsData,
            totalTickets: ticketsData.length,
            totalComments: ticketsData.reduce((sum, t) => sum + (t.comments?.length || 0), 0),
            totalAttachments: 0,
            fileName: fileName,
            totalSize: `${(fs.statSync(filePath).size / (1024 * 1024)).toFixed(1)}MB`,
            downloadType: 'tickets'
          }
        });
        return;
      }
    }

    // For attachments-only or all content, continue with attachment processing

    const downloadData = {
      projectInfo,
      totalAttachments: 0,
      estimatedSize: '0 MB'
    };

    // Process each issue and estimate total size
    progress.stage = 'processing';
    let totalEstimatedBytes = 0;
    let totalAttachmentCount = 0;

    console.log('Starting attachment analysis...');

    // First pass: count attachments and calculate total size
    for (const issue of issues) {
      if (issue.fields?.attachment) {
        totalAttachmentCount += issue.fields.attachment.length;
        for (const attachment of issue.fields.attachment) {
          totalEstimatedBytes += parseInt(attachment.size || 0);
        }
      }
    }

    // Skip second pass and go straight to segmentation
    downloadData.totalAttachments = totalAttachmentCount;

    downloadData.estimatedSize = `${(totalEstimatedBytes / (1024 * 1024)).toFixed(1)} MB`;

    console.log('Attachment analysis complete:', {
      totalAttachments: totalAttachmentCount,
      totalSize: `${(totalEstimatedBytes / (1024 * 1024)).toFixed(1)} MB`,
      timestamp: new Date().toISOString()
    });

    // Calculate segments needed for attachments
    const SEGMENT_SIZE_LIMIT = 200 * 1024 * 1024; // 200MB per segment
    const attachmentSegments = [];
    let currentSegment = {
      files: [],
      size: 0,
      number: 1
    };

    // Group attachments into segments with error handling
    try {
      progress.stage = 'analyzing';
      progress.currentOperation = 'Analyzing attachments';
      progress.operationDetails = `Found ${totalAttachmentCount} attachments (${(totalEstimatedBytes / (1024 * 1024)).toFixed(1)}MB total)`;
      progress.message = 'Calculating segments needed...';
      sendProgress(progress);

      // Calculate and show segment information
      const estimatedSegments = Math.ceil(totalEstimatedBytes / SEGMENT_SIZE_LIMIT);
      progress.operationDetails = `Total size: ${(totalEstimatedBytes / (1024 * 1024)).toFixed(1)}MB`;
      progress.message = `Will create ${estimatedSegments} segments of 50MB each`;
      sendProgress(progress);

      // Add a small delay to ensure progress is shown
      await new Promise(resolve => setTimeout(resolve, 100));

      for (const issue of issues) {
        if (!issue.fields?.attachment) continue;

        for (const attachment of issue.fields.attachment) {
          try {
            const attachmentSize = parseInt(attachment.size || 0);
            if (attachmentSize === 0) {
              console.warn(`Skipping attachment with size 0: ${attachment.filename}`);
              continue;
            }

            // If attachment is larger than segment size, split it
            if (attachmentSize > SEGMENT_SIZE_LIMIT) {
              const segmentCount = Math.ceil(attachmentSize / SEGMENT_SIZE_LIMIT);
              progress.currentOperation = 'Processing large file';
              progress.operationDetails = `${attachment.filename} (${(attachmentSize / (1024 * 1024)).toFixed(1)}MB)`;
              progress.message = `Splitting into ${segmentCount} parts of 50MB each`;
              sendProgress(progress);

              for (let i = 0; i < segmentCount; i++) {
                const startByte = i * SEGMENT_SIZE_LIMIT;
                const endByte = Math.min((i + 1) * SEGMENT_SIZE_LIMIT, attachmentSize);
                attachmentSegments.push({
                  files: [{
                    ticket: issue.key,
                    attachment,
                    partNumber: i + 1,
                    totalParts: segmentCount,
                    startByte,
                    endByte,
                    size: endByte - startByte
                  }],
                  size: endByte - startByte,
                  number: attachmentSegments.length + 1
                });
              }
            }
            // If current segment would exceed limit, start new segment
            else if (currentSegment.size + attachmentSize > SEGMENT_SIZE_LIMIT) {
              if (currentSegment.files.length > 0) {
                attachmentSegments.push(currentSegment);
              }
              currentSegment = {
                files: [{
                  ticket: issue.key,
                  attachment,
                  partNumber: 1,
                  totalParts: 1,
                  startByte: 0,
                  endByte: attachmentSize,
                  size: attachmentSize
                }],
                size: attachmentSize,
                number: attachmentSegments.length + 1
              };
            }
            // Add to current segment
            else {
              currentSegment.files.push({
                ticket: issue.key,
                attachment,
                partNumber: 1,
                totalParts: 1,
                startByte: 0,
                endByte: attachmentSize,
                size: attachmentSize
              });
              currentSegment.size += attachmentSize;
            }

            progress.currentOperation = 'Processing Files';
            progress.operationDetails = `File ${attachmentSegments.length + 1} of ${totalAttachmentCount}`;
            progress.message = `Processing: ${attachment.filename} (${(attachmentSize / (1024 * 1024)).toFixed(1)}MB)`;
            sendProgress(progress);
          } catch (error) {
            console.error(`Error processing attachment: ${attachment.filename}`, error);
            progress.currentOperation = 'Warning';
            progress.operationDetails = `Error with ${attachment.filename}`;
            progress.message = error.message;
            sendProgress(progress);
          }
        }
      }

      // Add final segment if not empty
      if (currentSegment.files.length > 0) {
        attachmentSegments.push(currentSegment);
      }

      const finalSegmentCount = attachmentSegments.length;
      if (finalSegmentCount === 0) {
        throw new Error('No valid attachments found to download');
      }

      progress.currentOperation = 'Segmentation complete';
      progress.operationDetails = `Created ${finalSegmentCount} segments`;
      progress.message = `Ready to download ${downloadData.totalAttachments} attachments in ${finalSegmentCount} parts`;
      sendProgress(progress);
    } catch (error) {
      console.error('Error during segmentation:', error);
      throw new Error('Failed to organize attachments: ' + error.message);
    }

    const totalSegments = attachmentSegments.length;

    progress.stage = 'segmenting';
    progress.currentOperation = 'Creating download segments';
    progress.operationDetails = `Preparing ${totalSegments} segments (50MB each)`;
    progress.message = `Organizing ${downloadData.totalAttachments} attachments into ${totalSegments} segments...`;
    sendProgress(progress);

    // Create segments with attachment chunks
    const segments = [];
    for (const segment of attachmentSegments) {
      const segmentZip = new AdmZip();

      // Add attachments for this segment
      for (const file of segment.files) {
        const { ticket, attachment, partNumber, totalParts, startByte, endByte } = file;

        console.log('Downloading attachment:', {
          filename: attachment.filename,
          ticket: ticket,
          size: `${((endByte - startByte) / (1024 * 1024)).toFixed(1)} MB`,
          part: `${partNumber}/${totalParts}`,
          timestamp: new Date().toISOString()
        });

        // Get attachment data
        const attachmentResponse = await axios.get(attachment.content, {
          headers: {
            ...createJiraHeaders(auth),
            Range: `bytes=${startByte}-${endByte - 1}`
          },
          responseType: 'arraybuffer'
        });

        // Add to zip with part number if split
        const filename = totalParts > 1
          ? `${attachment.filename}.part${partNumber}`
          : attachment.filename;

        segmentZip.addFile(
          `${projectKey}/${ticket}/${filename}`,
          Buffer.from(attachmentResponse.data)
        );
      }

      console.log('Creating segment file:', {
        segmentNumber: segment.number,
        totalSegments,
        fileCount: segment.files.length,
        size: `${(segment.size / (1024 * 1024)).toFixed(1)} MB`,
        timestamp: new Date().toISOString()
      });

      // Save segment with detailed info
      const segmentFileName = `${projectKey}_attachments_part${segment.number}of${totalSegments}_${(segment.size / (1024 * 1024)).toFixed(1)}MB_${new Date().toISOString().replace(/[:.]/g, '-')}.zip`;
      const segmentFilePath = path.join(downloadsDir, segmentFileName);
      segmentZip.writeZip(segmentFilePath);

      segments.push({
        fileName: segmentFileName,
        fileCount: segment.files.length,
        size: segment.size,
        partNumber: segment.number,
        totalParts: totalSegments,
        files: segment.files.map(f => ({
          name: f.attachment.filename,
          ticket: f.ticket,
          size: `${((f.endByte - f.startByte) / (1024 * 1024)).toFixed(1)}MB`,
          part: f.partNumber,
          totalParts: f.totalParts
        }))
      });

      progress.currentOperation = 'Downloading Files';
      progress.operationDetails = `Part ${segment.number} of ${totalSegments}`;
      progress.message = `Downloading ${segment.files.length} files (${(segment.size / (1024 * 1024)).toFixed(1)}MB)`;
      progress.currentFile = segment.files[0].attachment.filename;
      sendProgress(progress);
    }

    progress.stage = 'complete';
    progress.currentOperation = 'Complete';
    progress.operationDetails = `Total time: ${progress.timeElapsed}`;
    progress.message = 'All segments ready!';
    sendProgress(progress);

    // Send final success response
    const finalResponse = {
      success: true,
      data: {
        ...downloadData,
        tickets: ticketsData,
        totalTickets: ticketsData.length,
        totalComments: ticketsData.reduce((sum, t) => sum + (t.comments?.length || 0), 0),
        totalAttachments: totalAttachmentCount
      }
    };

    // Add attachment-specific data if present
    if (segments && segments.length > 0) {
      finalResponse.data = {
        ...finalResponse.data,
        segments,
        totalSegments,
        totalSize: `${(totalEstimatedBytes / (1024 * 1024)).toFixed(1)}MB`,
        segmentDetails: attachmentSegments.map(s => ({
          number: s.number,
          size: `${(s.size / (1024 * 1024)).toFixed(1)}MB`,
          fileCount: s.files.length,
          files: s.files.map(f => ({
            name: f.attachment.filename,
            ticket: f.ticket,
            size: `${((f.endByte - f.startByte) / (1024 * 1024)).toFixed(1)}MB`,
            part: f.partNumber,
            totalParts: f.totalParts
          }))
        })),
        segmentSize: '50MB'
      };
    }

    sendProgress(finalResponse);
  } catch (error) {
    const errorDetails = {
      message: error.message,
      code: error.code,
      stack: error.stack,
      timestamp: new Date().toISOString()
    };

    if (error.response) {
      errorDetails.status = error.response.status;
      errorDetails.statusText = error.response.statusText;
      errorDetails.data = error.response.data;
    }

    console.error('Download error:', errorDetails);
    if (!res.headersSent) {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive'
      });
    }
    res.write(`data: ${JSON.stringify({
      success: false,
      error: error.message || 'Failed to download tickets'
    })}\n\n`);
    res.end();
  }
});

// Background download endpoints

// Submit a background download job
app.post('/api/submit-download-job', async (req, res) => {
  const { username, apiKey, projectKey, downloadType, fileFormat, downloadPath } = req.body;
  
  if (!username || !apiKey || !projectKey) {
    return res.status(400).json({
      success: false,
      error: 'Missing required parameters'
    });
  }
  
  try {
    // Validate credentials
    const auth = Buffer.from(`${username}:${apiKey}`).toString('base64');
    const testResponse = await axios.get('https://thehut.atlassian.net/rest/api/2/myself', {
      headers: {
        'Authorization': `Basic ${auth}`,
        'Accept': 'application/json'
      }
    });
    
    // Validate download path if provided
    if (downloadPath) {
      const pathValidation = await queueManager.validateDownloadPath(downloadPath);
      if (!pathValidation.valid) {
        return res.status(400).json({
          success: false,
          error: `Invalid download path: ${pathValidation.error}`
        });
      }
    }
    
    // Add job to queue
    const job = await queueManager.addJob(db, downloadQueue, {
      username,
      apiKey,
      projectKey,
      downloadType,
      fileFormat,
      downloadPath
    });
    
    res.json({
      success: true,
      message: 'Download job submitted successfully',
      job
    });
  } catch (error) {
    console.error('Error submitting download job:', error);
    res.status(error.response?.status || 500).json({
      success: false,
      error: error.message || 'Failed to submit download job'
    });
  }
});

// Get all download jobs
app.get('/api/download-jobs', async (req, res) => {
  try {
    const jobs = await queueManager.getJobs(db);
    res.json({
      success: true,
      jobs
    });
  } catch (error) {
    console.error('Error getting download jobs:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to get download jobs'
    });
  }
});

// Get job status
app.get('/api/download-job/:jobId', async (req, res) => {
  try {
    const job = await queueManager.getJobById(db, req.params.jobId);
    res.json({
      success: true,
      job
    });
  } catch (error) {
    console.error('Error getting job status:', error);
    res.status(error.message === 'Job not found' ? 404 : 500).json({
      success: false,
      error: error.message || 'Failed to get job status'
    });
  }
});

// Cancel job
app.post('/api/cancel-download-job/:jobId', async (req, res) => {
  try {
    await queueManager.cancelJob(db, downloadQueue, req.params.jobId);
    res.json({
      success: true,
      message: 'Job cancelled successfully'
    });
  } catch (error) {
    console.error('Error cancelling job:', error);
    res.status(error.message === 'Job not found' ? 404 : 500).json({
      success: false,
      error: error.message || 'Failed to cancel job'
    });
  }
});

// Validate download path
app.post('/api/validate-download-path', async (req, res) => {
  const { path } = req.body;
  
  if (!path) {
    return res.status(400).json({
      success: false,
      error: 'Path is required'
    });
  }
  
  try {
    const validation = await queueManager.validateDownloadPath(path);
    res.json({
      success: true,
      validation
    });
  } catch (error) {
    logger.error('Error validating path', { 
      path, 
      error: error.message,
      stack: error.stack
    });
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to validate path'
    });
  }
});

// Client error reporting endpoint
app.post('/api/client-error', (req, res) => {
  const errorData = req.body;
  
  if (!errorData || !errorData.message) {
    return res.status(400).json({
      success: false,
      error: 'Invalid error data'
    });
  }
  
  // Log the client error with the server logger
  logger.error('Client-side error reported', errorData);
  
  // Store in database if needed
  // db.run('INSERT INTO client_errors (message, data, user_agent, url, timestamp) VALUES (?, ?, ?, ?, ?)',
  //   [errorData.message, JSON.stringify(errorData.data), errorData.userAgent, errorData.url, errorData.timestamp]);
  
  res.json({
    success: true,
    message: 'Error logged successfully'
  });
});

// Download project zip endpoint
app.get('/api/download-project/:filename', (req, res) => {
  const zipFilePath = path.join(downloadsDir, req.params.filename);

  // Log detailed request information
  logger.info('Download project request received', {
    filename: req.params.filename,
    path: zipFilePath,
    headers: req.headers,
    query: req.query
  });

  // Check if downloads directory exists
  debug.debugFileSystem('CHECK_DIR', downloadsDir);

  // Check if file exists and log detailed information
  debug.debugFileSystem('CHECK_FILE', zipFilePath);

  if (fs.existsSync(zipFilePath)) {
    const stats = fs.statSync(zipFilePath);
    logger.info('File found, preparing to stream', {
      filename: req.params.filename,
      size: `${(stats.size / (1024 * 1024)).toFixed(1)} MB`,
      created: stats.birthtime,
      modified: stats.mtime
    });

    // Set headers for file download
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${req.params.filename}"`);
    
    // Log response headers
    logger.debug('Response headers set', {
      headers: res.getHeaders()
    });

    // Stream the file instead of loading it all into memory
    try {
      const fileStream = fs.createReadStream(zipFilePath);
      logger.debug('File stream created successfully');

      fileStream.on('open', () => {
        logger.debug('File stream opened successfully');
      });

      fileStream.on('data', (chunk) => {
        logger.trace('Streaming data chunk', {
          chunkSize: chunk.length
        });
      });

      fileStream.on('error', (error) => {
        const errorDetails = {
          message: error.message,
          code: error.code,
          stack: error.stack,
          timestamp: new Date().toISOString()
        };
        logger.error('Error streaming file', errorDetails);
        
        if (!res.headersSent) {
          res.status(500).json({
            success: false,
            error: 'Failed to download file: ' + error.message
          });
        } else {
          logger.warn('Headers already sent, cannot send error response');
          res.end();
        }
      });

      fileStream.on('end', () => {
        logger.info('File stream complete', {
          filename: req.params.filename
        });
        
        // Delete the file after successful download
        setTimeout(() => {
          logger.debug('Attempting to delete file', {
            filename: req.params.filename,
            path: zipFilePath
          });
          
          fs.unlink(zipFilePath, (unlinkErr) => {
            if (unlinkErr) {
              logger.error('Error deleting zip file', {
                error: unlinkErr.message,
                code: unlinkErr.code,
                stack: unlinkErr.stack
              });
            } else {
              logger.info('File deleted successfully', {
                filename: req.params.filename
              });
            }
          });
        }, 1000); // Wait 1 second before deleting
      });

      // Pipe the file to the response
      logger.debug('Piping file to response');
      fileStream.pipe(res);
    } catch (error) {
      logger.error('Error creating file stream', {
        error: error.message,
        stack: error.stack
      });
      
      res.status(500).json({
        success: false,
        error: 'Failed to create file stream: ' + error.message
      });
    }
  } else {
    logger.warn('File not found', {
      filename: req.params.filename,
      path: zipFilePath,
      downloadsDir,
      downloadsExists: fs.existsSync(downloadsDir),
      filesInDownloads: fs.existsSync(downloadsDir) ? fs.readdirSync(downloadsDir) : []
    });
    
    res.status(404).json({
      success: false,
      error: 'File not found: ' + req.params.filename
    });
  }
});

// Serve index.html for all other routes to handle client-side routing
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Add error handler middleware (must be after all routes)
app.use(debug.errorHandler);

// Database cleanup on exit
process.on('exit', () => {
  logger.info('Application shutting down, closing database connection');
  db.close();
});

// Start server
app.listen(port, () => {
    logger.info(`Server running on port ${port}`, {
      port,
      environment: process.env.NODE_ENV,
      nodeVersion: process.version
    });
});
