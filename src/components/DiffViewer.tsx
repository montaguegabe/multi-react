import {
  ArrowLeft,
  ChevronDown,
  ChevronRight,
  PanelLeftClose,
  PanelLeftOpen,
  RefreshCw,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState, type RefCallback } from 'react';
import type { DiffFile } from 'diff2html/lib/types';
import type {
  ContextMenuAction,
  ContextMenuTarget,
  DiscardTarget,
  DiffViewerProps,
  FileEntry,
} from '../types';
import type { GroupInfo } from './DiffRenderer';
import { DiffRenderer } from './DiffRenderer';
import { DiffSelectionType } from '../models/DiffSelection';
import { ConfirmDialog } from './ConfirmDialog';
import { cn } from '../utils/cn';
import { parseDiff } from '../utils/parseDiff';

function fileStatus(f: DiffFile): FileEntry['status'] {
  if (f.isNew) return 'added';
  if (f.isDeleted) return 'deleted';
  if (f.isRename || f.isCopy) return 'renamed';
  return 'modified';
}

function statusLabel(s: FileEntry['status']): string {
  switch (s) {
    case 'added':
      return 'A';
    case 'deleted':
      return 'D';
    case 'renamed':
      return 'R';
    case 'modified':
      return 'M';
  }
}

function statusColor(s: FileEntry['status']): string {
  switch (s) {
    case 'added':
      return 'text-green-500';
    case 'deleted':
      return 'text-red-500';
    case 'renamed':
      return 'text-blue-500';
    case 'modified':
      return 'text-yellow-500';
  }
}

