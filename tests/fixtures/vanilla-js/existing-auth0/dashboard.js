import { createAuth0Client } from '@auth0/auth0-spa-js';

async function initDashboard() {
  const auth0Client = await createAuth0Client({
    domain: import.meta.env.VITE_AUTH0_DOMAIN,
    clientId: import.meta.env.VITE_AUTH0_CLIENT_ID,
  });

  const isAuthenticated = await auth0Client.isAuthenticated();
  const content = document.getElementById('dashboard-content');

  // Update nav buttons
  const loginBtn = document.getElementById('login-btn');
  const logoutBtn = document.getElementById('logout-btn');

  if (loginBtn && logoutBtn) {
    loginBtn.style.display = isAuthenticated ? 'none' : 'inline-block';
    logoutBtn.style.display = isAuthenticated ? 'inline-block' : 'none';

    loginBtn.addEventListener('click', async () => {
      await auth0Client.loginWithRedirect({
        authorizationParams: {
          redirect_uri: window.location.origin + '/dashboard.html',
        },
      });
    });

    logoutBtn.addEventListener('click', async () => {
      await auth0Client.logout({
        logoutParams: {
          returnTo: window.location.origin,
        },
      });
    });
  }

  // Clear existing content
  if (content) {
    content.textContent = '';

    if (!isAuthenticated) {
      const p = document.createElement('p');
      p.textContent = 'Please log in to view the dashboard.';
      content.appendChild(p);
      return;
    }

    const user = await auth0Client.getUser();
    const p = document.createElement('p');
    p.textContent = `Welcome, ${user?.name || 'User'}!`;
    content.appendChild(p);
  }
}

initDashboard().catch(console.error);
