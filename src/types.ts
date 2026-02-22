import type { DiffFile } from 'diff2html/lib/types';

export interface Repository {
  path: string;
  name: string;
  diff: string;
}

export interface FileEntry {
  repoName: string;
  repoPath: string;
  file: DiffFile;
  /** Display name: shortest unique path segment */
  displayPath: string;
  status: 'added' | 'deleted' | 'modified' | 'renamed';
  key: string;
}

export interface ContextMenuTarget {
  repoName: string;
  repoPath: string;
  displayPath: string;
}

export interface ContextMenuAction {
  label: string;
  onClick: (target: ContextMenuTarget) => void;
}

export interface DiffViewerProps {
  repositories: Repository[];
  loading?: boolean;
  title?: string;
  onRefresh?: () => void;
  onBack?: () => void;
  mobile?: boolean;
  fileContextActions?: ContextMenuAction[];
}
