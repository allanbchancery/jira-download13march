# Jira Ticket Downloader

A user-friendly web application to download Jira tickets, comments, and attachments from https://thehut.atlassian.net/. The application provides real-time progress tracking, error handling, and organized downloads.

## Features

- **User-friendly Interface**
  - Clean, modern design
  - Responsive layout for desktop and mobile
  - Intuitive project selection
  - Real-time progress tracking

- **Secure Authentication**
  - Secure credential handling
  - API key never stored locally
  - Automatic session management

- **Download Capabilities**
  - Download multiple projects simultaneously
  - Fetch all tickets with pagination
  - Include all comments and attachments
  - Organized zip file structure

- **Progress Tracking**
  - Real-time progress updates
  - Time elapsed and remaining estimates
  - Current operation details
  - Download size information

- **Error Handling**
  - Connection loss detection
  - Automatic retry mechanism
  - Detailed error messages
  - Per-project error tracking

## Installation

1. Clone the repository:
```bash
git clone [repository-url]
cd jira-downloader
```

2. Install dependencies:
```bash
npm install
```

3. Start the development server:
```bash
npm run dev
```

4. Open http://localhost:3000 in your browser

## Usage

1. **Authentication**
   - Enter your Jira username (email)
   - Enter your API key from Jira account settings
   - Click "Connect" to verify credentials

2. **Project Selection**
   - Select one or more projects to download
   - View project details before downloading
   - Choose download location for each project

3. **Download Process**
   - Monitor real-time progress for each project
   - View detailed statistics during download
   - Cancel downloads if needed
   - Generate download reports

4. **Output Structure**
```
ProjectKey/
├── tickets.json (contains all ticket data and comments)
└── TicketKey/
    ├── attachment1.pdf
    ├── attachment2.jpg
    └── ...
```

## Features in Detail

### Progress Tracking
- **Ticket Progress**
  - Total tickets count
  - Current ticket being processed
  - Batch download progress

- **Time Tracking**
  - Time elapsed
  - Estimated time remaining
  - Operation duration statistics

- **Size Information**
  - Total download size
  - Current download progress
  - Per-attachment size tracking

### Error Handling
- **Connection Issues**
  - Automatic reconnection attempts
  - Progress preservation
  - Detailed error reporting

- **Download Failures**
  - Per-file error tracking
  - Retry mechanisms
  - Detailed failure logs

### Security
- Credentials are never stored locally
- API key is masked in the interface
- Secure connection to Jira API
- Automatic session cleanup

## Development

The application is built with:
- Frontend: HTML, CSS, JavaScript
- Backend: Node.js, Express
- APIs: Jira REST API
- Libraries: adm-zip, axios, cors

### Project Structure
```
jira-downloader/
├── index.html
├── styles.css
├── script.js
├── server.js
└── downloads/     # Generated on first use
```

## Contributing

1. Fork the repository
2. Create a feature branch
3. Commit your changes
4. Push to the branch
5. Create a Pull Request

## License

This project is licensed under the MIT License - see the LICENSE file for details.
