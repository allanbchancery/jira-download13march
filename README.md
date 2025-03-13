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

- **Smart Download Management**
  - Automatic 50MB segmentation for large downloads
  - Individual segment progress tracking
  - Detailed file information per segment
  - Download status indicators for each segment

- **Progress Tracking**
  - Real-time progress updates
  - Time elapsed and remaining estimates
  - Current operation details
  - Download size information

- **Error Handling**
  - Connection loss detection
  - Automatic retry mechanism
  - Detailed error messages
  - Per-segment error tracking

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
   - Choose download options (format, content type)

3. **Download Process**
   - Monitor real-time progress for each project
   - View segment information and file lists
   - Download segments individually
   - Track download status per segment

4. **Output Structure**
```
ProjectKey_part1of3_50MB/
├── tickets.json (contains ticket data and comments)
└── TicketKey/
    ├── attachment1.pdf
    ├── large_file.zip.part1
    └── ...

ProjectKey_part2of3_50MB/
├── tickets.json
└── TicketKey/
    ├── large_file.zip.part2
    └── ...

ProjectKey_part3of3_50MB/
├── tickets.json
└── TicketKey/
    ├── attachment2.jpg
    └── ...
```

## Features in Detail

### Segmented Downloads
- **Automatic Segmentation**
  - 50MB size limit per segment
  - Smart file splitting for large attachments
  - Organized segment structure
  - Clear segment labeling

- **Segment Information**
  - Total number of segments
  - Files contained in each segment
  - Size information per segment
  - Part numbers for split files

- **Download Controls**
  - Individual segment downloads
  - Download status tracking
  - Success/failure indicators
  - Retry options for failed segments

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
  - Per-segment size tracking

### Error Handling
- **Connection Issues**
  - Automatic reconnection attempts
  - Progress preservation
  - Detailed error reporting

- **Download Failures**
  - Per-segment error tracking
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
├── index.html      # Frontend interface
├── styles.css      # Styling
├── script.js       # Frontend logic
├── server.js       # Backend API
└── downloads/      # Generated on first use
```

## Contributing

1. Fork the repository
2. Create a feature branch
3. Commit your changes
4. Push to the branch
5. Create a Pull Request

## License

This project is licensed under the MIT License - see the LICENSE file for details.
