// ─────────────────────────────────────────────────────────────────────────────
// Config
// ─────────────────────────────────────────────────────────────────────────────
const API_BASE_URL = "http://localhost:8000";

// ─────────────────────────────────────────────────────────────────────────────
// DOM refs
// ─────────────────────────────────────────────────────────────────────────────
const usernameInput = document.getElementById('emailInput');       // input box
const searchBtn = document.getElementById('searchBtn');
const searchBtnText = document.getElementById('searchBtnText');
const searchBtnIcon = document.getElementById('searchBtnIcon');

const scanPanel = document.getElementById('scanPanel');
const scanPercent = document.getElementById('scanPercent');
const scanProgressBar = document.getElementById('scanProgressBar');
const scanFoundBadge = document.getElementById('scanFoundBadge');
const currentRepo = document.getElementById('currentRepo');
const liveResults = document.getElementById('liveResults');

const userInfo = document.getElementById('userInfo');
const userAvatar = document.getElementById('userAvatar');
const userName = document.getElementById('userName');
const repoCount = document.getElementById('repoCount');

const resultsSection = document.getElementById('resultsSection');
const repoTableBody = document.getElementById('repoTableBody');
const selectAllChk = document.getElementById('selectAll');
const removeBtn = document.getElementById('removeBtn');
const toastContainer = document.getElementById('toastContainer');

// ─────────────────────────────────────────────────────────────────────────────
// State
// ─────────────────────────────────────────────────────────────────────────────
let foundRepos = [];      // all repos found during current scan
let selectedIdxs = new Set(); // indices of checked repos
let activeStream = null;    // current EventSource

// ─────────────────────────────────────────────────────────────────────────────
// Event Listeners
// ─────────────────────────────────────────────────────────────────────────────
searchBtn.addEventListener('click', handleSearch);
usernameInput.addEventListener('keypress', e => { if (e.key === 'Enter') handleSearch(); });

selectAllChk.addEventListener('change', e => {
    document.querySelectorAll('.repo-checkbox').forEach(cb => {
        cb.checked = e.target.checked;
        const i = parseInt(cb.dataset.index);
        e.target.checked ? selectedIdxs.add(i) : selectedIdxs.delete(i);
    });
    updateRemoveBtn();
});

removeBtn.addEventListener('click', handleRemoveAccess);


