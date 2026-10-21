/**
 * Pure selectors over installer content: which tips and announcements to show
 * for a framework and date, and how to turn walkthrough templates into text.
 */

import type { InstallerEventName } from '../../lib/events.js';
import { placeholdersOf, type Announcement, type InstallerContent, type Tip } from './schema.js';

export interface ContentQuery {
  /** Detected integration id (e.g. `nextjs`), once known. */
  framework?: string;
  now: Date;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * A card with a framework list shows only once that framework is detected;
 * a card without one shows everywhere.
 */
function matchesFramework(card: Tip, framework: string | undefined): boolean {
  return !card.frameworks || (framework !== undefined && card.frameworks.includes(framework));
}

/** `startsAt` is inclusive; a date-only `endsAt` includes that whole day (UTC). */
export function isAnnouncementActive(announcement: Announcement, now: Date): boolean {
  const t = now.getTime();
  if (announcement.startsAt && t < Date.parse(announcement.startsAt)) return false;
  if (announcement.endsAt) {
    const end = Date.parse(announcement.endsAt) + (DATE_ONLY.test(announcement.endsAt) ? DAY_MS : 0);
    if (t >= end) return false;
  }
  return true;
}

export function selectTips(content: InstallerContent, query: ContentQuery): Tip[] {
  return content.tips.filter((tip) => matchesFramework(tip, query.framework));
}

export function selectAnnouncements(content: InstallerContent, query: ContentQuery): Announcement[] {
  return content.announcements.filter(
    (a) => matchesFramework(a, query.framework) && isAnnouncementActive(a, query.now),
  );
}

/** Replace `{name}` with `params.name`. Unknown placeholders are left visible. */
export function interpolate(template: string, params: Record<string, string | number> = {}): string {
  let out = template;
  for (const name of placeholdersOf(template)) {
    if (name in params) out = out.replaceAll(`{${name}}`, String(params[name]));
  }
  return out;
}

/**
 * Walkthrough text for an event, or undefined when the content doesn't narrate
 * it. `variant` picks the outcome for events like `complete`.
 */
export function walkthroughText(
  content: InstallerContent,
  event: InstallerEventName,
  params?: Record<string, string | number>,
  variant?: string,
): string | undefined {
  const copy = content.walkthrough[event];
  if (copy === undefined) return undefined;
  const template = typeof copy === 'string' ? copy : variant !== undefined ? copy[variant] : undefined;
  return template === undefined ? undefined : interpolate(template, params);
}

/** Friendly framework name, falling back to the integration id. */
export function frameworkName(content: InstallerContent, integration: string): string {
  return content.frameworks[integration] ?? integration;
}
