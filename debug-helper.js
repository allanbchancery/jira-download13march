/**
 * Debug Helper for Jira Ticket Downloader
 * This file adds additional logging and debugging functionality
 */

// Enable debug mode globally
window.DEBUG_MODE = true;

// Debug logging function
function debugLog(category, message, data = null) {
    if (!window.DEBUG_MODE) return;
    
    const timestamp = new Date().toISOString();
    const logPrefix = `[DEBUG][${timestamp}][${category}]`;
    
    if (data) {
        console.log(logPrefix, message, data);
    } else {
        console.log(logPrefix, message);
    }
}

// Add debug logging to fetch calls
const originalFetch = window.fetch;
window.fetch = function(url, options) {
    debugLog('FETCH', `Request to ${url}`, options);
    
    return originalFetch.apply(this, arguments)
        .then(response => {
            debugLog('FETCH', `Response from ${url}`, {
                status: response.status,
                statusText: response.statusText,
                headers: Array.from(response.headers.entries())
            });
            
            // Clone the response to avoid consuming it
            const clonedResponse = response.clone();
            
            // Try to log the response body if it's JSON
            clonedResponse.json().then(data => {
                debugLog('FETCH', `Response body from ${url}`, data);
            }).catch(() => {
                debugLog('FETCH', `Response body from ${url} is not JSON`);
            });
            
            return response;
        })
        .catch(error => {
            debugLog('FETCH', `Error in fetch to ${url}`, {
                message: error.message,
                stack: error.stack
            });
            throw error;
        });
};

// Add debug logging to DOM events
function addEventListenerDebug(element, eventName, callback) {
    if (!element) {
        debugLog('EVENT', `Cannot add event listener for ${eventName} - element is null`);
        return;
    }
    
    debugLog('EVENT', `Adding ${eventName} listener to element`, {
        element: element.tagName,
        id: element.id,
        className: element.className
    });
    
    const wrappedCallback = function(event) {
        debugLog('EVENT', `${eventName} event triggered on element`, {
            element: event.target.tagName,
            id: event.target.id,
            className: event.target.className
        });
        
        try {
            return callback.apply(this, arguments);
        } catch (error) {
            debugLog('EVENT', `Error in ${eventName} event handler`, {
                message: error.message,
                stack: error.stack
            });
            throw error;
        }
    };
    
    element.addEventListener(eventName, wrappedCallback);
    return wrappedCallback;
}

// Debug helper for View Files functionality
function debugViewFiles(job) {
    debugLog('VIEW_FILES', 'View Files button clicked for job', {
        jobId: job.job_id,
        projectKey: job.project_key,
        status: job.status
    });
    
    // Check if segments exist
    if (!job.segments) {
        debugLog('VIEW_FILES', 'No segments found in job data', job);
        return false;
    }
    
    if (!Array.isArray(job.segments)) {
        debugLog('VIEW_FILES', 'Job segments is not an array', typeof job.segments);
        return false;
    }
    
    if (job.segments.length === 0) {
        debugLog('VIEW_FILES', 'Job segments array is empty', job.segments);
        return false;
    }
    
    // Log segment details
    job.segments.forEach((segment, index) => {
        debugLog('VIEW_FILES', `Segment ${index + 1} details`, {
            segmentNumber: segment.segment_number,
            totalSegments: segment.total_segments,
            filePath: segment.file_path,
            fileCount: segment.file_count,
            sizeBytes: segment.size_bytes
        });
    });
    
    return true;
}

