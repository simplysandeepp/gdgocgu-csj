let allUsers = [];
let filteredUsers = [];
const leaderboardBody = document.getElementById('leaderboardBody');
const loadingState = document.getElementById('loadingState');
const emptyState = document.getElementById('emptyState');
const totalUsersEl = document.getElementById('totalUsers');
const completedUsersEl = document.getElementById('completedUsers');
const lastUpdatedEl = document.getElementById('lastUpdated');
const searchInput = document.getElementById('searchInput');

document.addEventListener('DOMContentLoaded', () => {
    setupSearch();
    loadData();
    updateLastUpdated();
});

async function loadData() {
    try {
        showLoading(true);
        const response = await fetch('/api/leaderboard');
        if (!response.ok) {
            throw new Error('Failed to load data');
        }
        const result = await response.json();
        if (!result.success) {
            throw new Error(result.message || 'Failed to load data');
        }
        const csvText = result.data.content;
        console.log('Loading data from secure API');
        allUsers = parseCSV(csvText);
        processUsers();
        filteredUsers = [...allUsers];
        updateStats();
        renderLeaderboard(filteredUsers);
        updateLastUpdated(result.data.modified);
        
        // Smooth loading transition
        setTimeout(() => {
            showLoading(false);
        }, 300);
    } catch (error) {
        console.error('Error loading data:', error);
        showLoading(false);
        showEmptyState(true);
        showToast(error.message || 'Unable to load leaderboard data right now.');
    }
}

function parseCSV(csvText) {
    const lines = csvText.trim().split('\n');
    const headers = lines[0].split(',');
    const users = [];
    
    for (let i = 1; i < lines.length; i++) {
        const line = lines[i];
        if (!line.trim()) continue;
        
        const values = parseCSVLine(line);
        if (values.length < headers.length) continue;
        
        let userName = values[0]?.trim() || 'Unknown';
        const userEmail = values[1]?.trim() || '';
        const profileUrl = values[2]?.trim() || '';
        
        // Handle special cases
        if (userName === 'gdg.nit@gmail.com') {
            userName = 'Suman Jash';
        } else if (userName === 'https://www.cloudskillsboost.google/public_profiles/d1b5eca9-3675-41a9-bf18-b995d8622d29') {
            userName = 'Mohd Faraz';
        }
        
        const user = {
            name: userName,
            email: userEmail,
            profileUrl: profileUrl,
            profileStatus: values[3]?.trim() || '',
            accessCodeRedeemed: values[4]?.trim() === 'Yes',
            allCompleted: values[5]?.trim() === 'Yes',
            badgesCount: parseInt(values[6]) || 0,
            badgeNames: values[7]?.trim() || '',
            gamesCount: parseInt(values[8]) || 0,
            gameNames: values[9]?.trim() || '',
            originalIndex: i
        };
        
        users.push(user);
    }
    
    return users;
}

function parseCSVLine(line) {
    const result = [];
    let current = '';
    let inQuotes = false;
    
    for (let i = 0; i < line.length; i++) {
        const char = line[i];
        if (char === '"') {
            inQuotes = !inQuotes;
        } else if (char === ',' && !inQuotes) {
            result.push(current);
            current = '';
        } else {
            current += char;
        }
    }
    result.push(current);
    return result;
}

function processUsers() {
    allUsers.sort((a, b) => {
        if (b.badgesCount !== a.badgesCount) {
            return b.badgesCount - a.badgesCount;
        }
        if (b.gamesCount !== a.gamesCount) {
            return b.gamesCount - a.gamesCount;
        }
        return a.originalIndex - b.originalIndex;
    });
    
    allUsers.forEach((user, index) => {
        user.rank = index + 1;
    });
}

function renderLeaderboard(users) {
    if (users.length === 0) {
        showEmptyState(true);
        leaderboardBody.innerHTML = '';
        return;
    }
    
    showEmptyState(false);
    leaderboardBody.innerHTML = '';
    
    users.forEach((user, index) => {
        const row = createUserRow(user, index);
        leaderboardBody.appendChild(row);
    });
}

function createUserRow(user, index) {
    const tr = document.createElement('tr');
    tr.style.setProperty('--index', index);
    
    // Rank
    const rankTd = document.createElement('td');
    rankTd.innerHTML = getRankHTML(user.rank);
    tr.appendChild(rankTd);
    
    // Name
    const nameTd = document.createElement('td');
    nameTd.innerHTML = getUserInfoHTML(user);
    tr.appendChild(nameTd);
    
    const allocationTd = document.createElement('td');
    allocationTd.className = 'td-center';
    allocationTd.innerHTML = getAllocationHTML(user);
    tr.appendChild(allocationTd);
    
    return tr;
}

function getRankHTML(rank) {
    let medal = '';
    let className = 'rank';
    
    if (rank === 1) {
        medal = '🥇';
        className += ' top-1';
    } else if (rank === 2) {
        medal = '🥈';
        className += ' top-2';
    } else if (rank === 3) {
        medal = '🥉';
        className += ' top-3';
    }
    
    return `
        <div class="${className}">
            ${medal ? `<span class="medal">${medal}</span>` : ''}
            <span class="rank-number">#${rank}</span>
        </div>
    `;
}

