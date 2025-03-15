/**
 * Test server for EventSource retry logic and keep-alive functionality
 */
const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();
const port = 3001; // Use a different port than the main server

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

// Test endpoint for EventSource with keep-alive
app.get('/api/test-eventsource', (req, res) => {
  // Set headers for SSE
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive'
  });

  console.log('EventSource connection established');

  // Send initial message
  res.write(`data: ${JSON.stringify({
    message: 'Connection established',
    timestamp: new Date().toISOString()
  })}\n\n`);

  // Send keep-alive messages every 5 seconds
  const keepAliveInterval = setInterval(() => {
    if (!res.writableEnded) {
      try {
        res.write(`data: ${JSON.stringify({
          keepAlive: true,
          timestamp: new Date().toISOString()
        })}\n\n`);
        console.log('Sent keep-alive message');
      } catch (error) {
        console.error('Error sending keep-alive message:', error);
        clearInterval(keepAliveInterval);
      }
    } else {
      clearInterval(keepAliveInterval);
    }
  }, 5000);

  // Send progress updates every 2 seconds
  let progress = 0;
  const progressInterval = setInterval(() => {
    if (!res.writableEnded) {
      try {
        progress += 10;
        if (progress > 100) {
          clearInterval(progressInterval);
          res.write(`data: ${JSON.stringify({
            success: true,
            data: {
              message: 'Process completed successfully',
              timestamp: new Date().toISOString()
            }
          })}\n\n`);
          res.end();
          return;
        }

        res.write(`data: ${JSON.stringify({
          stage: progress < 30 ? 'init' : progress < 60 ? 'processing' : 'finalizing',
          message: `Processing: ${progress}% complete`,
          currentIssue: progress,
          totalIssues: 100,
          currentOperation: `Operation ${progress/10} of 10`,
          operationDetails: `Processing batch ${Math.floor(progress/20) + 1} of 5`,
          downloadedSize: `${progress * 0.5} MB`,
          timeElapsed: `${progress * 0.6}s`,
          estimatedTimeRemaining: `${(100 - progress) * 0.6}s`
        })}\n\n`);
        console.log(`Sent progress update: ${progress}%`);
      } catch (error) {
        console.error('Error sending progress update:', error);
        clearInterval(progressInterval);
      }
    } else {
      clearInterval(progressInterval);
    }
  }, 2000);

  // Handle client disconnect
  req.on('close', () => {
    console.log('EventSource connection closed');
    clearInterval(keepAliveInterval);
    clearInterval(progressInterval);
  });
});

// Test endpoint for EventSource that fails after a delay
app.get('/api/test-eventsource-fail', (req, res) => {
  // Set headers for SSE
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive'
  });

  console.log('EventSource connection established (will fail)');

  // Send initial message
  res.write(`data: ${JSON.stringify({
    message: 'Connection established (will fail after 5 seconds)',
    timestamp: new Date().toISOString()
  })}\n\n`);

  // Send a few progress updates
  let count = 0;
  const progressInterval = setInterval(() => {
    if (!res.writableEnded) {
      try {
        count++;
        res.write(`data: ${JSON.stringify({
          stage: 'init',
          message: `Processing: step ${count}`,
          timestamp: new Date().toISOString()
        })}\n\n`);
        console.log(`Sent progress update ${count} (will fail soon)`);

        // After 5 seconds, close the connection to simulate a failure
        if (count >= 5) {
          console.log('Simulating connection failure');
          clearInterval(progressInterval);
          res.end();
        }
      } catch (error) {
        console.error('Error sending progress update:', error);
        clearInterval(progressInterval);
      }
    } else {
      clearInterval(progressInterval);
    }
  }, 1000);

  // Handle client disconnect
  req.on('close', () => {
    console.log('EventSource connection closed (fail test)');
    clearInterval(progressInterval);
  });
});

// Client error reporting endpoint
app.post('/api/client-error', (req, res) => {
  console.log('Client error reported:', req.body);
  res.json({
    success: true,
    message: 'Error logged successfully'
  });
});

// Start server
app.listen(port, () => {
  console.log(`Test server running on http://localhost:${port}`);
  console.log(`Open error-test.html in your browser to test EventSource retry logic`);
});
