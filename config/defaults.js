/**
 * Default configuration for the Jira Ticket Downloader
 */
const path = require('path');
const os = require('os');

module.exports = {
  // Default download path (user's Downloads folder)
  downloadPath: path.join(os.homedir(), 'Downloads', 'jira-downloads'),
  
  // API configuration
  api: {
    baseUrl: 'https://thehut.atlassian.net/rest/api/2',
    timeout: 30000, // 30 seconds
    maxRetries: 3,
    retryDelay: 1000 // 1 second
  },
  
  // Job configuration
  jobs: {
    maxConcurrent: 2, // Maximum number of concurrent jobs
    retentionDays: 7, // Keep completed jobs for 7 days
  },
  
  // Segment size limit (50MB)
  segmentSizeLimit: 50 * 1024 * 1024,
  
  // Notification settings
  notifications: {
    enabled: true,
    sound: true,
    successTitle: 'Jira Download Complete',
    errorTitle: 'Jira Download Failed'
  }
};
