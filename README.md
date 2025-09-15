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

![Dashboard Preview](docs/dashboard_preview.png)  
*Example of admin dashboard showing node status, health bars, and logs.*

![File View Preview](docs/file_view_preview.png)  
*Example of frontend file management interface.*

---

## ER Diagram (Simplified)

```text
+------------+      +-----------+      +-----------+
|   Users    |<---->|  Folders  |<---->|   Files   |
+------------+      +-----------+      +-----------+
| user_id    |      | folder_id |      |  file_id  |
| email      |      |   name    |      |  filename |
| name       |      | shareWith |      | highlight |
| lastLogin  |      | highlight |      | 
| photoURL   |      |  user_id  |      | folder_id |
+------------+      | timestamp |         |
                    |  deleted  |
                    | deletedAt |
                    +-----------+      | owner_id  |
                                       | shared_to |
                                       +-----------+
```
Simplified view of Firebase collections and relationships.

## API Endpoints
Method	Endpoint	Description
GET	/api/cluster/health	Get status of all nodes
POST	/api/node/toggle	Start/Stop a node
GET	/api/files	List files for current user
POST	/api/files/upload	Upload a file
POST	/api/files/share	Share file with another user
DELETE	/api/files/:id	Delete a file

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
