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
        let issues = [];
        const startTime = Date.now();
        const progress = {
            stage: 'init',
            message: 'Initializing download...',
            totalIssues,
            currentIssue: 0,
            batchProgress: 0,
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
        };

        // Send initial progress
        sendProgress(progress);

        // Fetch issues based on download type
        if (downloadType === 'attachments') {
            // For attachments only, just get attachment info
            progress.stage = 'fetching';
            progress.currentOperation = 'Fetching attachment info';
            progress.message = 'Getting attachment information...';
            sendProgress(progress);

            const response = await axios.post('https://thehut.atlassian.net/rest/api/2/search', {
                jql,
                maxResults: totalIssues,
                fields: ['attachment']
            }, {
                headers: createJiraHeaders(auth)
            });

            issues = response.data.issues;
            progress.currentIssue = issues.length;
            progress.batchProgress = 100;
            sendProgress(progress);
        }

        const downloadData = {
            projectInfo,
            totalAttachments: 0,
            estimatedSize: '0 MB'
        };

        // Process each issue and estimate total size
        progress.stage = 'processing';
        let totalEstimatedBytes = 0;
        let totalAttachmentCount = 0;
        
        // First pass: count attachments and calculate total size
        for (const issue of issues) {
            if (issue.fields.attachment) {
                totalAttachmentCount += issue.fields.attachment.length;
                for (const attachment of issue.fields.attachment) {
                    totalEstimatedBytes += parseInt(attachment.size || 0);
                }
            }
        }

        // Second pass: process attachments
        let processedAttachments = 0;
        for (const issue of issues) {
            if (!issue.fields.attachment) continue;
            
            for (const attachment of issue.fields.attachment) {
                try {
                    processedAttachments++;
                    const attachmentSize = parseInt(attachment.size || 0);
                    
                    progress.currentOperation = 'Processing attachments';
                    progress.operationDetails = `${processedAttachments} of ${totalAttachmentCount}`;
                    progress.message = `Processing: ${attachment.filename} (${(attachmentSize / (1024 * 1024)).toFixed(1)}MB)`;
                    updateTimeEstimates();
                    sendProgress(progress);
                    
                    downloadData.totalAttachments++;
                } catch (error) {
                    console.error(`Failed to process attachment: ${attachment.filename}`);
                }
            }
        }

        downloadData.estimatedSize = `${(totalEstimatedBytes / (1024 * 1024)).toFixed(1)} MB`;

        // Calculate segments needed for attachments
        const SEGMENT_SIZE_LIMIT = 50 * 1024 * 1024; // 50MB per segment
        const attachmentSegments = [];
        let currentSegment = {
            files: [],
            size: 0,
            number: 1
        };

        // Group attachments into segments
        for (const issue of issues) {
            if (!issue.fields.attachment) continue;
            
            for (const attachment of issue.fields.attachment) {
                const attachmentSize = parseInt(attachment.size || 0);
                
                // If attachment is larger than segment size, split it
                if (attachmentSize > SEGMENT_SIZE_LIMIT) {
                    const segmentCount = Math.ceil(attachmentSize / SEGMENT_SIZE_LIMIT);
                    for (let i = 0; i < segmentCount; i++) {
                        attachmentSegments.push({
                            files: [{
                                ticket: issue.key,
                                attachment,
                                partNumber: i + 1,
                                totalParts: segmentCount,
                                startByte: i * SEGMENT_SIZE_LIMIT,
                                endByte: Math.min((i + 1) * SEGMENT_SIZE_LIMIT, attachmentSize)
                            }],
                            size: Math.min(SEGMENT_SIZE_LIMIT, attachmentSize - (i * SEGMENT_SIZE_LIMIT)),
                            number: attachmentSegments.length + 1
                        });
                    }
                }
                // If current segment would exceed limit, create new segment
                else if (currentSegment.size + attachmentSize > SEGMENT_SIZE_LIMIT) {
                    attachmentSegments.push(currentSegment);
                    currentSegment = {
                        files: [{
                            ticket: issue.key,
                            attachment,
                            partNumber: 1,
                            totalParts: 1,
                            startByte: 0,
                            endByte: attachmentSize
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
                        endByte: attachmentSize
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

        progress.stage = 'segmenting';
        progress.currentOperation = 'Creating download segments';
        progress.operationDetails = `Preparing ${totalSegments} segments (50MB each)`;
        progress.message = `Organizing ${downloadData.totalAttachments} attachments into ${totalSegments} segments...`;
        sendProgress(progress);

        // Create segments with attachment chunks
        const segments = [];
        for (const segment of attachmentSegments) {
            const segmentZip = new AdmZip();
            
            // Add attachments for this segment
            for (const file of segment.files) {
                const { ticket, attachment, partNumber, totalParts, startByte, endByte } = file;
                
                // Get attachment data
                const attachmentResponse = await axios.get(attachment.content, {
                    headers: {
                        ...createJiraHeaders(auth),
                        Range: `bytes=${startByte}-${endByte - 1}`
                    },
                    responseType: 'arraybuffer'
                });

                // Add to zip with part number if split
                const filename = totalParts > 1 
                    ? `${attachment.filename}.part${partNumber}` 
                    : attachment.filename;
                    
                segmentZip.addFile(
                    `${projectKey}/${ticket}/${filename}`, 
                    Buffer.from(attachmentResponse.data)
                );
            }

            // Save segment with detailed info
            const segmentFileName = `${projectKey}_attachments_part${segment.number}of${totalSegments}_${(segment.size / (1024 * 1024)).toFixed(1)}MB_${new Date().toISOString().replace(/[:.]/g, '-')}.zip`;
            const segmentFilePath = path.join(downloadsDir, segmentFileName);
            segmentZip.writeZip(segmentFilePath);

            segments.push({
                fileName: segmentFileName,
                fileCount: segment.files.length,
                size: segment.size,
                partNumber: segment.number,
                totalParts: totalSegments,
                files: segment.files.map(f => ({
                    name: f.attachment.filename,
                    ticket: f.ticket,
                    size: f.endByte - f.startByte,
                    part: f.partNumber,
                    totalParts: f.totalParts
                }))
            });

            progress.currentOperation = 'Creating segments';
            progress.operationDetails = `Created segment ${segment.number} of ${totalSegments} (50MB segments)`;
            progress.message = `Segment ${segment.number}: ${(segment.size / (1024 * 1024)).toFixed(1)}MB - ${segment.files.length} files`;
            sendProgress(progress);
        }

        progress.stage = 'complete';
        progress.currentOperation = 'Complete';
        progress.operationDetails = `Total time: ${progress.timeElapsed}`;
        progress.message = 'All segments ready!';
        sendProgress(progress);

        // Send final success response with segment information
        sendProgress({
            success: true,
            data: {
                ...downloadData,
                segments,
                totalSegments,
                totalSize: `${(totalEstimatedBytes / (1024 * 1024)).toFixed(1)}MB`,
                segmentDetails: attachmentSegments.map(s => ({
                    number: s.number,
                    size: `${(s.size / (1024 * 1024)).toFixed(1)}MB`,
                    fileCount: s.files.length,
                    files: s.files.map(f => ({
                        name: f.attachment.filename,
                        ticket: f.ticket,
                        size: `${((f.endByte - f.startByte) / (1024 * 1024)).toFixed(1)}MB`,
                        part: f.partNumber,
                        totalParts: f.totalParts
                    }))
                })),
                segmentSize: '50MB'
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
