const API_BASE = window.location.origin;
const VERIFY_API = `${API_BASE}/api/admin/verify`;
const UPLOAD_API = `${API_BASE}/api/admin/upload`;
const STATS_API = `${API_BASE}/api/stats`;
const INFO_API = `${API_BASE}/api/admin/info`;
const DOWNLOAD_API = `${API_BASE}/api/admin/download`;
const INVENTORY_API = `${API_BASE}/api/admin/inventory`;
const ALLOCATIONS_API = `${API_BASE}/api/admin/allocations`;

const SESSION_KEY = 'gdg_admin_session';
const TOKEN_KEY = 'gdg_admin_token';
const SESSION_DURATION = 3600000;

let loginForm, loginError, password;
let adminDashboard, logoutBtn;
let dropZone, fileInput, filePreview, uploadForm, uploadBtn;
let uploadSuccess, uploadError, errorMessage;
let currentFileName, lastModified, fileSize;
let downloadBackup, removeFileBtn;
let previewName, previewSize;

let bagInput, bottleInput, tshirtInput;
let saveInventoryBtn, refreshAllocationBtn;
let allocationSummary, allocationTableBody;

let selectedFile = null;

document.addEventListener('DOMContentLoaded', () => {
    initializeElements();
    checkSession();
    setupEventListeners();
    loadFileInfo();
});

function initializeElements() {
    loginForm = document.getElementById('loginForm');
    loginError = document.getElementById('loginError');
    password = document.getElementById('password');

    adminDashboard = document.getElementById('adminDashboard');
    logoutBtn = document.getElementById('logoutBtn');

    dropZone = document.getElementById('dropZone');
    fileInput = document.getElementById('fileInput');
    filePreview = document.getElementById('filePreview');
    uploadForm = document.getElementById('uploadForm');
    uploadBtn = document.getElementById('uploadBtn');
    removeFileBtn = document.getElementById('removeFile');

    uploadSuccess = document.getElementById('uploadSuccess');
    uploadError = document.getElementById('uploadError');
    errorMessage = document.getElementById('errorMessage');

    currentFileName = document.getElementById('currentFileName');
    lastModified = document.getElementById('lastModified');
    fileSize = document.getElementById('fileSize');

    previewName = document.getElementById('previewName');
    previewSize = document.getElementById('previewSize');

    downloadBackup = document.getElementById('downloadBackup');

    bagInput = document.getElementById('bagCount');
    bottleInput = document.getElementById('bottleCount');
    tshirtInput = document.getElementById('tshirtCount');
    saveInventoryBtn = document.getElementById('saveInventoryBtn');
    refreshAllocationBtn = document.getElementById('refreshAllocationBtn');
    allocationSummary = document.getElementById('allocationSummary');
    allocationTableBody = document.getElementById('allocationTableBody');
}

function checkSession() {
    const session = localStorage.getItem(SESSION_KEY);
    const token = localStorage.getItem(TOKEN_KEY);

    if (session && token) {
        const sessionData = JSON.parse(session);
        const now = Date.now();

        if (now - sessionData.timestamp < SESSION_DURATION) {
            showDashboard();
            return;
        }
    }

    destroySession();
    showLogin();
}

function createSession(token) {
    localStorage.setItem(
        SESSION_KEY,
        JSON.stringify({
            timestamp: Date.now()
        })
    );
    localStorage.setItem(TOKEN_KEY, token);
}

function destroySession() {
    localStorage.removeItem(SESSION_KEY);
    localStorage.removeItem(TOKEN_KEY);
}

function getToken() {
    return localStorage.getItem(TOKEN_KEY);
}

function showLogin() {
    document.getElementById('loginScreen').style.display = 'flex';
    adminDashboard.style.display = 'none';
}

async function showDashboard() {
    document.getElementById('loginScreen').style.display = 'none';
    adminDashboard.style.display = 'block';

    await Promise.all([
        loadStatistics(),
        loadInventory(),
        loadAllocations()
    ]);
}

