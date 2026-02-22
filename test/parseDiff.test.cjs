const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');

const {
  parseDiff,
  formatPatch,
  DiffSelection,
  DiffSelectionType,
} = require('../dist/index.js');

test('preserves literal "\\ No newline at end of file" text inside changed lines', () => {
  const diff = [
    'diff --git a/src/index.ts b/src/index.ts',
    'index 7f9f97f..fbf9f10 100644',
    '--- a/src/index.ts',
    '+++ b/src/index.ts',
    '@@ -11,4 +11,4 @@ export { cn } from \'./utils/cn\';',
    ' export { DiffSelection, DiffSelectionType } from \'./models/DiffSelection\';',
    ' export { formatPatch, formatDiscardPatch } from \'./utils/formatPatch\';',
    ' ',
    '-// Wrapper around diff2html that preserves "" info',
    '+// Wrapper around diff2html that preserves "\\ No newline at end of file" info',
    ' export { parseDiff } from \'./utils/parseDiff\';',
  ].join('\n');

  const files = parseDiff(diff);
  const lines = files[0].blocks[0].lines;
  const del = lines.find((line) => line.type === 'delete' && line.oldNumber === 14);
  const ins = lines.find((line) => line.type === 'insert' && line.newNumber === 14);

  assert.ok(del, 'expected delete line at old line 14');
  assert.ok(ins, 'expected insert line at new line 14');
  assert.equal(del.content, '-// Wrapper around diff2html that preserves "" info');
  assert.equal(
    ins.content,
    '+// Wrapper around diff2html that preserves "\\ No newline at end of file" info',
  );
});

test('annotates true no-newline markers on preceding parsed line', () => {
  const diff = [
    'diff --git a/nocache.txt b/nocache.txt',
    'index 3722f5a..e23d8ce 100644',
    '--- a/nocache.txt',
    '+++ b/nocache.txt',
    '@@ -1,3 +1,3 @@',
    ' We change the contents of this file to the current date and time to force a re-fetch of internal pip packages.',
    ' ',
    '-This is done automatically by the `gha_build` script.',
    '\\ No newline at end of file',
    '+This is done automatically by the `gha_build` script.',
  ].join('\n');

  const files = parseDiff(diff);
  const lines = files[0].blocks[0].lines;
  const del = lines.find((line) => line.type === 'delete');
  const ins = lines.find((line) => line.type === 'insert');

  assert.ok(del, 'expected delete line');
  assert.ok(ins, 'expected insert line');
  assert.equal(del.noNewlineAtEnd, true);
  assert.equal(ins.noNewlineAtEnd, undefined);
});

test('formatPatch emits /dev/null target path for deleted files', () => {
  const diff = [
    'diff --git a/old.txt b/old.txt',
    'deleted file mode 100644',
    'index ce01362..0000000',
    '--- a/old.txt',
    '+++ /dev/null',
    '@@ -1 +0,0 @@',
    '-hello',
  ].join('\n');

  const files = parseDiff(diff);
  assert.equal(files.length, 1);

  const selection = DiffSelection.fromInitialSelection(DiffSelectionType.All);
  const patch = formatPatch(files[0], selection, false);
  assert.ok(patch, 'expected a patch for deleted file selection');
  assert.ok(
    patch.startsWith('--- a/old.txt\n+++ /dev/null\n'),
    `unexpected deleted-file patch header:\n${patch}`,
  );
});

test('formatPatch emits +0,0 in deleted-file hunk headers', () => {
  const diff = [
    'diff --git a/.github/workflows/deploy.yml b/.github/workflows/deploy.yml',
    'deleted file mode 100644',
    'index 18f8a6e..0000000',
    '--- a/.github/workflows/deploy.yml',
    '+++ /dev/null',
    '@@ -1,3 +0,0 @@',
    '-name: deploy',
    '-on: push',
    '-jobs: {}',
  ].join('\n');

  const [file] = parseDiff(diff);
  const selection = DiffSelection.fromInitialSelection(DiffSelectionType.All);
  const patch = formatPatch(file, selection, false);
  assert.ok(patch, 'expected patch for deleted file');
  assert.match(patch, /@@ -1,3 \+0,0 @@/, `unexpected deleted hunk:\n${patch}`);
});

