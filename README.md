# multi-react

Shared React components and utilities for Multi ecosystem applications.

`multi-react` is the reusable React package behind Multi-style repository diff views. It provides a multi-repository `DiffViewer`, diff parsing helpers, patch formatting helpers, file-entry builders, and typed selection/history/context-menu models for apps that need to inspect and act on Git changes.

For the main Multi project, see the [Multi documentation](https://multi.bighelp.ai/) and [montaguegabe/multi](https://github.com/montaguegabe/multi).

## Installation

```sh
npm install multi-react
```

The host app provides React and React DOM:

```json
{
  "peerDependencies": {
    "react": ">=18",
    "react-dom": ">=18"
  }
}
```

## Usage

```tsx
import { DiffViewer, type Repository } from "multi-react";

const repositories: Repository[] = [
  {
    name: "example",
    path: "/path/to/example",
    diff: gitDiffText,
  },
];

export function ChangesView() {
  return (
    <DiffViewer
      title="Working Tree"
      repositories={repositories}
      onRefresh={() => void reloadDiffs()}
    />
  );
}
```

## Exports

- `DiffViewer`
- Repository, file-entry, history, selection, context-menu, and discard types
- `DiffSelection` and `DiffSelectionType`
- `parseDiff`
- `formatPatch` and `formatDiscardPatch`
- `getDisplayPath`, `getFileStatus`, and `buildRepoFileEntries`
- `cn`

## License

AGPL-3.0-only
