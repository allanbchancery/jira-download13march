// Constants
const API_BASE_URL = 'http://localhost:3000/api';
const STORAGE_KEY = 'jira_downloader_settings';

// DOM Elements
const connectionForm = document.getElementById('connectionForm');
const usernameInput = document.getElementById('username');
const apiKeyInput = document.getElementById('apiKey');
const connectBtn = document.getElementById('connectBtn');
const projectSelection = document.getElementById('projectSelection');
const projectList = document.querySelector('.project-list');
const downloadBtn = document.getElementById('downloadBtn');
const cancelBtn = document.getElementById('cancelBtn');
const downloadProgress = document.getElementById('downloadProgress');
const downloadSummary = document.getElementById('downloadSummary');
const downloadReportBtn = document.getElementById('downloadReportBtn');
const newDownloadBtn = document.getElementById('newDownloadBtn');
const downloadLocationSection = document.getElementById('downloadLocationSection');
const downloadPathInput = document.getElementById('downloadPath');
const validatePathBtn = document.getElementById('validatePathBtn');
const browseBtn = document.getElementById('browseBtn');
const directoryInput = document.getElementById('directoryInput');
const pathValidationResult = document.querySelector('.path-validation-result');
const pathOptions = document.querySelector('.path-options');

// State
let isConnected = false;
let isDownloading = false;
let shouldCancel = false;
let currentDownloadStats = {
    totalTickets: 0,
    totalComments: 0,
    totalAttachments: 0,
    failedProjects: []
};
let predefinedPaths = [];
let isDownloadPathValid = false;

// Load saved settings
function loadSavedSettings() {
    const savedSettings = localStorage.getItem(STORAGE_KEY);
    if (savedSettings) {
        const { username } = JSON.parse(savedSettings);
        usernameInput.value = username;
    }
}

// Save settings
function saveSettings() {
    const settings = {
        username: usernameInput.value
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
}

// Validate credentials format
function validateCredentials(username, apiKey) {
    const errors = [];
    
    if (!username) {
        errors.push('Username is required');
    } else if (!username.includes('@')) {
        errors.push('Username must be a valid email address');
    }
    
    if (!apiKey) {
        errors.push('API Key is required');
    } else if (apiKey.length < 8) {
        errors.push('API Key is invalid');
    }
    
    return errors;
}

// Show error message
function showError(message, container = connectionForm) {
    const existingError = container.querySelector('.error-message');
    if (existingError) {
        existingError.remove();
    }
    
    const errorDiv = document.createElement('div');
    errorDiv.className = 'error-message';
    errorDiv.innerHTML = `<i class="fas fa-exclamation-circle"></i>${message}`;
    container.insertBefore(errorDiv, container.firstChild);
}

// Show success message
function showSuccess(message, container = connectionForm) {
    const existingSuccess = container.querySelector('.success-message');
    if (existingSuccess) {
        existingSuccess.remove();
    }
    
    const successDiv = document.createElement('div');
    successDiv.className = 'success-message';
    successDiv.innerHTML = `<i class="fas fa-check-circle"></i>${message}`;
    container.insertBefore(successDiv, container.firstChild);
}

// Toggle password visibility
document.querySelector('.toggle-password').addEventListener('click', function() {
    const type = apiKeyInput.type === 'password' ? 'text' : 'password';
    apiKeyInput.type = type;
    this.innerHTML = `<i class="fas fa-eye${type === 'password' ? '' : '-slash'}"></i>`;
});

// Test connection to Jira
async function testConnection(username, apiKey) {
    try {
        const response = await fetch(`${API_BASE_URL}/test-connection`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ username, apiKey })
        });
        
        const data = await response.json();
        if (!data.success) {
            throw new Error(data.error || 'Invalid credentials');
        }
        
        return true;
    } catch (error) {
        throw new Error('Connection failed: ' + error.message);
    }
}

// Populate project list
function populateProjects(projects) {
    projectList.innerHTML = '';
    
    // Group projects by first letter of name or key
    const projectsByLetter = projects.reduce((acc, project) => {
        // Try to use project name first, fallback to key
        const displayName = project.name || project.key;
        const firstLetter = displayName.charAt(0).toUpperCase();
        if (!acc[firstLetter]) {
            acc[firstLetter] = [];
        }
        acc[firstLetter].push(project);
        return acc;
    }, {});

    // Sort letters and create sections
    Object.keys(projectsByLetter).sort().forEach(letter => {
        // Create section for this letter
        const section = document.createElement('div');
        section.className = 'project-section';
        section.id = `section-${letter}`;
        
        // Add letter heading
        const heading = document.createElement('h3');
        heading.textContent = letter;
        section.appendChild(heading);
        
        // Add projects for this letter
        projectsByLetter[letter].sort((a, b) => {
            const aName = a.name || a.key;
            const bName = b.name || b.key;
            return aName.localeCompare(bName);
        }).forEach(project => {
            const projectItem = document.createElement('div');
            projectItem.className = 'project-item';
            const displayName = project.name || project.key;
            projectItem.innerHTML = `
                <input type="checkbox" id="${project.key}" value="${project.key}">
                <label for="${project.key}">${displayName} (${project.key})</label>
            `;
            section.appendChild(projectItem);
        });
        
        projectList.appendChild(section);
    });
    
    // Enable download button and show download options when at least one project is selected
    const checkboxes = projectList.querySelectorAll('input[type="checkbox"]');
    const downloadOptions = document.querySelector('.download-options');
    checkboxes.forEach(checkbox => {
        checkbox.addEventListener('change', () => {
            const anyChecked = Array.from(checkboxes).some(cb => cb.checked);
            downloadBtn.disabled = !anyChecked;
            downloadOptions.style.display = anyChecked ? 'block' : 'none';
        });
    });
    // Initially hide download options
    downloadOptions.style.display = 'none';

    // Update active letter in navigation based on scroll position
    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                const letter = entry.target.id.split('-')[1];
                document.querySelectorAll('.letter-links a').forEach(link => {
                    link.classList.toggle('active', link.getAttribute('href') === `#section-${letter}`);
                });
            }
        });
    }, { threshold: 0.5 });

    // Observe each section
    document.querySelectorAll('.project-section').forEach(section => {
        observer.observe(section);
    });

    // Show/hide letters based on available sections
    document.querySelectorAll('.letter-links a').forEach(link => {
        const letter = link.getAttribute('href').split('-')[1];
        link.style.display = projectsByLetter[letter] ? 'flex' : 'none';
    });
}