function getUserInfoHTML(user) {
    const initials = getInitials(user.name);
    return `
        <div class="user-info">
            <div class="avatar">${initials}</div>
            <div class="user-details">
                <a href="${user.profileUrl}" target="_blank" rel="noopener noreferrer" class="user-name">
                    ${escapeHTML(user.name)}
                </a>
            </div>
        </div>
    `;
}

function getAllocationHTML(user) {
    if (user.badgeNames && user.badgeNames.trim()) {
        return `<div class="status completed">${formatAllocationWithEmoji(user.badgeNames)}</div>`;
    }
    return '<div class="status not-started">No Goodies</div>';
}

function formatAllocationWithEmoji(text) {
    const safe = escapeHTML(text);
    return safe
        .replace(/\bWater Bottle\b/g, '🧴 Water Bottle')
        .replace(/\bT-Shirt\b/g, '👕 T-Shirt')
        .replace(/\bBag\b/g, '🎒 Bag');
}

function updateStats() {
    const total = allUsers.length;
    const allocated = allUsers.filter(u => (u.badgesCount || 0) > 0).length;
    
    animateValue(totalUsersEl, 0, total, 1500);
    animateValue(completedUsersEl, 0, allocated, 1500);
}

function setupSearch() {
    if (!searchInput) return;

    const onSearch = debounce(() => {
        const query = (searchInput.value || '').trim().toLowerCase();

        filteredUsers = query
            ? allUsers.filter((user) => user.name.toLowerCase().includes(query))
            : [...allUsers];

        renderLeaderboard(filteredUsers);
    }, 120);

    searchInput.addEventListener('input', onSearch);
}

function animateValue(element, start, end, duration) {
    const range = end - start;
    const increment = range / (duration / 16);
    let current = start;
    
    const timer = setInterval(() => {
        current += increment;
        if (current >= end) {
            element.textContent = end;
            clearInterval(timer);
            
            // Add bounce effect on completion
            element.style.transform = 'scale(1.1)';
            setTimeout(() => {
                element.style.transform = 'scale(1)';
            }, 200);
        } else {
            element.textContent = Math.floor(current);
        }
    }, 16);
}

function getInitials(name) {
    if (!name) return '?';
    const parts = name.trim().split(' ');
    if (parts.length === 1) {
        return parts[0].substring(0, 2).toUpperCase();
    }
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function escapeHTML(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

function showLoading(show) {
    loadingState.style.display = show ? 'flex' : 'none';
    if (show) {
        loadingState.style.opacity = '1';
    }
}

function showEmptyState(show) {
    emptyState.style.display = show ? 'flex' : 'none';
}

function showToast(message) {
    let toast = document.getElementById('apiToast');
    if (!toast) {
        toast = document.createElement('div');
        toast.id = 'apiToast';
        toast.style.position = 'fixed';
        toast.style.right = '20px';
        toast.style.bottom = '20px';
        toast.style.padding = '10px 14px';
        toast.style.background = '#1f2937';
        toast.style.color = '#fff';
        toast.style.borderRadius = '8px';
        toast.style.boxShadow = '0 8px 24px rgba(0,0,0,0.2)';
        toast.style.zIndex = '9999';
        toast.style.fontSize = '0.9rem';
        toast.style.opacity = '0';
        toast.style.transition = 'opacity 180ms ease';
        document.body.appendChild(toast);
    }

    toast.textContent = message;
    toast.style.opacity = '1';
    setTimeout(() => {
        toast.style.opacity = '0';
    }, 3200);
}

function updateLastUpdated(modifiedTimestamp) {
    const now = new Date();
    const formatted = now.toLocaleString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    });
    
    if (modifiedTimestamp) {
        const date = new Date(modifiedTimestamp * 1000);
        lastUpdatedEl.textContent = date.toLocaleString('en-US', {
            year: 'numeric',
            month: 'long',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
    } else {
        lastUpdatedEl.textContent = formatted;
    }
    
    // Animate the update
    lastUpdatedEl.style.transform = 'scale(1.05)';
    setTimeout(() => {
        lastUpdatedEl.style.transform = 'scale(1)';
    }, 300);
}

// Add smooth scroll behavior
document.querySelectorAll('a[href^="#"]').forEach(anchor => {
    anchor.addEventListener('click', function (e) {
        e.preventDefault();
        const target = document.querySelector(this.getAttribute('href'));
        if (target) {
            target.scrollIntoView({
                behavior: 'smooth',
                block: 'start'
            });
        }
    });
});

// Add intersection observer for staggered animations
const observerOptions = {
    threshold: 0.1,
    rootMargin: '0px 0px -50px 0px'
};

const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
        if (entry.isIntersecting) {
            entry.target.style.opacity = '1';
            entry.target.style.transform = 'translateY(0)';
        }
    });
}, observerOptions);

// Observe fade-in elements
document.querySelectorAll('.fade-in-up').forEach(el => {
    observer.observe(el);
});

// Export for debugging
window.leaderboardApp = {
    allUsers,
    filteredUsers,
    loadData,
    renderLeaderboard
};