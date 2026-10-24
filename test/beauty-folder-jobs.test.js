'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { BeautyFolderJobs } = require('../src/main/beauty-folder-jobs');
const owner = key => ({ key, alive: () => true });

test('folder progress and stop are isolated to the owner frame and opaque plan ID', async () => {
  const jobs = new BeautyFolderJobs(), first = owner('window1:frame1'), other = owner('window1:frame2');
  jobs.bind({ id: 'plan', count: 3 }, first);
  await assert.rejects(jobs.run('plan', other, async () => {}), /不属于/);
  let release, entered; const gate = new Promise(resolve => { release = resolve; }), start = new Promise(resolve => { entered = resolve; });
  const running = jobs.run('plan', first, async controls => {
    controls.onProgress({ total: 3, completed: 1, imported: 1, added: 1, failed: 0, current: 'sub/image.png' }); entered(); await gate;
    assert.equal(controls.shouldStop(), true);
    return { total: 3, attempted: 1, imported: ['one'], added: 1, errors: [], stopped: true, unprocessed: 2 };
  });
  await start;
  for (const requester of [other, owner('another-window')]) {
    assert.throws(() => jobs.status('plan', requester), /不属于/); assert.throws(() => jobs.stop('plan', requester), /不属于/);
  }
  assert.throws(() => jobs.status('unknown', first), /不属于/);
  assert.equal(jobs.status('plan', first).completed, 1); assert.equal(jobs.stop('plan', first).phase, 'stopping');
  release(); await running;
  const state = jobs.status('plan', first); assert.equal(state.phase, 'stopped'); assert.equal(state.unprocessed, 2);
  assert.equal(jobs.stop('plan', first).phase, 'stopped'); assert.equal(state.current, '');
});

test('only one import runs, queued stop and closed originating frame stop future work', async () => {
  const jobs = new BeautyFolderJobs(), first = owner('one');
  jobs.bind({ id: 'first', count: 2 }, first);
  let release; const gate = new Promise(resolve => { release = resolve; });
  const running = jobs.run('first', first, async controls => { await gate; assert.equal(controls.shouldStop(), true); return { total: 2, attempted: 0, imported: [], added: 0, errors: [], stopped: true, unprocessed: 2 }; });
  jobs.bind({ id: 'second', count: 1 }, owner('two'));
  await assert.rejects(jobs.run('second', owner('two'), async () => {}), /仍在进行/);
  jobs.stop('first', first); release(); await running;
  await jobs.run('second', { key: 'two', alive: () => false }, async controls => {
    assert.equal(controls.shouldStop(), true);
    return { total: 1, attempted: 0, imported: [], added: 0, errors: [], stopped: true, unprocessed: 1 };
  });
  assert.throws(() => jobs.status('first', first), /过期/);
});

test('terminal failures leave a bounded safe status and a later job can run', async () => {
  const jobs = new BeautyFolderJobs(), first = owner('first'); jobs.bind({ id: 'bad', count: 1 }, first);
  await assert.rejects(jobs.run('bad', first, async () => { throw new Error('disk failure'); }), /disk/);
  assert.equal(jobs.status('bad', first).phase, 'failed'); assert.ok(!JSON.stringify(jobs.status('bad', first)).includes('disk failure'));
  jobs.bind({ id: 'next', count: 0 }, first);
  await jobs.run('next', first, async () => ({ total: 0, attempted: 0, imported: [], added: 0, errors: [], stopped: false, unprocessed: 0 }));
  assert.equal(jobs.status('next', first).phase, 'done');
});