test('selected mixed patch applies cleanly after git reset --cached flow', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'multi-react-patch-'));
  const git = (args) =>
    execFileSync('git', args, {
      cwd: tmp,
      encoding: 'utf8',
    });

  try {
    git(['init', '-q']);
    fs.mkdirSync(path.join(tmp, '.github/workflows'), { recursive: true });
    fs.mkdirSync(path.join(tmp, 'openbase_api/dev'), { recursive: true });

    fs.writeFileSync(
      path.join(tmp, '.github/workflows/deploy.yml'),
      ['name: deploy', 'on: push', 'jobs:', '  deploy: {}'].join('\n') + '\n',
    );

    const testsBase =
      Array.from({ length: 80 }, (_, i) => `tests line ${i + 1}`).join('\n') +
      '\n';
    const viewsBase =
      Array.from({ length: 60 }, (_, i) => `views line ${i + 1}`).join('\n') +
      '\n';

    fs.writeFileSync(path.join(tmp, 'openbase_api/dev/tests.py'), testsBase);
    fs.writeFileSync(path.join(tmp, 'openbase_api/dev/views.py'), viewsBase);
    fs.writeFileSync(
      path.join(tmp, 'openbase_api/package_apps.py'),
      'INSTALLED_APPS = []\n',
    );

    git(['add', '.']);
    git(['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'init']);

    fs.rmSync(path.join(tmp, '.github/workflows/deploy.yml'));

    const testsLines = testsBase.split('\n');
    testsLines.splice(1, 2, 'tests line 2 changed', 'tests line 3 changed', 'tests inserted 3.5');
    testsLines.splice(40, 1, 'tests line 41 changed', 'tests inserted 41.5');
    testsLines.splice(70, 2, 'tests line 71 changed');
    fs.writeFileSync(path.join(tmp, 'openbase_api/dev/tests.py'), testsLines.join('\n'));

    const viewsLines = viewsBase.split('\n');
    viewsLines.splice(7, 1, 'views line 8 changed', 'views inserted 8.5');
    viewsLines.splice(30, 2, 'views line 31 changed');
    fs.writeFileSync(path.join(tmp, 'openbase_api/dev/views.py'), viewsLines.join('\n'));

    fs.writeFileSync(
      path.join(tmp, 'openbase_api/package_apps.py'),
      'INSTALLED_APPS = []\nINSTALLED_APPS += ["dev"]\n',
    );

    const rawDiff = git(['diff', 'HEAD']);
    const files = parseDiff(rawDiff);
    let patch = '';

    files.forEach((file) => {
      let selection;
      if (file.newName === '/dev/null') {
        selection = DiffSelection.fromInitialSelection(DiffSelectionType.All);
      } else {
        selection = DiffSelection.fromInitialSelection(DiffSelectionType.None);
        let lineIndex = 0;
        let changedLineIndex = 0;

        file.blocks.forEach((block) => {
          block.lines.forEach((line) => {
            if (line.type === 'insert' || line.type === 'delete') {
              if (changedLineIndex % 2 === 0) {
                selection = selection.withLineSelection(lineIndex, true);
              }
              changedLineIndex += 1;
            }
            lineIndex += 1;
          });
        });
      }

      const filePatch = formatPatch(file, selection, file.isNew === true);
      if (filePatch) patch += filePatch;
    });

    assert.match(
      patch,
      /@@ -1,\d+ \+0,0 @@/,
      `expected deleted-file hunk to start at +0,0:\n${patch}`,
    );

    fs.writeFileSync(path.join(tmp, 'selected.patch'), patch);
    git(['reset', '-q', 'HEAD']);

    const applied = spawnSync(
      'git',
      ['apply', '--cached', '--unidiff-zero', '--whitespace=nowarn', 'selected.patch'],
      {
        cwd: tmp,
        encoding: 'utf8',
      },
    );

    assert.equal(
      applied.status,
      0,
      `expected patch to apply cleanly. stderr:\n${applied.stderr}\npatch:\n${patch}`,
    );
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
