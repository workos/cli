import { getUncommittedFiles } from '../utils/git-utils.js';

export function detectChanges(): { hasChanges: boolean; files: string[] } {
  const files = getUncommittedFiles();
  return { hasChanges: files.length > 0, files };
}