function setupEventListeners() {
    loginForm.addEventListener('submit', handleLogin);
    logoutBtn.addEventListener('click', handleLogout);
    fileInput.addEventListener('change', handleFileSelect);

    dropZone.addEventListener('dragover', handleDragOver);
    dropZone.addEventListener('dragleave', handleDragLeave);
    dropZone.addEventListener('drop', handleDrop);

    uploadForm.addEventListener('submit', handleUpload);
    removeFileBtn.addEventListener('click', clearFileSelection);
    downloadBackup.addEventListener('click', handleDownloadBackup);

    saveInventoryBtn.addEventListener('click', handleSaveInventory);
    refreshAllocationBtn.addEventListener('click', loadAllocations);
}

async function handleLogin(e) {
    e.preventDefault();

    const enteredPassword = password.value;
    loginError.style.display = 'none';

    const submitButton = loginForm.querySelector('button');
    submitButton.disabled = true;
    submitButton.textContent = 'Verifying...';

    try {
        const response = await fetch(VERIFY_API, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ password: enteredPassword })
        });

        const result = await response.json();

        if (!result.success || !result.data?.token) {
            throw new Error(result.message || 'Invalid password');
        }

        createSession(result.data.token);
        password.value = '';
        await showDashboard();
    } catch (error) {
        loginError.textContent = error.message || 'Incorrect password. Please try again.';
        loginError.style.display = 'block';
        password.value = '';
        password.focus();
    } finally {
        submitButton.disabled = false;
        submitButton.innerHTML = `
            <svg class="btn-icon" viewBox="0 0 24 24" fill="none">
                <path d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
            Login
        `;
    }
}

function handleLogout() {
    destroySession();
    showLogin();
    clearFileSelection();
    hideAlerts();
}

async function loadStatistics() {
    try {
        const response = await fetch(STATS_API);
        const result = await response.json();

        if (!result.success) {
            throw new Error(result.message || 'Failed to load statistics');
        }

        const stats = result.data;

        animateValue(document.getElementById('statTotal'), 0, stats.total, 900);
        animateValue(document.getElementById('statCompleted'), 0, stats.completed, 900);
        animateValue(document.getElementById('statInProgress'), 0, stats.inProgress, 900);
        animateValue(document.getElementById('statRedeemed'), 0, stats.redeemed, 900);

        document.getElementById('statCompletedPercent').textContent = `${stats.completedPercent}%`;
        document.getElementById('statInProgressPercent').textContent = `${stats.inProgressPercent}%`;
        document.getElementById('statRedeemedPercent').textContent = `${stats.redeemedPercent}%`;

        animateValue(document.getElementById('totalBadges'), 0, stats.badges.total, 900);
        document.getElementById('avgBadges').textContent = stats.badges.average;
        document.getElementById('maxBadges').textContent = stats.badges.max;
        animateValue(document.getElementById('highBadges'), 0, stats.badges.highUsers, 900);

        animateValue(document.getElementById('totalGames'), 0, stats.games.total, 900);
        document.getElementById('avgGames').textContent = stats.games.average;
        document.getElementById('maxGames').textContent = stats.games.max;
        animateValue(document.getElementById('usersWithGames'), 0, stats.games.usersWithGames, 900);
    } catch (error) {
        showError(error.message || 'Error loading statistics.');
    }
}

function animateValue(element, start, end, duration) {
    if (!element) return;

    const range = end - start;
    const increment = range / (duration / 16);
    let current = start;

    const timer = setInterval(() => {
        current += increment;
        if (current >= end) {
            element.textContent = end;
            clearInterval(timer);
        } else {
            element.textContent = Math.floor(current);
        }
    }, 16);
}

function handleFileSelect(e) {
    const file = e.target.files[0];
    if (file) {
        validateAndSetFile(file);
    }
}

function handleDragOver(e) {
    e.preventDefault();
    dropZone.classList.add('drag-over');
}

