const express = require('express');
const cors = require('cors');
const axios = require('axios');
const dotenv = require('dotenv');
const path = require('path');
const AdmZip = require('adm-zip');
const fs = require('fs');

// Load environment variables
dotenv.config();

const app = express();
const port = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname)));

// Utility function to create Jira API headers
const createJiraHeaders = (auth) => ({
    'Authorization': `Basic ${auth}`,
    'Accept': 'application/json',
    'Content-Type': 'application/json'
});

// Utility function to convert ticket data to CSV
function convertToCSV(tickets) {
    // Define CSV headers
    const headers = [
        'Key',
        'Summary',
        'Description',
        'Comment Count',
        'Attachment Count',
        'Comments',
        'Attachments'
    ];

    // Convert tickets to CSV rows
    const rows = tickets.map(ticket => [
        ticket.key,
        `"${(ticket.summary || '').replace(/"/g, '""')}"`,
        `"${(ticket.description || '').replace(/"/g, '""')}"`,
        ticket.comments.length,
        ticket.attachments.length,
        `"${ticket.comments.map(c => c.body.replace(/"/g, '""')).join('\\n')}"`,
        ticket.attachments.map(a => a.filename).join(', ')
    ]);

    // Combine headers and rows
    return [headers, ...rows].map(row => row.join(',')).join('\n');
}

// Test connection endpoint
app.post('/api/test-connection', async (req, res) => {
    const { username, apiKey } = req.body;
    const auth = Buffer.from(`${username}:${apiKey}`).toString('base64');
    
    try {
        const response = await axios.get('https://thehut.atlassian.net/rest/api/2/myself', {
            headers: createJiraHeaders(auth)
        });
        res.json({ success: true, user: response.data });
    } catch (error) {
        res.status(401).json({
            success: false,
            error: 'Failed to authenticate with Jira'
        });
    }
});

