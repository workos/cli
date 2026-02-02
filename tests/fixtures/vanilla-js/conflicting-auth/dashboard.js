import { initAuth, requireAuth, onAuthStateChange, getCurrentUser, logout } from './auth.js';

// Simple utilities
function $(selector) {
  return document.querySelector(selector);
}

function createElement(tag, options = {}) {
  const el = document.createElement(tag);
  if (options.text) el.textContent = options.text;
  if (options.className) el.className = options.className;
  if (options.id) el.id = options.id;
  return el;
}

// Initialize auth and protect this page
const user = initAuth();

// Require authentication for dashboard
if (!requireAuth('/')) {
  throw new Error('Authentication required');
}

// Update UI based on auth state using safe DOM methods
function updateAuthUI(user) {
  const authStatus = $('#auth-status');
  const dashboardContent = $('#dashboard-content');

  if (user) {
    if (authStatus) {
      authStatus.textContent = '';
      const welcome = createElement('span', { text: ` | Welcome, ${user.name} | ` });
      const logoutBtn = createElement('button', { id: 'logout-btn', text: 'Logout' });
      logoutBtn.addEventListener('click', () => {
        logout();
        window.location.href = '/';
      });
      authStatus.appendChild(welcome);
      authStatus.appendChild(logoutBtn);
    }
    if (dashboardContent) {
      dashboardContent.textContent = '';

      const welcomeP = createElement('p');
      const strong = createElement('strong', { text: user.name });
      welcomeP.appendChild(document.createTextNode('Welcome back, '));
      welcomeP.appendChild(strong);
      welcomeP.appendChild(document.createTextNode('!'));
      dashboardContent.appendChild(welcomeP);

      dashboardContent.appendChild(createElement('p', { text: `Role: ${user.role}` }));
      dashboardContent.appendChild(createElement('p', { text: `Theme: ${user.preferences.theme}` }));
      dashboardContent.appendChild(createElement('h2', { text: 'Your Stats' }));

      const statsDiv = createElement('div', { className: 'stats' });

      const projectsCard = createElement('div', { className: 'stat-card' });
      projectsCard.appendChild(createElement('h3', { text: 'Projects' }));
      projectsCard.appendChild(createElement('p', { text: '12' }));
      statsDiv.appendChild(projectsCard);

      const tasksCard = createElement('div', { className: 'stat-card' });
      tasksCard.appendChild(createElement('h3', { text: 'Tasks' }));
      tasksCard.appendChild(createElement('p', { text: '47' }));
      statsDiv.appendChild(tasksCard);

      dashboardContent.appendChild(statsDiv);
    }
  }
}

// Listen for auth state changes
onAuthStateChange(updateAuthUI);

// Initial UI update
updateAuthUI(user);
