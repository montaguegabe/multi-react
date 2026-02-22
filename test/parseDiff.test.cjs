const test = require('node:test');
const assert = require('node:assert/strict');

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
