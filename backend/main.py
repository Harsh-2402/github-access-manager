from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from typing import List, Optional
import github_service
import logging
import json
import requests

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(title="GitHub Access Manager")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── Pydantic Models ───────────────────────────────────────────────────────────
class RepoItem(BaseModel):
    owner:         str
    repo:          str
    username:      str                  # GitHub login of the collaborator
    status:        str                  # "active" | "invited"
    invitation_id: Optional[int] = None # only set when status == "invited"

class RemoveAccessRequest(BaseModel):
    repos: List[RepoItem]


# ── Health ────────────────────────────────────────────────────────────────────
@app.get("/health")
def health_check():
    return {"status": "ok", "message": "Service is healthy"}


# ── STEP 2–4: Scan a username across all repos (SSE stream) ───────────────────
@app.get("/user-access/stream")
def stream_user_access(username: str):
    """
    Server-Sent Events endpoint.

    Flow:
      1. Validate the GitHub username and fetch their profile.
      2. Fetch all repos visible to the authenticated token.
      3. For each repo:
           a. Check Collaborators list  → match by login
           b. Check Pending Invitations → match by invitee.login
      4. Stream results in real time.

    SSE event types:
      { "type": "start",    "total": N, "username": str, "avatar_url": str }
      { "type": "scanning", "repo": "owner/name", "scanned": N, "total": N }
      { "type": "found",    "repo": { owner, repo, full_name, permission,
                                      status, username, invitation_id? } }
      { "type": "done",     "total": N }
      { "type": "error",    "message": str }
    """
    def event_stream():
        def sse(data: dict) -> str:
            return f"data: {json.dumps(data)}\n\n"

        # ── STEP 1: Validate username ──────────────────────────────────────────
        try:
            profile_resp = requests.get(
                f"{github_service.GITHUB_API_URL}/users/{username.strip()}",
                headers=github_service.get_headers(),
            )
            if profile_resp.status_code != 200:
                yield sse({"type": "error", "message": f"GitHub username '{username.strip()}' not found."})
                return

            profile    = profile_resp.json()
            login      = profile.get("login", username.strip())   # canonical casing
            avatar_url = profile.get("avatar_url", "")

            # ── Check if searched user is the token owner ─────────────────────
            is_owner = False
            me_resp = requests.get(
                f"{github_service.GITHUB_API_URL}/user",
                headers=github_service.get_headers(),
            )
            if me_resp.status_code == 200:
                owner_login = me_resp.json().get("login", "")
                if login.lower() == owner_login.lower():
                    is_owner = True   # scan proceeds, but frontend hides remove button

        except Exception as e:
            yield sse({"type": "error", "message": f"Failed to validate username: {e}"})
            return

        # ── STEP 2: Get all repos ──────────────────────────────────────────────
        try:
            all_repos = github_service.get_all_repos()
        except Exception as e:
            yield sse({"type": "error", "message": f"Failed to fetch repositories: {e}"})
            return

        total_repos   = len(all_repos)
        scanned_count = 0
        found_count   = 0

        yield sse({"type": "start", "total": total_repos, "username": login, "avatar_url": avatar_url, "is_owner": is_owner})


        # ── STEP 3: Scan each repo ─────────────────────────────────────────────
        for repo in all_repos:
            owner     = repo["owner"]["login"]
            repo_name = repo["name"]
            full_name = repo["full_name"]
            scanned_count += 1

            # Emit progress
            yield sse({
                "type":    "scanning",
                "repo":    full_name,
                "scanned": scanned_count,
                "total":   total_repos,
            })

            access_found = False

            # ── 3a: Check Direct Collaborators ───────────────────────────────
            #
            # IMPORTANT: /collaborators/{login}/permission returns 200 for ANY
            # user with repo access (including org members), not just direct
            # collaborators. So we first verify direct membership with a HEAD
            # check: 204 = is a direct collaborator, 404 = is not.
            try:
                check_resp = requests.get(
                    f"{github_service.GITHUB_API_URL}/repos/{owner}/{repo_name}/collaborators/{login}",
                    headers=github_service.get_headers(),
                )
                if check_resp.status_code == 204:
                    # Confirmed direct collaborator — now get their permission level
                    perm_resp = requests.get(
                        f"{github_service.GITHUB_API_URL}/repos/{owner}/{repo_name}/collaborators/{login}/permission",
                        headers=github_service.get_headers(),
                    )
                    perm = "read"
                    if perm_resp.status_code == 200:
                        perm = perm_resp.json().get("permission", "read")

                    if perm != "none":
                        yield sse({
                            "type": "found",
                            "repo": {
                                "owner":         owner,
                                "repo":          repo_name,
                                "full_name":     full_name,
                                "permission":    perm,
                                "status":        "active",
                                "username":      login,
                                "invitation_id": None,
                            },
                        })
                        found_count  += 1
                        access_found  = True
                # 404 = not a direct collaborator → fall through to invite check
            except Exception as e:
                logger.debug(f"Collaborator check error for {full_name}: {e}")


            # ── 3b: Check Pending Invitations (if not already found) ──────────
            if not access_found:
                try:
                    invitations = github_service.get_repo_invitations(owner, repo_name)
                    for invite in invitations:
                        invitee = invite.get("invitee") or {}
                        if invitee.get("login", "").lower() == login.lower():
                            yield sse({
                                "type": "found",
                                "repo": {
                                    "owner":         owner,
                                    "repo":          repo_name,
                                    "full_name":     full_name,
                                    "permission":    invite.get("permissions", "read"),
                                    "status":        "invited",
                                    "username":      login,
                                    "invitation_id": invite.get("id"),
                                },
                            })
                            found_count  += 1
                            break
                except Exception as e:
                    logger.debug(f"Invitation check error for {full_name}: {e}")

        yield sse({"type": "done", "total": found_count})

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control":    "no-cache",
            "X-Accel-Buffering": "no",
        },
    )


# ── STEP 5: Remove access ─────────────────────────────────────────────────────
@app.post("/remove-access")
def remove_access(request: RemoveAccessRequest):
    """
    Removes access for each repo in the list.
    - status == "active"  → DELETE /repos/{owner}/{repo}/collaborators/{login}
    - status == "invited" → DELETE /repos/{owner}/{repo}/invitations/{invitation_id}
    """
    results = []

    for item in request.repos:
        if item.status == "active":
            success, message = github_service.remove_collaborator(
                item.owner, item.repo, item.username
            )
        elif item.status == "invited":
            if not item.invitation_id:
                results.append({
                    "repo": item.repo, "owner": item.owner,
                    "success": False, "message": "Missing invitation_id — cannot cancel invite.",
                })
                continue
            success, message = github_service.cancel_invitation(
                item.owner, item.repo, item.invitation_id
            )
        else:
            success, message = False, f"Unknown status '{item.status}'."

        results.append({
            "repo":    item.repo,
            "owner":   item.owner,
            "success": success,
            "message": message,
        })

    return {"results": results}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
