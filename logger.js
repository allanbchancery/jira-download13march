/**
 * Enhanced Logger for Jira Ticket Downloader
 * Provides structured logging with levels, file output, and console formatting
 */
const fs = require('fs');
const path = require('path');
const util = require('util');

// Log levels
const LOG_LEVELS = {
  ERROR: 0,
  WARN: 1,
  INFO: 2,
  DEBUG: 3,
  TRACE: 4
};

// Default configuration
const DEFAULT_CONFIG = {
  level: 'DEBUG',
  enableConsole: true,
  enableFile: true,
  logDir: path.join(__dirname, 'logs'),
  errorLogPath: path.join(__dirname, 'logs', 'error.log'),
  combinedLogPath: path.join(__dirname, 'logs', 'combined.log'),
  maxLogSize: 10 * 1024 * 1024, // 10MB
  maxLogFiles: 5,
  format: 'json'
};

class Logger {
  constructor(config = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.currentLevel = LOG_LEVELS[this.config.level] || LOG_LEVELS.INFO;
    
    // Create log directory if it doesn't exist
    if (this.config.enableFile && !fs.existsSync(this.config.logDir)) {
      fs.mkdirSync(this.config.logDir, { recursive: true });
    }
    
    // Initialize log files
    if (this.config.enableFile) {
      // Ensure error log exists
      if (!fs.existsSync(this.config.errorLogPath)) {
        fs.writeFileSync(this.config.errorLogPath, '');
      }
      
      // Ensure combined log exists
      if (!fs.existsSync(this.config.combinedLogPath)) {
        fs.writeFileSync(this.config.combinedLogPath, '');
      }
    }
    
    // Log initialization
    this.info('Logger initialized', { config: this.config });
  }
  
  /**
   * Log an error message
   * @param {string} message - Log message
   * @param {object} data - Additional data to log
   */
  error(message, data = null) {
    this._log('ERROR', message, data);
  }
  
  /**
   * Log a warning message
   * @param {string} message - Log message
   * @param {object} data - Additional data to log
   */
  warn(message, data = null) {
    this._log('WARN', message, data);
  }
  
  /**
   * Log an info message
   * @param {string} message - Log message
   * @param {object} data - Additional data to log
   */
  info(message, data = null) {
    this._log('INFO', message, data);
  }
  
  /**
   * Log a debug message
   * @param {string} message - Log message
   * @param {object} data - Additional data to log
   */
  debug(message, data = null) {
    this._log('DEBUG', message, data);
  }
  
  /**
   * Log a trace message
   * @param {string} message - Log message
   * @param {object} data - Additional data to log
   */
  trace(message, data = null) {
    this._log('TRACE', message, data);
  }
  
  /**
   * Log an HTTP request
   * @param {object} req - Express request object
   * @param {object} res - Express response object
   * @param {string} duration - Request duration in ms
   */
  logRequest(req, res, duration) {
    const requestData = {
      method: req.method,
      url: req.url,
      params: req.params,
      query: req.query,
      body: req.method === 'POST' || req.method === 'PUT' ? req.body : undefined,
      headers: req.headers,
      statusCode: res.statusCode,
      duration: `${duration}ms`,
      userAgent: req.headers['user-agent'],
      ip: req.ip || req.connection.remoteAddress
    };
    
    // Log at appropriate level based on status code
    if (res.statusCode >= 500) {
      this.error(`HTTP ${res.statusCode} ${req.method} ${req.url}`, requestData);
    } else if (res.statusCode >= 400) {
      this.warn(`HTTP ${res.statusCode} ${req.method} ${req.url}`, requestData);
    } else {
      this.info(`HTTP ${res.statusCode} ${req.method} ${req.url}`, requestData);
    }
  }
  
  /**
   * Log an error with full stack trace and request context
   * @param {Error} err - Error object
   * @param {object} req - Express request object (optional)
   */
  logError(err, req = null) {
    const errorData = {
      name: err.name,
      message: err.message,
      stack: err.stack,
      code: err.code,
    };
    
    // Add request context if available
    if (req) {
      errorData.request = {
        method: req.method,
        url: req.url,
        headers: req.headers,
        params: req.params,
        query: req.query,
        body: req.method === 'POST' || req.method === 'PUT' ? req.body : undefined,
        ip: req.ip || req.connection.remoteAddress
      };
    }
    
    this.error(`Error: ${err.message}`, errorData);
  }
  
