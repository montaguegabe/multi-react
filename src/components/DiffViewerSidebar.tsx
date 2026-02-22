import { ChevronDown, ChevronRight } from 'lucide-react';
import type React from 'react';
import type {
  Dispatch,
  MutableRefObject,
  RefCallback,
  SetStateAction,
} from 'react';
import { DiffSelectionType } from '../models/DiffSelection';
import type { DiffSelection } from '../models/DiffSelection';
import type { ContextMenuTarget, FileEntry, HistoryGroup } from '../types';
import { cn } from '../utils/cn';
import {
  formatHistoryTimestamp,
  statusColor,
  statusLabel,
} from './DiffViewer.shared';

type GlobalSelectionState = {
  checked: boolean;
  indeterminate: boolean;
};

type RepoEntriesByName = Record<string, FileEntry[]>;

type DiffViewerSidebarProps = {
  hasHistoryTab: boolean;
  activeSidebarTab: 'files' | 'history';
  setActiveSidebarTab: Dispatch<SetStateAction<'files' | 'history'>>;
  globalSelectionState: GlobalSelectionState | null;
  totalFiles: number;
  entries: FileEntry[];
  selections?: Record<string, DiffSelection>;
  onSelectionChange?: (fileKey: string, selection: DiffSelection) => void;
  repoNames: string[];
  byRepo: RepoEntriesByName;
  collapsedRepos: Record<string, boolean>;
  setCollapsedRepos: Dispatch<SetStateAction<Record<string, boolean>>>;
  selectedKey: string | null;
  setSelectedKey: Dispatch<SetStateAction<string | null>>;
  mobile: boolean;
  setSidebarOpen: Dispatch<SetStateAction<boolean>>;
  handleContextMenu: (
    e: React.MouseEvent,
    target: ContextMenuTarget,
    fileEntry?: FileEntry,
  ) => void;
  repoPathByName: Record<string, string>;
  fileEntryButtonRefs: MutableRefObject<Record<string, HTMLButtonElement | null>>;
  historyLoading: boolean;
  combinedHistory: HistoryGroup[];
  selectedHistoryGroupId: string | null;
  onHistoryGroupSelect: (groupId: string) => void;
  historyGroupButtonRefs: MutableRefObject<
    Record<string, HTMLButtonElement | null>
  >;
  handleHistoryGroupContextMenu: (
    e: React.MouseEvent,
    groupId: string,
  ) => Promise<void>;
};

export function DiffViewerSidebar({
  hasHistoryTab,
  activeSidebarTab,
  setActiveSidebarTab,
  globalSelectionState,
  totalFiles,
  entries,
  selections,
  onSelectionChange,
  repoNames,
  byRepo,
  collapsedRepos,
  setCollapsedRepos,
  selectedKey,
  setSelectedKey,
  mobile,
  setSidebarOpen,
  handleContextMenu,
  repoPathByName,
  fileEntryButtonRefs,
  historyLoading,
  combinedHistory,
  selectedHistoryGroupId,
  onHistoryGroupSelect,
  historyGroupButtonRefs,
  handleHistoryGroupContextMenu,
}: DiffViewerSidebarProps) {
  return (
    <div className="shrink-0 border-r border-border overflow-y-auto bg-muted/30">
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
                      handleContextMenu(
                        e,
                        {
                          repoName,
                          repoPath: repoPathByName[repoName] ?? '',
                          displayPath: '',
                        },
                        undefined,
                      )
                    }
                    className={`w-full px-3 py-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider bg-muted/50 border-b border-border select-none ${hasFiles ? 'text-muted-foreground hover:bg-accent/50' : 'text-muted-foreground/40'} transition-colors`}
                  >
                    {selections &&
                      onSelectionChange &&
                      (() => {
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
                          (f) =>
                            selections[f.key]?.getSelectionType() ??
                            DiffSelectionType.All,
                        );
                        const allAll = types.every(
                          (t) => t === DiffSelectionType.All,
                        );
                        const allNone = types.every(
                          (t) => t === DiffSelectionType.None,
                        );
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
                                  checked
                                    ? sel.withSelectAll()
                                    : sel.withSelectNone(),
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
                        ref={(el) => {
                          fileEntryButtonRefs.current[entry.key] = el;
                        }}
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
                                e.target.checked
                                  ? sel.withSelectAll()
                                  : sel.withSelectNone(),
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
                        <span className="truncate text-xs" title={entry.displayPath}>
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
                  ref={(el) => {
                    historyGroupButtonRefs.current[group.id] = el;
                  }}
                  onClick={() => {
                    onHistoryGroupSelect(group.id);
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
  );
}
