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
// Serve static files
app.use(express.static(__dirname));
app.use('/downloads', express.static(path.join(__dirname, 'downloads')));

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
    console.log('Testing connection with auth:', { username, auth });
    
    try {
        const response = await axios.get('https://thehut.atlassian.net/rest/api/2/myself', {
            headers: {
                'Authorization': `Basic ${auth}`,
                'Accept': 'application/json'
            }
        });
        console.log('Connection successful:', response.data);
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
        console.log('Fetching projects with auth:', { username });
        const response = await axios.get('https://thehut.atlassian.net/rest/api/2/project', {
            headers: createJiraHeaders(auth)
        });
        console.log('Projects response:', response.data);
        
        // Map the response to include both name and key
        const projects = response.data.map(project => ({
            key: project.key,
            name: project.name
        }));
        console.log('Mapped projects:', projects);
        
        res.json({ success: true, projects });
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

    console.log('Download request received:', {
        projectKey,
        downloadType,
        fileFormat,
        username,
        timestamp: new Date().toISOString()
    });

    try {
        // Log downloads directory status
        console.log('Downloads directory status:', {
            path: downloadsDir,
            exists: fs.existsSync(downloadsDir),
            isDirectory: fs.existsSync(downloadsDir) && fs.statSync(downloadsDir).isDirectory()
        });

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
        console.log('Fetching project info and issue count...');
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
        
        console.log('Project info retrieved:', {
            projectKey: projectInfo.key,
            projectName: projectInfo.name,
            totalIssues,
            timestamp: new Date().toISOString()
        });

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

        // Send initial progress with download type info
        progress.currentOperation = `Downloading ${downloadType === 'all' ? 'Everything' : downloadType === 'tickets' ? 'Tickets Only' : 'Attachments Only'}`;
        sendProgress(progress);

        // Fetch issues based on download type
        progress.stage = 'fetching';
        progress.currentOperation = 'Scanning Project';
        progress.message = 'Finding content...';
        progress.operationDetails = `Project: ${projectKey}`;
        sendProgress(progress);

        // Define fields to fetch based on download type
        let fields = [];
        if (downloadType === 'all') {
            fields = ['summary', 'description', 'comment', 'attachment', 'created', 'updated', 'status', 'priority', 'assignee', 'reporter'];
        } else if (downloadType === 'tickets') {
            fields = ['summary', 'description', 'comment', 'created', 'updated', 'status', 'priority', 'assignee', 'reporter'];
        } else if (downloadType === 'attachments') {
            fields = ['attachment'];
        }

        const response = await axios.post('https://thehut.atlassian.net/rest/api/2/search', {
            jql,
            maxResults: totalIssues,
            fields
        }, {
            headers: createJiraHeaders(auth)
        });

        issues = response.data.issues;
        progress.currentIssue = issues.length;
        progress.batchProgress = 100;
        sendProgress(progress);

        console.log('Processing issues:', {
            count: issues.length,
            downloadType,
            timestamp: new Date().toISOString()
        });

        // Process issues based on download type
        const ticketsData = issues.map(issue => ({
            key: issue.key || '',
            summary: issue.fields?.summary || '',
            description: issue.fields?.description || '',
            created: issue.fields?.created || '',
            updated: issue.fields?.updated || '',
            status: issue.fields?.status?.name || '',
            priority: issue.fields?.priority?.name || '',
            assignee: issue.fields?.assignee?.displayName || '',
            reporter: issue.fields?.reporter?.displayName || '',
            comments: (issue.fields?.comment?.comments || []).map(c => ({
                author: c?.author?.displayName || '',
                created: c?.created || '',
                body: c?.body || ''
            }))
        }));

        // For tickets-only or all content, create the tickets file
        if (downloadType === 'tickets' || downloadType === 'all') {
            const fileName = `${projectKey}_tickets_${new Date().toISOString().replace(/[:.]/g, '-')}.${fileFormat}`;
            const filePath = path.join(downloadsDir, fileName);

            console.log('Writing ticket data to file:', {
                fileName,
                format: fileFormat,
                ticketCount: ticketsData.length,
                path: filePath,
                timestamp: new Date().toISOString()
            });

            if (fileFormat === 'json') {
                fs.writeFileSync(filePath, JSON.stringify(ticketsData, null, 2));
                console.log('JSON file written successfully');
            } else {
                // Convert to CSV format
                const csvRows = [];
                // Add headers
                csvRows.push(['Key', 'Summary', 'Description', 'Created', 'Updated', 'Status', 'Priority', 'Assignee', 'Reporter', 'Comments']);
                // Add data
                ticketsData.forEach(ticket => {
                    csvRows.push([
                        ticket.key,
                        ticket.summary,
                        ticket.description,
                        ticket.created,
                        ticket.updated,
                        ticket.status,
                        ticket.priority,
                        ticket.assignee,
                        ticket.reporter,
                        ticket.comments.map(c => `${c.author}: ${c.body}`).join(' | ')
                    ]);
                });
                fs.writeFileSync(filePath, csvRows.map(row => row.join(',')).join('\n'));
            }

            // If tickets only, send file info for download
            if (downloadType === 'tickets') {
                sendProgress({
                    success: true,
                    data: {
                        tickets: ticketsData,
                        totalTickets: ticketsData.length,
                        totalComments: ticketsData.reduce((sum, t) => sum + (t.comments?.length || 0), 0),
                        totalAttachments: 0,
                        fileName: fileName,
                        totalSize: `${(fs.statSync(filePath).size / (1024 * 1024)).toFixed(1)}MB`,
                        downloadType: 'tickets'
                    }
                });
                return;
            }
        }

        // For attachments-only or all content, continue with attachment processing

        const downloadData = {
            projectInfo,
            totalAttachments: 0,
            estimatedSize: '0 MB'
        };

        // Process each issue and estimate total size
        progress.stage = 'processing';
        let totalEstimatedBytes = 0;
        let totalAttachmentCount = 0;
        
        console.log('Starting attachment analysis...');
        
        // First pass: count attachments and calculate total size
        for (const issue of issues) {
            if (issue.fields.attachment) {
                totalAttachmentCount += issue.fields.attachment.length;
                for (const attachment of issue.fields.attachment) {
                    totalEstimatedBytes += parseInt(attachment.size || 0);
                }
            }
        }

        // Skip second pass and go straight to segmentation
        downloadData.totalAttachments = totalAttachmentCount;

        downloadData.estimatedSize = `${(totalEstimatedBytes / (1024 * 1024)).toFixed(1)} MB`;

            console.log('Attachment analysis complete:', {
                totalAttachments: totalAttachmentCount,
                totalSize: `${(totalEstimatedBytes / (1024 * 1024)).toFixed(1)} MB`,
                timestamp: new Date().toISOString()
            });

            // Calculate segments needed for attachments
            const SEGMENT_SIZE_LIMIT = 50 * 1024 * 1024; // 50MB per segment
        const attachmentSegments = [];
        let currentSegment = {
            files: [],
            size: 0,
            number: 1
        };

        // Group attachments into segments with error handling
        try {
            progress.stage = 'analyzing';
            progress.currentOperation = 'Analyzing attachments';
            progress.operationDetails = `Found ${totalAttachmentCount} attachments (${(totalEstimatedBytes / (1024 * 1024)).toFixed(1)}MB total)`;
            progress.message = 'Calculating segments needed...';
            sendProgress(progress);

            // Calculate and show segment information
            const estimatedSegments = Math.ceil(totalEstimatedBytes / SEGMENT_SIZE_LIMIT);
            progress.operationDetails = `Total size: ${(totalEstimatedBytes / (1024 * 1024)).toFixed(1)}MB`;
            progress.message = `Will create ${estimatedSegments} segments of 50MB each`;
            sendProgress(progress);

            // Add a small delay to ensure progress is shown
            await new Promise(resolve => setTimeout(resolve, 100));

            for (const issue of issues) {
                if (!issue.fields.attachment) continue;
                
                for (const attachment of issue.fields.attachment) {
                    try {
                        const attachmentSize = parseInt(attachment.size || 0);
                        if (attachmentSize === 0) {
                            console.warn(`Skipping attachment with size 0: ${attachment.filename}`);
                            continue;
                        }
                        
                        // If attachment is larger than segment size, split it
                        if (attachmentSize > SEGMENT_SIZE_LIMIT) {
                            const segmentCount = Math.ceil(attachmentSize / SEGMENT_SIZE_LIMIT);
                            progress.currentOperation = 'Processing large file';
                            progress.operationDetails = `${attachment.filename} (${(attachmentSize / (1024 * 1024)).toFixed(1)}MB)`;
                            progress.message = `Splitting into ${segmentCount} parts of 50MB each`;
                            sendProgress(progress);

                            for (let i = 0; i < segmentCount; i++) {
                                const startByte = i * SEGMENT_SIZE_LIMIT;
                                const endByte = Math.min((i + 1) * SEGMENT_SIZE_LIMIT, attachmentSize);
                                attachmentSegments.push({
                                    files: [{
                                        ticket: issue.key,
                                        attachment,
                                        partNumber: i + 1,
                                        totalParts: segmentCount,
                                        startByte,
                                        endByte,
                                        size: endByte - startByte
                                    }],
                                    size: endByte - startByte,
                                    number: attachmentSegments.length + 1
                                });
                            }
                        }
                        // If current segment would exceed limit, start new segment
                        else if (currentSegment.size + attachmentSize > SEGMENT_SIZE_LIMIT) {
                            if (currentSegment.files.length > 0) {
                                attachmentSegments.push(currentSegment);
                            }
                            currentSegment = {
                                files: [{
                                    ticket: issue.key,
                                    attachment,
                                    partNumber: 1,
                                    totalParts: 1,
                                    startByte: 0,
                                    endByte: attachmentSize,
                                    size: attachmentSize
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
                                endByte: attachmentSize,
                                size: attachmentSize
                            });
                            currentSegment.size += attachmentSize;
                        }

            progress.currentOperation = 'Processing Files';
            progress.operationDetails = `File ${attachmentSegments.length + 1} of ${totalAttachmentCount}`;
            progress.message = `Processing: ${attachment.filename} (${(attachmentSize / (1024 * 1024)).toFixed(1)}MB)`;
                        sendProgress(progress);
                    } catch (error) {
                        console.error(`Error processing attachment: ${attachment.filename}`, error);
                        progress.currentOperation = 'Warning';
                        progress.operationDetails = `Error with ${attachment.filename}`;
                        progress.message = error.message;
                        sendProgress(progress);
                    }
                }
            }
            
            // Add final segment if not empty
            if (currentSegment.files.length > 0) {
                attachmentSegments.push(currentSegment);
            }

            const finalSegmentCount = attachmentSegments.length;
            if (finalSegmentCount === 0) {
                throw new Error('No valid attachments found to download');
            }

            progress.currentOperation = 'Segmentation complete';
            progress.operationDetails = `Created ${finalSegmentCount} segments`;
            progress.message = `Ready to download ${downloadData.totalAttachments} attachments in ${finalSegmentCount} parts`;
            sendProgress(progress);
        } catch (error) {
            console.error('Error during segmentation:', error);
            throw new Error('Failed to organize attachments: ' + error.message);
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
                
                console.log('Downloading attachment:', {
                    filename: attachment.filename,
                    ticket: ticket,
                    size: `${((endByte - startByte) / (1024 * 1024)).toFixed(1)} MB`,
                    part: `${partNumber}/${totalParts}`,
                    timestamp: new Date().toISOString()
                });

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

            console.log('Creating segment file:', {
                segmentNumber: segment.number,
                totalSegments,
                fileCount: segment.files.length,
                size: `${(segment.size / (1024 * 1024)).toFixed(1)} MB`,
                timestamp: new Date().toISOString()
            });

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

            progress.currentOperation = 'Downloading Files';
            progress.operationDetails = `Part ${segment.number} of ${totalSegments}`;
            progress.message = `Downloading ${segment.files.length} files (${(segment.size / (1024 * 1024)).toFixed(1)}MB)`;
            progress.currentFile = segment.files[0].attachment.filename;
            sendProgress(progress);
        }

        progress.stage = 'complete';
        progress.currentOperation = 'Complete';
        progress.operationDetails = `Total time: ${progress.timeElapsed}`;
        progress.message = 'All segments ready!';
        sendProgress(progress);

        // Send final success response
        const finalResponse = {
            success: true,
            data: {
                ...downloadData,
                tickets: ticketsData,
                totalTickets: ticketsData.length,
                totalComments: ticketsData.reduce((sum, t) => sum + (t.comments?.length || 0), 0),
                totalAttachments: totalAttachmentCount
            }
        };

        // Add attachment-specific data if present
        if (segments && segments.length > 0) {
            finalResponse.data = {
                ...finalResponse.data,
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
            };
        }

        sendProgress(finalResponse);
    } catch (error) {
        const errorDetails = {
            message: error.message,
            code: error.code,
            stack: error.stack,
            timestamp: new Date().toISOString()
        };
        
        if (error.response) {
            errorDetails.status = error.response.status;
            errorDetails.statusText = error.response.statusText;
            errorDetails.data = error.response.data;
        }
        
        console.error('Download error:', errorDetails);
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
    
    console.log('Download project request:', {
        filename: req.params.filename,
        path: zipFilePath,
        timestamp: new Date().toISOString()
    });
    
    if (fs.existsSync(zipFilePath)) {
        const stats = fs.statSync(zipFilePath);
        console.log('File stats:', {
            size: `${(stats.size / (1024 * 1024)).toFixed(1)} MB`,
            created: stats.birthtime,
            modified: stats.mtime,
            timestamp: new Date().toISOString()
        });

        // Set headers for file download
        res.setHeader('Content-Type', 'application/zip');
        res.setHeader('Content-Disposition', `attachment; filename="${req.params.filename}"`);
        
        // Stream the file instead of loading it all into memory
        const fileStream = fs.createReadStream(zipFilePath);
        
        fileStream.on('error', (error) => {
            const errorDetails = {
                message: error.message,
                code: error.code,
                stack: error.stack,
                timestamp: new Date().toISOString()
            };
            console.error('Error streaming file:', errorDetails);
            res.status(500).json({
                success: false,
                error: 'Failed to download file'
            });
        });

        fileStream.on('end', () => {
            console.log('File stream complete:', {
                filename: req.params.filename,
                timestamp: new Date().toISOString()
            });
            // Delete the file after successful download
            setTimeout(() => {
                console.log('Attempting to delete file:', {
                    filename: req.params.filename,
                    path: zipFilePath,
                    timestamp: new Date().toISOString()
                });
                fs.unlink(zipFilePath, (unlinkErr) => {
                    if (unlinkErr) {
                        console.error('Error deleting zip file:', {
                            error: unlinkErr.message,
                            code: unlinkErr.code,
                            stack: unlinkErr.stack,
                            timestamp: new Date().toISOString()
                        });
                    } else {
                        console.log('File deleted successfully:', {
                            filename: req.params.filename,
                            timestamp: new Date().toISOString()
                        });
                    }
                });
            }, 1000); // Wait 1 second before deleting
        });

        // Pipe the file to the response
        fileStream.pipe(res);
    } else {
        console.error('File not found:', {
            filename: req.params.filename,
            path: zipFilePath,
            timestamp: new Date().toISOString()
        });
        res.status(404).json({
            success: false,
            error: 'File not found'
        });
    }
});

// Serve index.html for all other routes to handle client-side routing
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Start server
app.listen(port, () => {
    console.log(`Server running on port ${port}`);
});
