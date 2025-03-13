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
    projects.forEach(project => {
        const projectItem = document.createElement('div');
        projectItem.className = 'project-item';
        projectItem.innerHTML = `
            <input type="checkbox" id="${project.key}" value="${project.key}">
            <label for="${project.key}">${project.name} (${project.key})</label>
        `;
        projectList.appendChild(projectItem);
    });
    
    // Enable download button when at least one project is selected
    const checkboxes = projectList.querySelectorAll('input[type="checkbox"]');
    checkboxes.forEach(checkbox => {
        checkbox.addEventListener('change', () => {
            const anyChecked = Array.from(checkboxes).some(cb => cb.checked);
            downloadBtn.disabled = !anyChecked;
        });
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
                    <div class="current-operation">
                        <span class="operation-text">Preparing download...</span>
                    </div>
                `;
                projectProgress.appendChild(progressDetails);

                // Set up event source for progress updates
                const eventSource = new EventSource(`${API_BASE_URL}/download-tickets?username=${encodeURIComponent(usernameInput.value)}&apiKey=${encodeURIComponent(apiKeyInput.value)}&projectKey=${encodeURIComponent(project)}`);

                
                eventSource.onmessage = (event) => {
                    const data = JSON.parse(event.data);
                    
                    if (data.success !== undefined) {
                        // Final response
                        eventSource.close();
                        if (!data.success) {
                            throw new Error(data.error);
                        }
                        return data;
                    }
                    
                    // Update progress UI
                    const stats = progressDetails.querySelector('.progress-stats');
                    const operation = progressDetails.querySelector('.operation-text');
                    
                    stats.querySelector('.ticket-count').textContent = `${data.currentIssue} / ${data.totalIssues}`;
                    stats.querySelector('.download-size').textContent = data.downloadedSize;
                    stats.querySelector('.current-stage').textContent = data.stage;
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
                currentDownloadStats.totalTickets += data.data.tickets.length;
                currentDownloadStats.totalComments += data.data.totalComments;
                currentDownloadStats.totalAttachments += data.data.totalAttachments;
                
                // Show download dialog
                updateProgress(project, 60, 'Preparing download...');
                
                // Create a temporary button for the download dialog
                const downloadDialog = document.createElement('div');
                downloadDialog.className = 'download-dialog';
                downloadDialog.innerHTML = `
                    <div class="download-dialog-content">
                        <h3>Download Location</h3>
                        <p>Project: ${project}</p>
                        <p>Contains:</p>
                        <ul>
                            <li>${data.data.tickets.length} tickets</li>
                            <li>${data.data.totalComments} comments</li>
                            <li>${data.data.totalAttachments} attachments</li>
                        </ul>
                        <button class="btn primary download-start">Download Now</button>
                    </div>
                `;
                document.body.appendChild(downloadDialog);
                
                // Wait for user to click download
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

// Initialize
loadSavedSettings();
