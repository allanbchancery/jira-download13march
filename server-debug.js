/**
 * Server Debug Helper for Jira Ticket Downloader
 * This file adds additional logging and debugging functionality for the server
 */

const fs = require('fs');
const path = require('path');

// Enable debug mode
const DEBUG_MODE = true;
const LOG_FILE = path.join(__dirname, 'debug.log');

// Initialize log file
if (DEBUG_MODE) {
    fs.writeFileSync(LOG_FILE, `[${new Date().toISOString()}] Debug logging started\n`);
    console.log(`Debug logging enabled. Log file: ${LOG_FILE}`);
}

/**
 * Debug logging function
 * @param {string} category - Log category
 * @param {string} message - Log message
 * @param {any} data - Optional data to log
 */
function debugLog(category, message, data = null) {
    if (!DEBUG_MODE) return;
    
    const timestamp = new Date().toISOString();
    const logPrefix = `[${timestamp}][${category}]`;
    
    let logMessage = `${logPrefix} ${message}`;
    if (data) {
        try {
            if (typeof data === 'object') {
                logMessage += `\n${JSON.stringify(data, null, 2)}`;
            } else {
                logMessage += ` ${data}`;
            }
        } catch (error) {
            logMessage += ` [Error stringifying data: ${error.message}]`;
        }
    }
    
    console.log(logMessage);
    
    // Also write to log file
    fs.appendFileSync(LOG_FILE, logMessage + '\n');
}

/**
 * Debug middleware for Express
 * @param {object} req - Express request object
 * @param {object} res - Express response object
 * @param {function} next - Express next function
 */
function debugMiddleware(req, res, next) {
    if (!DEBUG_MODE) return next();
    
    const startTime = Date.now();
    const requestId = Math.random().toString(36).substring(2, 15);
    
    // Log request
    debugLog('REQUEST', `${req.method} ${req.url}`, {
        requestId,
        headers: req.headers,
        query: req.query,
        body: req.method === 'POST' ? req.body : undefined
    });
    
    // Capture original methods
    const originalJson = res.json;
    const originalSend = res.send;
    const originalEnd = res.end;
    
    // Override response methods to log
    res.json = function(body) {
        debugLog('RESPONSE', `JSON response for ${req.method} ${req.url}`, {
            requestId,
            statusCode: res.statusCode,
            body: body
        });
        return originalJson.call(this, body);
    };
    
    res.send = function(body) {
        debugLog('RESPONSE', `Send response for ${req.method} ${req.url}`, {
            requestId,
            statusCode: res.statusCode,
            contentType: res.get('Content-Type'),
            bodyLength: body ? (typeof body === 'string' ? body.length : JSON.stringify(body).length) : 0
        });
        return originalSend.call(this, body);
    };
    
    res.end = function(chunk, encoding) {
        const duration = Date.now() - startTime;
        debugLog('RESPONSE', `End response for ${req.method} ${req.url}`, {
            requestId,
            statusCode: res.statusCode,
            duration: `${duration}ms`
        });
        return originalEnd.call(this, chunk, encoding);
    };
    
    next();
}

/**
 * Debug wrapper for database operations
 * @param {object} db - SQLite database object
 * @returns {object} - Wrapped database object
 */
function wrapDatabase(db) {
    if (!DEBUG_MODE) return db;
    
    const originalGet = db.get;
    const originalAll = db.all;
    const originalRun = db.run;
    
    db.get = function(sql, params, callback) {
        const queryId = Math.random().toString(36).substring(2, 10);
        debugLog('DB', `GET query ${queryId}`, { sql, params });
        
        if (typeof params === 'function') {
            callback = params;
            params = [];
        }
        
        return originalGet.call(this, sql, params, function(err, row) {
            if (err) {
                debugLog('DB', `GET query ${queryId} error`, err);
            } else {
                debugLog('DB', `GET query ${queryId} result`, row);
            }
            
            if (callback) callback.apply(this, arguments);
        });
    };
    
    db.all = function(sql, params, callback) {
        const queryId = Math.random().toString(36).substring(2, 10);
        debugLog('DB', `ALL query ${queryId}`, { sql, params });
        
        if (typeof params === 'function') {
            callback = params;
            params = [];
        }
        
        return originalAll.call(this, sql, params, function(err, rows) {
            if (err) {
                debugLog('DB', `ALL query ${queryId} error`, err);
            } else {
                debugLog('DB', `ALL query ${queryId} result`, {
                    count: rows ? rows.length : 0,
                    rows: rows
                });
            }
            
            if (callback) callback.apply(this, arguments);
        });
    };
    
    db.run = function(sql, params, callback) {
        const queryId = Math.random().toString(36).substring(2, 10);
        debugLog('DB', `RUN query ${queryId}`, { sql, params });
        
        if (typeof params === 'function') {
            callback = params;
            params = [];
        }
        
        return originalRun.call(this, sql, params, function(err) {
            if (err) {
                debugLog('DB', `RUN query ${queryId} error`, err);
            } else {
                debugLog('DB', `RUN query ${queryId} result`, {
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
 * @param {object} queueManager - Queue manager object
 * @returns {object} - Wrapped queue manager object
 */
function wrapQueueManager(queueManager) {
    if (!DEBUG_MODE) return queueManager;
    
    const originalGetJobById = queueManager.getJobById;
    
    queueManager.getJobById = async function(db, jobId) {
        debugLog('QUEUE', `Getting job by ID: ${jobId}`);
        
        try {
            const job = await originalGetJobById.call(this, db, jobId);
            debugLog('QUEUE', `Job retrieved successfully`, {
                jobId,
                status: job.status,
                segmentsCount: job.segments ? job.segments.length : 0,
                segments: job.segments
            });
            return job;
        } catch (error) {
            debugLog('QUEUE', `Error getting job by ID: ${jobId}`, {
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
 * @param {string} operation - Operation name
 * @param {string} filePath - File path
 * @param {any} data - Optional data
 */
function debugFileSystem(operation, filePath, data = null) {
    if (!DEBUG_MODE) return;
    
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
        
        debugLog('FS', `${operation}: ${filePath}`, {
            fileInfo,
            data
        });
    } catch (error) {
        debugLog('FS', `Error in ${operation}: ${filePath}`, {
            error: error.message,
            stack: error.stack
        });
    }
}

// Export debug functions
module.exports = {
    debugLog,
    debugMiddleware,
    wrapDatabase,
    wrapQueueManager,
    debugFileSystem
};
