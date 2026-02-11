const path = require('path');
const express = require('express');
const cookieParser = require('cookie-parser');
const { auth, requiresAuth } = require('express-openid-connect');
require('dotenv').config();

const app = express();

app.use(cookieParser());

app.use(
  auth({
    authRequired: false,
    auth0Logout: true,
    secret: process.env.AUTH0_SECRET,
    baseURL: process.env.AUTH0_BASE_URL || 'http://localhost:3000',
    clientID: process.env.AUTH0_CLIENT_ID,
    issuerBaseURL: `https://${process.env.AUTH0_DOMAIN}`,
  }),
);

app.get('/', (req, res) => {
  if (req.oidc.isAuthenticated()) {
    const user = req.oidc.user;
    res.send(`
      <h1>Welcome, ${user.name}!</h1>
      <p>Email: ${user.email}</p>
      <p><a href="/logout">Sign out</a></p>
    `);
  } else {
    res.sendFile(path.join(__dirname, 'index.html'));
  }
});

app.get('/profile', requiresAuth(), (req, res) => {
  res.json(req.oidc.user);
});

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', version: '1.0.0' });
});

app.listen(3000, () => {
  console.log('Server running on http://localhost:3000');
});
