import { useEffect, useRef } from 'react';
import type {
  ContextMenuTarget,
  DiffViewerProps,
  DiscardTarget,
  FileEntry,
} from '../types';
import type { GroupInfo } from './DiffRenderer';

export type ContextMenuState =
  | {
      type: 'file';
      x: number;
      y: number;
      target: ContextMenuTarget;
      fileEntry?: FileEntry;
    }
  | {
      type: 'line';
      x: number;
      y: number;
      fileEntry: FileEntry;
      lineIndex: number;
      groupInfo?: GroupInfo;
      groupOnly?: boolean;
    };

type DiffViewerContextMenuProps = {
  contextMenu: ContextMenuState | null;
  fileContextActions: DiffViewerProps['fileContextActions'];
  onDiscard: DiffViewerProps['onDiscard'];
  requestDiscard: (target: DiscardTarget) => void;
  onClose: () => void;
};

export function DiffViewerContextMenu({
  contextMenu,
  fileContextActions,
  onDiscard,
  requestDiscard,
  onClose,
}: DiffViewerContextMenuProps) {
  const contextMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!contextMenu) return;
    const handleClick = (e: MouseEvent) => {
      if (
        contextMenuRef.current &&
        !contextMenuRef.current.contains(e.target as Node)
      ) {
        onClose();
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [contextMenu, onClose]);

  if (!contextMenu) return null;

  return (
    <div
      ref={contextMenuRef}
      className="fixed z-50 min-w-[160px] rounded-md border border-border bg-background py-1 shadow-md"
      style={{ left: contextMenu.x, top: contextMenu.y }}
    >
      {contextMenu.type === 'file' && (
        <>
          {fileContextActions?.map((action) => (
            <button
              key={action.label}
              onClick={() => {
                action.onClick(contextMenu.target);
                onClose();
              }}
              className="w-full text-left px-3 py-1.5 text-sm hover:bg-accent transition-colors"
            >
              {action.label}
            </button>
          ))}
          {onDiscard && contextMenu.fileEntry && (
            <button
              onClick={() =>
                requestDiscard({
                  type: 'file',
                  fileEntry: contextMenu.fileEntry!,
                })
              }
              className="w-full text-left px-3 py-1.5 text-sm text-red-500 hover:bg-accent transition-colors"
            >
              Discard File Changes
            </button>
          )}
        </>
      )}
      {contextMenu.type === 'line' && (
        <>
          {(!contextMenu.groupOnly ||
            !contextMenu.groupInfo ||
            contextMenu.groupInfo.lineCount <= 1) && (
            <button
              onClick={() =>
                requestDiscard({
                  type: 'lines',
                  fileEntry: contextMenu.fileEntry,
                  lineIndices: [contextMenu.lineIndex],
                })
              }
              className="w-full text-left px-3 py-1.5 text-sm text-red-500 hover:bg-accent transition-colors"
            >
              Discard Line
            </button>
          )}
          {contextMenu.groupInfo && contextMenu.groupInfo.lineCount > 1 && (
            <button
              onClick={() => {
                const g = contextMenu.groupInfo!;
                const indices: number[] = [];
                for (let i = g.startIndex; i <= g.endIndex; i += 1) {
                  indices.push(i);
                }
                requestDiscard({
                  type: 'lines',
                  fileEntry: contextMenu.fileEntry,
                  lineIndices: indices,
                });
              }}
              className="w-full text-left px-3 py-1.5 text-sm text-red-500 hover:bg-accent transition-colors"
            >
              Discard Group ({contextMenu.groupInfo.lineCount} lines)
            </button>
          )}
        </>
      )}
    </div>
  );
}
