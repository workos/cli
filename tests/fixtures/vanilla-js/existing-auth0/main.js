import { createAuth0Client } from '@auth0/auth0-spa-js';

let auth0Client = null;

async function initAuth0() {
  auth0Client = await createAuth0Client({
    domain: import.meta.env.VITE_AUTH0_DOMAIN,
    clientId: import.meta.env.VITE_AUTH0_CLIENT_ID,
  });

  // Check if user is authenticated
  const isAuthenticated = await auth0Client.isAuthenticated();
  updateUI(isAuthenticated);

  // Handle callback
  if (window.location.search.includes('code=')) {
    await auth0Client.handleRedirectCallback();
    window.history.replaceState({}, document.title, window.location.pathname);
    updateUI(true);
  }
}

function updateUI(isAuthenticated) {
  const loginBtn = document.getElementById('login-btn');
  const logoutBtn = document.getElementById('logout-btn');

  if (loginBtn && logoutBtn) {
    loginBtn.style.display = isAuthenticated ? 'none' : 'inline-block';
    logoutBtn.style.display = isAuthenticated ? 'inline-block' : 'none';
  }
}

async function login() {
  await auth0Client.loginWithRedirect({
    authorizationParams: {
      redirect_uri: window.location.origin,
    },
  });
}

async function logout() {
  await auth0Client.logout({
    logoutParams: {
      returnTo: window.location.origin,
    },
  });
}

// Initialize
initAuth0().catch(console.error);

// Expose functions globally
window.auth0Login = login;
window.auth0Logout = logout;

// Attach event listeners
document.getElementById('login-btn')?.addEventListener('click', login);
document.getElementById('logout-btn')?.addEventListener('click', logout);

export { auth0Client, login, logout };
