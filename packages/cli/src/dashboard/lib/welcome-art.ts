import { getSettings } from '../../lib/settings.js';

export function getWelcomeArt(): string {
  return getSettings().branding.asciiArt;
}
