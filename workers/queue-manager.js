/**
 * Queue manager for background download jobs
 * Handles job scheduling, queuing, and processing
 */
const Queue = require('better-queue');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const downloadWorker = require('./download-worker');
const defaults = require('../config/defaults');

// Create queue directory for future use
const queueDir = path.join(process.cwd(), 'queue');
if (!fs.existsSync(queueDir)) {
  fs.mkdirSync(queueDir, { recursive: true });
}

/**
 * Initialize the download queue
 * @param {Object} db Database connection
 * @returns {Object} Queue instance
 */
function initializeQueue(db) {
  // Create queue with in-memory storage
  const queue = new Queue(async (job, cb) => {
    try {
      console.log(`Processing job ${job.job_id} for project ${job.project_key}`);
      const result = await downloadWorker.processDownloadJob(job, db);
      cb(null, result);
    } catch (error) {
      console.error(`Error processing job ${job.job_id}:`, error);
      cb(error);
    }
  }, {
    maxConcurrent: defaults.jobs.maxConcurrent,
    priority: (job, cb) => {
      // Higher priority for smaller jobs
      if (job.download_type === 'tickets') {
        return cb(null, 10);
      }
      return cb(null, 5);
    },
    afterProcessDelay: 1000 // Small delay between jobs
  });

  // Queue event handlers
  queue.on('task_finish', (jobId, result) => {
    console.log(`Job ${jobId} completed successfully`);
  });

  queue.on('task_failed', (jobId, error) => {
    console.error(`Job ${jobId} failed:`, error);
  });

  queue.on('empty', () => {
    console.log('Queue is empty');
  });

  queue.on('error', (error) => {
    console.error('Queue error:', error);
  });

  return queue;
}

/**
 * Add a new download job to the queue
 * @param {Object} db Database connection
 * @param {Object} queue Queue instance
 * @param {Object} jobData Job data
 * @returns {Promise<Object>} Job information
 */
async function addJob(db, queue, jobData) {
  const jobId = uuidv4();
  const now = new Date().toISOString();
  
  const job = {
    job_id: jobId,
    username: jobData.username,
    api_key: jobData.apiKey,
    project_key: jobData.projectKey,
    download_type: jobData.downloadType || 'all',
    file_format: jobData.fileFormat || 'json',
    download_path: jobData.downloadPath || defaults.downloadPath,
    status: 'pending',
    created_at: now,
    updated_at: now
  };
  
  // Save job to database
  await saveJobToDatabase(db, job);
  
  // Add to queue
  queue.push(job);
  
  return {
    jobId,
    status: 'pending',
    projectKey: jobData.projectKey,
    downloadType: jobData.downloadType || 'all',
    createdAt: now
  };
}

/**
 * Save job to database
 * @param {Object} db Database connection
 * @param {Object} job Job data
 * @returns {Promise<void>}
 */
