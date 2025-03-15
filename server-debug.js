/**
 * Server Debug Helper for Jira Ticket Downloader
 * Enhanced version with structured logging and error tracking
 */

const fs = require('fs');
const path = require('path');
const logger = require('./logger');

/**
 * Debug middleware for Express
 * Enhanced version that uses structured logging
 * @param {object} req - Express request object
 * @param {object} res - Express response object
 * @param {function} next - Express next function
 */
const debugMiddleware = logger.createRequestLogger();

/**
 * Error handler middleware
 * Logs errors and sends appropriate responses
 */
const errorHandler = logger.createErrorHandler();

/**
 * Debug wrapper for database operations
 * Enhanced version with better error tracking
 * @param {object} db - SQLite database object
 * @returns {object} - Wrapped database object
 */
function wrapDatabase(db) {
    const originalGet = db.get;
    const originalAll = db.all;
    const originalRun = db.run;
    
    db.get = function(sql, params, callback) {
        const queryId = Math.random().toString(36).substring(2, 10);
        logger.debug(`DB GET query ${queryId}`, { sql, params });
        
        if (typeof params === 'function') {
            callback = params;
            params = [];
        }
        
        return originalGet.call(this, sql, params, function(err, row) {
            if (err) {
                logger.error(`DB GET query ${queryId} error`, { 
                    sql, 
                    params, 
                    error: err.message,
                    stack: err.stack 
                });
            } else {
                logger.debug(`DB GET query ${queryId} result`, { row });
            }
            
            if (callback) callback.apply(this, arguments);
        });
    };
    
    db.all = function(sql, params, callback) {
        const queryId = Math.random().toString(36).substring(2, 10);
        logger.debug(`DB ALL query ${queryId}`, { sql, params });
        
        if (typeof params === 'function') {
            callback = params;
            params = [];
        }
        
        return originalAll.call(this, sql, params, function(err, rows) {
            if (err) {
                logger.error(`DB ALL query ${queryId} error`, { 
                    sql, 
                    params, 
                    error: err.message,
                    stack: err.stack 
                });
            } else {
                logger.debug(`DB ALL query ${queryId} result`, {
                    count: rows ? rows.length : 0,
                    rows: rows
                });
            }
            
            if (callback) callback.apply(this, arguments);
        });
    };
    
    db.run = function(sql, params, callback) {
        const queryId = Math.random().toString(36).substring(2, 10);
        logger.debug(`DB RUN query ${queryId}`, { sql, params });
        
        if (typeof params === 'function') {
            callback = params;
            params = [];
        }
        
        return originalRun.call(this, sql, params, function(err) {
            if (err) {
                logger.error(`DB RUN query ${queryId} error`, { 
                    sql, 
                    params, 
                    error: err.message,
                    stack: err.stack 
                });
            } else {
                logger.debug(`DB RUN query ${queryId} result`, {
                    lastID: this.lastID,
                    changes: this.changes
                });
            }
            
            if (callback) callback.apply(this, arguments);
        });
    };
    
    return db;
}

/**
 * Debug wrapper for queue manager
 * Enhanced version with better error tracking
 * @param {object} queueManager - Queue manager object
 * @returns {object} - Wrapped queue manager object
 */
function wrapQueueManager(queueManager) {
    // Wrap all methods to add logging
    const originalMethods = {
        initializeQueue: queueManager.initializeQueue,
        addJob: queueManager.addJob,
        getJobs: queueManager.getJobs,
        getJobById: queueManager.getJobById,
        cancelJob: queueManager.cancelJob,
        cleanupOldJobs: queueManager.cleanupOldJobs,
        validateDownloadPath: queueManager.validateDownloadPath
    };
    
    // Wrap getJobById with enhanced logging
    queueManager.getJobById = async function(db, jobId) {
        logger.debug(`QUEUE Getting job by ID: ${jobId}`);
        
        try {
            const job = await originalMethods.getJobById.call(this, db, jobId);
            logger.debug(`QUEUE Job retrieved successfully`, {
                jobId,
                status: job.status,
                segmentsCount: job.segments ? job.segments.length : 0,
                segments: job.segments
            });
            return job;
        } catch (error) {
            logger.error(`QUEUE Error getting job by ID: ${jobId}`, {
                error: error.message,
                stack: error.stack
            });
            throw error;
        }
    };
    
    // Wrap addJob with enhanced logging
    queueManager.addJob = async function(db, queue, jobData) {
        logger.debug(`QUEUE Adding new job`, { projectKey: jobData.projectKey, downloadType: jobData.downloadType });
        
        try {
            const job = await originalMethods.addJob.call(this, db, queue, jobData);
            logger.info(`QUEUE Job added successfully`, {
                jobId: job.jobId,
                status: job.status,
                projectKey: job.projectKey
            });
            return job;
        } catch (error) {
            logger.error(`QUEUE Error adding job`, {
                projectKey: jobData.projectKey,
                error: error.message,
                stack: error.stack
            });
            throw error;
        }
    };
    
    // Wrap cancelJob with enhanced logging
    queueManager.cancelJob = async function(db, queue, jobId) {
        logger.debug(`QUEUE Cancelling job: ${jobId}`);
        
        try {
            const result = await originalMethods.cancelJob.call(this, db, queue, jobId);
            logger.info(`QUEUE Job cancelled successfully`, { jobId });
            return result;
        } catch (error) {
            logger.error(`QUEUE Error cancelling job: ${jobId}`, {
                error: error.message,
                stack: error.stack
            });
            throw error;
        }
    };
    
    return queueManager;
}

/**
 * Debug file system operations
 * Enhanced version with better error tracking
 * @param {string} operation - Operation name
 * @param {string} filePath - File path
 * @param {any} data - Optional data
 */
function debugFileSystem(operation, filePath, data = null) {
    try {
        let fileInfo = {};
        
        if (fs.existsSync(filePath)) {
            const stats = fs.statSync(filePath);
            fileInfo = {
                exists: true,
                isDirectory: stats.isDirectory(),
                isFile: stats.isFile(),
                size: stats.size,
                created: stats.birthtime,
                modified: stats.mtime
            };
        } else {
            fileInfo = {
                exists: false
            };
        }
        
        logger.debug(`FS ${operation}: ${filePath}`, {
            fileInfo,
            data
        });
    } catch (error) {
        logger.error(`FS Error in ${operation}: ${filePath}`, {
            error: error.message,
            stack: error.stack,
            data
        });
    }
}

/**
 * Capture uncaught exceptions
 */
process.on('uncaughtException', (err) => {
    logger.error('UNCAUGHT EXCEPTION', {
        error: err.message,
        stack: err.stack
    });
    
    // Give logger time to write before exiting
    setTimeout(() => {
        process.exit(1);
    }, 1000);
});

/**
 * Capture unhandled promise rejections
 */
process.on('unhandledRejection', (reason, promise) => {
    logger.error('UNHANDLED REJECTION', {
        reason: reason instanceof Error ? reason.message : reason,
        stack: reason instanceof Error ? reason.stack : 'No stack trace available'
    });
});

// Export debug functions
module.exports = {
    debugMiddleware,
    errorHandler,
    wrapDatabase,
    wrapQueueManager,
    debugFileSystem,
    logger
};
