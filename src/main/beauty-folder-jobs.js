'use strict';
// One bounded job and one preview. Status is polled by its originating renderer frame only.
class BeautyFolderJobs {
  constructor() { this.preview = null; this.job = null; }
  bind(preview, owner) { this.preview = { id: preview.id, total: preview.count, owner: owner.key }; }
  checkPreview(id, owner) {
    if (!this.preview || this.preview.id !== id || this.preview.owner !== owner.key) throw new Error('文件夹预览不属于当前页面，请重新选择');
  }
  checkJob(id, owner) {
    if (!this.job || this.job.id !== id || this.job.owner !== owner.key) throw new Error('导入任务不属于当前页面或已过期');
    return this.job;
  }
  status(id, owner) { return { ...this.checkJob(id, owner).state }; }
  stop(id, owner) {
    const job = this.checkJob(id, owner);
    if (!job.finished) { job.stop = true; job.state.cancelRequested = true; job.state.phase = 'stopping'; }
    return { ...job.state };
  }
  async run(id, owner, execute) {
    this.checkPreview(id, owner);
    if (this.job && !this.job.finished) throw new Error('另一个文件夹导入仍在进行，请稍后重试');
    const job = { id, owner: owner.key, stop: false, finished: false, state: { id, phase: 'queued', total: this.preview.total, completed: 0, imported: 0, added: 0, failed: 0, current: '', cancelRequested: false } };
    this.job = job; this.preview = null;
    try {
      const result = await execute({
        shouldStop: () => job.stop || !owner.alive(),
        onProgress: state => { Object.assign(job.state, state, { current: String(state.current || '').slice(0, 240), phase: job.stop ? 'stopping' : 'running' }); },
      });
      Object.assign(job.state, { phase: result.stopped ? 'stopped' : 'done', total: result.total, completed: result.attempted, imported: result.imported.length, added: result.added, failed: result.errors.length, current: '', unprocessed: result.unprocessed });
      return result;
    } catch (error) { job.state.phase = 'failed'; job.state.current = ''; throw error; }
    finally { job.finished = true; }
  }
}
module.exports = { BeautyFolderJobs };
