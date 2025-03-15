/**
 * Enhanced Debug Helper for Jira Ticket Downloader
 * Provides comprehensive client-side error logging and debugging
 */

// Enable debug mode globally
window.DEBUG_MODE = true;

// Log levels
const LOG_LEVELS = {
    ERROR: 0,
    WARN: 1,
    INFO: 2,
    DEBUG: 3,
    TRACE: 4
};

// Current log level
window.LOG_LEVEL = LOG_LEVELS.DEBUG;

// Store logs in memory for debug panel
window.clientLogs = [];
const MAX_LOGS = 1000; // Maximum number of logs to keep in memory

// Enhanced debug logging function with levels
function debugLog(level, category, message, data = null) {
    // Skip if debug mode is disabled
    if (!window.DEBUG_MODE) return;
    
    // Skip if log level is higher than current level
    if (LOG_LEVELS[level] > window.LOG_LEVEL) return;
    
    const timestamp = new Date().toISOString();
    const logPrefix = `[${level}][${timestamp}][${category}]`;
    
    // Format log entry
    let formattedMessage;
    if (data) {
        formattedMessage = `${logPrefix} ${message}`;
        console[level === 'ERROR' ? 'error' : level === 'WARN' ? 'warn' : 'log'](formattedMessage, data);
    } else {
        formattedMessage = `${logPrefix} ${message}`;
        console[level === 'ERROR' ? 'error' : level === 'WARN' ? 'warn' : 'log'](formattedMessage);
    }
    
    // Store log in memory
    window.clientLogs.unshift({
        level,
        timestamp,
        category,
        message,
        data
    });
    
    // Trim logs if they exceed maximum
    if (window.clientLogs.length > MAX_LOGS) {
        window.clientLogs.pop();
    }
    
    // If error level, also report to server if configured
    if (level === 'ERROR' && window.REPORT_ERRORS_TO_SERVER) {
        reportErrorToServer(message, data);
    }
}

// Convenience methods for different log levels
function logError(category, message, data = null) {
    debugLog('ERROR', category, message, data);
}

function logWarn(category, message, data = null) {
    debugLog('WARN', category, message, data);
}

function logInfo(category, message, data = null) {
    debugLog('INFO', category, message, data);
}

function logDebug(category, message, data = null) {
    debugLog('DEBUG', category, message, data);
}

function logTrace(category, message, data = null) {
    debugLog('TRACE', category, message, data);
}

// For backward compatibility
function debugLogLegacy(category, message, data = null) {
    debugLog('DEBUG', category, message, data);
}

/**
 * Report error to server
 * @param {string} message - Error message
 * @param {object} data - Error data
 */
function reportErrorToServer(message, data) {
    // Only if API_BASE_URL is defined
    if (typeof API_BASE_URL === 'undefined') return;
    
    try {
        const errorData = {
            message,
            data,
            userAgent: navigator.userAgent,
            url: window.location.href,
            timestamp: new Date().toISOString()
        };
        
        // Use navigator.sendBeacon for non-blocking error reporting
        if (navigator.sendBeacon) {
            const blob = new Blob([JSON.stringify(errorData)], { type: 'application/json' });
            navigator.sendBeacon(`${API_BASE_URL}/client-error`, blob);
        } else {
            // Fall back to fetch for older browsers
            fetch(`${API_BASE_URL}/client-error`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(errorData),
                // Use keepalive to ensure the request completes even if the page is unloading
                keepalive: true
            }).catch(() => {
                // Ignore errors in error reporting
            });
        }
    } catch (e) {
        // Don't let error reporting cause more errors
        console.error('Error reporting error to server:', e);
    }
}

