/**
 * Background download worker for Jira Ticket Downloader
 * Handles downloading Jira tickets and attachments in the background
 */
const axios = require('axios');
const axiosRetry = require('axios-retry');
const path = require('path');
const fs = require('fs');
const AdmZip = require('adm-zip');
const notifier = require('node-notifier');
const defaults = require('../config/defaults');

// Configure axios with retry logic
axiosRetry(axios, {
  retries: defaults.api.maxRetries,
  retryDelay: (retryCount) => {
    return retryCount * defaults.api.retryDelay;
  },
  retryCondition: (error) => {
    // Retry on network errors or 5xx responses
    return axiosRetry.isNetworkOrIdempotentRequestError(error) || 
           (error.response && error.response.status >= 500);
  }
});

// Set default timeout
axios.defaults.timeout = defaults.api.timeout;

/**
 * Process a download job
 * @param {Object} job The job data
 * @param {Object} db Database connection
 * @returns {Promise<Object>} Job result
 */
async function processDownloadJob(job, db) {
  const { 
    job_id, 
    username, 
    api_key, 
    project_key, 
    download_type, 
    file_format,
    download_path
  } = job;

  // Use specified download path or default
  const outputPath = download_path || defaults.downloadPath;
  
  // Ensure the download directory exists
  if (!fs.existsSync(outputPath)) {
    fs.mkdirSync(outputPath, { recursive: true });
  }

  try {
    // Update job status to processing
    await updateJobStatus(db, job_id, 'processing', null);
    
    // Create auth token
    const auth = Buffer.from(`${username}:${api_key}`).toString('base64');
    
    // Create Jira API headers
    const headers = {
      'Authorization': `Basic ${auth}`,
      'Accept': 'application/json',
      'Content-Type': 'application/json'
    };

    // Get project info and total number of issues
    console.log(`[Job ${job_id}] Fetching project info and issue count...`);
    await updateJobProgress(db, job_id, 'init', 'Fetching project info', 0);
    
    const jql = `project = ${project_key}`;
    const [projectResponse, countResponse] = await Promise.all([
      axios.get(`${defaults.api.baseUrl}/project/${project_key}`, { headers }),
      axios.post(`${defaults.api.baseUrl}/search`, {
        jql,
        maxResults: 0
      }, { headers })
    ]);

    const projectInfo = projectResponse.data;
    const totalIssues = countResponse.data.total;

    console.log(`[Job ${job_id}] Project info retrieved:`, {
      projectKey: projectInfo.key,
      projectName: projectInfo.name,
      totalIssues
    });

    // Update job with project info
    await updateJobProgress(db, job_id, 'fetching', 'Fetching issues', 5);

    // Define fields to fetch based on download type
    let fields = [];
    if (download_type === 'all' || download_type === 'attachments') {
      fields.push('attachment');
    }
    if (download_type === 'all' || download_type === 'tickets') {
      fields.push('summary', 'description', 'comment', 'created', 'updated', 'status', 'priority', 'assignee', 'reporter');
    }

    // Fetch all issues with pagination
    let issues = [];
    const maxResultsPerPage = 100; // Jira's max per page
    let startAt = 0;
    
    do {
      await updateJobProgress(
        db, 
        job_id, 
        'fetching', 
        `Fetching issues (${Math.min(startAt + maxResultsPerPage, totalIssues)}/${totalIssues})`, 
        5 + ((startAt / totalIssues) * 25)
      );
      
      const response = await axios.post(`${defaults.api.baseUrl}/search`, {
        jql,
        startAt,
        maxResults: maxResultsPerPage,
        fields
      }, { headers });
      
      issues = issues.concat(response.data.issues);
      startAt += maxResultsPerPage;
    } while (startAt < totalIssues);

    console.log(`[Job ${job_id}] Fetched ${issues.length} issues`);
    await updateJobProgress(db, job_id, 'processing', 'Processing issues', 30);

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
    if (download_type === 'tickets' || download_type === 'all') {
      const fileName = `${project_key}_tickets_${new Date().toISOString().replace(/[:.]/g, '-')}.${file_format}`;
      const filePath = path.join(outputPath, fileName);

      await updateJobProgress(db, job_id, 'processing', `Writing ticket data to ${fileName}`, 40);

      if (file_format === 'json') {
        fs.writeFileSync(filePath, JSON.stringify(ticketsData, null, 2));
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

      // If tickets only, we're done
      if (download_type === 'tickets') {
        const fileSize = fs.statSync(filePath).size;
        const fileSizeMB = (fileSize / (1024 * 1024)).toFixed(1);
        
        await updateJobProgress(db, job_id, 'complete', `Download complete: ${fileName} (${fileSizeMB}MB)`, 100);
        
        // Send notification
        if (defaults.notifications.enabled) {
          notifier.notify({
            title: defaults.notifications.successTitle,
            message: `Downloaded ${ticketsData.length} tickets from ${project_key}`,
            sound: defaults.notifications.sound
          });
        }
        
        // Update job status to completed
        await updateJobStatus(db, job_id, 'completed', null, new Date().toISOString());
        
        return {
          success: true,
          fileName,
          filePath,
          ticketCount: ticketsData.length,
          commentCount: ticketsData.reduce((sum, t) => sum + (t.comments?.length || 0), 0),
          fileSize: fileSizeMB + 'MB'
        };
      }
    }

    // For attachments-only or all content, continue with attachment processing
    if (download_type === 'all' || download_type === 'attachments') {
      await updateJobProgress(db, job_id, 'analyzing', 'Analyzing attachments', 50);
      
      // Count attachments and calculate total size
      let totalAttachmentCount = 0;
      let totalEstimatedBytes = 0;
      
      for (const issue of issues) {
        if (issue.fields?.attachment) {
          totalAttachmentCount += issue.fields.attachment.length;
          for (const attachment of issue.fields.attachment) {
            totalEstimatedBytes += parseInt(attachment.size || 0);
          }
        }
      }
      
      console.log(`[Job ${job_id}] Found ${totalAttachmentCount} attachments (${(totalEstimatedBytes / (1024 * 1024)).toFixed(1)}MB)`);
      
      // Calculate segments needed for attachments
      const SEGMENT_SIZE_LIMIT = defaults.segmentSizeLimit;
      const attachmentSegments = [];
      let currentSegment = {
        files: [],
        size: 0,
        number: 1
      };
      
      await updateJobProgress(db, job_id, 'segmenting', `Organizing ${totalAttachmentCount} attachments`, 60);
      
      // Group attachments into segments
      for (const issue of issues) {
        if (!issue.fields?.attachment) continue;

        for (const attachment of issue.fields.attachment) {
          const attachmentSize = parseInt(attachment.size || 0);
          if (attachmentSize === 0) continue;

          // If attachment is larger than segment size, split it
          if (attachmentSize > SEGMENT_SIZE_LIMIT) {
            const segmentCount = Math.ceil(attachmentSize / SEGMENT_SIZE_LIMIT);
            
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
        }
      }

      // Add final segment if not empty
      if (currentSegment.files.length > 0) {
        attachmentSegments.push(currentSegment);
      }

      const totalSegments = attachmentSegments.length;
      console.log(`[Job ${job_id}] Created ${totalSegments} segments`);
      
      // Create segments with attachment chunks
      const segments = [];
      let processedSegments = 0;
      
      for (const segment of attachmentSegments) {
        const segmentZip = new AdmZip();
        const segmentProgress = 60 + ((processedSegments / totalSegments) * 35);
        
        await updateJobProgress(
          db, 
          job_id, 
          'downloading', 
          `Downloading segment ${segment.number}/${totalSegments} (${segment.files.length} files)`, 
          segmentProgress
        );

        // Add attachments for this segment
        for (const file of segment.files) {
          const { ticket, attachment, partNumber, totalParts, startByte, endByte } = file;

          // Get attachment data with progressive timeout for larger files
          const fileSize = endByte - startByte;
          const progressiveTimeout = Math.min(
            defaults.api.timeout,
            defaults.api.timeout * (1 + (fileSize / (10 * 1024 * 1024))) // Increase timeout for larger files
          );
          
          // Try to download with progressively increasing timeouts on failure
          let attachmentResponse;
          let retryCount = 0;
          const maxRetries = defaults.api.maxRetries;
          
          while (retryCount <= maxRetries) {
            try {
              attachmentResponse = await axios.get(attachment.content, {
                headers: {
                  ...headers,
                  Range: `bytes=${startByte}-${endByte - 1}`
                },
                responseType: 'arraybuffer',
                timeout: progressiveTimeout * (retryCount + 1) // Increase timeout with each retry
              });
              
              // If successful, break out of retry loop
              break;
            } catch (downloadError) {
              retryCount++;
              
              // If we've exhausted retries, throw the error
              if (retryCount > maxRetries) {
                throw downloadError;
              }
              
              // Log retry attempt
              console.log(`[Job ${job_id}] Retrying download for ${attachment.filename} (${retryCount}/${maxRetries})`);
              
              // Wait before retrying
              await new Promise(resolve => setTimeout(resolve, defaults.api.retryDelay * retryCount));
            }
          }

          // Add to zip with part number if split
          const filename = totalParts > 1
            ? `${attachment.filename}.part${partNumber}`
            : attachment.filename;

          segmentZip.addFile(
            `${project_key}/${ticket}/${filename}`,
            Buffer.from(attachmentResponse.data)
          );
        }

        // Save segment with detailed info
        const segmentFileName = `${project_key}_attachments_part${segment.number}of${totalSegments}_${(segment.size / (1024 * 1024)).toFixed(1)}MB_${new Date().toISOString().replace(/[:.]/g, '-')}.zip`;
        const segmentFilePath = path.join(outputPath, segmentFileName);
        segmentZip.writeZip(segmentFilePath);

        segments.push({
          fileName: segmentFileName,
          filePath: segmentFilePath,
          fileCount: segment.files.length,
          size: segment.size,
          partNumber: segment.number,
          totalParts: totalSegments
        });
        
        // Save segment info to database
        await saveSegmentInfo(
          db, 
          job_id, 
          segment.number, 
          totalSegments, 
          'completed', 
          segmentFilePath, 
          segment.files.length, 
          segment.size
        );
        
        processedSegments++;
      }

      // All segments complete
      await updateJobProgress(db, job_id, 'complete', `Download complete: ${totalSegments} segments`, 100);
      
      // Send notification
      if (defaults.notifications.enabled) {
        notifier.notify({
          title: defaults.notifications.successTitle,
          message: `Downloaded ${totalAttachmentCount} attachments from ${project_key} in ${totalSegments} segments`,
          sound: defaults.notifications.sound
        });
      }
      
      // Update job status to completed
      await updateJobStatus(db, job_id, 'completed', null, new Date().toISOString());
      
      return {
        success: true,
        segments,
        totalSegments,
        totalAttachments: totalAttachmentCount,
        totalSize: `${(totalEstimatedBytes / (1024 * 1024)).toFixed(1)}MB`
      };
    }
  } catch (error) {
    console.error(`[Job ${job_id}] Error:`, error);
    
    // Determine error type for better error messages
    let errorMessage = error.message || 'Unknown error occurred';
    
    // Handle timeout errors specifically
    if (error.code === 'ECONNABORTED' || errorMessage.includes('timeout')) {
      errorMessage = `Request timed out. The server took too long to respond. Try again later or contact your administrator if the issue persists.`;
      console.log(`[Job ${job_id}] Timeout error detected. Original error:`, error);
    }
    
    // Update job status to failed
    await updateJobStatus(db, job_id, 'failed', errorMessage);
    
    // Send notification
    if (defaults.notifications.enabled) {
      notifier.notify({
        title: defaults.notifications.errorTitle,
        message: `Failed to download ${project_key}: ${errorMessage}`,
        sound: defaults.notifications.sound
      });
    }
    
    return {
      success: false,
      error: errorMessage
    };
  }
}

/**
 * Update job status in database
 * @param {Object} db Database connection
 * @param {string} jobId Job ID
 * @param {string} status New status
 * @param {string|null} error Error message if any
 * @param {string|null} completedAt Completion timestamp
 * @returns {Promise<void>}
 */
async function updateJobStatus(db, jobId, status, error = null, completedAt = null) {
  return new Promise((resolve, reject) => {
    const now = new Date().toISOString();
    let sql = 'UPDATE download_jobs SET status = ?, updated_at = ?';
    let params = [status, now];
    
    if (error !== null) {
      sql += ', error = ?';
      params.push(error);
    }
    
    if (completedAt !== null) {
      sql += ', completed_at = ?';
      params.push(completedAt);
    }
    
    sql += ' WHERE job_id = ?';
    params.push(jobId);
    
    db.run(sql, params, function(err) {
      if (err) {
        console.error('Error updating job status:', err);
        reject(err);
      } else {
        resolve();
      }
    });
  });
}

/**
 * Update job progress in database
 * @param {Object} db Database connection
 * @param {string} jobId Job ID
 * @param {string} stage Current stage
 * @param {string} message Progress message
 * @param {number} progress Progress percentage (0-100)
 * @returns {Promise<void>}
 */
async function updateJobProgress(db, jobId, stage, message, progress) {
  // This would typically update a job_progress table or similar
  // For now, we'll just log the progress
  console.log(`[Job ${jobId}] Progress: ${progress}% - ${stage} - ${message}`);
  
  // We could also emit an event or update a real-time status
  return Promise.resolve();
}

/**
 * Save segment information to database
 * @param {Object} db Database connection
 * @param {string} jobId Job ID
 * @param {number} segmentNumber Segment number
 * @param {number} totalSegments Total segments
 * @param {string} status Segment status
 * @param {string} filePath File path
 * @param {number} fileCount Number of files
 * @param {number} sizeBytes Size in bytes
 * @returns {Promise<void>}
 */
async function saveSegmentInfo(db, jobId, segmentNumber, totalSegments, status, filePath, fileCount, sizeBytes) {
  return new Promise((resolve, reject) => {
    const now = new Date().toISOString();
    
    db.run(
      `INSERT INTO download_segments 
       (job_id, segment_number, total_segments, status, file_path, file_count, size_bytes, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [jobId, segmentNumber, totalSegments, status, filePath, fileCount, sizeBytes, now, now],
      function(err) {
        if (err) {
          console.error('Error saving segment info:', err);
          reject(err);
        } else {
          resolve();
        }
      }
    );
  });
}

module.exports = {
  processDownloadJob
};
