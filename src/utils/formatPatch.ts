import type { DiffFile, DiffLine } from 'diff2html/lib/types.js';
import { LineType } from 'diff2html/lib/types.js';
import { DiffSelection } from '../models/DiffSelection';

/** Strip the leading +/-/space prefix that diff2html includes in line.content */
function lineText(line: DiffLine): string {
  return line.content.replace(/^[+ -]/, '');
}

/** Check the annotation added by parseDiff for "\ No newline at end of file" */
function hasNoNewline(line: DiffLine): boolean {
  return (line as any).noNewlineAtEnd === true;
}

/** Emit the no-newline marker if the line is annotated */
function noNewlineSuffix(line: DiffLine): string {
  return hasNoNewline(line) ? '\\ No newline at end of file\n' : '';
}

/**
 * Generates a GNU unified diff patch from a DiffFile and selection state.
 * Returns null if no lines are selected.
 *
 * @param file       The parsed diff file from diff2html
 * @param selection  Which lines are selected for staging
 * @param isNewFile  Whether this is a new/untracked file (unselected adds are dropped entirely)
 */
export function formatPatch(
  file: DiffFile,
  selection: DiffSelection,
  isNewFile: boolean,
): string | null {
  const oldPath = file.oldName.replace(/^[ab]\//, '');
  const newPath = file.newName.replace(/^[ab]\//, '');

  const fromPath = isNewFile ? '/dev/null' : `a/${oldPath}`;
  const toPath = `b/${newPath}`;

  let patch = '';
  let globalIndex = 0;

  for (const block of file.blocks) {
    let hunkBuf = '';
    let oldCount = 0;
    let newCount = 0;
    let anySelected = false;

    for (const line of block.lines) {
      const selected = selection.isSelected(globalIndex);
      globalIndex++;

      if (line.type === LineType.CONTEXT) {
        hunkBuf += ` ${lineText(line)}\n`;
        hunkBuf += noNewlineSuffix(line);
        oldCount++;
        newCount++;
      } else if (selected) {
        // Selected add or delete: include as-is
        if (line.type === LineType.INSERT) {
          hunkBuf += `+${lineText(line)}\n`;
          hunkBuf += noNewlineSuffix(line);
          newCount++;
        } else if (line.type === LineType.DELETE) {
          hunkBuf += `-${lineText(line)}\n`;
          hunkBuf += noNewlineSuffix(line);
          oldCount++;
        }
        anySelected = true;
      } else {
        // Unselected line
        if (line.type === LineType.INSERT) {
          // Unselected add: drop entirely (for both new files and modified files)
          continue;
        } else if (line.type === LineType.DELETE) {
          if (isNewFile) {
            // New files shouldn't have deletes, but skip just in case
            continue;
          }
          // Unselected delete: convert to context line
          hunkBuf += ` ${lineText(line)}\n`;
          hunkBuf += noNewlineSuffix(line);
          oldCount++;
          newCount++;
        }
      }
    }

    if (!anySelected) {
      continue;
    }

    const oldStart = block.oldStartLine || 1;
    const newStart = block.newStartLine || 1;
    const oldInfo =
      oldCount === 1 ? `${oldStart}` : `${oldStart},${oldCount}`;
    const newInfo =
      newCount === 1 ? `${newStart}` : `${newStart},${newCount}`;

    patch += `@@ -${oldInfo} +${newInfo} @@\n`;
    patch += hunkBuf;
  }

  if (patch.length === 0) {
    return null;
  }

  return `--- ${fromPath}\n+++ ${toPath}\n${patch}`;
}

/**
 * Generates a forward patch that transforms the working tree to undo selected
 * changes. Applied with plain `git apply` (no --reverse) because context lines
 * match the working tree, not HEAD.
 *
 * Selected inserts  → `-` (remove from worktree)
 * Selected deletes  → `+` (restore to worktree)
 * Unselected inserts → context (they exist in the worktree)
 * Unselected deletes → dropped (they don't exist in the worktree)
 */
export function formatDiscardPatch(
  file: DiffFile,
  selection: DiffSelection,
): string | null {
  const oldPath = file.oldName.replace(/^[ab]\//, '');
  const newPath = file.newName.replace(/^[ab]\//, '');

  const aPath = file.isNew ? '/dev/null' : `a/${newPath}`;
  const bPath = file.isNew ? '/dev/null' : `b/${oldPath}`;

  let patch = '';
  let globalIndex = 0;

  for (const block of file.blocks) {
    let hunkBuf = '';
    let oldCount = 0;
    let newCount = 0;
    let anySelected = false;

    for (const line of block.lines) {
      const selected = selection.isSelected(globalIndex);
      globalIndex++;

      if (line.type === LineType.CONTEXT) {
        hunkBuf += ` ${lineText(line)}\n`;
        hunkBuf += noNewlineSuffix(line);
        oldCount++;
        newCount++;
      } else if (selected) {
        anySelected = true;
        if (line.type === LineType.INSERT) {
          // Selected insert: remove it from the working tree
          hunkBuf += `-${lineText(line)}\n`;
          hunkBuf += noNewlineSuffix(line);
          oldCount++;
        } else if (line.type === LineType.DELETE) {
          // Selected delete: restore it to the working tree
          hunkBuf += `+${lineText(line)}\n`;
          hunkBuf += noNewlineSuffix(line);
          newCount++;
        }
      } else {
        // Unselected line
        if (line.type === LineType.INSERT) {
          // Unselected insert: exists in working tree, keep as context
          hunkBuf += ` ${lineText(line)}\n`;
          hunkBuf += noNewlineSuffix(line);
          oldCount++;
          newCount++;
        } else if (line.type === LineType.DELETE) {
          // Unselected delete: not in working tree, skip entirely
          continue;
        }
      }
    }

    if (!anySelected) {
      continue;
    }

    // Use newStartLine for the old side (matches working tree positions)
    const wtStart = block.newStartLine || 1;
    const oldInfo =
      oldCount === 1 ? `${wtStart}` : `${wtStart},${oldCount}`;
    const newInfo =
      newCount === 1 ? `${wtStart}` : `${wtStart},${newCount}`;

    patch += `@@ -${oldInfo} +${newInfo} @@\n`;
    patch += hunkBuf;
  }

  if (patch.length === 0) {
    return null;
  }

  return `--- ${aPath}\n+++ ${bPath}\n${patch}`;
}
