import { describe, it, expect } from 'vitest';
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import bundled from './installer-content.json' with { type: 'json' };
import { INSTALLER_EVENT_NAMES, type InstallerEventName } from '../../lib/events.js';
import {
  TASK_IDS,
  WALKTHROUGH_PARAMS,
  WALKTHROUGH_VARIANTS,
  frameworkName,
  interpolate,
  isAnnouncementActive,
  loadInstallerContent,
  parseInstallerContent,
  placeholdersOf,
  selectAnnouncements,
  selectTips,
  walkthroughText,
  type InstallerContent,
} from './index.js';

/** A deep copy of the bundled content to mutate per test. */
function raw(): Record<string, any> {
  return structuredClone(bundled) as Record<string, any>;
}

function problems(content: unknown): string {
  try {
    parseInstallerContent(content);
    return '';
  } catch (error) {
    return (error as Error).message;
  }
}

describe('bundled installer content', () => {
  const content = loadInstallerContent();

  it('parses against the schema', () => {
    expect(problems(bundled)).toBe('');
  });

  it('labels every task', () => {
    for (const id of TASK_IDS) expect(content.tasks[id].label.length).toBeGreaterThan(0);
  });

  it('names a display name for every integration and nothing else', () => {
    const integrationsDir = join(import.meta.dirname, '../../integrations');
    const integrations = readdirSync(integrationsDir)
      .filter((name) => statSync(join(integrationsDir, name)).isDirectory())
      .sort();
    expect(Object.keys(content.frameworks).sort()).toEqual(integrations);
  });

  it('keys the walkthrough by real installer events', () => {
    const known = new Set<string>(INSTALLER_EVENT_NAMES);
    for (const event of Object.keys(content.walkthrough)) expect(known.has(event), event).toBe(true);
  });

  it('resolves every placeholder when the model supplies its declared params', () => {
    for (const [event, copy] of Object.entries(content.walkthrough)) {
      const params = Object.fromEntries(
        (WALKTHROUGH_PARAMS[event as InstallerEventName] ?? []).map((name) => [name, 'X']),
      );
      const variants = WALKTHROUGH_VARIANTS[event as InstallerEventName] ?? [undefined];
      for (const variant of variants) {
        const text = walkthroughText(content, event as InstallerEventName, params, variant);
        expect(text, `${event}${variant ? `.${variant}` : ''}`).toBeDefined();
        expect(placeholdersOf(text!), `${event}: ${text}`).toEqual([]);
      }
      expect(copy).toBeTruthy();
    }
  });

  it('uses unique ids across tips and announcements', () => {
    const ids = [...content.tips, ...content.announcements].map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('has at least one tip for every framework and one untargeted announcement', () => {
    for (const framework of Object.keys(content.frameworks)) {
      expect(selectTips(content, { framework, now: new Date() }).length, framework).toBeGreaterThan(0);
    }
    expect(content.announcements.some((a) => !a.frameworks && !a.startsAt && !a.endsAt)).toBe(true);
  });
});

describe('content validation', () => {
  it('rejects a walkthrough key that is not an installer event', () => {
    const c = raw();
    c.walkthrough['agent:thinking'] = 'Hmm.';
    expect(problems(c)).toContain('walkthrough.agent:thinking: "agent:thinking" is not an installer event');
  });

  it('rejects a placeholder the event does not supply, naming the ones it does', () => {
    const c = raw();
    c.walkthrough['branch:created'] = 'Made {branchName}.';
    expect(problems(c)).toContain('unknown placeholder {branchName} (available: {branch})');
  });

  it('rejects a placeholder on an event that supplies none', () => {
    const c = raw();
    c.walkthrough['auth:success'] = 'Hi {name}!';
    expect(problems(c)).toContain('unknown placeholder {name} (none available)');
  });

  it('requires exactly the declared outcomes for variant events', () => {
    const missing = raw();
    delete missing.walkthrough.complete.cancelled;
    expect(problems(missing)).toContain('outcomes must be exactly success, failure, cancelled');

    const flat = raw();
    flat.walkthrough.complete = 'Done.';
    expect(problems(flat)).toContain('needs one entry per outcome');

    const nested = raw();
    nested.walkthrough['auth:success'] = { yes: 'ok' };
    expect(problems(nested)).toContain('must be a single string');
  });

  it('rejects duplicate ids across tips and announcements', () => {
    const c = raw();
    c.announcements.push({ ...c.tips[0] });
    expect(problems(c)).toContain(`duplicate id "${c.tips[0].id}"`);
  });

  it('rejects a card targeting an unknown framework', () => {
    const c = raw();
    c.tips[0].frameworks = ['nuxt'];
    expect(problems(c)).toContain('unknown framework "nuxt"');
  });

  it('rejects missing tasks, unknown fields, non-https URLs and bad dates', () => {
    const noTask = raw();
    delete noTask.tasks.install;
    expect(problems(noTask)).toContain('tasks.install');

    const extra = raw();
    extra.tips[0].emoji = '🎉';
    expect(problems(extra)).toMatch(/tips\.0: .*emoji/);

    const http = raw();
    http.tips[0].url = 'http://workos.com/docs/sso';
    expect(problems(http)).toContain('tips.0.url');

    const date = raw();
    date.announcements[0].startsAt = 'next tuesday';
    expect(problems(date)).toContain('expected an ISO date');

    const backwards = raw();
    backwards.announcements[0].startsAt = '2026-10-02';
    backwards.announcements[0].endsAt = '2026-10-01';
    expect(problems(backwards)).toContain('ends before it starts');
  });

  it('lists every problem at once', () => {
    const c = raw();
    c.walkthrough['not:real'] = 'x';
    c.tips[0].frameworks = ['nuxt'];
    const message = problems(c);
    expect(message).toContain('not:real');
    expect(message).toContain('nuxt');
  });
});

describe('selectors', () => {
  const content: InstallerContent = parseInstallerContent({
    ...raw(),
    tips: [
      { id: 'everywhere', title: 'All', body: 'Shown for every framework.' },
      { id: 'next-only', title: 'Next', body: 'Next.js only.', frameworks: ['nextjs'] },
    ],
    announcements: [
      { id: 'always', title: 'Always', body: 'No window.' },
      { id: 'october', title: 'October', body: 'October only.', startsAt: '2026-10-01', endsAt: '2026-10-31' },
      { id: 'react-launch', title: 'React', body: 'React only.', frameworks: ['react'] },
      {
        id: 'exact',
        title: 'Exact',
        body: 'Timestamps.',
        startsAt: '2026-10-01T12:00:00Z',
        endsAt: '2026-10-01T13:00:00Z',
      },
    ],
  });
  const at = (iso: string) => new Date(iso);
  const ids = (cards: Array<{ id: string }>) => cards.map((c) => c.id);

  it('shows untargeted tips before a framework is known, targeted ones only for their framework', () => {
    expect(ids(selectTips(content, { now: at('2026-09-01') }))).toEqual(['everywhere']);
    expect(ids(selectTips(content, { framework: 'nextjs', now: at('2026-09-01') }))).toEqual([
      'everywhere',
      'next-only',
    ]);
    expect(ids(selectTips(content, { framework: 'react', now: at('2026-09-01') }))).toEqual(['everywhere']);
  });

  it('filters announcements to their date window, inclusive of the whole end day', () => {
    const on = (iso: string) => ids(selectAnnouncements(content, { now: at(iso) }));
    expect(on('2026-09-30T23:59:59Z')).toEqual(['always']);
    expect(on('2026-10-01T00:00:00Z')).toEqual(['always', 'october']);
    expect(on('2026-10-31T23:59:59Z')).toEqual(['always', 'october']);
    expect(on('2026-11-01T00:00:00Z')).toEqual(['always']);
  });

  it('treats timestamp windows as exact instants', () => {
    const exact = content.announcements.find((a) => a.id === 'exact')!;
    expect(isAnnouncementActive(exact, at('2026-10-01T11:59:59Z'))).toBe(false);
    expect(isAnnouncementActive(exact, at('2026-10-01T12:30:00Z'))).toBe(true);
    expect(isAnnouncementActive(exact, at('2026-10-01T13:00:00Z'))).toBe(false);
  });

  it('filters announcements by framework too', () => {
    expect(ids(selectAnnouncements(content, { framework: 'react', now: at('2026-09-01') }))).toEqual([
      'always',
      'react-launch',
    ]);
  });

  it('interpolates known params and leaves unknown ones visible', () => {
    expect(interpolate('On {branch} with {count} files', { branch: 'main', count: 3 })).toBe('On main with 3 files');
    expect(interpolate('Hi {name}', {})).toBe('Hi {name}');
  });

  it('picks the outcome variant and returns undefined for events it does not narrate', () => {
    expect(walkthroughText(content, 'complete', {}, 'success')).toBe(content.walkthrough.complete.success);
    expect(walkthroughText(content, 'complete')).toBeUndefined();
    expect(walkthroughText(content, 'git:checking')).toBeUndefined();
  });

  it('falls back to the integration id for an unknown framework name', () => {
    expect(frameworkName(content, 'nextjs')).toBe('Next.js');
    expect(frameworkName(content, 'cobol')).toBe('cobol');
  });
});
