export { DiffViewer } from './components/DiffViewer';
export type {
  Repository,
  FileEntry,
  DiffViewerProps,
  ContextMenuTarget,
  ContextMenuAction,
  DiscardTarget,
} from './types';
export { cn } from './utils/cn';
export { DiffSelection, DiffSelectionType } from './models/DiffSelection';
export { formatPatch, formatDiscardPatch } from './utils/formatPatch';

// Wrapper around diff2html that preserves "\ No newline at end of file" info
export { parseDiff } from './utils/parseDiff';
export { LineType } from 'diff2html/lib/types';
export type { DiffFile, DiffBlock, DiffLine } from 'diff2html/lib/types';