// Update progress bar
function updateProgress(projectKey, progress, message) {
    const projectProgress = downloadProgress.querySelector(`[data-project="${projectKey}"]`);
    if (projectProgress) {
        const progressBar = projectProgress.querySelector('.progress-fill');
        const progressText = projectProgress.querySelector('.progress-text');
        progressBar.style.width = `${progress}%`;
        progressText.textContent = `${progress}% - ${message}`;
    }
}

// Generate download report
function generateReport() {
    const report = {
        timestamp: new Date().toISOString(),
        statistics: currentDownloadStats,
        projects: Array.from(projectList.querySelectorAll('input[type="checkbox"]:checked'))
            .map(cb => cb.value)
    };
    
    const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `jira-download-report-${new Date().toISOString()}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

// Handle form submission
connectionForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const username = usernameInput.value.trim();
    const apiKey = apiKeyInput.value.trim();
    
    // Validate credentials format
    const errors = validateCredentials(username, apiKey);
    if (errors.length > 0) {
        showError(errors.join('<br>'));
        return;
    }
    
    // Show loading state
    connectBtn.disabled = true;
    const btnText = connectBtn.querySelector('.btn-text');
    const spinner = connectBtn.querySelector('.spinner');
    btnText.textContent = 'Connecting...';
    spinner.classList.remove('hidden');
    
    try {
        // Test connection
        await testConnection(username, apiKey);
        
        // Connection successful
        showSuccess('Connected successfully!');
        saveSettings();
        isConnected = true;
        
        // Show project selection
        projectSelection.classList.remove('hidden');
        
        // Get and populate projects
        const projectsResponse = await fetch(`${API_BASE_URL}/get-projects`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ username, apiKey })
        });
        
        const projectsData = await projectsResponse.json();
        if (!projectsData.success) {
            throw new Error('Failed to fetch projects');
        }
        
        populateProjects(projectsData.projects);
        
    } catch (error) {
        showError(error.message);
    } finally {
        // Reset button state
        connectBtn.disabled = false;
        btnText.textContent = 'Connect';
        spinner.classList.add('hidden');
    }
});

// Handle download
downloadBtn.addEventListener('click', async () => {
    const selectedProjects = Array.from(projectList.querySelectorAll('input[type="checkbox"]:checked'))
        .map(cb => cb.value);
    
    if (selectedProjects.length === 0) {
        showError('Please select at least one project', projectSelection);
        return;
    }
    
    // Get download mode
    const downloadMode = document.querySelector('input[name="downloadMode"]:checked').value;
    
    // Handle background download
    if (downloadMode === 'background') {
        // Validate download path if provided
        if (downloadPathInput.value.trim() && !isDownloadPathValid) {
            showError('Please validate the download path first', downloadLocationSection);
            return;
        }
        
        // Show loading state
        downloadBtn.disabled = true;
        const btnText = downloadBtn.querySelector('.btn-text');
        const spinner = downloadBtn.querySelector('.spinner');
        btnText.textContent = 'Submitting...';
        spinner.classList.remove('hidden');
        
        try {
            // Submit background jobs for each selected project
            const jobs = [];
            for (const project of selectedProjects) {
                const job = await submitBackgroundDownloadJob(project);
                jobs.push(job);
            }
            
            // Show success message
            showSuccess(`${jobs.length} background download jobs submitted successfully`, projectSelection);
            
            // Update jobs dashboard
            await updateJobsDashboard();
            
            // Scroll to jobs dashboard
            const jobsDashboard = document.querySelector('.jobs-dashboard');
            if (jobsDashboard) {
                jobsDashboard.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }
        } catch (error) {
            showError(error.message, projectSelection);
        } finally {
            // Reset button state
            downloadBtn.disabled = false;
            btnText.textContent = 'Download Selected';
            spinner.classList.add('hidden');
        }
        
        return;
    }
    
    // Handle foreground download (original implementation)
    // Reset state
    shouldCancel = false;
    isDownloading = true;
    currentDownloadStats = {
        totalTickets: 0,
        totalComments: 0,
        totalAttachments: 0,
        failedProjects: []
    };
    
    // Show progress UI
    downloadProgress.classList.remove('hidden');
    cancelBtn.classList.remove('hidden');
    downloadBtn.disabled = true;
    
    // Create progress bars for each project
    const progressList = downloadProgress.querySelector('.project-progress-list');
    progressList.innerHTML = '';
    selectedProjects.forEach(project => {
        const projectProgress = document.createElement('div');
        projectProgress.className = 'project-progress';
        projectProgress.dataset.project = project;
        projectProgress.innerHTML = `
            <div class="progress-label">${project}</div>
            <div class="progress-bar">
                <div class="progress-fill"></div>
            </div>
            <div class="progress-text">0% - Initializing...</div>
        `;
        progressList.appendChild(projectProgress);
    });
    
    try {
        // Download process
        for (const project of selectedProjects) {
            if (shouldCancel) break;
            
            try {
                // Get project progress element
                const projectProgress = downloadProgress.querySelector(`[data-project="${project}"]`);
                if (!projectProgress) {
                    throw new Error('Progress element not found');
                }

                // Create detailed progress section
                const progressDetails = document.createElement('div');
                progressDetails.className = 'progress-details';
                progressDetails.innerHTML = `
                    <div class="progress-stats">
                        <div>Tickets: <span class="ticket-count">0</span></div>
                        <div>Size: <span class="download-size">0 MB</span></div>
                        <div>Stage: <span class="current-stage">Initializing...</span></div>
                    </div>
                    <div class="time-stats">
                        <div>Time Elapsed: <span class="time-elapsed">0s</span></div>
                        <div>Remaining: <span class="time-remaining">Calculating...</span></div>
                    </div>
                    <div class="operation-details">
                        <div class="current-operation">
                            <span class="operation-text">Preparing download...</span>
                        </div>
                        <div class="operation-status">
                            <span class="status-text"></span>
                        </div>
                    </div>
                `;
                projectProgress.appendChild(progressDetails);

                // Get selected options
                const downloadType = document.querySelector('input[name="downloadType"]:checked').value;
                const fileFormat = document.querySelector('input[name="fileFormat"]:checked').value;
                
                // Set up event source for progress updates
                const eventSource = new EventSource(`${API_BASE_URL}/download-tickets?username=${encodeURIComponent(usernameInput.value)}&apiKey=${encodeURIComponent(apiKeyInput.value)}&projectKey=${encodeURIComponent(project)}&downloadType=${downloadType}&fileFormat=${fileFormat}`);

                
                eventSource.onmessage = (event) => {
                    const data = JSON.parse(event.data);
                    
                    if (data.success !== undefined) {
                        // Final response
                        eventSource.close();
                        if (!data.success) {
                            throw new Error(data.error);
                        }
                        
                        // Handle tickets-only download
                        if (data.data.downloadType === 'tickets') {
                            const downloadUrl = `/api/download-project/${data.data.fileName}`;
                            window.location.href = downloadUrl;
                        }
                        
                        return data;
                    }
                    
                    // Update progress UI
                    const stats = progressDetails.querySelector('.progress-stats');
                    const operation = progressDetails.querySelector('.operation-text');
                    
                    // Update stats
                    stats.querySelector('.ticket-count').textContent = `${data.currentIssue} / ${data.totalIssues}`;
                    stats.querySelector('.download-size').textContent = data.downloadedSize;
                    stats.querySelector('.current-stage').textContent = data.stage;
                    
                    // Update time information
                    const timeStats = progressDetails.querySelector('.time-stats');
                    timeStats.querySelector('.time-elapsed').textContent = data.timeElapsed;
                    timeStats.querySelector('.time-remaining').textContent = data.estimatedTimeRemaining;
                    
                    // Update operation details
                    const operationDetails = progressDetails.querySelector('.operation-details');
                    operationDetails.querySelector('.operation-text').textContent = data.currentOperation;
                    operationDetails.querySelector('.status-text').textContent = data.operationDetails;
                    
                    // Update message
                    operation.textContent = data.message;
                    
                    // Calculate overall progress
                    let progress = 0;
                    switch (data.stage) {
                        case 'init':
                            progress = 5;
                            break;
                        case 'fetching':
                            progress = 5 + (data.batchProgress * 0.3);
                            break;
                        case 'processing':
                            progress = 35 + ((data.currentIssue / data.totalIssues) * 55);
                            break;
                        case 'finalizing':
                            progress = 90;
                            break;
                        case 'complete':
                            progress = 100;
                            break;
                    }
                    
                    updateProgress(project, Math.round(progress), data.message);
                };
                
                eventSource.onerror = () => {
                    eventSource.close();
                    throw new Error('Download failed - connection lost');
                };
                
                // Wait for completion
                const data = await new Promise((resolve, reject) => {
                    eventSource.addEventListener('message', (event) => {
                        const data = JSON.parse(event.data);
                        if (data.success !== undefined) {
                            resolve(data);
                        }
                    });
                    eventSource.addEventListener('error', () => {
                        reject(new Error('Download failed - connection lost'));
                    });
                });
                
                // Update stats and show detailed progress
                currentDownloadStats.totalTickets += data.data.tickets ? data.data.tickets.length : 0;
                currentDownloadStats.totalComments += data.data.totalComments || 0;
                currentDownloadStats.totalAttachments += data.data.totalAttachments || 0;
                
                // Show download dialog
                updateProgress(project, 60, 'Preparing download...');
                
                // Create a temporary button for the download dialog
                const downloadDialog = document.createElement('div');
                downloadDialog.className = 'download-dialog';
                downloadDialog.innerHTML = `
                    <div class="download-dialog-content">
                        <h3>Download Ready</h3>
                        <p>Project: ${project}</p>
                        <p>Download Type: ${downloadType === 'all' ? 'Everything' : downloadType === 'tickets' ? 'Tickets Only' : 'Attachments Only'}</p>
                        <p>File Format: ${fileFormat.toUpperCase()}</p>
                        <p>Total Size: ${data.data.totalSize}</p>
                        <p>Contains:</p>
                        <ul>
                            <li>${data.data.tickets ? data.data.tickets.length : 0} tickets</li>
                            <li>${data.data.totalComments || 0} comments</li>
                            <li>${data.data.totalAttachments || 0} attachments</li>
                        </ul>
                        ${data.data.segments ? `
                            <div class="segments-info">
                                <p>Download split into ${data.data.totalSegments} segments (50MB each):</p>
                                <div class="segments-list">
                                    ${data.data.segmentDetails.map(segment => `
                                        <div class="segment-item">
                                            <div class="segment-header">
                                                <h4>Segment ${segment.number} of ${data.data.totalSegments}</h4>
                                                <p>Size: ${segment.size} (${segment.fileCount} files)</p>
                                            </div>
                                            <div class="segment-files">
                                                ${segment.files.map(file => `
                                                    <div class="file-info">
                                                        <span class="file-name">${file.name}</span>
                                                        <span class="file-details">
                                                            Ticket: ${file.ticket} | Size: ${file.size}
                                                            ${file.totalParts > 1 ? ` | Part ${file.part}/${file.totalParts}` : ''}
                                                        </span>
                                                    </div>
                                                `).join('')}
                                            </div>
                                            <button class="btn secondary download-segment" data-filename="${data.data.segments[segment.number - 1].fileName}">
                                                Download Segment ${segment.number}
                                            </button>
                                        </div>
                                    `).join('')}
                                </div>
                                <div class="segment-summary">
                                    <p>Total Size: ${data.data.totalSize}</p>
                                    <p>Total Files: ${data.data.totalAttachments}</p>
                                </div>
                            </div>
                        ` : `
                            <button class="btn primary download-start">Download Now</button>
                        `}
                    </div>
                `;
                document.body.appendChild(downloadDialog);
                
                // Handle segment downloads
                if (data.data.segments) {
                    // Add click handlers for segment downloads
                    const downloadSegments = downloadDialog.querySelectorAll('.download-segment');
                    downloadSegments.forEach(button => {
                        button.addEventListener('click', async () => {
                            const filename = button.dataset.filename;
                            button.disabled = true;
                            button.textContent = 'Downloading...';
                            
                            try {
                                const zipResponse = await fetch(`${API_BASE_URL}/download-project/${filename}`);
                                if (!zipResponse.ok) {
                                    throw new Error('Failed to download segment');
                                }
                                
                                const blob = await zipResponse.blob();
                                const url = window.URL.createObjectURL(blob);
                                const a = document.createElement('a');
                                a.href = url;
                                a.download = filename;
                                document.body.appendChild(a);
                                a.click();
                                document.body.removeChild(a);
                                window.URL.revokeObjectURL(url);
                                
                                button.textContent = 'Downloaded';
                                button.classList.add('success');
                            } catch (error) {
                                button.textContent = 'Failed - Try Again';
                                button.disabled = false;
                                button.classList.add('error');
                            }
                        });
                    });

                    // Wait for user to close dialog
                    await new Promise(resolve => {
                        const closeBtn = document.createElement('button');
                        closeBtn.className = 'btn primary';
                        closeBtn.textContent = 'Close';
                        closeBtn.style.marginTop = '20px';
                        closeBtn.addEventListener('click', () => {
                            downloadDialog.remove();
                            resolve();
                        });
                        downloadDialog.querySelector('.download-dialog-content').appendChild(closeBtn);
                    });
                } else {
                    // Single file download
                    await new Promise(resolve => {
                        downloadDialog.querySelector('.download-start').addEventListener('click', () => {
                            downloadDialog.remove();
                            resolve();
                        });
                    });
                    
                    updateProgress(project, 80, 'Downloading project archive...');
                    
                    try {
                        const zipResponse = await fetch(`${API_BASE_URL}/download-project/${data.data.zipFile}`);
                        if (!zipResponse.ok) {
                            throw new Error('Failed to download project archive');
                        }
                        
                        const blob = await zipResponse.blob();
                        const url = window.URL.createObjectURL(blob);
                        const a = document.createElement('a');
                        a.href = url;
                        a.download = data.data.zipFile;
                        document.body.appendChild(a);
                        a.click();
                        document.body.removeChild(a);
                        window.URL.revokeObjectURL(url);
                    } catch (error) {
                        throw new Error('Failed to download archive: ' + error.message);
                    }
                    updateProgress(project, 100, 'Download complete');
                }
            } catch (error) {
                currentDownloadStats.failedProjects.push(project);
                updateProgress(project, 100, 'Failed - ' + error.message);
            }
        }
    } finally {
        // Show summary
        downloadSummary.classList.remove('hidden');
        const summaryStats = downloadSummary.querySelector('.summary-stats');
        summaryStats.innerHTML = `
            <p>Downloaded:</p>
            <ul>
                <li>${currentDownloadStats.totalTickets} tickets</li>
                <li>${currentDownloadStats.totalComments} comments</li>
                <li>${currentDownloadStats.totalAttachments} attachments</li>
            </ul>
            ${currentDownloadStats.failedProjects.length > 0 ? `
                <p>Failed projects:</p>
                <ul>
                    ${currentDownloadStats.failedProjects.map(p => `<li>${p}</li>`).join('')}
                </ul>
            ` : ''}
        `;
        
        // Reset UI
        isDownloading = false;
        cancelBtn.classList.add('hidden');
        downloadBtn.disabled = false;
    }
});

// Handle cancel
cancelBtn.addEventListener('click', () => {
    shouldCancel = true;
    cancelBtn.disabled = true;
    cancelBtn.textContent = 'Canceling...';
});

// Handle new download
newDownloadBtn.addEventListener('click', () => {
    downloadProgress.classList.add('hidden');
    downloadSummary.classList.add('hidden');
    const checkboxes = projectList.querySelectorAll('input[type="checkbox"]');
    checkboxes.forEach(cb => cb.checked = false);
    downloadBtn.disabled = true;
});

// Handle download report
downloadReportBtn.addEventListener('click', generateReport);

// Simulate download process
async function simulateDownload(project, message, startProgress, endProgress) {
    const duration = Math.random() * 2000 + 1000; // 1-3 seconds
    const startTime = Date.now();
    
    while (Date.now() - startTime < duration) {
        if (shouldCancel) {
            throw new Error('Download canceled');
        }
        
        const progress = startProgress + ((Date.now() - startTime) / duration) * (endProgress - startProgress);
        updateProgress(project, Math.round(progress), message);
        await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    updateProgress(project, endProgress, message);
}

// Quick Navigation Button functionality
const quickNavBtn = document.getElementById('quickNavBtn');
const downloadOptions = document.querySelector('.download-options');

// Show/hide quick nav button based on project selection
function updateQuickNavButton() {
    const anyChecked = Array.from(projectList.querySelectorAll('input[type="checkbox"]')).some(cb => cb.checked);
    if (anyChecked) {
        quickNavBtn.classList.add('visible');
    } else {
        quickNavBtn.classList.remove('visible');
    }
}

// Handle quick nav button click
quickNavBtn.addEventListener('click', () => {
    downloadOptions.scrollIntoView({ behavior: 'smooth', block: 'start' });
});

// Update quick nav button visibility when checkboxes change
projectList.addEventListener('change', (e) => {
    if (e.target.type === 'checkbox') {
        updateQuickNavButton();
    }
});

// Fetch predefined download paths
async function fetchPredefinedPaths() {
    try {
        const response = await fetch(`${API_BASE_URL}/validate-download-path`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ path: '' }) // Empty path to get defaults
        });
        
        const data = await response.json();
        if (data.success && data.validation && data.validation.predefinedPaths) {
            predefinedPaths = data.validation.predefinedPaths;
            populatePredefinedPaths();
        }
    } catch (error) {
        console.error('Failed to fetch predefined paths:', error);
    }
}

// Populate predefined paths UI
function populatePredefinedPaths() {
    pathOptions.innerHTML = '';
    
    predefinedPaths.forEach(path => {
        const pathOption = document.createElement('div');
        pathOption.className = 'path-option';
        pathOption.textContent = path.label || path.path;
        pathOption.dataset.path = path.path;
        pathOption.addEventListener('click', () => {
            downloadPathInput.value = path.path;
            document.querySelectorAll('.path-option').forEach(opt => {
                opt.classList.remove('selected');
            });
            pathOption.classList.add('selected');
            validateDownloadPath();
        });
        pathOptions.appendChild(pathOption);
    });
}

// Validate download path
async function validateDownloadPath() {
    const path = downloadPathInput.value.trim();
    if (!path) {
        pathValidationResult.innerHTML = '';
        pathValidationResult.className = 'path-validation-result';
        isDownloadPathValid = false;
        return;
    }
    
    try {
        const response = await fetch(`${API_BASE_URL}/validate-download-path`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ path })
        });
        
        const data = await response.json();
        if (data.success && data.validation) {
            if (data.validation.valid) {
                pathValidationResult.innerHTML = `<i class="fas fa-check-circle"></i> Valid path (${data.validation.availableSpace} available)`;
                pathValidationResult.className = 'path-validation-result valid';
                isDownloadPathValid = true;
            } else {
                pathValidationResult.innerHTML = `<i class="fas fa-exclamation-circle"></i> ${data.validation.error}`;
                pathValidationResult.className = 'path-validation-result invalid';
                isDownloadPathValid = false;
            }
        } else {
            throw new Error(data.error || 'Failed to validate path');
        }
    } catch (error) {
        pathValidationResult.innerHTML = `<i class="fas fa-exclamation-circle"></i> ${error.message}`;
        pathValidationResult.className = 'path-validation-result invalid';
        isDownloadPathValid = false;
    }
}

// Submit background download job
async function submitBackgroundDownloadJob(projectKey) {
    const username = usernameInput.value.trim();
    const apiKey = apiKeyInput.value.trim();
    const downloadType = document.querySelector('input[name="downloadType"]:checked').value;
    const fileFormat = document.querySelector('input[name="fileFormat"]:checked').value;
    const downloadPath = downloadPathInput.value.trim();
    
    try {
        const response = await fetch(`${API_BASE_URL}/submit-download-job`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                username,
                apiKey,
                projectKey,
                downloadType,
                fileFormat,
                downloadPath: isDownloadPathValid ? downloadPath : undefined
            })
        });
        
        const data = await response.json();
        if (!data.success) {
            throw new Error(data.error || 'Failed to submit download job');
        }
        
        return data.job;
    } catch (error) {
        throw new Error(`Failed to submit background job: ${error.message}`);
    }
}

// Fetch download jobs
async function fetchDownloadJobs() {
    try {
        const response = await fetch(`${API_BASE_URL}/download-jobs`);
        const data = await response.json();
        
        if (!data.success) {
            throw new Error(data.error || 'Failed to fetch download jobs');
        }
        
        return data.jobs;
    } catch (error) {
        console.error('Failed to fetch download jobs:', error);
        return [];
    }
}

// Get job status
async function getJobStatus(jobId) {
    try {
        const response = await fetch(`${API_BASE_URL}/download-job/${jobId}`);
        const data = await response.json();
        
        if (!data.success) {
            throw new Error(data.error || 'Failed to get job status');
        }
        
        return data.job;
    } catch (error) {
        console.error(`Failed to get job status for ${jobId}:`, error);
        return null;
    }
}

// Cancel download job
async function cancelDownloadJob(jobId) {
    try {
        const response = await fetch(`${API_BASE_URL}/cancel-download-job/${jobId}`, {
            method: 'POST'
        });
        
        const data = await response.json();
        if (!data.success) {
            throw new Error(data.error || 'Failed to cancel job');
        }
        
        return true;
    } catch (error) {
        console.error(`Failed to cancel job ${jobId}:`, error);
        return false;
    }
}

// Create jobs dashboard
function createJobsDashboard() {
    // Create dashboard container if it doesn't exist
    let jobsDashboard = document.querySelector('.jobs-dashboard');
    if (!jobsDashboard) {
        jobsDashboard = document.createElement('div');
        jobsDashboard.className = 'jobs-dashboard';
        jobsDashboard.innerHTML = `
            <h3>
                Background Downloads
                <button id="refreshJobsBtn" class="btn secondary">
                    <i class="fas fa-sync-alt"></i> Refresh
                </button>
            </h3>
            <div class="tabs-container">
                <div class="tabs-nav">
                    <div class="tab-item active" data-tab="active-jobs">Active Jobs</div>
                    <div class="tab-item" data-tab="completed-jobs">Completed Jobs</div>
                </div>
                <div class="tab-content active" id="active-jobs">
                    <div class="jobs-list active-jobs-list"></div>
                </div>
                <div class="tab-content" id="completed-jobs">
                    <div class="jobs-list completed-jobs-list"></div>
                </div>
            </div>
        `;
        
        // Add dashboard to the page
        downloadSummary.parentNode.insertBefore(jobsDashboard, downloadSummary);
        
        // Add tab switching functionality
        const tabItems = jobsDashboard.querySelectorAll('.tab-item');
        tabItems.forEach(tab => {
            tab.addEventListener('click', () => {
                tabItems.forEach(t => t.classList.remove('active'));
                tab.classList.add('active');
                
                const tabContents = jobsDashboard.querySelectorAll('.tab-content');
                tabContents.forEach(content => {
                    content.classList.remove('active');
                });
                
                const tabContent = document.getElementById(tab.dataset.tab);
                tabContent.classList.add('active');
            });
        });
        
        // Add refresh button functionality
        const refreshBtn = jobsDashboard.querySelector('#refreshJobsBtn');
        refreshBtn.addEventListener('click', () => {
            refreshBtn.disabled = true;
            refreshBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
            
            updateJobsDashboard().finally(() => {
                refreshBtn.disabled = false;
                refreshBtn.innerHTML = '<i class="fas fa-sync-alt"></i> Refresh';
            });
        });
    }
    
    return jobsDashboard;
}

// Update jobs dashboard
async function updateJobsDashboard() {
    const jobsDashboard = createJobsDashboard();
    const activeJobsList = jobsDashboard.querySelector('.active-jobs-list');
    const completedJobsList = jobsDashboard.querySelector('.completed-jobs-list');
    
    try {
        const jobs = await fetchDownloadJobs();
        
        // Clear existing jobs
        activeJobsList.innerHTML = '';
        completedJobsList.innerHTML = '';
        
        if (jobs.length === 0) {
            activeJobsList.innerHTML = `
                <div class="empty-state">
                    <i class="fas fa-inbox"></i>
                    <p>No active download jobs</p>
                </div>
            `;
            
            completedJobsList.innerHTML = `
                <div class="empty-state">
                    <i class="fas fa-inbox"></i>
                    <p>No completed download jobs</p>
                </div>
            `;
            return;
        }
        
        // Sort jobs by creation date (newest first)
        jobs.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
        
        // Split jobs into active and completed
        const activeJobs = jobs.filter(job => ['pending', 'processing'].includes(job.status));
        const completedJobs = jobs.filter(job => ['completed', 'failed', 'cancelled'].includes(job.status));
        
        // Populate active jobs
        if (activeJobs.length === 0) {
            activeJobsList.innerHTML = `
                <div class="empty-state">
                    <i class="fas fa-inbox"></i>
                    <p>No active download jobs</p>
                </div>
            `;
        } else {
            activeJobs.forEach(job => {
                const jobCard = createJobCard(job);
                activeJobsList.appendChild(jobCard);
            });
        }
        
        // Populate completed jobs
        if (completedJobs.length === 0) {
            completedJobsList.innerHTML = `
                <div class="empty-state">
                    <i class="fas fa-inbox"></i>
                    <p>No completed download jobs</p>
                </div>
            `;
        } else {
            completedJobs.forEach(job => {
                const jobCard = createJobCard(job);
                completedJobsList.appendChild(jobCard);
            });
        }
    } catch (error) {
        console.error('Failed to update jobs dashboard:', error);
    }
}

// Create job card
function createJobCard(job) {
    const jobCard = document.createElement('div');
    jobCard.className = 'job-card';
    jobCard.dataset.jobId = job.job_id;
    
    // Format dates
    const createdDate = new Date(job.created_at).toLocaleString();
    const updatedDate = new Date(job.updated_at).toLocaleString();
    const completedDate = job.completed_at ? new Date(job.completed_at).toLocaleString() : null;
    
    // Calculate duration
    let duration = 'In progress';
    if (job.completed_at) {
        const durationMs = new Date(job.completed_at) - new Date(job.created_at);
        const durationMin = Math.floor(durationMs / 60000);
        const durationSec = Math.floor((durationMs % 60000) / 1000);
        duration = `${durationMin}m ${durationSec}s`;
    }
    
    jobCard.innerHTML = `
        <div class="job-header">
            <div class="job-title">${job.project_key}</div>
            <div class="job-status ${job.status}">${job.status}</div>
        </div>
        <div class="job-details">
            <div class="job-detail">
                <div class="job-detail-label">Download Type</div>
                <div class="job-detail-value">${job.download_type === 'all' ? 'Everything' : job.download_type === 'tickets' ? 'Tickets Only' : 'Attachments Only'}</div>
            </div>
            <div class="job-detail">
                <div class="job-detail-label">Format</div>
                <div class="job-detail-value">${job.file_format.toUpperCase()}</div>
            </div>
            <div class="job-detail">
                <div class="job-detail-label">Created</div>
                <div class="job-detail-value">${createdDate}</div>
            </div>
            <div class="job-detail">
                <div class="job-detail-label">Duration</div>
                <div class="job-detail-value">${duration}</div>
            </div>
        </div>
        ${job.status === 'processing' ? `
            <div class="job-progress">
                <div class="progress-bar">
                    <div class="progress-fill" style="width: 50%"></div>
                </div>
                <div class="progress-text">Processing...</div>
            </div>
        ` : ''}
        ${job.error ? `
            <div class="error-message">
                <i class="fas fa-exclamation-circle"></i>
                ${job.error}
            </div>
        ` : ''}
        ${job.segments && job.segments.length > 0 ? `
            <div class="job-segments">
                <h4>Download Segments (${job.segments.length})</h4>
                <div class="segment-list">
                    ${job.segments.map(segment => `
                        <div class="segment-card ${segment.status}">
                            <div class="segment-card-title">Segment ${segment.segment_number}</div>
                            <div class="segment-card-info">${segment.file_count} files</div>
                            <div class="segment-card-info">${(segment.size_bytes / (1024 * 1024)).toFixed(1)} MB</div>
                        </div>
                    `).join('')}
                </div>
            </div>
        ` : ''}
        <div class="job-actions">
            ${job.status === 'pending' ? `
                <button class="btn secondary cancel-job-btn">Cancel</button>
            ` : ''}
            ${job.status === 'completed' ? `
                <button class="btn secondary view-files-btn">View Files</button>
            ` : ''}
        </div>
    `;
    
    // Add event listeners
    if (job.status === 'pending') {
        const cancelBtn = jobCard.querySelector('.cancel-job-btn');
        cancelBtn.addEventListener('click', async () => {
            cancelBtn.disabled = true;
            cancelBtn.textContent = 'Cancelling...';
            
            try {
                const success = await cancelDownloadJob(job.job_id);
                if (success) {
                    jobCard.querySelector('.job-status').textContent = 'cancelled';
                    jobCard.querySelector('.job-status').className = 'job-status cancelled';
                    cancelBtn.remove();
                } else {
                    throw new Error('Failed to cancel job');
                }
            } catch (error) {
                cancelBtn.textContent = 'Cancel';
                cancelBtn.disabled = false;
                alert(`Error: ${error.message}`);
            }
        });
    }
    
    // Add View Files button handler for completed jobs
    if (job.status === 'completed') {
        const viewFilesBtn = jobCard.querySelector('.view-files-btn');
        
        if (viewFilesBtn) {
            console.log('Adding View Files button handler for job:', job.job_id);
            console.log('Job segments:', job.segments);
            
            viewFilesBtn.addEventListener('click', () => {
                console.log('View Files button clicked for job:', job.job_id);
                
                try {
                    // Check if segments exist
                    if (!job.segments || !Array.isArray(job.segments)) {
                        console.error('No segments found for job:', job.job_id);
                        alert('No download segments found for this job. Please try refreshing the page.');
                        return;
                    }
                    
                    if (job.segments.length === 0) {
                        console.error('Empty segments array for job:', job.job_id);
                        alert('No download segments available for this job.');
                        return;
                    }
                    
                    console.log('Creating files dialog with segments:', job.segments);
                    
                    // Show files dialog
                    const filesDialog = document.createElement('div');
                    filesDialog.className = 'download-dialog';
                    filesDialog.innerHTML = `
                        <div class="download-dialog-content">
                            <h3>Download Files</h3>
                            <p>Project: ${job.project_key}</p>
                            <div class="segments-list">
                                ${job.segments.map(segment => `
                                    <div class="segment-item">
                                        <div class="segment-header">
                                            <h4>Segment ${segment.segment_number} of ${segment.total_segments}</h4>
                                            <p>Size: ${(segment.size_bytes / (1024 * 1024)).toFixed(1)} MB (${segment.file_count} files)</p>
                                        </div>
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
                    
                    console.log('Files dialog created and added to DOM');
                    
                    // Add download handlers
                    const downloadButtons = filesDialog.querySelectorAll('.download-segment');
                    console.log('Found download buttons:', downloadButtons.length);
                    
                    downloadButtons.forEach(button => {
                        const filePath = button.dataset.path;
                        console.log('Adding click handler for segment with path:', filePath);
                        
                        button.addEventListener('click', async () => {
                            console.log('Download segment button clicked for path:', filePath);
                            
                            if (!filePath) {
                                console.error('No file path found in button data attribute');
                                alert('Error: No file path found for this segment');
                                return;
                            }
                            
                            const fileName = filePath.split('/').pop();
                            console.log('Extracted filename:', fileName);
                            
                            button.disabled = true;
                            button.textContent = 'Downloading...';
                            
                            try {
                                console.log('Fetching segment file:', fileName);
                                const zipResponse = await fetch(`${API_BASE_URL}/download-project/${fileName}`);
                                
                                if (!zipResponse.ok) {
                                    console.error('Failed to download segment:', zipResponse.status, zipResponse.statusText);
                                    throw new Error(`Failed to download segment: ${zipResponse.status} ${zipResponse.statusText}`);
                                }
                                
                                console.log('Segment file fetched successfully, creating blob');
                                const blob = await zipResponse.blob();
                                const url = window.URL.createObjectURL(blob);
                                
                                console.log('Creating download link for blob URL:', url);
                                const a = document.createElement('a');
                                a.href = url;
                                a.download = fileName;
                                document.body.appendChild(a);
                                
                                console.log('Triggering download');
                                a.click();
                                document.body.removeChild(a);
                                window.URL.revokeObjectURL(url);
                                
                                console.log('Download complete');
                                button.textContent = 'Downloaded';
                                button.classList.add('success');
                            } catch (error) {
                                console.error('Error downloading segment:', error);
                                button.textContent = 'Failed - Try Again';
                                button.disabled = false;
                                button.classList.add('error');
                                alert(`Download failed: ${error.message}`);
                            }
                        });
                    });
                    
                    // Add close handler
                    const closeButton = filesDialog.querySelector('.close-dialog');
                    console.log('Adding close button handler');
                    
                    closeButton.addEventListener('click', () => {
                        console.log('Close button clicked, removing dialog');
                        filesDialog.remove();
                    });
                    
                } catch (error) {
                    console.error('Error creating files dialog:', error);
                    alert(`Error: ${error.message}`);
                }
            });
        } else {
            console.error('View Files button not found in job card for job:', job.job_id);
        }
    }
    
    return jobCard;
}

// Toggle download mode
function toggleDownloadMode() {
    const downloadMode = document.querySelector('input[name="downloadMode"]:checked').value;
    downloadLocationSection.style.display = downloadMode === 'background' ? 'block' : 'none';
}

// Event listeners for download mode and path validation
document.querySelectorAll('input[name="downloadMode"]').forEach(radio => {
    radio.addEventListener('change', toggleDownloadMode);
});

validatePathBtn.addEventListener('click', validateDownloadPath);
downloadPathInput.addEventListener('blur', validateDownloadPath);

// Handle browse button click
browseBtn.addEventListener('click', () => {
    // Trigger the hidden file input
    directoryInput.click();
});

// Handle directory selection
directoryInput.addEventListener('change', (event) => {
    if (event.target.files.length > 0) {
        // Get the directory path from the first file
        const file = event.target.files[0];
        const filePath = file.webkitRelativePath;
        
        // Extract the directory path (remove the filename part)
        const directoryPath = filePath.split('/')[0];
        
        if (directoryPath) {
            // Set the directory path in the input field
            const fullPath = `/Users/${directoryPath}`;
            downloadPathInput.value = fullPath;
            
            // Validate the path
            validateDownloadPath();
        }
    }
});

// Initialize
loadSavedSettings();
fetchPredefinedPaths();
toggleDownloadMode();

// Set up periodic job status updates
setInterval(updateJobsDashboard, 10000); // Update every 10 seconds
