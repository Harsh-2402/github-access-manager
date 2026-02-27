# 🔐 GitHub Access Manager

<div align="center">

![GitHub Access Manager Banner](https://img.shields.io/badge/GitHub-Access%20Manager-blue?style=for-the-badge&logo=github)

[![FastAPI](https://img.shields.io/badge/FastAPI-0.100+-009688?style=flat-square&logo=fastapi&logoColor=white)](https://fastapi.tiangolo.com/)
[![Python](https://img.shields.io/badge/Python-3.9+-3776AB?style=flat-square&logo=python&logoColor=white)](https://python.org)
[![JavaScript](https://img.shields.io/badge/JavaScript-ES2020-F7DF1E?style=flat-square&logo=javascript&logoColor=black)](https://developer.mozilla.org/en-US/docs/Web/JavaScript)
[![TailwindCSS](https://img.shields.io/badge/TailwindCSS-3.x-38B2AC?style=flat-square&logo=tailwind-css&logoColor=white)](https://tailwindcss.com/)
[![Docker](https://img.shields.io/badge/Docker-Ready-2496ED?style=flat-square&logo=docker&logoColor=white)](https://docker.com)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow?style=flat-square)](LICENSE)

**A full-stack tool to audit and revoke GitHub repository access — in real time.**

[Features](#-features) · [Quick Start](#-quick-start) · [Architecture](#-architecture) · [API Reference](#-api-reference) · [Docker Setup](#-docker-setup)

</div>

---

## 🌟 Features

| Feature | Description |
|---|---|
| 🔍 **Real-time Scanning** | Server-Sent Events (SSE) stream scans all repos and reports results live as they are found |
| 👥 **Collaborator Detection** | Accurately distinguishes **direct collaborators** from org-wide members to avoid false positives |
| 📬 **Pending Invitations** | Detects and cancels **pending (unaccepted) invitations**, not just active collaborators |
| 🗑️ **Bulk Revoke Access** | Select multiple repositories and remove access or cancel invitations in a single click |
| 📊 **Permission Levels** | Displays each user's permission level: `admin`, `write`, `maintain`, `triage`, or `read` |
| 🛡️ **Owner Guard** | Prevents accidental removal of the token owner's own access |
| 💅 **Premium UI** | Glassmorphism design with live progress bar, animated scan panel, and toast notifications |

---

## 🚀 Quick Start

### Prerequisites

- **Python 3.9+**
- A **GitHub Personal Access Token (PAT)** with the following scopes:
  - `repo` — full control of private repositories
  - `admin:org` — read/write org and team membership
  - `user` — read user profile data

> **Tip:** Generate your token at [GitHub Settings → Developer settings → Personal access tokens](https://github.com/settings/tokens)

---

### 1. Clone the Repository

```bash
git clone https://github.com/Harsh-2402/github-access-manager.git
cd github-access-manager  
```

### 2. Backend Setup

```bash
cd backend
```

**Create and activate a virtual environment (recommended):**

```bash
# Create venv
python -m venv venv

# Windows
venv\Scripts\activate

# Linux / macOS
source venv/bin/activate
```

**Install dependencies:**

```bash
pip install -r requirements.txt
```

**Configure environment variables:**

Create (or edit) the `.env` file in the `backend/` directory:

```env
GITHUB_TOKEN=ghp_your_personal_access_token_here
```

**Start the backend server:**

```bash
uvicorn main:app --reload
```

The API will be available at `http://localhost:8000`.  
Interactive docs: `http://localhost:8000/docs`

---

### 3. Frontend Setup

Navigate to the `frontend/` directory and open `index.html` in your browser:

```bash
# Option A — Simply open the file
start frontend/index.html       # Windows
open frontend/index.html        # macOS

# Option B — Use a dev server (recommended for full SSE support)
# With VS Code Live Server extension, right-click index.html → "Open with Live Server"
```

---

## 🏗️ Architecture

```
GitAccessControl/
├── backend/
│   ├── main.py              # FastAPI app — endpoints & SSE stream logic
│   ├── github_service.py    # GitHub REST API client (repos, collaborators, invitations)
│   ├── requirements.txt     # Python dependencies
│   ├── Dockerfile           # Container image definition
│   └── .env                 # 🔒 Local secrets (not committed)
│
└── frontend/
    ├── index.html           # Single-page app layout (TailwindCSS)
    ├── script.js            # EventSource SSE client + UI logic
    └── styles.css           # Custom CSS (glassmorphism, animations, toasts)
```

### How It Works

```
User enters GitHub username
        │
        ▼
Frontend opens SSE connection ──► GET /user-access/stream?username={login}
                                          │
                                     Backend:
                                     1. Validate GitHub user via /users/{login}
                                     2. Fetch all repos (paginated, up to 2000)
                                     3. For each repo:
                                        ├─ HEAD /collaborators/{login} → 204 = direct collaborator
                                        │       └─ GET /collaborators/{login}/permission
                                        └─ GET /invitations → check invitee.login
                                     4. Stream SSE events: start → scanning → found → done
                                          │
                                          ▼
                                   Frontend renders live results table

User selects repos → clicks "Remove Access"
        │
        ▼
POST /remove-access  ──► DELETE /collaborators/{login}   (active)
                    └──► DELETE /invitations/{id}        (pending)
```

---

## 📡 API Reference

### `GET /health`
Returns service health status.

```json
{ "status": "ok", "message": "Service is healthy" }
```

---

### `GET /user-access/stream?username={login}`
**Server-Sent Events** stream. Scans all repositories for the given GitHub username.

#### SSE Event Types

| `type` | Payload fields | Description |
|--------|---------------|-------------|
| `start` | `total`, `username`, `avatar_url`, `is_owner` | Scan started; total repos known |
| `scanning` | `repo`, `scanned`, `total` | Currently checking this repo |
| `found` | `repo` object (see below) | User has access to this repo |
| `done` | `total` | Scan complete; total repos with access |
| `error` | `message` | Something went wrong |

**`found` repo object:**

```json
{
  "owner":         "org-or-user",
  "repo":          "repository-name",
  "full_name":     "org-or-user/repository-name",
  "permission":    "admin | write | maintain | triage | read",
  "status":        "active | invited",
  "username":      "github-login",
  "invitation_id": 12345678
}
```

---

### `POST /remove-access`
Removes collaborator access or cancels pending invitations.

**Request body:**

```json
{
  "repos": [
    {
      "owner":         "org-or-user",
      "repo":          "repository-name",
      "username":      "github-login",
      "status":        "active | invited",
      "invitation_id": 12345678
    }
  ]
}
```

**Response:**

```json
{
  "results": [
    { "repo": "repository-name", "owner": "org-or-user", "success": true, "message": "Removed @user from org/repo." }
  ]
}
```

---

## 🐳 Docker Setup

Run the backend in a container — no local Python needed.

**Build the image:**

```bash
cd backend
docker build -t github-access-manager .
```

**Run the container:**

```bash
docker run -p 8000:8000 --env-file .env github-access-manager
```

The API will be available at `http://localhost:8000`.

---

## ⚙️ Configuration

| Variable | Required | Description |
|---|---|---|
| `GITHUB_TOKEN` | ✅ Yes | GitHub Personal Access Token |

---

## 🔒 Security Notes

- The `.env` file contains your PAT and is **never committed** to source control (add it to `.gitignore`).
- The token must have `repo`, `admin:org`, and `user` scopes to scan private repositories and organizations.
- The app prevents removing the token owner's own access to avoid accidental lockouts.

---

## 🐛 Troubleshooting

| Issue | Solution |
|---|---|
| `GITHUB_TOKEN not set` | Ensure `.env` exists in `backend/` with a valid token |
| `User not found` | The GitHub username does not exist or was mistyped |
| Backend CORS errors | Confirm the backend is running on port `8000` and CORS is allowed |
| Slow scans | Normal for accounts with many repositories; the app supports up to **2,000 repos** via pagination |
| False positives removed | Two-step collaborator check (HEAD + permission) ensures only **direct** collaborators are shown |

---

## 📄 License

This project is licensed under the [MIT License](LICENSE).

---

<div align="center">
Made with ❤️ | <a href="https://github.com/Harsh-2402/github-access-manager">GitHub</a>
</div>