async function saveJobToDatabase(db, job) {
  return new Promise((resolve, reject) => {
    db.run(
      `INSERT INTO download_jobs 
       (job_id, username, api_key, project_key, download_type, file_format, download_path, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        job.job_id,
        job.username,
        job.api_key,
        job.project_key,
        job.download_type,
        job.file_format,
        job.download_path,
        job.status,
        job.created_at,
        job.updated_at
      ],
      function(err) {
        if (err) {
          console.error('Error saving job to database:', err);
          reject(err);
        } else {
          resolve();
        }
      }
    );
  });
}

/**
 * Get all jobs
 * @param {Object} db Database connection
 * @returns {Promise<Array>} List of jobs
 */
async function getJobs(db) {
  return new Promise((resolve, reject) => {
    db.all(
      `SELECT job_id, project_key, download_type, file_format, download_path, status, 
              created_at, updated_at, completed_at, error
       FROM download_jobs
       ORDER BY created_at DESC`,
      [],
      async (err, rows) => {
        if (err) {
          console.error('Error getting jobs:', err);
          reject(err);
        } else {
          try {
            // Fetch segments for each job
            const jobsWithSegments = [];
            
            for (const job of rows) {
              // Only fetch segments for completed jobs
              if (job.status === 'completed') {
                try {
                  const segments = await new Promise((resolveSegments, rejectSegments) => {
                    db.all(
                      `SELECT segment_number, total_segments, status, file_path, file_count, size_bytes, created_at, updated_at
                       FROM download_segments
                       WHERE job_id = ?
                       ORDER BY segment_number`,
                      [job.job_id],
                      (segErr, segments) => {
                        if (segErr) {
                          console.error(`Error getting segments for job ${job.job_id}:`, segErr);
                          rejectSegments(segErr);
                        } else {
                          resolveSegments(segments);
                        }
                      }
                    );
                  });
                  
                  job.segments = segments;
                } catch (segmentError) {
                  console.error(`Error fetching segments for job ${job.job_id}:`, segmentError);
                  job.segments = [];
                }
              }
              
              jobsWithSegments.push(job);
            }
            
            // Don't include sensitive data like API keys
            resolve(jobsWithSegments);
          } catch (error) {
            console.error('Error processing jobs with segments:', error);
            // Fall back to returning jobs without segments
            resolve(rows);
          }
        }
      }
    );
  });
}

/**
 * Get job by ID
 * @param {Object} db Database connection
 * @param {string} jobId Job ID
 * @returns {Promise<Object>} Job data
 */
async function getJobById(db, jobId) {
  return new Promise((resolve, reject) => {
    db.get(
      `SELECT job_id, project_key, download_type, file_format, download_path, status, 
              created_at, updated_at, completed_at, error
       FROM download_jobs
       WHERE job_id = ?`,
      [jobId],
      (err, row) => {
        if (err) {
          console.error('Error getting job:', err);
          reject(err);
        } else if (!row) {
          reject(new Error('Job not found'));
        } else {
          // Get segments for this job
          db.all(
            `SELECT segment_number, total_segments, status, file_path, file_count, size_bytes, created_at, updated_at
             FROM download_segments
             WHERE job_id = ?
             ORDER BY segment_number`,
            [jobId],
            (segErr, segments) => {
              if (segErr) {
                console.error('Error getting segments:', segErr);
                reject(segErr);
              } else {
                row.segments = segments;
                resolve(row);
              }
            }
          );
        }
      }
    );
  });
}

/**
 * Cancel job by ID
 * @param {Object} db Database connection
 * @param {Object} queue Queue instance
 * @param {string} jobId Job ID
 * @returns {Promise<boolean>} Success status
 */
async function cancelJob(db, queue, jobId) {
  return new Promise((resolve, reject) => {
    // First check if job exists and is pending
    db.get(
      'SELECT status FROM download_jobs WHERE job_id = ?',
      [jobId],
      (err, row) => {
        if (err) {
          console.error('Error checking job status:', err);
          reject(err);
        } else if (!row) {
          reject(new Error('Job not found'));
        } else if (row.status !== 'pending') {
          reject(new Error(`Cannot cancel job with status: ${row.status}`));
        } else {
          // Update job status to cancelled
          db.run(
            'UPDATE download_jobs SET status = ?, updated_at = ? WHERE job_id = ?',
            ['cancelled', new Date().toISOString(), jobId],
            function(updateErr) {
              if (updateErr) {
                console.error('Error updating job status:', updateErr);
                reject(updateErr);
              } else {
                // Remove from queue if possible
                queue.cancel(jobId, (cancelErr) => {
                  if (cancelErr) {
                    console.warn(`Could not remove job ${jobId} from queue:`, cancelErr);
                  }
                  resolve(true);
                });
              }
            }
          );
        }
      }
    );
  });
}

/**
 * Clean up old jobs
 * @param {Object} db Database connection
 * @returns {Promise<number>} Number of jobs cleaned up
 */
async function cleanupOldJobs(db) {
  return new Promise((resolve, reject) => {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - defaults.jobs.retentionDays);
    const cutoffDateStr = cutoffDate.toISOString();
    
    // Get list of old completed jobs
    db.all(
      `SELECT job_id FROM download_jobs 
       WHERE (status = 'completed' OR status = 'failed' OR status = 'cancelled')
       AND updated_at < ?`,
      [cutoffDateStr],
      (err, rows) => {
        if (err) {
          console.error('Error getting old jobs:', err);
          reject(err);
        } else if (rows.length === 0) {
          resolve(0);
        } else {
          const jobIds = rows.map(row => row.job_id);
          
          // Delete segments for these jobs
          db.run(
            'DELETE FROM download_segments WHERE job_id IN (' + jobIds.map(() => '?').join(',') + ')',
            jobIds,
            function(segErr) {
              if (segErr) {
                console.error('Error deleting old segments:', segErr);
                reject(segErr);
              } else {
                // Delete the jobs
                db.run(
                  'DELETE FROM download_jobs WHERE job_id IN (' + jobIds.map(() => '?').join(',') + ')',
                  jobIds,
                  function(jobErr) {
                    if (jobErr) {
                      console.error('Error deleting old jobs:', jobErr);
                      reject(jobErr);
                    } else {
                      resolve(jobIds.length);
                    }
                  }
                );
              }
            }
          );
        }
      }
    );
  });
}

/**
 * Validate download path
 * @param {string} downloadPath Path to validate
 * @returns {Promise<Object>} Validation result
 */
async function validateDownloadPath(downloadPath) {
  return new Promise((resolve) => {
    try {
      // Check if path exists
      if (!fs.existsSync(downloadPath)) {
        // Try to create the directory
        try {
          fs.mkdirSync(downloadPath, { recursive: true });
        } catch (createErr) {
          return resolve({
            valid: false,
            error: `Cannot create directory: ${createErr.message}`
          });
        }
      }
      
      // Check if path is a directory
      const stats = fs.statSync(downloadPath);
      if (!stats.isDirectory()) {
        return resolve({
          valid: false,
          error: 'Path is not a directory'
        });
      }
      
      // Check if directory is writable
      try {
        const testFile = path.join(downloadPath, '.write-test');
        fs.writeFileSync(testFile, 'test');
        fs.unlinkSync(testFile);
        
        // Get available space
        const diskInfo = fs.statfsSync(downloadPath);
        const availableSpace = diskInfo.bavail * diskInfo.bsize;
        const availableSpaceMB = Math.floor(availableSpace / (1024 * 1024));
        
        resolve({
          valid: true,
          path: downloadPath,
          availableSpace: availableSpaceMB + ' MB'
        });
      } catch (writeErr) {
        resolve({
          valid: false,
          error: `Directory is not writable: ${writeErr.message}`
        });
      }
    } catch (err) {
      resolve({
        valid: false,
        error: err.message
      });
    }
  });
}

module.exports = {
  initializeQueue,
  addJob,
  getJobs,
  getJobById,
  cancelJob,
  cleanupOldJobs,
  validateDownloadPath
};