function handleDragLeave(e) {
    e.preventDefault();
    dropZone.classList.remove('drag-over');
}

function handleDrop(e) {
    e.preventDefault();
    dropZone.classList.remove('drag-over');

    const file = e.dataTransfer.files[0];
    if (file) {
        validateAndSetFile(file);
    }
}

function validateAndSetFile(file) {
    hideAlerts();

    if (!file.name.toLowerCase().endsWith('.csv')) {
        showError('Please select a valid CSV file.');
        return;
    }

    if (file.size > 10 * 1024 * 1024) {
        showError('File size must be less than 10MB.');
        return;
    }

    selectedFile = file;
    showFilePreview(file);
    uploadBtn.disabled = false;
}

function showFilePreview(file) {
    previewName.textContent = file.name;
    previewSize.textContent = formatFileSize(file.size);

    dropZone.style.display = 'none';
    filePreview.style.display = 'block';
}

function clearFileSelection() {
    selectedFile = null;
    fileInput.value = '';

    dropZone.style.display = 'flex';
    filePreview.style.display = 'none';
    uploadBtn.disabled = true;
    hideAlerts();
}

async function handleUpload(e) {
    e.preventDefault();

    if (!selectedFile) {
        showError('Please select a file first.');
        return;
    }

    const token = getToken();
    if (!token) {
        showError('Session expired. Please login again.');
        handleLogout();
        return;
    }

    hideAlerts();
    uploadBtn.disabled = true;
    uploadBtn.innerHTML = `
        <svg class="btn-icon" style="animation: spin 1s linear infinite;" viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" opacity="0.25"/>
            <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" stroke-width="4" stroke-linecap="round"/>
        </svg>
        Uploading...
    `;

    try {
        const formData = new FormData();
        formData.append('file', selectedFile);

        const response = await fetch(UPLOAD_API, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${token}`
            },
            body: formData
        });

        const result = await response.json();

        if (!result.success) {
            if (result.message === 'Unauthorized') {
                handleLogout();
                throw new Error('Session expired. Please login again.');
            }
            throw new Error(result.message);
        }

        uploadSuccess.style.display = 'flex';
        clearFileSelection();
        await Promise.all([loadFileInfo(), loadStatistics(), loadAllocations()]);

        setTimeout(() => {
            uploadSuccess.style.display = 'none';
        }, 5000);
    } catch (error) {
        showError(error.message || 'Failed to upload file. Please try again.');
    } finally {
        uploadBtn.disabled = false;
        uploadBtn.innerHTML = `
            <svg class="btn-icon" viewBox="0 0 24 24" fill="none">
                <path d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
            Upload & Replace
        `;
    }
}

async function loadFileInfo() {
    try {
        const response = await fetch(INFO_API);
        const result = await response.json();

        if (!result.success || !result.data) {
            throw new Error(result.message || 'File info unavailable');
        }

        currentFileName.textContent = result.data.filename;
        lastModified.textContent = formatDate(result.data.modified * 1000);
        fileSize.textContent = formatFileSize(result.data.size);
    } catch (_error) {
        currentFileName.textContent = 'data.csv';
        lastModified.textContent = 'Not available';
        fileSize.textContent = 'Not available';
    }
}

async function handleDownloadBackup() {
    const token = getToken();
    if (!token) {
        showError('Session expired. Please login again.');
        handleLogout();
        return;
    }

    window.location.href = `${DOWNLOAD_API}?token=${encodeURIComponent(token)}`;
}

async function loadInventory() {
    const token = getToken();
    if (!token) return;

    try {
        const response = await fetch(INVENTORY_API, {
            headers: {
                Authorization: `Bearer ${token}`
            }
        });
        const result = await response.json();

        if (!result.success || !result.data) {
            throw new Error(result.message || 'Unable to load inventory.');
        }

        bagInput.value = result.data.bag ?? 0;
        bottleInput.value = result.data.waterBottle ?? 0;
        tshirtInput.value = result.data.tShirt ?? 0;
    } catch (error) {
        showError(error.message || 'Unable to load inventory.');
    }
}

async function handleSaveInventory() {
    const token = getToken();
    if (!token) {
        showError('Session expired. Please login again.');
        handleLogout();
        return;
    }

    saveInventoryBtn.disabled = true;
    saveInventoryBtn.textContent = 'Saving...';

    try {
        const payload = {
            bag: Number.parseInt(bagInput.value || '0', 10) || 0,
            waterBottle: Number.parseInt(bottleInput.value || '0', 10) || 0,
            tShirt: Number.parseInt(tshirtInput.value || '0', 10) || 0
        };

        const response = await fetch(INVENTORY_API, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${token}`
            },
            body: JSON.stringify(payload)
        });

        const result = await response.json();
        if (!result.success) {
            throw new Error(result.message || 'Failed to save inventory');
        }

        await loadAllocations();
        uploadSuccess.style.display = 'flex';
        uploadSuccess.querySelector('.alert-message').textContent = 'Inventory saved and allocation recomputed.';
        setTimeout(() => {
            uploadSuccess.style.display = 'none';
            uploadSuccess.querySelector('.alert-message').textContent = 'The leaderboard data has been updated.';
        }, 2800);
    } catch (error) {
        showError(error.message || 'Failed to save inventory.');
    } finally {
        saveInventoryBtn.disabled = false;
        saveInventoryBtn.textContent = 'Save Inventory';
    }
}

