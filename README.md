# Goomairu Drive (Mini Google Drive Project)

Goomairu Drive is a mini Google Drive-like project built for **learning purposes**, focusing on **distributed file storage and replication**.  
It allows uploading, downloading, sharing, and managing files across multiple nodes with automatic replication and health checks.

---

## Project Overview

- Files are uploaded to the **healthiest node** with the fewest files.
- Each file is **replicated** according to the configured replication factor (default: 2, including the first node).
- Every 5 minutes, the system checks nodes:
  - If a node fails or goes offline, files are redistributed to maintain replication.
  - If a node comes back online and replication exceeds the limit, excess copies are deleted to match the replication factor.
- Nodes are monitored for **health and availability** to ensure distributed consistency.

---

## Features

- Upload files and folders
- Move files into folders or drag-and-drop to organize
- Download files
- Share files with other users via email
- Delete files (with a preview before permanent deletion)
- Star / highlight files
- View file history
- View files shared with you
- Admin dashboard to monitor node status

---

## Screenshots / Dashboard Preview

![Login Preview](docs/login.png)  
*Login page : Login with Oauth google.*

![Drive Preview](docs/drive.png)  
*A personal drive page that displays a list of files and folders.*

![Share Preview](docs/share.png)  
*Page showing items shared with me by other users, with the option to reshare*

![Recent Preview](docs/recent.png)  
*Recent items page showing the latest files first, including shared files.*

![Delete Preview](docs/delete.png)  
*Trash page showing deleted items with options to restore or permanently delete.*

![Admin Preview](docs/admin.png)  
*Admin dashboard page displaying node statuses, logs, and allowing nodes to be turned on or off.*

![Docker Preview](docs/addfile_docker.png)  
*Page displaying Docker nodes and logs for newly added files.*

![Firebase Preview](docs/firebase.png)  
*Page displaying the Firebase database.*

![Docker Preview](docs/docker.png)  
*Page displaying Docker nodes and logs when file limits are exceeded.*

---

## ER Diagram (Simplified)

```text
+------------+      +-----------+      +-----------+
|   Users    |<---->|  Folders  |<---->|   Files   |
+------------+      +-----------+      +-----------+
| user_id    |      | folder_id |      |  file_id  |
| email      |      |   name    |      |  filename |
| name       |      | shareWith |      | highlight |
| lastLogin  |      | highlight |      | filePath  |
| photoURL   |      |  user_id  |      | folder_id |
+------------+      | timestamp |      |   nodeId  |
                    |  deleted  |      | shareWith |
                    | deletedAt |      |    size   |
                    +-----------+      | timestamp |
                                       |   userId  |
                                       +-----------+
```
Simplified view of Firebase collections and relationships.

## API Endpoints
Method	  Endpoint	                    Description
GET	      /api/health	                  Check overall system health
GET	      /api/files/:filename	        Get file metadata or info by filename
GET	      /files/raw/:userID/:filename	Download raw file for a specific user
GET	      /api/files	                  List all files for the current user
GET	      /api/cluster/health	          Get status of all nodes
GET	      /api/files	                  List all files for the current user
POST	    /api/node/toggle	            Start or stop a node
POST	    /api/files/upload	            Upload a file
POST	    /api/files/share	            Share a file with another user
POST	    /api/upload                  	Upload a file
POST	    /store-local	                Store a file locally
DELETE	  /api/files/:filename	        Delete a file

## Installation
```text
Frontend (React)
 - yarn install
 - yarn start
Backend (Go + Docker)
Make sure Docker is installed, then run:
 - docker-compose up -d
Firebase Setup
This project uses Firebase for database operations.
** You must provide your own API keys; do not commit secrets. **
Steps: Go to Project Overview → Project Settings → General → Web App Copy your Firebase configuration Place it in the project before running
```
## Requirements
Go v1.25

Node.js v20

Firebase v8

Docker

## Security Notes
Never commit secrets like Firebase API keys or service account credentials.

Docker containers mount the Docker socket (/var/run/docker.sock) for node management:

Safe for local development

Do not expose in public environments

Ensure .gitignore excludes sensitive files, for example:

SecretKey/credentials.json
.env