// Get projects endpoint
app.post('/api/get-projects', async (req, res) => {
    const { username, apiKey } = req.body;
    const auth = Buffer.from(`${username}:${apiKey}`).toString('base64');
    
    try {
        const response = await axios.get('https://thehut.atlassian.net/rest/api/2/project', {
            headers: createJiraHeaders(auth)
        });
        res.json({ success: true, projects: response.data });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: 'Failed to fetch projects'
        });
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

    try {
        // Set headers for SSE
        res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive'
        });

        // Helper function to send SSE
        const sendProgress = (data) => {
            res.write(`data: ${JSON.stringify(data)}\n\n`);
        };
    
        // Get project info and total number of issues
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

        const projectInfo = projectResponse.data;
        const totalIssues = countResponse.data.total;
        const batchSize = 100;
        const issues = [];
        const startTime = Date.now();
        const progress = {
            stage: 'init',
            message: 'Initializing download...',
            totalIssues,
            currentIssue: 0,
            batchProgress: 0,
            totalBatches: Math.ceil(totalIssues / batchSize),
            currentBatch: 0,
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
            
            if (progress.currentIssue > 0) {
                const issuesPerSecond = progress.currentIssue / elapsed;
                const remainingIssues = totalIssues - progress.currentIssue;
                const estimatedSeconds = Math.floor(remainingIssues / issuesPerSecond);
                progress.estimatedTimeRemaining = `${estimatedSeconds}s`;
            }
        };

        // Send initial progress
        sendProgress(progress);

        // Fetch all issues in batches
        for (let startAt = 0; startAt < totalIssues; startAt += batchSize) {
            progress.stage = 'fetching';
            progress.currentBatch++;
            progress.currentOperation = 'Fetching tickets';
            progress.operationDetails = `Batch ${progress.currentBatch} of ${progress.totalBatches}`;
            progress.message = `Fetching tickets ${startAt + 1} to ${Math.min(startAt + batchSize, totalIssues)} of ${totalIssues}...`;
            updateTimeEstimates();
            sendProgress(progress);

            const response = await axios.post('https://thehut.atlassian.net/rest/api/2/search', {
                jql,
                startAt,
                maxResults: batchSize,
                fields: ['summary', 'description', 'comment', 'attachment'],
                expand: ['comments']  // Ensure we get all comments
            }, {
                headers: createJiraHeaders(auth)
            });

            issues.push(...response.data.issues);
            progress.currentIssue = issues.length;
            progress.batchProgress = (issues.length / totalIssues) * 100;
            sendProgress(progress);
        }

        const downloadData = {
            projectInfo,
            tickets: [],
            totalComments: 0,
            totalAttachments: 0,
            estimatedSize: '0 MB'
        };

        // Create a zip file for the project
        const zip = new AdmZip();
        const projectDir = `${projectKey}`;

        // Create a JSON file with ticket data
        const ticketsData = [];

        // Process each issue and estimate total size
        progress.stage = 'processing';
        let totalEstimatedBytes = 0;
        
        for (const [index, issue] of issues.entries()) {
            progress.currentOperation = 'Processing tickets';
            progress.operationDetails = `Ticket ${index + 1} of ${issues.length}`;
            progress.message = `Processing ticket ${index + 1} of ${issues.length}...`;
            updateTimeEstimates();
            progress.currentIssue = index + 1;
            res.write(`data: ${JSON.stringify(progress)}\n\n`);
            
            const ticket = {
                key: issue.key,
                summary: issue.fields.summary,
                description: issue.fields.description,
                comments: [],
                attachments: []
            };

            // Get comments if not attachments-only mode
            if (downloadType !== 'attachments' && issue.fields.comment) {
                ticket.comments = issue.fields.comment.comments;
                downloadData.totalComments += ticket.comments.length;
            }

            // Get attachments if not tickets-only mode
            if (downloadType !== 'tickets' && issue.fields.attachment) {
                for (const attachment of issue.fields.attachment) {
                    try {
                        // Add attachment size to total estimate
                        totalEstimatedBytes += parseInt(attachment.size || 0);
                        
                        progress.currentOperation = 'Downloading attachments';
                        progress.operationDetails = `${downloadData.totalAttachments + 1} of ${issue.fields.attachment.length}`;
                        progress.message = `Downloading: ${attachment.filename}`;
                        updateTimeEstimates();
                        sendProgress(progress);

                        const attachmentResponse = await axios.get(attachment.content, {
                            headers: createJiraHeaders(auth),
                            responseType: 'arraybuffer'
                        });

                        // Add attachment to zip
                        const attachmentPath = `${projectDir}/${issue.key}/${attachment.filename}`;
                        zip.addFile(attachmentPath, Buffer.from(attachmentResponse.data, 'binary'));
                        
                        ticket.attachments.push({
                            filename: attachment.filename,
                            path: attachmentPath,
                            size: attachment.size
                        });
                        
                        downloadData.totalAttachments++;
                        
                        // Update progress with downloaded size
                        progress.downloadedSize = `${(totalEstimatedBytes / (1024 * 1024)).toFixed(1)} MB`;
                        sendProgress(progress);
                    } catch (error) {
                        console.error(`Failed to download attachment: ${attachment.filename}`);
                    }
                }
            }

            // Add ticket data if not attachments-only mode
            if (downloadType !== 'attachments') {
                ticketsData.push(ticket);
                downloadData.tickets.push(ticket);
            }
        }

        // Add ticket data to zip if not attachments-only mode
        if (downloadType !== 'attachments') {
            progress.stage = 'finalizing';
            progress.currentOperation = 'Finalizing';
            progress.operationDetails = 'Creating data file';
            progress.message = `Converting to ${fileFormat.toUpperCase()}...`;
            updateTimeEstimates();
            sendProgress(progress);

            downloadData.estimatedSize = `${(totalEstimatedBytes / (1024 * 1024)).toFixed(1)} MB`;
            
            // Add ticket data in selected format
            if (fileFormat === 'csv') {
                const csvData = convertToCSV(ticketsData);
                zip.addFile(`${projectDir}/tickets.csv`, Buffer.from(csvData));
            } else {
                zip.addFile(`${projectDir}/tickets.json`, Buffer.from(JSON.stringify(ticketsData, null, 2)));
            }
        }

        // Save zip file
        const zipFileName = `${projectKey}_${downloadType}_${fileFormat}_${new Date().toISOString().replace(/[:.]/g, '-')}.zip`;
        const zipFilePath = path.join(downloadsDir, zipFileName);
        zip.writeZip(zipFilePath);

        progress.stage = 'complete';
        progress.currentOperation = 'Complete';
        progress.operationDetails = `Total time: ${progress.timeElapsed}`;
        progress.message = 'Download ready!';
        sendProgress(progress);

        // Send final success response
        sendProgress({
            success: true,
            data: {
                ...downloadData,
                zipFile: zipFileName
            }
        });
    } catch (error) {
        console.error('Download error:', error);
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

// Download project zip endpoint
app.get('/api/download-project/:filename', (req, res) => {
    const zipFilePath = path.join(downloadsDir, req.params.filename);
    
    if (fs.existsSync(zipFilePath)) {
        res.download(zipFilePath, req.params.filename, (err) => {
            if (!err) {
                // Delete the zip file after download
                fs.unlink(zipFilePath, (unlinkErr) => {
                    if (unlinkErr) {
                        console.error('Error deleting zip file:', unlinkErr);
                    }
                });
            }
        });
    } else {
        res.status(404).json({
            success: false,
            error: 'File not found'
        });
    }
});

// Start server
app.listen(port, () => {
    console.log(`Server running on port ${port}`);
});
