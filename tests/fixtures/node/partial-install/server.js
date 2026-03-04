const path = require('path');
const express = require('express');
const { WorkOS } = require('@workos-inc/node');
require('dotenv').config();

const app = express();

const workos = new WorkOS(process.env.WORKOS_API_KEY, {
  clientId: process.env.WORKOS_CLIENT_ID,
});

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/login', (req, res) => {
  const authorizationUrl = workos.userManagement.getAuthorizationUrl({
    provider: 'authkit',
    redirectUri: process.env.WORKOS_REDIRECT_URI,
    clientId: process.env.WORKOS_CLIENT_ID,
  });
  // TODO: redirect user to authorizationUrl
  res.status(501).send('Not implemented');
});

// TODO: implement /callback route to exchange code for user

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', version: '1.0.0' });
});

app.listen(3000, () => {
  console.log('Server running on http://localhost:3000');
});
