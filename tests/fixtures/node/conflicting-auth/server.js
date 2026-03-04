const path = require('path');
const express = require('express');
const session = require('express-session');
const passport = require('passport');
const LocalStrategy = require('passport-local').Strategy;
const cookieParser = require('cookie-parser');
require('dotenv').config();

const app = express();
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser());
app.use(
  session({
    secret: process.env.SESSION_SECRET || 'keyboard-cat',
    resave: false,
    saveUninitialized: false,
  }),
);
app.use(passport.initialize());
app.use(passport.session());

// Hardcoded user for demo
const users = [{ id: 1, username: 'admin', password: 'password123' }];

passport.use(
  new LocalStrategy((username, password, done) => {
    const user = users.find((u) => u.username === username && u.password === password);
    if (!user) return done(null, false, { message: 'Invalid credentials' });
    return done(null, user);
  }),
);

passport.serializeUser((user, done) => done(null, user.id));
passport.deserializeUser((id, done) => {
  const user = users.find((u) => u.id === id);
  done(null, user || false);
});

function ensureAuthenticated(req, res, next) {
  if (req.isAuthenticated()) return next();
  res.redirect('/login');
}

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.post(
  '/login',
  passport.authenticate('local', {
    successRedirect: '/dashboard',
    failureRedirect: '/',
  }),
);

app.get('/logout', (req, res) => {
  req.logout(() => {
    res.redirect('/');
  });
});

app.get('/dashboard', ensureAuthenticated, (req, res) => {
  res.send(`<h1>Dashboard</h1><p>Welcome, ${req.user.username}!</p><a href="/logout">Logout</a>`);
});

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', version: '1.0.0' });
});

app.listen(3000, () => {
  console.log('Server running on http://localhost:3000');
});
