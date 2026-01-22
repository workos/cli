import * as clack from '@clack/prompts';

// Dashboard mode flag - when true, suppress console output
let dashboardMode = false;

export function setDashboardMode(enabled: boolean): void {
  dashboardMode = enabled;
}

export function isDashboardMode(): boolean {
  return dashboardMode;
}

// Create a proxy that suppresses log output in dashboard mode
const clackProxy = new Proxy(clack, {
  get(target, prop) {
    const value = target[prop as keyof typeof clack];

    // Suppress log methods in dashboard mode
    if (prop === 'log' && dashboardMode) {
      return {
        info: () => {},
        success: () => {},
        warn: () => {},
        warning: () => {},
        error: () => {},
        step: () => {},
        message: () => {},
      };
    }

    // Suppress intro/outro in dashboard mode
    if ((prop === 'intro' || prop === 'outro') && dashboardMode) {
      return () => {};
    }

    return value;
  },
});

export default clackProxy;