async function loadAllocations() {
    const token = getToken();
    if (!token) return;

    refreshAllocationBtn.disabled = true;

    try {
        const response = await fetch(ALLOCATIONS_API, {
            headers: {
                Authorization: `Bearer ${token}`
            }
        });
        const result = await response.json();

        if (!result.success || !result.data) {
            throw new Error(result.message || 'Unable to generate allocations');
        }

        const summary = result.data.summary;
        allocationSummary.innerHTML = `
            <div class="summary-chip">Participants: <strong>${summary.participants}</strong></div>
            <div class="summary-chip">Allocated: <strong>${summary.allocatedParticipants}</strong></div>
            <div class="summary-chip">Bag: <strong>${summary.bagGiven}</strong></div>
            <div class="summary-chip">Bottle: <strong>${summary.bottleGiven}</strong></div>
            <div class="summary-chip">T-Shirt: <strong>${summary.tShirtGiven}</strong></div>
            <div class="summary-chip">Left (B/Bo/T): <strong>${summary.inventoryLeft.bag}/${summary.inventoryLeft.waterBottle}/${summary.inventoryLeft.tShirt}</strong></div>
        `;

        allocationTableBody.innerHTML = '';
        result.data.rows.forEach((row) => {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td>#${row.rank}</td>
                <td>${escapeHTML(row.name)}</td>
                <td>${row.items.length ? row.items.join(', ') : '-'}</td>
            `;
            allocationTableBody.appendChild(tr);
        });
    } catch (error) {
        showError(error.message || 'Unable to generate allocations.');
    } finally {
        refreshAllocationBtn.disabled = false;
    }
}

function formatFileSize(bytes) {
    if (bytes === 0) return '0 Bytes';

    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));

    return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
}

function formatDate(timestamp) {
    return new Date(timestamp).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    });
}

function showError(message) {
    errorMessage.textContent = message;
    uploadError.style.display = 'flex';
}

function hideAlerts() {
    uploadSuccess.style.display = 'none';
    uploadError.style.display = 'none';
}

function escapeHTML(value) {
    const div = document.createElement('div');
    div.textContent = value;
    return div.innerHTML;
}

const style = document.createElement('style');
style.textContent = `
    @keyframes spin {
        from { transform: rotate(0deg); }
        to { transform: rotate(360deg); }
    }
`;
document.head.appendChild(style);