// Add enhanced debug logging to fetch calls
const originalFetch = window.fetch;
window.fetch = function(url, options) {
    const requestId = Math.random().toString(36).substring(2, 10);
    logDebug('FETCH', `Request ${requestId} to ${url}`, options);
    
    const startTime = Date.now();
    
    return originalFetch.apply(this, arguments)
        .then(response => {
            const duration = Date.now() - startTime;
            
            if (response.ok) {
                logDebug('FETCH', `Response ${requestId} from ${url} (${duration}ms)`, {
                    status: response.status,
                    statusText: response.statusText,
                    headers: Array.from(response.headers.entries()),
                    duration: `${duration}ms`
                });
            } else {
                logWarn('FETCH', `Error response ${requestId} from ${url} (${duration}ms)`, {
                    status: response.status,
                    statusText: response.statusText,
                    headers: Array.from(response.headers.entries()),
                    duration: `${duration}ms`
                });
            }
            
            // Clone the response to avoid consuming it
            const clonedResponse = response.clone();
            
            // Try to log the response body if it's JSON
            clonedResponse.json().then(data => {
                if (response.ok) {
                    logTrace('FETCH', `Response body ${requestId} from ${url}`, data);
                } else {
                    logWarn('FETCH', `Error response body ${requestId} from ${url}`, data);
                }
            }).catch(() => {
                logDebug('FETCH', `Response body ${requestId} from ${url} is not JSON`);
            });
            
            return response;
        })
        .catch(error => {
            const duration = Date.now() - startTime;
            logError('FETCH', `Network error ${requestId} in fetch to ${url} (${duration}ms)`, {
                message: error.message,
                stack: error.stack,
                duration: `${duration}ms`
            });
            throw error;
        });
};

// Add enhanced debug logging to DOM events
function addEventListenerDebug(element, eventName, callback) {
    if (!element) {
        logWarn('EVENT', `Cannot add event listener for ${eventName} - element is null`);
        return;
    }
    
    logDebug('EVENT', `Adding ${eventName} listener to element`, {
        element: element.tagName,
        id: element.id,
        className: element.className
    });
    
    const wrappedCallback = function(event) {
        logTrace('EVENT', `${eventName} event triggered on element`, {
            element: event.target.tagName,
            id: event.target.id,
            className: event.target.className
        });
        
        try {
            return callback.apply(this, arguments);
        } catch (error) {
            logError('EVENT', `Error in ${eventName} event handler`, {
                message: error.message,
                stack: error.stack,
                eventName,
                element: {
                    tagName: event.target.tagName,
                    id: event.target.id,
                    className: event.target.className
                }
            });
            throw error;
        }
    };
    
    element.addEventListener(eventName, wrappedCallback);
    return wrappedCallback;
}

// Global error handling
window.addEventListener('error', function(event) {
    logError('GLOBAL', 'Uncaught error', {
        message: event.message,
        filename: event.filename,
        lineno: event.lineno,
        colno: event.colno,
        error: event.error ? {
            name: event.error.name,
            message: event.error.message,
            stack: event.error.stack
        } : null
    });
});

// Unhandled promise rejection handling
window.addEventListener('unhandledrejection', function(event) {
    logError('PROMISE', 'Unhandled promise rejection', {
        reason: event.reason instanceof Error ? {
            name: event.reason.name,
            message: event.reason.message,
            stack: event.reason.stack
        } : event.reason
    });
});

// Enhanced debug helper for View Files functionality
function debugViewFiles(job) {
    logInfo('VIEW_FILES', 'View Files button clicked for job', {
        jobId: job.job_id,
        projectKey: job.project_key,
        status: job.status
    });
    
    // Check if segments exist
    if (!job.segments) {
        logWarn('VIEW_FILES', 'No segments found in job data', job);
        return false;
    }
    
    if (!Array.isArray(job.segments)) {
        logWarn('VIEW_FILES', 'Job segments is not an array', typeof job.segments);
        return false;
    }
    
    if (job.segments.length === 0) {
        logWarn('VIEW_FILES', 'Job segments array is empty', job.segments);
        return false;
    }
    
    // Log segment details
    job.segments.forEach((segment, index) => {
        logDebug('VIEW_FILES', `Segment ${index + 1} details`, {
            segmentNumber: segment.segment_number,
            totalSegments: segment.total_segments,
            filePath: segment.file_path,
            fileCount: segment.file_count,
            sizeBytes: segment.size_bytes
        });
    });
    
    return true;
}

