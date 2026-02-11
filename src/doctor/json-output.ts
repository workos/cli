import type { DoctorReport } from './types.js';

export function formatReportAsJson(report: DoctorReport): string {
  return JSON.stringify(report, null, 2);
}
