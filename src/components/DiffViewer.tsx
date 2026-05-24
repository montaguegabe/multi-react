import {
  ArrowLeft,
  PanelLeftClose,
  PanelLeftOpen,
  RefreshCw,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  ContextMenuTarget,
  NativeContextMenuItem,
  DiscardTarget,
  DiffViewerProps,
  FileEntry,
  HistoryRepoDiff,
} from '../types';
import type { GroupInfo } from './DiffRenderer';
import { DiffSelectionType } from '../models/DiffSelection';
import { ConfirmDialog } from './ConfirmDialog';
import {
  buildHistoryFileEntries,
  buildRepoFileEntries,
} from '../utils/diffEntries';
import { DiffViewerContent } from './DiffViewerContent';
import { DiffViewerSidebar } from './DiffViewerSidebar';
import {
  getCurrentFilePreviewUrl,
  type HistoryDiffEntry,
} from './DiffViewer.shared';

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
  const [historyDiffRequestedGroupIds, setHistoryDiffRequestedGroupIds] =
    useState<Record<string, true>>({});
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
  const fileEntryButtonRefs = useRef<Record<string, HTMLButtonElement | null>>(
    {},
  );
  const historyGroupButtonRefs = useRef<
    Record<string, HTMLButtonElement | null>
  >({});
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
    if (
      selectedHistoryGroupId &&
      !combinedHistory.some((group) => group.id === selectedHistoryGroupId)
    ) {
      setSelectedHistoryGroupId(null);
    }
  }, [combinedHistory, hasHistoryTab, selectedHistoryGroupId]);

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

    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [activeSidebarTab, entries]);

  const selectedEntry = useMemo(
    () => entries.find((e) => e.key === selectedKey) ?? null,
    [entries, selectedKey],
  );
  const selectedEntryPreviewUrl = useMemo(
    () => getCurrentFilePreviewUrl(selectedEntry),
    [selectedEntry],
  );

  const selectedHistoryGroup = useMemo(
    () =>
      combinedHistory.find((group) => group.id === selectedHistoryGroupId) ??
      null,
    [combinedHistory, selectedHistoryGroupId],
  );
  const selectedHistoryDiffRequested = selectedHistoryGroup
    ? Boolean(historyDiffRequestedGroupIds[selectedHistoryGroup.id])
    : false;
  const selectedHistoryDiffLoaded = selectedHistoryGroup
    ? Object.prototype.hasOwnProperty.call(
        historyDiffByGroupId,
        selectedHistoryGroup.id,
      )
    : false;

  const handleHistoryGroupSelect = useCallback((groupId: string) => {
    setSelectedHistoryGroupId(groupId);
    setHistoryDiffRequestedGroupIds((previous) =>
      previous[groupId] ? previous : { ...previous, [groupId]: true },
    );
  }, []);

  useEffect(() => {
    if (!sidebarOpen || activeSidebarTab !== 'files' || !selectedKey) return;
    fileEntryButtonRefs.current[selectedKey]?.scrollIntoView({
      block: 'nearest',
      inline: 'nearest',
    });
  }, [activeSidebarTab, selectedKey, sidebarOpen, entries]);

  useEffect(() => {
    if (
      !sidebarOpen ||
      activeSidebarTab !== 'history' ||
      !selectedHistoryGroupId
    ) {
      return;
    }
    historyGroupButtonRefs.current[selectedHistoryGroupId]?.scrollIntoView({
      block: 'nearest',
      inline: 'nearest',
    });
  }, [activeSidebarTab, selectedHistoryGroupId, sidebarOpen, combinedHistory]);

  useEffect(() => {
    if (
      !loadHistoryGroupDiff ||
      activeSidebarTab !== 'history' ||
      !selectedHistoryGroup ||
      !historyDiffRequestedGroupIds[selectedHistoryGroup.id]
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
    historyDiffRequestedGroupIds,
    historyDiffByGroupId,
    loadHistoryGroupDiff,
    selectedHistoryGroup,
  ]);

  const selectedHistoryRepoDiffs = selectedHistoryGroup
    ? historyDiffByGroupId[selectedHistoryGroup.id]
    : undefined;

  const selectedHistoryEntries = useMemo<HistoryDiffEntry[]>(() => {
    if (!selectedHistoryGroup || !selectedHistoryRepoDiffs) return [];

    return buildHistoryFileEntries(
      selectedHistoryGroup.id,
      selectedHistoryRepoDiffs,
    );
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
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
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
        <div className={`flex flex-1 min-h-0 overflow-hidden ${resizing ? 'select-none' : ''}`}>
          <div
            className={`min-h-0 ${sidebarOpen ? '' : 'w-0 overflow-hidden'} ${resizing ? '' : 'transition-all duration-200'}`}
            style={sidebarOpen ? { width: sidebarWidth } : undefined}
          >
            <DiffViewerSidebar
              hasHistoryTab={hasHistoryTab}
              activeSidebarTab={activeSidebarTab}
              setActiveSidebarTab={setActiveSidebarTab}
              globalSelectionState={globalSelectionState}
              totalFiles={totalFiles}
              entries={entries}
              selections={selections}
              onSelectionChange={onSelectionChange}
              repoNames={repoNames}
              byRepo={byRepo}
              collapsedRepos={collapsedRepos}
              setCollapsedRepos={setCollapsedRepos}
              selectedKey={selectedKey}
              setSelectedKey={setSelectedKey}
              mobile={mobile}
              setSidebarOpen={setSidebarOpen}
              handleContextMenu={handleContextMenu}
              repoPathByName={repoPathByName}
              fileEntryButtonRefs={fileEntryButtonRefs}
              historyLoading={historyLoading}
              combinedHistory={combinedHistory}
              selectedHistoryGroupId={selectedHistoryGroupId}
              onHistoryGroupSelect={handleHistoryGroupSelect}
              historyGroupButtonRefs={historyGroupButtonRefs}
              handleHistoryGroupContextMenu={handleHistoryGroupContextMenu}
            />
          </div>

          {/* Resize handle */}
          {sidebarOpen && (
            <div
              onMouseDown={() => setResizing(true)}
              className="w-1 shrink-0 cursor-col-resize hover:bg-primary/30 active:bg-primary/50 transition-colors"
            />
          )}

          <DiffViewerContent
            activeSidebarTab={activeSidebarTab}
            historyLoading={historyLoading}
            selectedHistoryGroup={selectedHistoryGroup}
            selectedHistoryDiffRequested={selectedHistoryDiffRequested}
            selectedHistoryDiffLoaded={selectedHistoryDiffLoaded}
            historyDiffLoadingGroupId={historyDiffLoadingGroupId}
            selectedHistoryEntries={selectedHistoryEntries}
            selectedHistoryEntriesByRepo={selectedHistoryEntriesByRepo}
            collapsedHistoryRepos={collapsedHistoryRepos}
            setCollapsedHistoryRepos={setCollapsedHistoryRepos}
            collapsedHistoryFiles={collapsedHistoryFiles}
            setCollapsedHistoryFiles={setCollapsedHistoryFiles}
            handleContextMenu={handleContextMenu}
            selectedEntry={selectedEntry}
            selections={selections}
            onSelectionChange={onSelectionChange}
            onDiscard={onDiscard}
            handleLineContextMenu={handleLineContextMenu}
            selectedEntryPreviewUrl={selectedEntryPreviewUrl}
            commitPanel={commitPanel}
          />
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
