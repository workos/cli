import { getConfig } from '../../lib/settings.js';

export function getWelcomeArt(): string {
  return getConfig().branding.asciiArt;
}
