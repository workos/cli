// Custom authentication module for Vanilla JS
// This module provides existing auth functionality that should be preserved

const AUTH_STORAGE_KEY = 'app_auth_state';

// Simple event system for auth state changes
const authListeners = new Set();

export function onAuthStateChange(callback) {
  authListeners.add(callback);
  return () => authListeners.delete(callback);
}

function notifyAuthStateChange(user) {
  authListeners.forEach((callback) => callback(user));
}

// Get current auth state from localStorage
export function getCurrentUser() {
  try {
    const stored = localStorage.getItem(AUTH_STORAGE_KEY);
    if (stored) {
      const data = JSON.parse(stored);
      // Check if session is expired
      if (data.expiresAt && Date.now() > data.expiresAt) {
        logout();
        return null;
      }
      return data.user;
    }
  } catch {
    // Invalid stored data
    localStorage.removeItem(AUTH_STORAGE_KEY);
  }
  return null;
}

// Simple login function (mock implementation)
export async function login(credentials) {
  // Simulate API call
  await new Promise((resolve) => setTimeout(resolve, 500));

  if (!credentials.email || !credentials.password) {
    throw new Error('Email and password required');
  }

  const user = {
    id: 'user-' + Math.random().toString(36).substr(2, 9),
    email: credentials.email,
    name: credentials.email.split('@')[0],
    role: 'user',
    preferences: {
      theme: 'light',
      notifications: true,
    },
  };

  const authState = {
    user,
    expiresAt: Date.now() + 24 * 60 * 60 * 1000, // 24 hours
  };

  localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(authState));
  notifyAuthStateChange(user);

  return user;
}

export function logout() {
  localStorage.removeItem(AUTH_STORAGE_KEY);
  notifyAuthStateChange(null);
}

// Check if user is authenticated
export function isAuthenticated() {
  return getCurrentUser() !== null;
}

// Protect a page - redirect if not authenticated
export function requireAuth(redirectTo = '/') {
  if (!isAuthenticated()) {
    window.location.href = redirectTo;
    return false;
  }
  return true;
}

// Initialize auth state on page load
export function initAuth() {
  const user = getCurrentUser();
  if (user) {
    notifyAuthStateChange(user);
  }
  return user;
}
