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
  NativeContextMenuItem,
  DiscardTarget,
  DiffViewerProps,
  FileEntry,
  HistoryRepoDiff,
} from '../types';
import type { GroupInfo } from './DiffRenderer';
import { DiffRenderer } from './DiffRenderer';
import { DiffSelectionType } from '../models/DiffSelection';
import { ConfirmDialog } from './ConfirmDialog';
import { cn } from '../utils/cn';
import { parseDiff } from '../utils/parseDiff';
import {
  buildRepoFileEntries,
  getDisplayPath,
  getFileStatus,
} from '../utils/diffEntries';

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

function formatHistoryTimestamp(timestampMs: number): string {
  return new Date(timestampMs).toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

type HistoryDiffEntry = {
  key: string;
  repoName: string;
  repoPath: string;
  displayPath: string;
  status: FileEntry['status'];
  file: DiffFile;
};

export const DiffViewer = ({
  repositories,
  loading = false,
  title = 'Git Diff',
  onRefresh,
  onPushAll,
  pushingAll = false,
  showPushIndicator = false,
  onBack,
  mobile = false,
  fileContextActions,
  selections,
  onSelectionChange,
  commitPanel,
  onDiscard,
  showNativeContextMenu,
  historyGroups,
  historyLoading = false,
  loadHistoryGroupDiff,
  onOpenRepoInGitHubWeb,
}: DiffViewerProps) => {
  const hasHistoryTab = historyGroups !== undefined;
  const combinedHistory = historyGroups ?? [];
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [activeSidebarTab, setActiveSidebarTab] = useState<'files' | 'history'>(
    'files',
  );
  const [selectedHistoryGroupId, setSelectedHistoryGroupId] = useState<
    string | null
  >(null);
  const [historyDiffByGroupId, setHistoryDiffByGroupId] = useState<
    Record<string, HistoryRepoDiff[]>
  >({});
  const [historyDiffLoadingGroupId, setHistoryDiffLoadingGroupId] = useState<
    string | null
  >(null);
  const [collapsedHistoryRepos, setCollapsedHistoryRepos] = useState<
    Record<string, boolean>
  >({});
  const [collapsedHistoryFiles, setCollapsedHistoryFiles] = useState<
    Record<string, boolean>
  >({});
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

  const showNativeFileContextMenu = useCallback(
    async (target: ContextMenuTarget, fileEntry?: FileEntry) => {
      if (!showNativeContextMenu) return;

      const items: NativeContextMenuItem[] = [];
      fileContextActions?.forEach((action, index) => {
        items.push({
          id: `file-action-${index}`,
          label: action.label,
          type: 'normal',
        });
      });

      if (onDiscard && fileEntry) {
        if (items.length > 0) {
          items.push({ type: 'separator' });
        }
        items.push({
          id: 'discard-file',
          label: 'Discard File Changes',
          type: 'normal',
        });
      }

      if (items.length === 0) return;

      const selectedId = await showNativeContextMenu(items);
      if (!selectedId) return;

      if (selectedId === 'discard-file' && onDiscard && fileEntry) {
        requestDiscard({ type: 'file', fileEntry });
        return;
      }

      if (!selectedId.startsWith('file-action-')) return;
      const actionIndex = Number(selectedId.slice('file-action-'.length));
      const action = fileContextActions?.[actionIndex];
      if (!action) return;
      action.onClick(target);
    },
    [fileContextActions, onDiscard, requestDiscard, showNativeContextMenu],
  );

  const handleContextMenu = useCallback(
    (e: React.MouseEvent, target: ContextMenuTarget, fileEntry?: FileEntry) => {
      if (!fileContextActions?.length && !onDiscard) return;
      e.preventDefault();

      if (showNativeContextMenu) {
        void showNativeFileContextMenu(target, fileEntry);
        return;
      }

      setContextMenu({ type: 'file', x: e.clientX, y: e.clientY, target, fileEntry });
    },
    [fileContextActions, onDiscard, showNativeContextMenu, showNativeFileContextMenu],
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

  const { entries, byRepo } = useMemo(
    () => buildRepoFileEntries(repositories),
    [repositories],
  );

  useEffect(() => {
    if (
      entries.length > 0 &&
      (!selectedKey || !entries.find((e) => e.key === selectedKey))
    ) {
      setSelectedKey(entries[0].key);
    }
  }, [entries, selectedKey]);

  useEffect(() => {
    if (!hasHistoryTab) return;

    if (activeSidebarTab === 'history' && combinedHistory.length === 0) {
      setSelectedHistoryGroupId(null);
      return;
    }

    if (
      activeSidebarTab === 'history' &&
      combinedHistory.length > 0 &&
      (!selectedHistoryGroupId ||
        !combinedHistory.find((group) => group.id === selectedHistoryGroupId))
    ) {
      setSelectedHistoryGroupId(combinedHistory[0].id);
    }
  }, [
    activeSidebarTab,
    combinedHistory,
    hasHistoryTab,
    selectedHistoryGroupId,
  ]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;

      if (activeSidebarTab === 'files') {
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
        return;
      }

      if (activeSidebarTab === 'history') {
        if (combinedHistory.length === 0) return;
        e.preventDefault();
        (document.activeElement as HTMLElement)?.blur();
        setSelectedHistoryGroupId((prev) => {
          const idx = combinedHistory.findIndex((group) => group.id === prev);
          if (idx < 0) return combinedHistory[0].id;
          const next =
            e.key === 'ArrowDown'
              ? Math.min(idx + 1, combinedHistory.length - 1)
              : Math.max(idx - 1, 0);
          return combinedHistory[next].id;
        });
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [activeSidebarTab, combinedHistory, entries]);

  const selectedEntry = useMemo(
    () => entries.find((e) => e.key === selectedKey) ?? null,
    [entries, selectedKey],
  );

  const selectedHistoryGroup = useMemo(
    () =>
      combinedHistory.find((group) => group.id === selectedHistoryGroupId) ??
      null,
    [combinedHistory, selectedHistoryGroupId],
  );

  useEffect(() => {
    if (
      !loadHistoryGroupDiff ||
      activeSidebarTab !== 'history' ||
      !selectedHistoryGroup
    ) {
      return;
    }

    if (
      Object.prototype.hasOwnProperty.call(
        historyDiffByGroupId,
        selectedHistoryGroup.id,
      )
    ) {
      return;
    }

    let cancelled = false;
    setHistoryDiffLoadingGroupId(selectedHistoryGroup.id);

    void loadHistoryGroupDiff(selectedHistoryGroup)
      .then((diff) => {
        if (cancelled) return;
        setHistoryDiffByGroupId((previous) => ({
          ...previous,
          [selectedHistoryGroup.id]: diff,
        }));
      })
      .catch(() => {
        if (cancelled) return;
        setHistoryDiffByGroupId((previous) => ({
          ...previous,
          [selectedHistoryGroup.id]: [],
        }));
      })
      .finally(() => {
        if (cancelled) return;
        setHistoryDiffLoadingGroupId((current) =>
          current === selectedHistoryGroup.id ? null : current,
        );
      });

    return () => {
      cancelled = true;
    };
  }, [
    activeSidebarTab,
    historyDiffByGroupId,
    loadHistoryGroupDiff,
    selectedHistoryGroup,
  ]);

  const selectedHistoryRepoDiffs = selectedHistoryGroup
    ? historyDiffByGroupId[selectedHistoryGroup.id]
    : undefined;

  const selectedHistoryEntries = useMemo<HistoryDiffEntry[]>(() => {
    if (!selectedHistoryGroup || !selectedHistoryRepoDiffs) return [];

    return selectedHistoryRepoDiffs.flatMap((repoDiff) => {
      if (!repoDiff.diff.trim()) return [];
      return parseDiff(repoDiff.diff).map((file, index) => {
        const displayPath = getDisplayPath(file);

        return {
          key: `history::${selectedHistoryGroup.id}::${repoDiff.repoName}::${displayPath}::${index}`,
          repoName: repoDiff.repoName,
          repoPath: repoDiff.repoPath,
          displayPath,
          status: getFileStatus(file),
          file,
        };
      });
    });
  }, [selectedHistoryRepoDiffs, selectedHistoryGroup]);

  const selectedHistoryEntriesByRepo = useMemo(() => {
    const grouped = new Map<
      string,
      { repoName: string; repoPath: string; entries: HistoryDiffEntry[] }
    >();
    for (const entry of selectedHistoryEntries) {
      const repoGroup = grouped.get(entry.repoPath);
      if (repoGroup) {
        repoGroup.entries.push(entry);
      } else {
        grouped.set(entry.repoPath, {
          repoName: entry.repoName,
          repoPath: entry.repoPath,
          entries: [entry],
        });
      }
    }
    return grouped;
  }, [selectedHistoryEntries]);

  useEffect(() => {
    if (!selectedHistoryGroup) return;

    setCollapsedHistoryRepos((previous) => {
      const next = { ...previous };
      for (const repoPath of selectedHistoryEntriesByRepo.keys()) {
        const key = `${selectedHistoryGroup.id}::${repoPath}`;
        if (!(key in next)) {
          next[key] = false;
        }
      }
      return next;
    });

    setCollapsedHistoryFiles((previous) => {
      const next = { ...previous };
      for (const entry of selectedHistoryEntries) {
        const key = `${selectedHistoryGroup.id}::${entry.key}`;
        if (!(key in next)) {
          next[key] = false;
        }
      }
      return next;
    });
  }, [selectedHistoryEntries, selectedHistoryEntriesByRepo, selectedHistoryGroup]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (
        hasHistoryTab &&
        (e.metaKey || e.ctrlKey) &&
        !e.altKey &&
        !e.shiftKey
      ) {
        if (e.key === '1') {
          e.preventDefault();
          setActiveSidebarTab('files');
          return;
        }
        if (e.key === '2') {
          e.preventDefault();
          setActiveSidebarTab('history');
          return;
        }
      }

      if (e.key === 'Escape' && onBack) {
        e.preventDefault();
        onBack();
        return;
      }

      if (
        onOpenRepoInGitHubWeb &&
        e.metaKey &&
        e.shiftKey &&
        !e.ctrlKey &&
        !e.altKey &&
        e.key.toLowerCase() === 'g'
      ) {
        e.preventDefault();
        const currentRepoPath = selectedEntry?.repoPath ?? repositories[0]?.path;
        if (currentRepoPath) {
          onOpenRepoInGitHubWeb(currentRepoPath);
        }
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [hasHistoryTab, onBack, onOpenRepoInGitHubWeb, repositories, selectedEntry]);

  const showNativeLineContextMenu = useCallback(
    async (lineIndex: number, groupInfo?: GroupInfo, groupOnly?: boolean) => {
      if (!showNativeContextMenu || !onDiscard || !selectedEntry) return;

      const canDiscardSingle =
        !groupOnly || !groupInfo || groupInfo.lineCount <= 1;
      const items: NativeContextMenuItem[] = [];

      if (canDiscardSingle) {
        items.push({
          id: 'discard-line',
          label: 'Discard Line',
          type: 'normal',
        });
      }

      if (groupInfo && groupInfo.lineCount > 1) {
        items.push({
          id: 'discard-group',
          label: `Discard Group (${groupInfo.lineCount} lines)`,
          type: 'normal',
        });
      }

      if (items.length === 0) return;

      const selectedId = await showNativeContextMenu(items);
      if (!selectedId) return;

      if (selectedId === 'discard-line') {
        requestDiscard({
          type: 'lines',
          fileEntry: selectedEntry,
          lineIndices: [lineIndex],
        });
        return;
      }

      if (selectedId === 'discard-group' && groupInfo) {
        const indices: number[] = [];
        for (let i = groupInfo.startIndex; i <= groupInfo.endIndex; i += 1) {
          indices.push(i);
        }
        requestDiscard({
          type: 'lines',
          fileEntry: selectedEntry,
          lineIndices: indices,
        });
      }
    },
    [onDiscard, requestDiscard, selectedEntry, showNativeContextMenu],
  );

  const handleLineContextMenu = useCallback(
    (e: React.MouseEvent, lineIndex: number, groupInfo?: GroupInfo, groupOnly?: boolean) => {
      if (!onDiscard || !selectedEntry) return;
      e.preventDefault();

      if (showNativeContextMenu) {
        void showNativeLineContextMenu(lineIndex, groupInfo, groupOnly);
        return;
      }

      setContextMenu({ type: 'line', x: e.clientX, y: e.clientY, fileEntry: selectedEntry, lineIndex, groupInfo, groupOnly });
    },
    [onDiscard, selectedEntry, showNativeContextMenu, showNativeLineContextMenu],
  );

  const handleHistoryGroupContextMenu = useCallback(
    async (e: React.MouseEvent, groupId: string) => {
      if (!showNativeContextMenu) return;
      e.preventDefault();

      const group = combinedHistory.find((item) => item.id === groupId);
      if (!group || group.commits.length === 0) return;

      const itemLabel = group.commits.length === 1 ? 'Copy SHA' : 'Copy SHAs';
      const selectedId = await showNativeContextMenu([
        { id: 'copy-sha', label: itemLabel, type: 'normal' },
      ]);

      if (selectedId !== 'copy-sha') return;

      const copyText =
        group.commits.length === 1
          ? group.commits[0].hash
          : group.commits.map((commit) => commit.hash).join('\n');

      try {
        await navigator.clipboard.writeText(copyText);
      } catch {
        // Clipboard can fail in restricted contexts.
      }
    },
    [combinedHistory, showNativeContextMenu],
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
  const shouldShowEmptyState =
    !loading &&
    totalFiles === 0 &&
    repoNames.length <= 1 &&
    !hasHistoryTab;
  const globalSelectionState = useMemo(() => {
    if (!selections || !onSelectionChange || entries.length === 0) return null;

    const types = entries.map(
      (entry) =>
        selections[entry.key]?.getSelectionType() ?? DiffSelectionType.All,
    );
    const allAll = types.every((t) => t === DiffSelectionType.All);
    const allNone = types.every((t) => t === DiffSelectionType.None);
    return {
      checked: allAll,
      indeterminate: !allAll && !allNone,
    };
  }, [entries, selections, onSelectionChange]);

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
              title="Back (Esc)"
              aria-label="Go back (Esc)"
              className="p-1.5 hover:bg-accent rounded-lg transition-colors"
            >
              <ArrowLeft className="h-4 w-4" />
            </button>
          )}
          <div>
            <h1 className="text-xl font-semibold">{title}</h1>
            {repoNames.length > 1 && (
              <p className="text-xs text-muted-foreground">
                {repoNames.length} repos
              </p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {onPushAll && (
            <button
              onClick={onPushAll}
              disabled={pushingAll}
              className="px-3 py-1.5 text-sm rounded-lg border border-border hover:bg-accent transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {pushingAll
                ? showPushIndicator
                  ? 'Pushing...'
                  : 'Syncing...'
                : showPushIndicator
                  ? '↑ Push'
                  : 'Sync All'}
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

      {shouldShowEmptyState ? (
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
            {hasHistoryTab && (
              <div className="flex border-b border-border shrink-0">
                <button
                  onClick={() => setActiveSidebarTab('files')}
                  className={cn(
                    'flex-1 px-3 py-2 text-xs font-medium transition-colors',
                    activeSidebarTab === 'files'
                      ? 'text-foreground border-b-2 border-primary'
                      : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  Files
                </button>
                <button
                  onClick={() => setActiveSidebarTab('history')}
                  className={cn(
                    'flex-1 px-3 py-2 text-xs font-medium transition-colors',
                    activeSidebarTab === 'history'
                      ? 'text-foreground border-b-2 border-primary'
                      : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  History
                </button>
              </div>
            )}

            {activeSidebarTab === 'files' ? (
              <>
                {globalSelectionState && (
                  <div className="w-full px-3 py-2 flex items-center gap-2 text-xs bg-muted/50 border-b border-border">
                    <input
                      type="checkbox"
                      ref={(el) => {
                        if (el) el.indeterminate = globalSelectionState.indeterminate;
                      }}
                      className="shrink-0 accent-blue-500"
                      checked={globalSelectionState.checked}
                      onChange={(e) => {
                        if (!onSelectionChange) return;
                        const checked = e.target.checked;
                        for (const entry of entries) {
                          const sel = selections?.[entry.key];
                          if (!sel) continue;
                          onSelectionChange(
                            entry.key,
                            checked ? sel.withSelectAll() : sel.withSelectNone(),
                          );
                        }
                      }}
                    />
                    <span className="text-muted-foreground">
                      {totalFiles} file{totalFiles !== 1 ? 's' : ''} changed
                    </span>
                  </div>
                )}
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
              </>
            ) : (
              <div className="divide-y divide-border">
                {historyLoading ? (
                  <div className="px-3 py-4 text-xs text-muted-foreground">
                    Loading history...
                  </div>
                ) : combinedHistory.length === 0 ? (
                  <div className="px-3 py-4 text-xs text-muted-foreground">
                    No commits found.
                  </div>
                ) : (
                  combinedHistory.map((group) => {
                    const selected = selectedHistoryGroupId === group.id;
                    return (
                      <button
                        key={group.id}
                        onClick={() => {
                          setSelectedHistoryGroupId(group.id);
                          if (mobile) setSidebarOpen(false);
                        }}
                        onContextMenu={(e) =>
                          void handleHistoryGroupContextMenu(e, group.id)
                        }
                        className={cn(
                          'w-full px-3 py-2 text-left transition-colors',
                          selected
                            ? 'bg-primary/10 border-l-2 border-l-primary pl-[10px]'
                            : 'hover:bg-accent/50',
                        )}
                      >
                        <div className="text-[11px] text-muted-foreground">
                          {formatHistoryTimestamp(group.newestAuthoredAtMs)}
                        </div>
                        <div className="mt-1 space-y-1">
                          {group.commits.map((commit) => (
                            <div key={`${group.id}-${commit.hash}`} className="min-w-0">
                              <div className="text-xs font-medium truncate">
                                {commit.repoName}: {commit.subject}
                              </div>
                              <div className="text-[11px] text-muted-foreground truncate">
                                {commit.description ||
                                  `${commit.shortHash} • ${commit.authorName || commit.authorEmail}`}
                              </div>
                            </div>
                          ))}
                        </div>
                      </button>
                    );
                  })
                )}
              </div>
            )}
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
              {activeSidebarTab === 'history' ? (
                historyLoading ? (
                  <div className="flex items-center justify-center h-full text-muted-foreground">
                    Loading history...
                  </div>
                ) : selectedHistoryGroup ? (
                  historyDiffLoadingGroupId === selectedHistoryGroup.id ? (
                    <div className="flex items-center justify-center h-full text-muted-foreground">
                      Loading grouped diff...
                    </div>
                  ) : selectedHistoryEntries.length > 0 ? (
                    <div className="divide-y divide-border">
                      <div className="px-4 py-2.5 text-xs text-muted-foreground bg-muted/30">
                        {selectedHistoryGroup.commits.length} commit
                        {selectedHistoryGroup.commits.length === 1 ? '' : 's'} across{' '}
                        {selectedHistoryGroup.repoNames.length} repo
                        {selectedHistoryGroup.repoNames.length === 1 ? '' : 's'}{' '}
                        • {selectedHistoryEntries.length} file
                        {selectedHistoryEntries.length === 1 ? '' : 's'} changed
                      </div>
                      {[...selectedHistoryEntriesByRepo.entries()].map(
                        ([repoPath, repoGroup]) => {
                          const repoCollapseKey = `${selectedHistoryGroup.id}::${repoPath}`;
                          const repoCollapsed = collapsedHistoryRepos[repoCollapseKey] ?? false;

                          return (
                            <div key={repoCollapseKey} className="border-b border-border/50">
                              <button
                                onClick={() =>
                                  setCollapsedHistoryRepos((previous) => ({
                                    ...previous,
                                    [repoCollapseKey]: !repoCollapsed,
                                  }))
                                }
                                onContextMenu={(e) =>
                                  handleContextMenu(
                                    e,
                                    {
                                      repoName: repoGroup.repoName,
                                      repoPath: repoGroup.repoPath,
                                      displayPath: '',
                                    },
                                    undefined,
                                  )
                                }
                                className="w-full px-4 py-2 text-xs flex items-center gap-2 bg-muted/20 hover:bg-muted/30 transition-colors"
                              >
                                {repoCollapsed ? (
                                  <ChevronRight className="h-3 w-3 shrink-0" />
                                ) : (
                                  <ChevronDown className="h-3 w-3 shrink-0" />
                                )}
                                <span className="font-medium truncate">{repoGroup.repoName}</span>
                                <span className="ml-auto text-[11px] text-muted-foreground">
                                  {repoGroup.entries.length} file
                                  {repoGroup.entries.length === 1 ? '' : 's'}
                                </span>
                              </button>

                              {!repoCollapsed &&
                                repoGroup.entries.map((entry) => {
                                  const fileCollapseKey = `${selectedHistoryGroup.id}::${entry.key}`;
                                  const fileCollapsed =
                                    collapsedHistoryFiles[fileCollapseKey] ?? false;

                                  return (
                                    <div
                                      key={entry.key}
                                      className="border-t border-border/50"
                                    >
                                      <button
                                        onClick={() =>
                                          setCollapsedHistoryFiles((previous) => ({
                                            ...previous,
                                            [fileCollapseKey]: !fileCollapsed,
                                          }))
                                        }
                                        onContextMenu={(e) =>
                                          handleContextMenu(
                                            e,
                                            {
                                              repoName: entry.repoName,
                                              repoPath: entry.repoPath,
                                              displayPath: entry.displayPath,
                                            },
                                            undefined,
                                          )
                                        }
                                        className="w-full px-4 py-2 text-xs flex items-center gap-2 hover:bg-accent/40 transition-colors"
                                      >
                                        {fileCollapsed ? (
                                          <ChevronRight className="h-3 w-3 shrink-0" />
                                        ) : (
                                          <ChevronDown className="h-3 w-3 shrink-0" />
                                        )}
                                        <span
                                          className={`shrink-0 text-xs font-mono font-bold w-4 text-center ${statusColor(entry.status)}`}
                                        >
                                          {statusLabel(entry.status)}
                                        </span>
                                        <span
                                          className="truncate"
                                          title={entry.displayPath}
                                        >
                                          {entry.displayPath}
                                        </span>
                                      </button>

                                      {!fileCollapsed && (
                                        <DiffRenderer file={entry.file} />
                                      )}
                                    </div>
                                  );
                                })}
                            </div>
                          );
                        },
                      )}
                    </div>
                  ) : (
                    <div className="flex items-center justify-center h-full text-muted-foreground">
                      No file diff available for this history group
                    </div>
                  )
                ) : (
                  <div className="flex items-center justify-center h-full text-muted-foreground">
                    No history selected
                  </div>
                )
              ) : (
                <>
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
                </>
              )}
            </div>
            {activeSidebarTab === 'files' && commitPanel && (
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