// ─────────────────────────────────────────────────────────────────────────────
// STEP 2–4: Search — open SSE stream
// ─────────────────────────────────────────────────────────────────────────────
function handleSearch() {
    const username = usernameInput.value.trim();
    if (!username) {
        showToast("Please enter a GitHub username.", "error");
        return;
    }

    // Clear any previous input error state
    usernameInput.classList.remove('border-red-500', 'ring-red-500/50', 'ring-2');

    // Close any previous stream
    if (activeStream) { activeStream.close(); activeStream = null; }

    resetUI();
    setSearching(true);

    const es = new EventSource(`${API_BASE_URL}/user-access/stream?username=${encodeURIComponent(username)}`);
    activeStream = es;

    es.onmessage = e => {
        const msg = JSON.parse(e.data);

        // ── start: total repos known, show scan panel ──────────────────────
        if (msg.type === "start") {
            userAvatar.src = msg.avatar_url;
            userName.textContent = `@${msg.username}`;
            repoCount.textContent = `Scanning ${msg.total} repositories…`;
            userInfo.classList.remove('hidden');

            scanPercent.textContent = "0%";
            scanProgressBar.style.width = "0%";
            scanFoundBadge.innerHTML =
                `<i class="fas fa-check-circle mr-1"></i><span id="scanFoundCount">0</span> found`;

            // If the owner is searching themselves, hide the remove controls
            if (msg.is_owner) {
                document.getElementById('removeFooter').classList.add('hidden');
                document.getElementById('selectAllCol').classList.add('hidden');
                // Show an owner info banner
                let banner = document.getElementById('ownerBanner');
                if (!banner) {
                    banner = document.createElement('div');
                    banner.id = 'ownerBanner';
                    banner.className = 'px-6 py-3 bg-yellow-500/10 border-t border-yellow-500/20 text-yellow-300 text-sm flex items-center gap-2';
                    banner.innerHTML = `<i class="fas fa-info-circle"></i> You are viewing your own access. Remove Access is not available for the repository owner.`;
                    document.getElementById('resultsSection').querySelector('.glass-card').appendChild(banner);
                }
            } else {
                document.getElementById('removeFooter').classList.remove('hidden');
                document.getElementById('selectAllCol').classList.remove('hidden');
                const banner = document.getElementById('ownerBanner');
                if (banner) banner.remove();
            }
        }

        // ── scanning: update progress bar ─────────────────────────────────
        else if (msg.type === "scanning") {
            currentRepo.textContent = msg.repo;
            if (msg.total > 0) {
                const pct = Math.round((msg.scanned / msg.total) * 100);
                scanPercent.textContent = `${pct}%`;
                scanProgressBar.style.width = `${pct}%`;
            }
        }

        // ── found: append live row + table row ────────────────────────────
        else if (msg.type === "found") {
            const idx = foundRepos.length;
            foundRepos.push(msg.repo);

            // Update found count badge
            scanFoundBadge.classList.remove('hidden');
            const countEl = document.getElementById('scanFoundCount');
            if (countEl) countEl.textContent = foundRepos.length;

            // Show results table on first hit
            if (foundRepos.length === 1) resultsSection.classList.remove('hidden');

            appendLiveRow(msg.repo);
            appendTableRow(msg.repo, idx);

            // Update user info count
            repoCount.textContent = `Found access to ${foundRepos.length} repositor${foundRepos.length === 1 ? 'y' : 'ies'}`;
        }

        // ── done: scan finished ───────────────────────────────────────────
        else if (msg.type === "done") {
            es.close(); activeStream = null;
            setSearching(false);
            currentRepo.textContent = "✓ Scan complete";
            scanPercent.textContent = "100%";
            scanProgressBar.style.width = "100%";
            repoCount.textContent = `Found access to ${msg.total} repositor${msg.total === 1 ? 'y' : 'ies'}`;

            if (msg.total === 0) {
                showToast("No repositories found for this username.", "info");
                setTimeout(() => scanPanel.classList.add('hidden'), 2500);
            } else {
                showToast(`Found ${msg.total} repositor${msg.total === 1 ? 'y' : 'ies'} with access.`, "success");
            }
        }

        // ── error ─────────────────────────────────────────────────────────
        else if (msg.type === "error") {
            es.close(); activeStream = null;
            setSearching(false);
            showToast(msg.message || "An error occurred.", "error");
        }
    };

    es.onerror = () => {
        es.close(); activeStream = null;
        setSearching(false);
        showToast("Lost connection to backend. Is it running?", "error");
    };
}


// ─────────────────────────────────────────────────────────────────────────────
// STEP 5: Remove access
// ─────────────────────────────────────────────────────────────────────────────
async function handleRemoveAccess() {
    if (selectedIdxs.size === 0) return;

    const count = selectedIdxs.size;
    if (!confirm(`Remove access from ${count} repositor${count === 1 ? 'y' : 'ies'}?`)) return;

    const repos = Array.from(selectedIdxs).map(i => ({
        owner: foundRepos[i].owner,
        repo: foundRepos[i].repo,
        username: foundRepos[i].username,
        status: foundRepos[i].status,
        invitation_id: foundRepos[i].invitation_id ?? null,
    }));

    removeBtn.disabled = true;
    removeBtn.innerHTML = `<i class="fas fa-circle-notch fa-spin"></i><span>Removing…</span>`;

    try {
        const res = await fetch(`${API_BASE_URL}/remove-access`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ repos }),
        });

        if (!res.ok) throw new Error(`Server error: ${res.status}`);

        const data = await res.json();
        const succeeded = data.results.filter(r => r.success).length;
        const failed = data.results.length - succeeded;

        if (succeeded > 0)
            showToast(`Successfully removed access from ${succeeded} repositor${succeeded === 1 ? 'y' : 'ies'}.`, "success");
        if (failed > 0)
            showToast(`Failed to remove ${failed} repositor${failed === 1 ? 'y' : 'ies'}. Check the console.`, "error");

        // Re-scan to refresh results
        handleSearch();

    } catch (err) {
        showToast(err.message, "error");
        updateRemoveBtn();
    }
}


// ─────────────────────────────────────────────────────────────────────────────
// UI helpers
// ─────────────────────────────────────────────────────────────────────────────
function setSearching(isSearching) {
    searchBtn.disabled = isSearching;
    if (isSearching) {
        searchBtnText.textContent = "Scanning…";
        searchBtnIcon.className = "fas fa-circle-notch fa-spin";
        scanPanel.classList.remove('hidden');
    } else {
        searchBtnText.textContent = "Search";
        searchBtnIcon.className = "fas fa-search group-hover:rotate-12 transition-transform";
    }
}