// Performance monitoring
const performanceMarks = {};

/**
 * Start timing an operation
 * @param {string} operationName - Name of the operation to time
 */
function startTiming(operationName) {
    if (!window.DEBUG_MODE) return;
    
    const startTime = performance.now();
    performanceMarks[operationName] = startTime;
    logDebug('PERFORMANCE', `Starting operation: ${operationName}`);
}

/**
 * End timing an operation and log the duration
 * @param {string} operationName - Name of the operation that was timed
 * @param {object} additionalData - Additional data to log
 */
function endTiming(operationName, additionalData = null) {
    if (!window.DEBUG_MODE) return;
    
    if (!performanceMarks[operationName]) {
        logWarn('PERFORMANCE', `No start time found for operation: ${operationName}`);
        return;
    }
    
    const endTime = performance.now();
    const duration = endTime - performanceMarks[operationName];
    
    logInfo('PERFORMANCE', `Operation completed: ${operationName}`, {
        duration: `${duration.toFixed(2)}ms`,
        ...additionalData
    });
    
    delete performanceMarks[operationName];
}

// Enhanced patch for the createJobCard function
function patchCreateJobCard() {
    if (typeof createJobCard !== 'function') {
        logError('PATCH', 'createJobCard function not found');
        return;
    }
    
    const originalCreateJobCard = createJobCard;
    
    window.createJobCard = function(job) {
        startTiming(`createJobCard_${job.job_id}`);
        logDebug('JOB_CARD', 'Creating job card for job', job);
        
        try {
            const jobCard = originalCreateJobCard.apply(this, arguments);
            
            // Add debug info to View Files button
            const viewFilesBtn = jobCard.querySelector('.view-files-btn');
            if (viewFilesBtn) {
                logDebug('JOB_CARD', 'Found View Files button in job card', {
                    jobId: job.job_id,
                    hasSegments: !!job.segments,
                    segmentsLength: job.segments ? job.segments.length : 0
                });
                
                // Replace the click event listener
                viewFilesBtn.addEventListener('click', function(event) {
                    startTiming(`viewFiles_${job.job_id}`);
                    logInfo('VIEW_FILES', 'View Files button clicked', {
                        jobId: job.job_id,
                        event: event.type
                    });
                    
                    // Validate segments
                    if (!debugViewFiles(job)) {
                        logWarn('VIEW_FILES', 'No valid segments found for this job');
                        alert('Debug: No valid segments found for this job. Check console for details.');
                        endTiming(`viewFiles_${job.job_id}`, { success: false });
                        return;
                    }
                    
                    try {
                        // Show files dialog
                        const filesDialog = document.createElement('div');
                        filesDialog.className = 'download-dialog';
                        
                        // Add debug class for styling
                        filesDialog.classList.add('debug-dialog');
                        
                        filesDialog.innerHTML = `
                            <div class="download-dialog-content">
                                <h3>Download Files (Debug Mode)</h3>
                                <p>Project: ${job.project_key}</p>
                                <div class="debug-info">
                                    <h4>Debug Information</h4>
                                    <pre>${JSON.stringify(job, null, 2)}</pre>
                                </div>
                                <div class="segments-list">
                                    ${job.segments.map(segment => `
                                        <div class="segment-item">
                                            <div class="segment-header">
                                                <h4>Segment ${segment.segment_number} of ${segment.total_segments}</h4>
                                                <p>Size: ${(segment.size_bytes / (1024 * 1024)).toFixed(1)} MB (${segment.file_count} files)</p>
                                            </div>
                                            <div class="debug-path">Path: ${segment.file_path}</div>
                                            <button class="btn secondary download-segment" data-path="${segment.file_path}">
                                                Download Segment ${segment.segment_number}
                                            </button>
                                        </div>
                                    `).join('')}
                                </div>
                                <button class="btn primary close-dialog">Close</button>
                                <div class="debug-panel">
                                    <h4>Debug Panel</h4>
                                    <button class="btn secondary toggle-logs">Show/Hide Logs</button>
                                    <div class="client-logs hidden">
                                        <select class="log-level-filter">
                                            <option value="ERROR">Error Only</option>
                                            <option value="WARN">Warning+</option>
                                            <option value="INFO">Info+</option>
                                            <option value="DEBUG" selected>Debug+</option>
                                            <option value="TRACE">All Logs</option>
                                        </select>
                                        <div class="log-entries"></div>
                                    </div>
                                </div>
                            </div>
                        `;
                        document.body.appendChild(filesDialog);
                        
                        logDebug('VIEW_FILES', 'Files dialog created and added to DOM');
                        
                        // Add download handlers
                        const downloadButtons = filesDialog.querySelectorAll('.download-segment');
                        logDebug('VIEW_FILES', `Found ${downloadButtons.length} download buttons`);
                        
                        downloadButtons.forEach(button => {
                            const filePath = button.dataset.path;
                            logDebug('VIEW_FILES', 'Adding click handler for segment with path', filePath);
                            
                            button.addEventListener('click', async () => {
                                const downloadId = Math.random().toString(36).substring(2, 10);
                                startTiming(`downloadSegment_${downloadId}`);
                                logInfo('VIEW_FILES', 'Download segment button clicked for path', filePath);
                                
                                if (!filePath) {
                                    logWarn('VIEW_FILES', 'No file path found in button data attribute');
                                    alert('Error: No file path found for this segment');
                                    endTiming(`downloadSegment_${downloadId}`, { success: false });
                                    return;
                                }
                                
                                const fileName = filePath.split('/').pop();
                                logDebug('VIEW_FILES', 'Extracted filename', fileName);
                                
                                button.disabled = true;
                                button.textContent = 'Downloading...';
                                
                                try {
                                    logDebug('VIEW_FILES', 'Fetching segment file', fileName);
                                    const zipResponse = await fetch(`${API_BASE_URL}/download-project/${fileName}`);
                                    
                                    logDebug('VIEW_FILES', 'Fetch response', {
                                        status: zipResponse.status,
                                        statusText: zipResponse.statusText,
                                        headers: Array.from(zipResponse.headers.entries())
                                    });
                                    
                                    if (!zipResponse.ok) {
                                        logError('VIEW_FILES', 'Failed to download segment', {
                                            status: zipResponse.status,
                                            statusText: zipResponse.statusText
                                        });
                                        throw new Error(`Failed to download segment: ${zipResponse.status} ${zipResponse.statusText}`);
                                    }
                                    
                                    logDebug('VIEW_FILES', 'Segment file fetched successfully, creating blob');
                                    const blob = await zipResponse.blob();
                                    logDebug('VIEW_FILES', 'Blob created', {
                                        size: blob.size,
                                        type: blob.type
                                    });
                                    
                                    const url = window.URL.createObjectURL(blob);
                                    logDebug('VIEW_FILES', 'Created object URL', url);
                                    
                                    const a = document.createElement('a');
                                    a.href = url;
                                    a.download = fileName;
                                    document.body.appendChild(a);
                                    
                                    logDebug('VIEW_FILES', 'Triggering download');
                                    a.click();
                                    document.body.removeChild(a);
                                    window.URL.revokeObjectURL(url);
                                    
                                    logInfo('VIEW_FILES', 'Download complete', {
                                        fileName,
                                        size: `${(blob.size / (1024 * 1024)).toFixed(1)} MB`
                                    });
                                    button.textContent = 'Downloaded';
                                    button.classList.add('success');
                                    endTiming(`downloadSegment_${downloadId}`, { 
                                        success: true,
                                        fileName,
                                        size: blob.size
                                    });
                                } catch (error) {
                                    logError('VIEW_FILES', 'Error downloading segment', {
                                        fileName,
                                        message: error.message,
                                        stack: error.stack
                                    });
                                    button.textContent = 'Failed - Try Again';
                                    button.disabled = false;
                                    button.classList.add('error');
                                    alert(`Download failed: ${error.message}`);
                                    endTiming(`downloadSegment_${downloadId}`, { success: false });
                                }
                            });
                        });
                        
                        // Add debug panel functionality
                        const toggleLogsBtn = filesDialog.querySelector('.toggle-logs');
                        const clientLogsDiv = filesDialog.querySelector('.client-logs');
                        const logEntriesDiv = filesDialog.querySelector('.log-entries');
                        const logLevelFilter = filesDialog.querySelector('.log-level-filter');
                        
                        if (toggleLogsBtn) {
                            toggleLogsBtn.addEventListener('click', () => {
                                clientLogsDiv.classList.toggle('hidden');
                                if (!clientLogsDiv.classList.contains('hidden')) {
                                    // Render logs
                                    renderLogs();
                                }
                            });
                        }
                        
                        // Function to render logs based on selected level
                        function renderLogs() {
                            const selectedLevel = logLevelFilter.value;
                            const selectedLevelValue = LOG_LEVELS[selectedLevel];
                            
                            // Filter logs based on selected level
                            const filteredLogs = window.clientLogs.filter(log => 
                                LOG_LEVELS[log.level] <= selectedLevelValue
                            );
                            
                            // Clear existing logs
                            logEntriesDiv.innerHTML = '';
                            
                            // Add logs
                            filteredLogs.forEach(log => {
                                const logEntry = document.createElement('div');
                                logEntry.className = `log-entry log-${log.level.toLowerCase()}`;
                                
                                const timestamp = new Date(log.timestamp).toLocaleTimeString();
                                
                                logEntry.innerHTML = `
                                    <div class="log-header">
                                        <span class="log-level">${log.level}</span>
                                        <span class="log-timestamp">${timestamp}</span>
                                        <span class="log-category">${log.category}</span>
                                    </div>
                                    <div class="log-message">${log.message}</div>
                                    ${log.data ? `<pre class="log-data">${JSON.stringify(log.data, null, 2)}</pre>` : ''}
                                `;
                                
                                logEntriesDiv.appendChild(logEntry);
                            });
                        }
                        
                        // Add log level filter change handler
                        if (logLevelFilter) {
                            logLevelFilter.addEventListener('change', () => {
                                renderLogs();
                            });
                        }
                        
                        // Add close handler
                        const closeButton = filesDialog.querySelector('.close-dialog');
                        logDebug('VIEW_FILES', 'Adding close button handler');
                        
                        closeButton.addEventListener('click', () => {
                            logDebug('VIEW_FILES', 'Close button clicked, removing dialog');
                            filesDialog.remove();
                        });
                        
                        endTiming(`viewFiles_${job.job_id}`, { success: true });
                    } catch (error) {
                        logError('VIEW_FILES', 'Error creating files dialog', {
                            message: error.message,
                            stack: error.stack
                        });
                        alert(`Error: ${error.message}`);
                        endTiming(`viewFiles_${job.job_id}`, { success: false });
                    }
                });
            } else {
                logWarn('JOB_CARD', 'View Files button not found in job card', {
                    jobId: job.job_id,
                    status: job.status,
                    html: jobCard.innerHTML
                });
            }
            
            endTiming(`createJobCard_${job.job_id}`, { success: true });
            return jobCard;
        } catch (error) {
            logError('JOB_CARD', 'Error creating job card', {
                jobId: job.job_id,
                error: error.message,
                stack: error.stack
            });
            endTiming(`createJobCard_${job.job_id}`, { success: false });
            throw error;
        }
    };
    
    logInfo('PATCH', 'Successfully patched createJobCard function');
}

