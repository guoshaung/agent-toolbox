'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { registerAvatarRigIpc, validateInput, refreshSeed, runProcess } = require('../src/main/avatar-rig-service');
const image = { base64: Buffer.from('image-fixture').toString('base64') };
const payload = () => ({ mode: 'multiview', name: '角色 ../ 名称', views: { front: image, left: image, back: image } });

async function temp(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'avatar-mv-test-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return root;
}

test('three views are required and each image is validated before running anything', () => {
  for (const missing of ['front', 'left', 'back']) {
    const input = payload(); delete input.views[missing];
    assert.throws(() => validateInput(input), /缺少/);
  }
  assert.throws(() => validateInput({ mode: 'shell' }), /未知/);
  assert.throws(() => validateInput({ base64: 'not valid!' }), /无效/);
  assert.throws(() => validateInput({ base64: 'A'.repeat(56 * 1024 * 1024) }), /40MB/);
  assert.deepEqual(Object.keys(validateInput(payload()).images), ['front', 'left', 'back']);
  const four = payload(); four.views.right = image;
  assert.equal(validateInput(four).images.right.toString(), 'image-fixture');
  assert.equal(validateInput({ ...four, options: { torsoCloth: true } }).options.torsoCloth, true);
  assert.equal(validateInput({ mode: 'single', base64: image.base64, options: { torsoCloth: true } }).options.torsoCloth, false);
  four.views.right = { base64: 'invalid!' };
  assert.throws(() => validateInput(four), /无效/);
});

test('multiview IPC writes distinct inputs, selects mv interpreter and blocks concurrent jobs', async t => {
  const root = await temp(t), handlers = {};
  let release, started;
  const entered = new Promise(r => { started = r; });
  const hold = new Promise(r => { release = r; });
  const calls = [];
  registerAvatarRigIpc({ handle: (n, f) => { handlers[n] = f; } }, {
    getUserDataPath: () => root, shell: {}, checkReadiness: async () => ({ single: true, multiview: true }),
    run: async (exe, args, options) => {
      calls.push({ exe, args }); started(); await hold;
      assert.equal(args[1], 'pipeline_multiview.py');
      assert.ok(exe.includes('.venv-mv'));
      const job = args.at(-1);
      for (const view of ['front', 'left', 'back', 'right']) assert.equal((await fs.readFile(path.join(job, 'input-' + view + '.png'))).toString(), 'image-fixture');
      assert.equal(JSON.parse(await fs.readFile(path.join(job, 'torso-cloth.json'))).bounce.amplitude, .01);
      options.onOutput('STAGE:export_vrm.py');
      const bytes = Buffer.alloc(1024); bytes.write('glTF'); bytes.writeUInt32LE(2, 4); bytes.writeUInt32LE(1024, 8);
      await fs.writeFile(path.join(job, 'avatar.vrm'), bytes);
      await fs.writeFile(path.join(job, 'project.json'), JSON.stringify({ source: 'Hunyuan3D-2mv', bones: 21 }));
    },
  });
  const four = payload(); four.views.right = image; four.options = { torsoCloth: true };
  const job = handlers['avatarRig:generate'](null, four);
  await entered;
  assert.equal((await handlers['avatarRig:status']()).running, true);
  assert.equal((await handlers['avatarRig:generate'](null, payload())).ok, false);
  release();
  const result = await job;
  assert.equal(result.ok, true);
  assert.equal(calls.length, 1);
  assert.equal((await handlers['avatarRig:status']()).running, false);
  assert.match(result.jobId, /^[a-zA-Z0-9_-]+$/);
});

test('failed reconstruction reports failure without stale success and releases the lock', async t => {
  const root = await temp(t), handlers = {};
  registerAvatarRigIpc({ handle: (n, f) => { handlers[n] = f; } }, {
    getUserDataPath: () => root, shell: {}, checkReadiness: async () => ({ single: true, multiview: true }),
    run: async () => { throw new Error('CUDA out of memory'); },
  });
  const result = await handlers['avatarRig:generate'](null, payload());
  assert.equal(result.ok, false); assert.match(result.error, /CUDA/);
  const jobs = path.join(root, 'container/avatar-rig-studio/jobs');
  const job = (await fs.readdir(jobs))[0];
  assert.equal(JSON.parse(await fs.readFile(path.join(jobs, job, 'failure.json'))).ok, false);
  assert.equal((await handlers['avatarRig:status']()).running, false);
});

test('explicit seed update backs up edited scripts and preserves jobs/envs/models', async t => {
  const root = await temp(t), source = path.join(root, 'seed'), target = path.join(root, 'project');
  for (const dir of [source, target, path.join(source, 'jobs'), path.join(target, 'jobs')]) await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(source, 'app.py'), 'new'); await fs.writeFile(path.join(target, 'app.py'), 'edited');
  await fs.writeFile(path.join(source, 'jobs/result.txt'), 'seed'); await fs.writeFile(path.join(target, 'jobs/result.txt'), 'user');
  await fs.mkdir(path.join(source, 'vendor/backend/models'), { recursive: true });
  await fs.writeFile(path.join(source, 'vendor/backend/models/network.py'), 'network code');
  const result = await refreshSeed(source, target);
  assert.equal(result.backedUp, 1);
  assert.equal(await fs.readFile(path.join(result.backup, 'app.py'), 'utf8'), 'edited');
  assert.equal(await fs.readFile(path.join(target, 'jobs/result.txt'), 'utf8'), 'user');
  assert.equal(await fs.readFile(path.join(target, 'vendor/backend/models/network.py'), 'utf8'), 'network code');
  assert.equal((await refreshSeed(source, target)).copied, 0);
});

test('process failure preserves stderr and returns a rejection', async () => {
  await assert.rejects(runProcess(process.execPath, ['-e', 'console.error("stage failed");process.exit(3)'], { cwd: process.cwd(), timeout: 5000 }), /stage failed/);
});
