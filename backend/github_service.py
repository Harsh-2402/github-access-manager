import os
import requests
import logging
from dotenv import load_dotenv

# ─────────────────────────────────────────────────────────────────────────────
# STEP 1 — Load credentials from .env
# ─────────────────────────────────────────────────────────────────────────────
load_dotenv()

GITHUB_TOKEN   = os.getenv("GITHUB_TOKEN")
GITHUB_API_URL = "https://api.github.com"

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

if not GITHUB_TOKEN:
    logger.warning("GITHUB_TOKEN not set in .env — all API calls will fail.")


def get_headers() -> dict:
    return {
        "Authorization": f"token {GITHUB_TOKEN}",
        "Accept": "application/vnd.github.v3+json",
    }


# ─────────────────────────────────────────────────────────────────────────────
# STEP 2 — Get all repos the authenticated token has access to
# ─────────────────────────────────────────────────────────────────────────────
def get_all_repos() -> list:
    """
    Returns every repo visible to the authenticated token.
    Includes repos where the token owner is: owner / collaborator / org member.
    Paginated — up to 2 000 repos (20 pages × 100).
    """
    repos = []
    page  = 1

    while True:
        resp = requests.get(
            f"{GITHUB_API_URL}/user/repos",
            headers=get_headers(),
            params={
                "affiliation": "owner,collaborator,organization_member",
                "visibility":  "all",
                "per_page":    100,
                "page":        page,
            },
        )
        resp.raise_for_status()
        batch = resp.json()

        if not batch:
            break

        repos.extend(batch)
        page += 1

        if page > 20:
            logger.info("Reached 2 000-repo safety cap.")
            break

    logger.info(f"Fetched {len(repos)} repos total.")
    return repos


# ─────────────────────────────────────────────────────────────────────────────
# STEP 3a — Get collaborators for a single repo
# ─────────────────────────────────────────────────────────────────────────────
def get_repo_collaborators(owner: str, repo_name: str) -> list:
    """
    Returns active collaborators (direct affiliation) for the given repo.
    Each item is a raw GitHub collaborator object (login, permissions, etc.)
    """
    collaborators = []
    page = 1

    while True:
        resp = requests.get(
            f"{GITHUB_API_URL}/repos/{owner}/{repo_name}/collaborators",
            headers=get_headers(),
            params={"affiliation": "direct", "per_page": 100, "page": page},
        )
        if resp.status_code != 200:
            break

        batch = resp.json()
        if not batch:
            break

        collaborators.extend(batch)
        page += 1

        if page > 10:   # safety cap: 1 000 collaborators per repo
            break

    return collaborators


# ─────────────────────────────────────────────────────────────────────────────
# STEP 3b — Get pending invitations for a single repo
# ─────────────────────────────────────────────────────────────────────────────
def get_repo_invitations(owner: str, repo_name: str) -> list:
    """
    Returns pending invitations for the given repo.
    Each item includes: invitee.login, permissions, id (invitation_id).
    """
    resp = requests.get(
        f"{GITHUB_API_URL}/repos/{owner}/{repo_name}/invitations",
        headers=get_headers(),
    )
    if resp.status_code == 200:
        return resp.json()
    return []


# ─────────────────────────────────────────────────────────────────────────────
# STEP 5a — Remove an active collaborator
# ─────────────────────────────────────────────────────────────────────────────
def remove_collaborator(owner: str, repo: str, username: str) -> tuple[bool, str]:
    """
    Removes an active collaborator from a repo by their GitHub username.
    Returns (success: bool, message: str).
    """
    url = f"{GITHUB_API_URL}/repos/{owner}/{repo}/collaborators/{username}"
    try:
        resp = requests.delete(url, headers=get_headers())
        if resp.status_code == 204:
            return True, f"Removed @{username} from {owner}/{repo}."
        return False, f"GitHub returned {resp.status_code}: {resp.text}"
    except Exception as e:
        logger.error(f"Error removing {username} from {owner}/{repo}: {e}")
        return False, str(e)


# ─────────────────────────────────────────────────────────────────────────────
# STEP 5b — Cancel a pending invitation
# ─────────────────────────────────────────────────────────────────────────────
def cancel_invitation(owner: str, repo: str, invitation_id: int) -> tuple[bool, str]:
    """
    Cancels a pending repository invitation by its ID.
    Returns (success: bool, message: str).
    """
    url = f"{GITHUB_API_URL}/repos/{owner}/{repo}/invitations/{invitation_id}"
    try:
        resp = requests.delete(url, headers=get_headers())
        if resp.status_code == 204:
            return True, f"Cancelled invitation {invitation_id} for {owner}/{repo}."
        return False, f"GitHub returned {resp.status_code}: {resp.text}"
    except Exception as e:
        logger.error(f"Error cancelling invitation {invitation_id} for {owner}/{repo}: {e}")
        return False, str(e)