// Add debug styles
function addDebugStyles() {
    const style = document.createElement('style');
    style.textContent = `
        .debug-dialog {
            z-index: 1000;
        }
        
        .debug-info {
            background-color: #f8f9fa;
            border: 1px solid #dee2e6;
            border-radius: 4px;
            padding: 10px;
            margin-bottom: 20px;
            max-height: 200px;
            overflow: auto;
        }
        
        .debug-info pre {
            margin: 0;
            white-space: pre-wrap;
            font-size: 12px;
        }
        
        .debug-path {
            font-family: monospace;
            font-size: 12px;
            color: #6c757d;
            margin-bottom: 5px;
        }
        
        /* Debug panel styles */
        .debug-panel {
            margin-top: 20px;
            border-top: 1px solid #dee2e6;
            padding-top: 10px;
        }
        
        .client-logs {
            margin-top: 10px;
            max-height: 300px;
            overflow-y: auto;
            border: 1px solid #dee2e6;
            border-radius: 4px;
            background-color: #f8f9fa;
        }
        
        .client-logs.hidden {
            display: none;
        }
        
        .log-level-filter {
            width: 100%;
            margin-bottom: 10px;
            padding: 5px;
            border-radius: 4px;
            border: 1px solid #ced4da;
        }
        
        .log-entries {
            padding: 10px;
        }
        
        .log-entry {
            margin-bottom: 8px;
            padding: 8px;
            border-radius: 4px;
            border-left: 4px solid #ccc;
            background-color: white;
        }
        
        .log-error {
            border-left-color: #dc3545;
            background-color: #f8d7da;
        }
        
        .log-warn {
            border-left-color: #ffc107;
            background-color: #fff3cd;
        }
        
        .log-info {
            border-left-color: #0dcaf0;
            background-color: #d1ecf1;
        }
        
        .log-debug {
            border-left-color: #6c757d;
            background-color: #e9ecef;
        }
        
        .log-trace {
            border-left-color: #adb5bd;
            background-color: #f8f9fa;
        }
        
        .log-header {
            display: flex;
            justify-content: space-between;
            margin-bottom: 5px;
            font-size: 12px;
            color: #6c757d;
        }
        
        .log-level {
            font-weight: bold;
        }
        
        .log-message {
            margin-bottom: 5px;
            font-weight: bold;
        }
        
        .log-data {
            font-size: 11px;
            margin: 0;
            white-space: pre-wrap;
            background-color: rgba(0, 0, 0, 0.05);
            padding: 5px;
            border-radius: 3px;
        }
    `;
    document.head.appendChild(style);
    debugLog('STYLES', 'Added debug styles to document');
}

// Initialize debug helpers
function initDebugHelpers() {
    debugLog('INIT', 'Initializing debug helpers');
    
    // Add debug styles
    addDebugStyles();
    
    // Patch createJobCard function
    window.addEventListener('load', () => {
        debugLog('INIT', 'Window loaded, patching createJobCard');
        patchCreateJobCard();
        
        // Add debug info to page
        const debugInfo = document.createElement('div');
        debugInfo.style.position = 'fixed';
        debugInfo.style.bottom = '10px';
        debugInfo.style.right = '10px';
        debugInfo.style.backgroundColor = 'rgba(0, 0, 0, 0.7)';
        debugInfo.style.color = 'white';
        debugInfo.style.padding = '5px 10px';
        debugInfo.style.borderRadius = '4px';
        debugInfo.style.fontSize = '12px';
        debugInfo.style.zIndex = '9999';
        debugInfo.textContent = 'Debug Mode Active';
        document.body.appendChild(debugInfo);
        
        debugLog('INIT', 'Debug initialization complete');
    });
}

// Export debug functions
window.debugHelpers = {
    log: debugLog,
    viewFiles: debugViewFiles,
    addEventListenerDebug
};

// Initialize
initDebugHelpers();
