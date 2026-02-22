import {
  ArrowLeft,
  ChevronDown,
  ChevronRight,
  PanelLeftClose,
  PanelLeftOpen,
  RefreshCw,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { parse, html as diff2html } from 'diff2html';
import type { DiffFile } from 'diff2html/lib/types';
import 'diff2html/bundles/css/diff2html.min.css';
import type {
  ContextMenuAction,
  ContextMenuTarget,
  DiffViewerProps,
  FileEntry,
} from '../types';

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
  onBack,
  mobile = false,
  fileContextActions,
}: DiffViewerProps) => {
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [collapsedRepos, setCollapsedRepos] = useState<
    Record<string, boolean>
  >({});
  const [sidebarOpen, setSidebarOpen] = useState(!mobile);
  const [sidebarWidth, setSidebarWidth] = useState(288); // 18rem = 288px
  const [resizing, setResizing] = useState(false);
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    target: ContextMenuTarget;
  } | null>(null);
  const contextMenuRef = useRef<HTMLDivElement>(null);

  const handleContextMenu = useCallback(
    (e: React.MouseEvent, target: ContextMenuTarget) => {
      if (!fileContextActions?.length) return;
      e.preventDefault();
      setContextMenu({ x: e.clientX, y: e.clientY, target });
    },
    [fileContextActions],
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
        const files = parse(repo.diff);
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

  const selectedDiffHtml = useMemo(() => {
    if (!selectedEntry) return '';
    return diff2html([selectedEntry.file], {
      outputFormat: 'line-by-line',
      drawFileList: false,
    });
  }, [selectedEntry]);

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
                        })
                      }
                      className={`w-full px-3 py-2 flex items-center gap-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wider bg-muted/50 border-b border-border select-none ${hasFiles ? 'hover:bg-accent/50' : ''} transition-colors`}
                    >
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
                    byRepo[repoName].map((entry) => (
                      <button
                        key={entry.key}
                        onClick={() => {
                          setSelectedKey(entry.key);
                          if (mobile) setSidebarOpen(false);
                        }}
                        onContextMenu={(e) => handleContextMenu(e, entry)}
                        className={`w-full text-left pl-3 pr-3 py-1.5 flex items-center gap-2 text-sm transition-colors border-b border-border/50 ${
                          selectedKey === entry.key
                            ? 'bg-primary/10 border-l-2 border-l-primary pl-[10px] font-medium'
                            : 'hover:bg-accent/50'
                        }`}
                      >
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
                    ))}
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

          {/* Right panel: diff content */}
          <div className="flex-1 overflow-auto min-w-0">
            {selectedEntry ? (
              <div
                className="diff-container"
                dangerouslySetInnerHTML={{ __html: selectedDiffHtml }}
              />
            ) : (
              <div className="flex items-center justify-center h-full text-muted-foreground">
                Select a file to view its diff
              </div>
            )}
          </div>
        </div>
      )}

      {/* Context menu */}
      {contextMenu && fileContextActions && (
        <div
          ref={contextMenuRef}
          className="fixed z-50 min-w-[160px] rounded-md border border-border bg-background py-1 shadow-md"
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          {fileContextActions.map((action) => (
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
        </div>
      )}
    </div>
  );
};