  /**
   * Internal logging method
   * @param {string} level - Log level
   * @param {string} message - Log message
   * @param {object} data - Additional data to log
   * @private
   */
  _log(level, message, data) {
    // Check if we should log at this level
    if (LOG_LEVELS[level] > this.currentLevel) {
      return;
    }
    
    const timestamp = new Date().toISOString();
    const logEntry = {
      timestamp,
      level,
      message,
      data: data || {}
    };
    
    // Add stack trace for errors
    if (level === 'ERROR' && !data?.stack) {
      logEntry.stack = new Error().stack.split('\n').slice(2).join('\n');
    }
    
    // Format log entry
    let formattedLog;
    if (this.config.format === 'json') {
      formattedLog = JSON.stringify(logEntry);
    } else {
      formattedLog = `[${timestamp}][${level}] ${message}`;
      if (data) {
        formattedLog += '\n' + util.inspect(data, { depth: null, colors: true });
      }
    }
    
    // Console output
    if (this.config.enableConsole) {
      const consoleMethod = level === 'ERROR' ? 'error' : 
                           level === 'WARN' ? 'warn' : 
                           level === 'INFO' ? 'log' : 
                           'debug';
      
      console[consoleMethod](formattedLog);
    }
    
    // File output
    if (this.config.enableFile) {
      // Append to combined log
      fs.appendFileSync(this.config.combinedLogPath, formattedLog + '\n');
      
      // Append to error log if error
      if (level === 'ERROR') {
        fs.appendFileSync(this.config.errorLogPath, formattedLog + '\n');
      }
      
      // Check log rotation
      this._checkRotation();
    }
  }
  
  /**
   * Check if log files need rotation
   * @private
   */
  _checkRotation() {
    try {
      // Check combined log size
      const stats = fs.statSync(this.config.combinedLogPath);
      if (stats.size > this.config.maxLogSize) {
        this._rotateLog(this.config.combinedLogPath);
      }
      
      // Check error log size
      const errorStats = fs.statSync(this.config.errorLogPath);
      if (errorStats.size > this.config.maxLogSize) {
        this._rotateLog(this.config.errorLogPath);
      }
    } catch (err) {
      console.error('Error checking log rotation:', err);
    }
  }
  
  /**
   * Rotate a log file
   * @param {string} logPath - Path to log file
   * @private
   */
  _rotateLog(logPath) {
    try {
      // Get base name and directory
      const dir = path.dirname(logPath);
      const ext = path.extname(logPath);
      const base = path.basename(logPath, ext);
      
      // Shift existing rotated logs
      for (let i = this.config.maxLogFiles - 1; i >= 1; i--) {
        const oldFile = path.join(dir, `${base}.${i}${ext}`);
        const newFile = path.join(dir, `${base}.${i + 1}${ext}`);
        
        if (fs.existsSync(oldFile)) {
          fs.renameSync(oldFile, newFile);
        }
      }
      
      // Rotate current log to .1
      const newFile = path.join(dir, `${base}.1${ext}`);
      fs.renameSync(logPath, newFile);
      
      // Create new empty log file
      fs.writeFileSync(logPath, '');
      
      this.info(`Rotated log file: ${logPath}`);
    } catch (err) {
      console.error('Error rotating log file:', err);
    }
  }
  
  /**
   * Create Express middleware for request logging
   * @returns {function} Express middleware
   */
  createRequestLogger() {
    return (req, res, next) => {
      const startTime = Date.now();
      
      // Log request
      this.debug(`${req.method} ${req.url}`, {
        method: req.method,
        url: req.url,
        params: req.params,
        query: req.query,
        headers: req.headers,
        body: req.method === 'POST' || req.method === 'PUT' ? req.body : undefined
      });
      
      // Capture original methods
      const originalEnd = res.end;
      
      // Override end method to log response
      res.end = function(chunk, encoding) {
        const duration = Date.now() - startTime;
        
        // Restore original end method
        res.end = originalEnd;
        
        // Call original end method
        res.end(chunk, encoding);
        
        // Log response
        this.logRequest(req, res, duration);
      }.bind(this);
      
      next();
    };
  }
  
  /**
   * Create Express middleware for error handling
   * @returns {function} Express error middleware
   */
  createErrorHandler() {
    return (err, req, res, next) => {
      // Log the error
      this.logError(err, req);
      
      // Send error response
      res.status(err.status || 500).json({
        success: false,
        error: err.message || 'Internal Server Error',
        errorCode: err.code || 'UNKNOWN_ERROR'
      });
    };
  }
}

// Create singleton instance
const logger = new Logger();

module.exports = logger;
