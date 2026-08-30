/**
 * 配置的渲染进程门面：启动时整份读进来，之后读是同步的（工具代码里到处 await
 * 太啰嗦），写是穿透到主进程落盘的。
 */
export class Config {
  constructor(initial) {
    this.cache = initial || {};
  }

  static async load() {
    return new Config(await window.toolbox.config.all());
  }

  get(key, fallback) {
    const value = key.split('.').reduce((acc, k) => (acc == null ? acc : acc[k]), this.cache);
    return value === undefined ? fallback : value;
  }

  async set(key, value) {
    const parts = key.split('.');
    const last = parts.pop();
    let node = this.cache;
    for (const part of parts) {
      if (typeof node[part] !== 'object' || node[part] === null) node[part] = {};
      node = node[part];
    }
    if (value === undefined) delete node[last];
    else node[last] = value;
    await window.toolbox.config.set(key, value);
    return value;
  }
}