function resetUI() {
    foundRepos = [];
    selectedIdxs.clear();
    repoTableBody.innerHTML = '';
    liveResults.innerHTML = '';
    currentRepo.textContent = '—';
    scanPercent.textContent = '0%';
    scanProgressBar.style.width = '0%';
    scanFoundBadge.classList.add('hidden');
    resultsSection.classList.add('hidden');
    userInfo.classList.add('hidden');
    selectAllChk.checked = false;
    updateRemoveBtn();

    // Restore remove controls (in case previous search was the owner)
    document.getElementById('removeFooter').classList.remove('hidden');
    document.getElementById('selectAllCol').classList.remove('hidden');
    const banner = document.getElementById('ownerBanner');
    if (banner) banner.remove();
}


/** Live row in the scan panel */
function appendLiveRow(repo) {
    const div = document.createElement('div');
    div.className = "flex items-center gap-3 px-6 py-2.5";
    div.innerHTML = `
        <i class="fas fa-check-circle text-green-400 text-xs flex-shrink-0"></i>
        <span class="font-mono text-xs text-gray-300 truncate flex-1">${repo.full_name}</span>
        <span class="text-xs px-2 py-0.5 rounded-full flex-shrink-0 ${statusClass(repo.status)}">${repo.status}</span>
        <span class="text-xs px-2 py-0.5 rounded-full flex-shrink-0 ${permClass(repo.permission)}">${repo.permission}</span>
    `;
    liveResults.appendChild(div);
    liveResults.scrollTop = liveResults.scrollHeight;
}

/** Row in the final results table */
function appendTableRow(repo, index) {
    const tr = document.createElement('tr');
    tr.className = "hover-row border-b border-white/5 transition-colors animate-fade-in";
    tr.innerHTML = `
        <td class="p-5 text-center">
            <input type="checkbox" class="repo-checkbox w-5 h-5 rounded cursor-pointer" data-index="${index}">
        </td>
        <td class="p-5 font-medium text-white">${repo.repo}</td>
        <td class="p-5 text-gray-400">${repo.owner}</td>
        <td class="p-5">
            <span class="px-3 py-1 rounded-full text-xs font-semibold ${permClass(repo.permission)}">${repo.permission}</span>
        </td>
        <td class="p-5">
            <span class="px-3 py-1 rounded-full text-xs font-semibold ${statusClass(repo.status)}">${repo.status}</span>
        </td>
    `;

    tr.querySelector('.repo-checkbox').addEventListener('change', e => {
        const i = parseInt(e.target.dataset.index);
        e.target.checked ? selectedIdxs.add(i) : selectedIdxs.delete(i);
        selectAllChk.checked = selectedIdxs.size === foundRepos.length;
        updateRemoveBtn();
    });

    repoTableBody.appendChild(tr);
}

function permClass(perm) {
    const map = {
        admin: 'bg-purple-500/20 text-purple-300 border border-purple-500/30',
        write: 'bg-green-500/20  text-green-300  border border-green-500/30',
        maintain: 'bg-blue-500/20   text-blue-300   border border-blue-500/30',
        triage: 'bg-yellow-500/20 text-yellow-300 border border-yellow-500/30',
    };
    return map[perm] ?? 'bg-gray-500/20 text-gray-300 border border-gray-500/30';
}

function statusClass(status) {
    return status === 'active'
        ? 'bg-green-500/20  text-green-300  border border-green-500/30'
        : 'bg-yellow-500/20 text-yellow-300 border border-yellow-500/30';
}

function updateRemoveBtn() {
    const n = selectedIdxs.size;
    removeBtn.disabled = n === 0;
    removeBtn.innerHTML = n > 0
        ? `<i class="fas fa-trash-alt"></i><span>Remove Access (${n})</span>`
        : `<i class="fas fa-trash-alt"></i><span>Remove Access</span>`;
}


// ─────────────────────────────────────────────────────────────────────────────
// Toast
// ─────────────────────────────────────────────────────────────────────────────
function showToast(message, type = "info") {
    const iconMap = { success: "check-circle", error: "exclamation-circle", info: "info-circle" };
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerHTML = `
        <i class="fas fa-${iconMap[type] ?? 'info-circle'} text-lg"></i>
        <span class="text-sm font-medium">${message}</span>
    `;
    toastContainer.appendChild(toast);
    setTimeout(() => {
        toast.classList.add('hiding');
        toast.addEventListener('animationend', () => toast.remove());
    }, 4500);
}
