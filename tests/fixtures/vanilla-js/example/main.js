console.log('Vanilla JS app loaded');

// Simple utilities
export function $(selector) {
  return document.querySelector(selector);
}

export function $$(selector) {
  return document.querySelectorAll(selector);
}
