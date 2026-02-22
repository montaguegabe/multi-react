import type { DiffFile } from 'diff2html/lib/types.js';
import type { FileEntry, Repository } from '../types';
import { parseDiff } from './parseDiff';

export function getDisplayPath(file: DiffFile): string {
  return file.isDeleted
    ? file.oldName.replace(/^[ab]\//, '')
    : file.newName.replace(/^[ab]\//, '');
}

export function getFileStatus(file: DiffFile): FileEntry['status'] {
  if (file.isNew) return 'added';
  if (file.isDeleted) return 'deleted';
  if (file.isRename || file.isCopy) return 'renamed';
  return 'modified';
}

export function buildRepoFileEntries(
  repositories: Repository[],
): { entries: FileEntry[]; byRepo: Record<string, FileEntry[]> } {
  const entries: FileEntry[] = [];
  const byRepo: Record<string, FileEntry[]> = {};

  for (const repo of repositories) {
    const repoEntries: FileEntry[] = [];

    if (repo.diff.trim()) {
      const files = parseDiff(repo.diff);
      for (const file of files) {
        const displayPath = getDisplayPath(file);
        const key = `${repo.name}::${displayPath}`;
        const entry: FileEntry = {
          repoName: repo.name,
          repoPath: repo.path,
          file,
          displayPath,
          status: getFileStatus(file),
          key,
        };
        entries.push(entry);
        repoEntries.push(entry);
      }
    }

    byRepo[repo.name] = repoEntries;
  }

  return { entries, byRepo };
}
