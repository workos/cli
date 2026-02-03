import { initAuth, login, logout, onAuthStateChange, isAuthenticated, getCurrentUser } from './auth.js';

console.log('Vanilla JS app loaded');

// Simple utilities
export function $(selector) {
  return document.querySelector(selector);
}

export function $$(selector) {
  return document.querySelectorAll(selector);
}

// Initialize authentication
const user = initAuth();

// Update UI based on auth state
function updateAuthUI(user) {
  const authStatus = $('#auth-status');
  const loginSection = $('#login-section');

  if (user) {
    if (authStatus) {
      // Note: This uses innerHTML which should be sanitized in production
      authStatus.textContent = '';
      const welcome = document.createElement('span');
      welcome.textContent = ` | Welcome, ${user.name} | `;
      const logoutBtn = document.createElement('button');
      logoutBtn.id = 'logout-btn';
      logoutBtn.textContent = 'Logout';
      logoutBtn.addEventListener('click', () => logout());
      authStatus.appendChild(welcome);
      authStatus.appendChild(logoutBtn);
    }
    if (loginSection) {
      loginSection.style.display = 'none';
    }
  } else {
    if (authStatus) {
      authStatus.textContent = '';
    }
    if (loginSection) {
      loginSection.style.display = 'block';
    }
  }
}

// Listen for auth state changes
onAuthStateChange(updateAuthUI);

// Initial UI update
updateAuthUI(user);

// Handle login form
const loginForm = $('#login-form');
if (loginForm) {
  loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = $('#email').value;
    const password = $('#password').value;

    try {
      await login({ email, password });
    } catch (error) {
      alert('Login failed: ' + error.message);
    }
  });
}
