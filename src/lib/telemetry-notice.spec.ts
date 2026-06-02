import { describe, it, expect, vi, beforeEach } from 'vitest';

// Toggleable output mode.
let jsonMode = false;
vi.mock('../utils/output.js', () => ({
  isJsonMode: () => jsonMode,
}));

// Spy on the box renderer instead of writing to stderr.
const mockRenderStderrBox = vi.fn();
vi.mock('../utils/box.js', () => ({
  renderStderrBox: (...args: unknown[]) => mockRenderStderrBox(...args),
}));

// Control the persisted-state gates and spy on the mark.
let noticeShown = false;
let optedOut = false;
const mockMarkNoticeShown = vi.fn(() => {
  noticeShown = true;
});
vi.mock('./preferences.js', () => ({
  isNoticeShown: () => noticeShown,
  isTelemetryOptedOut: () => optedOut,
  markNoticeShown: (...args: unknown[]) => mockMarkNoticeShown(...args),
}));

const { formatWorkOSCommand } = await import('../utils/command-invocation.js');
const { maybeShowTelemetryNotice, resetTelemetryNoticeState } = await import('./telemetry-notice.js');

describe('telemetry-notice', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    jsonMode = false;
    noticeShown = false;
    optedOut = false;
    resetTelemetryNoticeState();
  });

  it('human + unshown + not-opted-out → renders once and marks shown', () => {
    maybeShowTelemetryNotice();

    expect(mockRenderStderrBox).toHaveBeenCalledTimes(1);
    expect(mockMarkNoticeShown).toHaveBeenCalledTimes(1);
  });

  it('renders the opt-out command via formatWorkOSCommand (npx-safe, not hardcoded)', () => {
    maybeShowTelemetryNotice();

    const inner = mockRenderStderrBox.mock.calls[0]?.[0] as string;
    expect(inner).toContain(formatWorkOSCommand('telemetry opt-out'));
  });

  it('second call in the same session → no second render (per-session guard)', () => {
    maybeShowTelemetryNotice();
    expect(mockRenderStderrBox).toHaveBeenCalledTimes(1);

    maybeShowTelemetryNotice();
    expect(mockRenderStderrBox).toHaveBeenCalledTimes(1);
    expect(mockMarkNoticeShown).toHaveBeenCalledTimes(1);
  });

  it('json mode → no render and never marks (mark-only-on-display)', () => {
    jsonMode = true;

    maybeShowTelemetryNotice();

    expect(mockRenderStderrBox).not.toHaveBeenCalled();
    expect(mockMarkNoticeShown).not.toHaveBeenCalled();
    // The flag must stay unset so a real human still sees it later.
    expect(noticeShown).toBe(false);
  });

  it('already shown (noticeShownAt present) → no render, no mark', () => {
    noticeShown = true;

    maybeShowTelemetryNotice();

    expect(mockRenderStderrBox).not.toHaveBeenCalled();
    expect(mockMarkNoticeShown).not.toHaveBeenCalled();
  });

  it('opted out → no render, no mark', () => {
    optedOut = true;

    maybeShowTelemetryNotice();

    expect(mockRenderStderrBox).not.toHaveBeenCalled();
    expect(mockMarkNoticeShown).not.toHaveBeenCalled();
  });

  it('marks shown only AFTER rendering (display-then-persist order)', () => {
    const calls: string[] = [];
    mockRenderStderrBox.mockImplementation(() => calls.push('render'));
    mockMarkNoticeShown.mockImplementation(() => {
      calls.push('mark');
      noticeShown = true;
    });

    maybeShowTelemetryNotice();

    expect(calls).toEqual(['render', 'mark']);
  });

  it('never throws if rendering fails; does not mark on failure', () => {
    mockRenderStderrBox.mockImplementation(() => {
      throw new Error('render boom');
    });

    expect(() => maybeShowTelemetryNotice()).not.toThrow();
    expect(mockMarkNoticeShown).not.toHaveBeenCalled();
  });

  it('resetTelemetryNoticeState allows the notice to render again', () => {
    maybeShowTelemetryNotice();
    expect(mockRenderStderrBox).toHaveBeenCalledTimes(1);

    // Simulate a fresh process where the flag was not persisted.
    noticeShown = false;
    resetTelemetryNoticeState();
    maybeShowTelemetryNotice();
    expect(mockRenderStderrBox).toHaveBeenCalledTimes(2);
  });
});
