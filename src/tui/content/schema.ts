/**
 * Schema for the full-screen installer's swappable content: task labels,
 * walkthrough copy, tips, and announcements.
 *
 * The content itself is data (installer-content.json). This file is the
 * contract between that data and the run model: which tasks exist, which
 * installer events the walkthrough can narrate, and which `{placeholders}` each
 * event supplies. Validation runs once when the content loads, so a bad edit
 * fails the content tests instead of rendering broken copy mid-install.
 */

import { z } from 'zod';
import { INSTALLER_EVENT_NAMES, type InstallerEventName } from '../../lib/events.js';

/** Task ids in display order. The run model owns what moves each one. */
export const TASK_IDS = [
  'sign-in',
  'scaffold',
  'inspect',
  'credentials',
  'configure',
  'install',
  'verify',
  'finish',
] as const;
export type TaskId = (typeof TASK_IDS)[number];

/**
 * Placeholders each narrated event can fill, e.g. `{branch}` for
 * `branch:created`. An event that isn't listed supplies none. The run model
 * builds exactly these params; the content validator rejects any other
 * placeholder.
 */
export const WALKTHROUGH_PARAMS: Partial<Record<InstallerEventName, readonly string[]>> = {
  'auth:failure': [],
  'scaffold:start': ['packageManager'],
  'detection:complete': ['framework'],
  'git:dirty': ['count'],
  'branch:protected': ['branch'],
  'branch:created': ['branch'],
  'credentials:env:found': ['file'],
  'device:started': ['url', 'code'],
  'agent:retry': ['attempt', 'maxRetries'],
  'file:write': ['path'],
  'file:edit': ['path'],
  'agent:tool': ['command'],
  'validation:complete': ['count'],
  'postinstall:changes': ['count'],
  'postinstall:commit:success': ['message'],
  'postinstall:pr:success': ['url'],
};

/**
 * Events whose copy depends on the outcome. Their walkthrough entry must be an
 * object with exactly these keys instead of a single string.
 */
export const WALKTHROUGH_VARIANTS: Partial<Record<InstallerEventName, readonly string[]>> = {
  'validation:complete': ['passed', 'failed'],
  complete: ['success', 'failure', 'cancelled'],
};

const PLACEHOLDER = /\{([a-zA-Z][a-zA-Z0-9]*)\}/g;

/** Placeholder names used in a template, e.g. `"On {branch}"` → `['branch']`. */
export function placeholdersOf(template: string): string[] {
  return [...template.matchAll(PLACEHOLDER)].map((m) => m[1]);
}

/** Date-only (`2026-10-01`) or full ISO timestamp. */
const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}(T[\d:.]+(Z|[+-]\d{2}:\d{2}))?$/, 'expected an ISO date like 2026-10-01')
  .refine((s) => !Number.isNaN(Date.parse(s)), 'not a real date');

const id = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'expected a lowercase-kebab id');
const text = z.string().trim().min(1);

const taskSchema = z.strictObject({
  label: text,
  /** Shown while the task is in progress, e.g. "Signing in to WorkOS". */
  activeLabel: text.optional(),
});

const cardFields = {
  id,
  title: text,
  body: text,
  /** A command worth trying, rendered as code. */
  command: text.optional(),
  url: z.url({ protocol: /^https$/ }).optional(),
  /** Integration ids (e.g. `nextjs`). Omit to show for every framework. */
  frameworks: z.array(text).min(1).optional(),
};

const tipSchema = z.strictObject(cardFields);

const announcementSchema = z.strictObject({
  ...cardFields,
  /** First day shown (inclusive). */
  startsAt: isoDate.optional(),
  /** Last day shown (inclusive for a date-only value). */
  endsAt: isoDate.optional(),
});

const copySchema = z.union([text, z.record(z.string(), text)]);

const knownEvents = new Set<string>(INSTALLER_EVENT_NAMES);

export const installerContentSchema = z
  .strictObject({
    version: z.literal(1),
    /** Display names keyed by integration id, used for `{framework}`. */
    frameworks: z.record(z.string(), text),
    tasks: z.strictObject(
      Object.fromEntries(TASK_IDS.map((t) => [t, taskSchema])) as Record<TaskId, typeof taskSchema>,
    ),
    walkthrough: z.record(z.string(), copySchema),
    tips: z.array(tipSchema),
    announcements: z.array(announcementSchema),
  })
  .superRefine((content, ctx) => {
    const issue = (path: (string | number)[], message: string) => ctx.addIssue({ code: 'custom', path, message });

    for (const [event, copy] of Object.entries(content.walkthrough)) {
      const path = ['walkthrough', event];
      if (!knownEvents.has(event)) {
        issue(path, `"${event}" is not an installer event`);
        continue;
      }
      const allowed = new Set(WALKTHROUGH_PARAMS[event as InstallerEventName] ?? []);
      const variants = WALKTHROUGH_VARIANTS[event as InstallerEventName];
      const templates: Array<[string[], string]> = [];
      if (variants) {
        if (typeof copy === 'string') {
          issue(path, `needs one entry per outcome: ${variants.join(', ')}`);
          continue;
        }
        const keys = Object.keys(copy).sort();
        if (keys.join() !== [...variants].sort().join()) {
          issue(path, `outcomes must be exactly ${variants.join(', ')} (got ${keys.join(', ') || 'none'})`);
        }
        for (const [variant, template] of Object.entries(copy)) templates.push([[...path, variant], template]);
      } else if (typeof copy !== 'string') {
        issue(path, 'must be a single string (this event has no outcome variants)');
        continue;
      } else {
        templates.push([path, copy]);
      }
      for (const [at, template] of templates) {
        for (const name of placeholdersOf(template)) {
          if (!allowed.has(name)) {
            const offer = allowed.size
              ? `available: ${[...allowed].map((p) => `{${p}}`).join(', ')}`
              : 'none available';
            issue(at, `unknown placeholder {${name}} (${offer})`);
          }
        }
      }
    }

    const seen = new Set<string>();
    const cards = [
      ...content.tips.map((c, i) => ['tips', i, c] as const),
      ...content.announcements.map((c, i) => ['announcements', i, c] as const),
    ];
    for (const [list, index, card] of cards) {
      if (seen.has(card.id)) issue([list, index, 'id'], `duplicate id "${card.id}"`);
      seen.add(card.id);
      for (const framework of card.frameworks ?? []) {
        if (!(framework in content.frameworks)) {
          issue([list, index, 'frameworks'], `unknown framework "${framework}" (add it to "frameworks" first)`);
        }
      }
    }

    content.announcements.forEach((a, i) => {
      if (a.startsAt && a.endsAt && Date.parse(a.startsAt) > Date.parse(a.endsAt)) {
        issue(['announcements', i, 'endsAt'], 'ends before it starts');
      }
    });
  });

export type InstallerContent = z.infer<typeof installerContentSchema>;
export type TaskCopy = z.infer<typeof taskSchema>;
export type Tip = z.infer<typeof tipSchema>;
export type Announcement = z.infer<typeof announcementSchema>;

/** Parse raw content, throwing one readable error that lists every problem. */
export function parseInstallerContent(raw: unknown): InstallerContent {
  const result = installerContentSchema.safeParse(raw);
  if (result.success) return result.data;
  const problems = result.error.issues.map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`);
  throw new Error(`Invalid installer content:\n${problems.join('\n')}`);
}
