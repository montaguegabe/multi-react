import type { ReactNode } from 'react';
import type { DiffFile } from 'diff2html/lib/types';
import type { DiffSelection } from './models/DiffSelection';

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

export type DiscardTarget =
  | { type: 'file'; fileEntry: FileEntry }
  | { type: 'lines'; fileEntry: FileEntry; lineIndices: number[] };

export interface DiffViewerProps {
  repositories: Repository[];
  loading?: boolean;
  title?: string;
  onRefresh?: () => void;
  onPushAll?: () => void;
  pushingAll?: boolean;
  onBack?: () => void;
  mobile?: boolean;
  fileContextActions?: ContextMenuAction[];

  /** Per-file line selections (presence of onSelectionChange enables selection mode) */
  selections?: Record<string, DiffSelection>;
  onSelectionChange?: (fileKey: string, selection: DiffSelection) => void;

  /** Commit panel slot rendered below the diff content */
  commitPanel?: ReactNode;

  /** Called when user confirms discarding changes via context menu */
  onDiscard?: (target: DiscardTarget) => void;
}
