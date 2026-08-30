/**
 * 预置书签一律指向**官方文档**，不放二手教程站 —— 这是需求第 1 条的重点。
 * 用户增删的书签存在 config 的 docs.bookmarks 里，和这份默认表合并。
 */
export const DEFAULT_BOOKMARKS = [
  { group: '语言', name: 'Python', url: 'https://docs.python.org/zh-cn/3/' },
  { group: '语言', name: 'MDN Web', url: 'https://developer.mozilla.org/zh-CN/docs/Web' },
  { group: '语言', name: 'TypeScript', url: 'https://www.typescriptlang.org/zh/docs/' },
  { group: '语言', name: 'Go', url: 'https://go.dev/doc/' },
  { group: '语言', name: 'Rust', url: 'https://doc.rust-lang.org/book/' },
  { group: '语言', name: 'Java SE API', url: 'https://docs.oracle.com/en/java/javase/21/docs/api/' },

  { group: '前端', name: 'React', url: 'https://zh-hans.react.dev/' },
  { group: '前端', name: 'Vue 3', url: 'https://cn.vuejs.org/guide/introduction.html' },
  { group: '前端', name: 'Vite', url: 'https://cn.vitejs.dev/' },
  { group: '前端', name: 'Tailwind', url: 'https://tailwindcss.com/docs' },
  { group: '前端', name: 'Electron', url: 'https://www.electronjs.org/zh/docs/latest/' },
  { group: '前端', name: 'Playwright', url: 'https://playwright.dev/docs/intro' },

  { group: '后端', name: 'Node.js', url: 'https://nodejs.org/docs/latest/api/' },
  { group: '后端', name: 'FastAPI', url: 'https://fastapi.tiangolo.com/zh/' },
  { group: '后端', name: 'Django', url: 'https://docs.djangoproject.com/zh-hans/stable/' },
  { group: '后端', name: 'Flask', url: 'https://flask.palletsprojects.com/' },
  { group: '后端', name: 'Spring Boot', url: 'https://docs.spring.io/spring-boot/index.html' },

  { group: '数据 / AI', name: 'pandas', url: 'https://pandas.pydata.org/docs/' },
  { group: '数据 / AI', name: 'NumPy', url: 'https://numpy.org/doc/stable/' },
  { group: '数据 / AI', name: 'PyTorch', url: 'https://pytorch.org/docs/stable/index.html' },
  { group: '数据 / AI', name: 'Hugging Face', url: 'https://huggingface.co/docs' },

  { group: '基础设施', name: 'Git', url: 'https://git-scm.com/book/zh/v2' },
  { group: '基础设施', name: 'Docker', url: 'https://docs.docker.com/' },
  { group: '基础设施', name: 'Kubernetes', url: 'https://kubernetes.io/zh-cn/docs/home/' },
  { group: '基础设施', name: 'PostgreSQL', url: 'https://www.postgresql.org/docs/current/' },
  { group: '基础设施', name: 'Redis', url: 'https://redis.io/docs/latest/' },
  { group: '基础设施', name: 'Nginx', url: 'https://nginx.org/en/docs/' },
];