// Patch the createJobCard function to add debugging
function patchCreateJobCard() {
    if (typeof createJobCard !== 'function') {
        console.error('createJobCard function not found');
        return;
    }
    
    const originalCreateJobCard = createJobCard;
    
    window.createJobCard = function(job) {
        debugLog('JOB_CARD', 'Creating job card for job', job);
        
        const jobCard = originalCreateJobCard.apply(this, arguments);
        
        // Add debug info to View Files button
        const viewFilesBtn = jobCard.querySelector('.view-files-btn');
        if (viewFilesBtn) {
            debugLog('JOB_CARD', 'Found View Files button in job card', {
                jobId: job.job_id,
                hasSegments: !!job.segments,
                segmentsLength: job.segments ? job.segments.length : 0
            });
            
            // Replace the click event listener
            viewFilesBtn.addEventListener('click', function(event) {
                debugLog('VIEW_FILES', 'View Files button clicked', {
                    jobId: job.job_id,
                    event: event.type
                });
                
                // Validate segments
                if (!debugViewFiles(job)) {
                    alert('Debug: No valid segments found for this job. Check console for details.');
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
                        </div>
                    `;
                    document.body.appendChild(filesDialog);
                    
                    debugLog('VIEW_FILES', 'Files dialog created and added to DOM');
                    
                    // Add download handlers
                    const downloadButtons = filesDialog.querySelectorAll('.download-segment');
                    debugLog('VIEW_FILES', `Found ${downloadButtons.length} download buttons`);
                    
                    downloadButtons.forEach(button => {
                        const filePath = button.dataset.path;
                        debugLog('VIEW_FILES', 'Adding click handler for segment with path', filePath);
                        
                        button.addEventListener('click', async () => {
                            debugLog('VIEW_FILES', 'Download segment button clicked for path', filePath);
                            
                            if (!filePath) {
                                debugLog('VIEW_FILES', 'No file path found in button data attribute');
                                alert('Error: No file path found for this segment');
                                return;
                            }
                            
                            const fileName = filePath.split('/').pop();
                            debugLog('VIEW_FILES', 'Extracted filename', fileName);
                            
                            button.disabled = true;
                            button.textContent = 'Downloading...';
                            
                            try {
                                debugLog('VIEW_FILES', 'Fetching segment file', fileName);
                                const zipResponse = await fetch(`${API_BASE_URL}/download-project/${fileName}`);
                                
                                debugLog('VIEW_FILES', 'Fetch response', {
                                    status: zipResponse.status,
                                    statusText: zipResponse.statusText,
                                    headers: Array.from(zipResponse.headers.entries())
                                });
                                
                                if (!zipResponse.ok) {
                                    debugLog('VIEW_FILES', 'Failed to download segment', {
                                        status: zipResponse.status,
                                        statusText: zipResponse.statusText
                                    });
                                    throw new Error(`Failed to download segment: ${zipResponse.status} ${zipResponse.statusText}`);
                                }
                                
                                debugLog('VIEW_FILES', 'Segment file fetched successfully, creating blob');
                                const blob = await zipResponse.blob();
                                debugLog('VIEW_FILES', 'Blob created', {
                                    size: blob.size,
                                    type: blob.type
                                });
                                
                                const url = window.URL.createObjectURL(blob);
                                debugLog('VIEW_FILES', 'Created object URL', url);
                                
                                const a = document.createElement('a');
                                a.href = url;
                                a.download = fileName;
                                document.body.appendChild(a);
                                
                                debugLog('VIEW_FILES', 'Triggering download');
                                a.click();
                                document.body.removeChild(a);
                                window.URL.revokeObjectURL(url);
                                
                                debugLog('VIEW_FILES', 'Download complete');
                                button.textContent = 'Downloaded';
                                button.classList.add('success');
                            } catch (error) {
                                debugLog('VIEW_FILES', 'Error downloading segment', {
                                    message: error.message,
                                    stack: error.stack
                                });
                                button.textContent = 'Failed - Try Again';
                                button.disabled = false;
                                button.classList.add('error');
                                alert(`Download failed: ${error.message}`);
                            }
                        });
                    });
                    
                    // Add close handler
                    const closeButton = filesDialog.querySelector('.close-dialog');
                    debugLog('VIEW_FILES', 'Adding close button handler');
                    
                    closeButton.addEventListener('click', () => {
                        debugLog('VIEW_FILES', 'Close button clicked, removing dialog');
                        filesDialog.remove();
                    });
                    
                } catch (error) {
                    debugLog('VIEW_FILES', 'Error creating files dialog', {
                        message: error.message,
                        stack: error.stack
                    });
                    alert(`Error: ${error.message}`);
                }
            });
        } else {
            debugLog('JOB_CARD', 'View Files button not found in job card', {
                jobId: job.job_id,
                status: job.status,
                html: jobCard.innerHTML
            });
        }
        
        return jobCard;
    };
    
    debugLog('PATCH', 'Successfully patched createJobCard function');
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