export const DiffViewer = ({
  repositories,
  loading = false,
  title = 'Git Diff',
  onRefresh,
  onPushAll,
  pushingAll = false,
  onBack,
  mobile = false,
  fileContextActions,
  selections,
  onSelectionChange,
  commitPanel,
  onDiscard,
}: DiffViewerProps) => {
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [collapsedRepos, setCollapsedRepos] = useState<
    Record<string, boolean>
  >({});
  const [sidebarOpen, setSidebarOpen] = useState(!mobile);
  const [sidebarWidth, setSidebarWidth] = useState(288); // 18rem = 288px
  const [resizing, setResizing] = useState(false);
  type ContextMenuState =
    | { type: 'file'; x: number; y: number; target: ContextMenuTarget; fileEntry?: FileEntry }
    | { type: 'line'; x: number; y: number; fileEntry: FileEntry; lineIndex: number; groupInfo?: GroupInfo; groupOnly?: boolean };

  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const contextMenuRef = useRef<HTMLDivElement>(null);
  const [pendingDiscard, setPendingDiscard] = useState<DiscardTarget | null>(null);

  const SUPPRESS_KEY = 'multi-react:suppressDiscardConfirm';

  const handleContextMenu = useCallback(
    (e: React.MouseEvent, target: ContextMenuTarget, fileEntry?: FileEntry) => {
      if (!fileContextActions?.length && !onDiscard) return;
      e.preventDefault();
      setContextMenu({ type: 'file', x: e.clientX, y: e.clientY, target, fileEntry });
    },
    [fileContextActions, onDiscard],
  );

  const requestDiscard = useCallback(
    (target: DiscardTarget) => {
      setContextMenu(null);
      if (!onDiscard) return;
      let suppressed = false;
      try {
        suppressed = localStorage.getItem(SUPPRESS_KEY) === 'true';
      } catch {
        // localStorage unavailable
      }
      if (suppressed) {
        onDiscard(target);
      } else {
        setPendingDiscard(target);
      }
    },
    [onDiscard],
  );

  useEffect(() => {
    if (!resizing) return;
    const handleMouseMove = (e: MouseEvent) => {
      setSidebarWidth(Math.max(150, Math.min(600, e.clientX)));
    };
    const handleMouseUp = () => setResizing(false);
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [resizing]);

  useEffect(() => {
    if (!contextMenu) return;
    const handleClick = (e: MouseEvent) => {
      if (
        contextMenuRef.current &&
        !contextMenuRef.current.contains(e.target as Node)
      ) {
        setContextMenu(null);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [contextMenu]);

  const { entries, byRepo } = useMemo(() => {
    const entries: FileEntry[] = [];
    const byRepo: Record<string, FileEntry[]> = {};

    for (const repo of repositories) {
      const repoEntries: FileEntry[] = [];
      if (repo.diff.trim()) {
        const files = parseDiff(repo.diff);
        for (const f of files) {
          const displayPath = f.isDeleted
            ? f.oldName.replace(/^[ab]\//, '')
            : f.newName.replace(/^[ab]\//, '');
          const key = `${repo.name}::${displayPath}`;
          const entry: FileEntry = {
            repoName: repo.name,
            repoPath: repo.path,
            file: f,
            displayPath,
            status: fileStatus(f),
            key,
          };
          entries.push(entry);
          repoEntries.push(entry);
        }
      }
      byRepo[repo.name] = repoEntries;
    }
    return { entries, byRepo };
  }, [repositories]);

  useEffect(() => {
    if (
      entries.length > 0 &&
      (!selectedKey || !entries.find((e) => e.key === selectedKey))
    ) {
      setSelectedKey(entries[0].key);
    }
  }, [entries, selectedKey]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
      if (entries.length === 0) return;
      e.preventDefault();
      (document.activeElement as HTMLElement)?.blur();
      setSelectedKey((prev) => {
        const idx = entries.findIndex((en) => en.key === prev);
        const next =
          e.key === 'ArrowDown'
            ? Math.min(idx + 1, entries.length - 1)
            : Math.max(idx - 1, 0);
        // Ensure the repo containing this entry is not collapsed
        const nextEntry = entries[next];
        setCollapsedRepos((cr) =>
          cr[nextEntry.repoName] ? { ...cr, [nextEntry.repoName]: false } : cr,
        );
        return nextEntry.key;
      });
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [entries]);

  const selectedEntry = useMemo(
    () => entries.find((e) => e.key === selectedKey) ?? null,
    [entries, selectedKey],
  );

  const handleLineContextMenu = useCallback(
    (e: React.MouseEvent, lineIndex: number, groupInfo?: GroupInfo, groupOnly?: boolean) => {
      if (!onDiscard || !selectedEntry) return;
      e.preventDefault();
      setContextMenu({ type: 'line', x: e.clientX, y: e.clientY, fileEntry: selectedEntry, lineIndex, groupInfo, groupOnly });
    },
    [onDiscard, selectedEntry],
  );

  const repoPathByName = useMemo(() => {
    const map: Record<string, string> = {};
    for (const repo of repositories) {
      map[repo.name] = repo.path;
    }
    return map;
  }, [repositories]);

  const repoNames = Object.keys(byRepo);
  const totalFiles = entries.length;

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
        <div className="flex items-center gap-3">
          {mobile && (
            <button
              onClick={() => setSidebarOpen((prev) => !prev)}
              className="p-1.5 hover:bg-accent rounded-lg transition-colors"
            >
              {sidebarOpen ? (
                <PanelLeftClose className="h-4 w-4" />
              ) : (
                <PanelLeftOpen className="h-4 w-4" />
              )}
            </button>
          )}
          {onBack && !mobile && (
            <button
              onClick={onBack}
              className="p-1.5 hover:bg-accent rounded-lg transition-colors"
            >
              <ArrowLeft className="h-4 w-4" />
            </button>
          )}
          <div>
            <h1 className="text-xl font-semibold">{title}</h1>
            <p className="text-xs text-muted-foreground">
              {totalFiles} file{totalFiles !== 1 ? 's' : ''} changed
              {repoNames.length > 1
                ? ` across ${repoNames.length} repos`
                : ''}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {onPushAll && (
            <button
              onClick={onPushAll}
              disabled={pushingAll}
              className="px-3 py-1.5 text-sm rounded-lg border border-border hover:bg-accent transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {pushingAll ? 'Syncing...' : 'Sync All'}
            </button>
          )}
          {onRefresh && (
            <button
              onClick={onRefresh}
              className="p-2 hover:bg-accent rounded-lg transition-colors"
            >
              <RefreshCw
                className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`}
              />
            </button>
          )}
        </div>
      </div>

      {!loading && totalFiles === 0 && repoNames.length <= 1 ? (
        <div className="flex-1 flex items-center justify-center text-muted-foreground">
          No changes
        </div>
      ) : (
        <div className={`flex flex-1 min-h-0 ${resizing ? 'select-none' : ''}`}>
          {/* Left panel: file list */}
          <div
            className={`${sidebarOpen ? '' : 'w-0 overflow-hidden'} shrink-0 border-r border-border overflow-y-auto bg-muted/30 ${resizing ? '' : 'transition-all duration-200'}`}
            style={sidebarOpen ? { width: sidebarWidth } : undefined}
          >
            {repoNames.map((repoName) => {
              const isCollapsed = !!collapsedRepos[repoName];
              const repoFiles = byRepo[repoName];
              const hasFiles = repoFiles.length > 0;
              return (
                <div key={repoName}>
                  {repoNames.length > 1 && (
                    <div
                      role={hasFiles ? 'button' : undefined}
                      tabIndex={hasFiles ? 0 : undefined}
                      onClick={
                        hasFiles
                          ? () =>
                              setCollapsedRepos((prev) => ({
                                ...prev,
                                [repoName]: !prev[repoName],
                              }))
                          : undefined
                      }
                      onContextMenu={(e) =>
                        handleContextMenu(e, {
                          repoName,
                          repoPath: repoPathByName[repoName] ?? '',
                          displayPath: '',
                        }, undefined)
                      }
                      className={`w-full px-3 py-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider bg-muted/50 border-b border-border select-none ${hasFiles ? 'text-muted-foreground hover:bg-accent/50' : 'text-muted-foreground/40'} transition-colors`}
                    >
                      {/* Repo-level checkbox (derived from per-file selections) */}
                      {selections && onSelectionChange && (() => {
                        if (!hasFiles) {
                          return (
                            <input
                              type="checkbox"
                              className="shrink-0 opacity-30"
                              checked={false}
                              disabled
                              readOnly
                            />
                          );
                        }
                        const types = repoFiles.map(
                          (f) => selections[f.key]?.getSelectionType() ?? DiffSelectionType.All,
                        );
                        const allAll = types.every((t) => t === DiffSelectionType.All);
                        const allNone = types.every((t) => t === DiffSelectionType.None);
                        const repoChecked = allAll;
                        const repoIndeterminate = !allAll && !allNone;
                        const refCb: RefCallback<HTMLInputElement> = (el) => {
                          if (el) el.indeterminate = repoIndeterminate;
                        };
                        return (
                          <input
                            type="checkbox"
                            ref={refCb}
                            className="shrink-0 accent-blue-500"
                            checked={repoChecked}
                            onChange={(e) => {
                              e.stopPropagation();
                              const checked = e.target.checked;
                              for (const f of repoFiles) {
                                const sel = selections[f.key];
                                if (!sel) continue;
                                onSelectionChange(
                                  f.key,
                                  checked ? sel.withSelectAll() : sel.withSelectNone(),
                                );
                              }
                            }}
                            onClick={(e) => e.stopPropagation()}
                          />
                        );
                      })()}
                      {hasFiles && isCollapsed ? (
                        <ChevronRight className="h-3 w-3 shrink-0" />
                      ) : (
                        <ChevronDown
                          className={`h-3 w-3 shrink-0 ${hasFiles ? '' : 'opacity-30'}`}
                        />
                      )}
                      <span className="truncate">{repoName}</span>
                      <span className="ml-auto text-[10px] font-normal tabular-nums">
                        {hasFiles ? repoFiles.length : 'clean'}
                      </span>
                    </div>
                  )}
                  {!isCollapsed &&
                    byRepo[repoName].map((entry) => {
                      const sel = selections?.[entry.key];
                      const selType = sel?.getSelectionType();
                      const fileChecked = selType === DiffSelectionType.All;
                      const fileIndeterminate = selType === DiffSelectionType.Partial;
                      const fileNone = selType === DiffSelectionType.None;
                      const fileRefCb: RefCallback<HTMLInputElement> = (el) => {
                        if (el) el.indeterminate = fileIndeterminate;
                      };
                      return (
                        <button
                          key={entry.key}
                          onClick={() => {
                            setSelectedKey(entry.key);
                            if (mobile) setSidebarOpen(false);
                          }}
                          onContextMenu={(e) => handleContextMenu(e, entry, entry)}
                          className={cn(
                            'w-full text-left pl-3 pr-3 py-1.5 flex items-center gap-2 text-sm transition-colors border-b border-border/50',
                            selectedKey === entry.key
                              ? 'bg-primary/10 border-l-2 border-l-primary pl-[10px] font-medium'
                              : 'hover:bg-accent/50',
                            fileNone && 'opacity-50',
                          )}
                        >
                          {/* File-level checkbox (derived from line selections) */}
                          {selections && onSelectionChange && sel && (
                            <input
                              type="checkbox"
                              ref={fileRefCb}
                              className="shrink-0 accent-blue-500"
                              checked={fileChecked}
                              onChange={(e) => {
                                e.stopPropagation();
                                onSelectionChange(
                                  entry.key,
                                  e.target.checked ? sel.withSelectAll() : sel.withSelectNone(),
                                );
                              }}
                              onClick={(e) => e.stopPropagation()}
                            />
                          )}
                          <span
                            className={`shrink-0 text-xs font-mono font-bold w-4 text-center ${statusColor(entry.status)}`}
                          >
                            {statusLabel(entry.status)}
                          </span>
                          <span
                            className="truncate text-xs"
                            title={entry.displayPath}
                          >
                            {entry.displayPath}
                          </span>
                        </button>
                      );
                    })}
                </div>
              );
            })}
          </div>

          {/* Resize handle */}
          {sidebarOpen && (
            <div
              onMouseDown={() => setResizing(true)}
              className="w-1 shrink-0 cursor-col-resize hover:bg-primary/30 active:bg-primary/50 transition-colors"
            />
          )}

          {/* Right panel: diff content + commit panel */}
          <div className="flex-1 flex flex-col min-w-0">
            <div className="flex-1 overflow-auto min-w-0">
              {selectedEntry ? (
                <DiffRenderer
                  file={selectedEntry.file}
                  selection={selections?.[selectedEntry.key]}
                  onSelectionChange={
                    onSelectionChange
                      ? (sel) => onSelectionChange(selectedEntry.key, sel)
                      : undefined
                  }
                  onLineContextMenu={onDiscard ? handleLineContextMenu : undefined}
                />
              ) : (
                <div className="flex items-center justify-center h-full text-muted-foreground">
                  Select a file to view its diff
                </div>
              )}
            </div>
            {commitPanel && (
              <div className="shrink-0 border-t border-border">
                {commitPanel}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Context menu */}
      {contextMenu && (
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
                    setContextMenu(null);
                  }}
                  className="w-full text-left px-3 py-1.5 text-sm hover:bg-accent transition-colors"
                >
                  {action.label}
                </button>
              ))}
              {onDiscard && contextMenu.fileEntry && (
                <button
                  onClick={() =>
                    requestDiscard({ type: 'file', fileEntry: contextMenu.fileEntry! })
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
              {(!contextMenu.groupOnly || !contextMenu.groupInfo || contextMenu.groupInfo.lineCount <= 1) && (
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
                    for (let i = g.startIndex; i <= g.endIndex; i++) indices.push(i);
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
      )}

      {/* Discard confirmation dialog */}
      <ConfirmDialog
        open={!!pendingDiscard}
        title="Discard Changes"
        message={
          pendingDiscard?.type === 'file'
            ? `Discard all changes to "${pendingDiscard.fileEntry.displayPath}"? This cannot be undone.`
            : pendingDiscard?.type === 'lines'
              ? `Discard ${pendingDiscard.lineIndices.length === 1 ? 'this line' : `these ${pendingDiscard.lineIndices.length} lines`}? This cannot be undone.`
              : ''
        }
        confirmLabel="Discard"
        onConfirm={() => {
          if (pendingDiscard && onDiscard) onDiscard(pendingDiscard);
          setPendingDiscard(null);
        }}
        onCancel={() => setPendingDiscard(null)}
        suppressStorageKey={SUPPRESS_KEY}
      />
    </div>
  );
};
