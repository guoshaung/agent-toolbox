"""闲鱼自动回复：本机一键安装 + 启动（工具箱「容器」里点 ▶ 运行的就是这个文件）。

上游项目：zhinianboke/xianyu-auto-reply（AGPL-3.0）。这里不分发它的代码，
第一次运行时按 UPSTREAM_COMMIT 拉取固定版本，之后每一步都会先检查、已完成就跳过：

  1. 拉取上游代码到本目录
  2. 用 uv 建 Python 3.11 虚拟环境并装依赖（清华镜像）
  3. 下载 MySQL 8.0（阿里云镜像，校验 MD5），数据放在 .runtime/，端口 3307
  4. 下载 Redis 源码（校验 SHA-256）并编译，端口 6380
  5. 生成随机的数据库 / Redis / JWT 密码，写进 .runtime/xianyu.env（仅本人可读）
  6. 下载 Playwright / Patchright 浏览器（npmmirror 镜像）
  7. 装前端依赖并构建

然后启动 MySQL → Redis → backend-web(8089) → websocket(8090) → scheduler(8091)
→ 前端(9000)，并打开浏览器。全部只监听 127.0.0.1。Ctrl+C 或在工具箱里停止会关掉所有服务。

不叫 main.py：后端用 uvicorn 按 "main:app" 加载，根目录有 main.py 会撞名。
只用标准库，并兼容 macOS 自带的 python3（3.9），因为第一次运行时还没有虚拟环境。
"""
import hashlib
import os
import platform
import secrets
import shutil
import signal
import subprocess
import sys
import tarfile
import time
import urllib.request
import webbrowser
from pathlib import Path

ROOT = Path(__file__).resolve().parent
RT = ROOT / ".runtime"
LOGS = RT / "logs"
RUN = RT / "run"
PY = ROOT / ".venv" / "bin" / "python"

UPSTREAM = "https://github.com/zhinianboke/xianyu-auto-reply.git"
UPSTREAM_COMMIT = "ff3e89605ede8229d2428ab8092f6fb0cc848cb8"

PIP_INDEX = "https://pypi.tuna.tsinghua.edu.cn/simple"
NPM_REGISTRY = "https://registry.npmmirror.com"
PLAYWRIGHT_MIRROR = "https://npmmirror.com/mirrors/playwright"

MYSQL_VERSION = "8.0.28"
MYSQL_BASE = "https://mirrors.aliyun.com/mysql/MySQL-8.0/"
# 官方 tarball 的 MD5（与镜像站 .md5 文件一致）；x86_64 的在运行时读镜像站的 .md5
MYSQL_MD5 = {"arm64": "f1943053b12428e4c0e4ed309a636fd0"}

REDIS_VERSION = "7.2.6"
REDIS_URLS = [
    f"https://download.redis.io/releases/redis-{REDIS_VERSION}.tar.gz",
    f"https://mirrors.huaweicloud.com/redis/redis-{REDIS_VERSION}.tar.gz",
]
REDIS_SHA256 = "fb10d67a2fe2b4556f6cb840064dd6e6e3175ce8ca035f0726990ec2da9f3d0e"

MYSQL_DIR = RT / "mysql"
MYSQL_BIN = MYSQL_DIR / "bin"
MYSQL_DATA = RT / "mysql-data"
REDIS_SRC = RT / f"redis-{REDIS_VERSION}" / "src"
ENV_FILE = RT / "xianyu.env"
# socket 路径不能超过 103 字节，容器目录太深，放 /tmp
MYSQL_SOCK = "/tmp/xianyu-mysql.sock"

children = []


def log(msg):
    print(f"[闲鱼] {msg}", flush=True)


def run(args, **kw):
    kw.setdefault("check", True)
    return subprocess.run([str(a) for a in args], **kw)


# ---------------------------------------------------------------- 安装步骤

def ensure_code():
    if (ROOT / "backend-web" / "main.py").exists():
        return
    log("拉取上游代码 …")
    if not (ROOT / ".git").exists():
        run(["git", "init", "-q"], cwd=ROOT)
        run(["git", "remote", "add", "origin", UPSTREAM], cwd=ROOT)
    run(["git", "fetch", "--depth", "1", "origin", UPSTREAM_COMMIT], cwd=ROOT)
    run(["git", "checkout", "-q", "FETCH_HEAD"], cwd=ROOT)


def _deps():
    """三个后端服务 pyproject 里依赖的并集（去掉同名的宽松约束，留精确版本）。"""
    import re
    deps = {}
    for svc in ("backend-web", "websocket", "scheduler"):
        text = (ROOT / svc / "pyproject.toml").read_text()
        block = text.split("dependencies", 1)[1].split("]\n", 1)[0]
        for spec in re.findall(r'"([^"]+)"', block):
            name = re.split(r"[<>=!;\[ ]", spec, 1)[0].lower()
            if name not in deps or "==" in spec:
                deps[name] = spec
    return sorted(deps.values())


def ensure_venv():
    if PY.exists() and (RUN / "deps-installed").exists():
        return
    if not shutil.which("uv"):
        raise SystemExit("需要先装 uv：https://docs.astral.sh/uv/ （brew install uv 或 pip install uv）")
    log("建 Python 3.11 虚拟环境并安装依赖 …")
    env = dict(os.environ, UV_INDEX_URL=PIP_INDEX)
    if not PY.exists():
        run(["uv", "venv", "--python", "3.11", ROOT / ".venv"], env=env)
    req = RUN / "requirements-merged.txt"
    req.write_text("\n".join(_deps()) + "\n")
    run(["uv", "pip", "install", "--python", PY, "-r", req], env=env)
    (RUN / "deps-installed").touch()


def _download(urls, dest):
    """依次试几个地址；有的站会拒绝 Python 默认 UA（403），所以带上浏览器 UA。"""
    log(f"下载 {dest.name} …")
    last = None
    for url in ([urls] if isinstance(urls, str) else urls):
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (Macintosh)"})
        try:
            with urllib.request.urlopen(req, timeout=60) as r, open(dest, "wb") as f:
                shutil.copyfileobj(r, f)
            return
        except Exception as e:  # 换下一个镜像
            last = e
            log(f"  {url} 失败：{e}")
    raise SystemExit(f"下载 {dest.name} 失败：{last}")


def _digest(path, algo):
    h = hashlib.new(algo)
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def ensure_mysql_binary():
    if (MYSQL_BIN / "mysqld").exists():
        return
    arch = "arm64" if platform.machine() == "arm64" else "x86_64"
    name = f"mysql-{MYSQL_VERSION}-macos11-{arch}"
    tar = RT / f"{name}.tar.gz"
    _download(MYSQL_BASE + tar.name, tar)
    want = MYSQL_MD5.get(arch)
    if not want:
        req = urllib.request.Request(MYSQL_BASE + tar.name + ".md5",
                                     headers={"User-Agent": "Mozilla/5.0 (Macintosh)"})
        with urllib.request.urlopen(req, timeout=30) as r:
            want = r.read().decode().split()[0]
    if _digest(tar, "md5") != want:
        tar.unlink()
        raise SystemExit("MySQL 安装包校验失败，已删除，请重试")
    with tarfile.open(tar) as t:
        t.extractall(RT)
    (RT / name).rename(MYSQL_DIR)
    tar.unlink()


def ensure_redis_binary():
    if (REDIS_SRC / "redis-server").exists():
        return
    tar = RT / f"redis-{REDIS_VERSION}.tar.gz"
    _download(REDIS_URLS, tar)
    if _digest(tar, "sha256") != REDIS_SHA256:
        tar.unlink()
        raise SystemExit("Redis 源码校验失败，已删除，请重试")
    with tarfile.open(tar) as t:
        t.extractall(RT)
    tar.unlink()
    log("编译 Redis（约一分钟）…")
    with open(LOGS / "redis-build.log", "w") as out:
        run(["make", f"-j{os.cpu_count() or 4}", "BUILD_TLS=no", "MALLOC=libc"],
            cwd=REDIS_SRC.parent, stdout=out, stderr=subprocess.STDOUT)


def ensure_env_and_database():
    """第一次：生成随机密码、初始化 MySQL 数据目录、建库建用户。"""
    if ENV_FILE.exists() and MYSQL_DATA.exists():
        return
    log("初始化数据库并生成随机密码 …")
    db_pw, redis_pw = secrets.token_hex(16), secrets.token_hex(16)
    jwt, internal = secrets.token_hex(32), secrets.token_hex(24)
    MYSQL_DATA.mkdir(parents=True, exist_ok=True)
    run([MYSQL_BIN / "mysqld", "--no-defaults", "--initialize-insecure",
         f"--basedir={MYSQL_DIR}", f"--datadir={MYSQL_DATA}"],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    # 只开 socket 不开端口做初始化，不会和别的 MySQL 抢 3307
    init_sock = "/tmp/xianyu-mysql-init.sock"
    p = subprocess.Popen([str(MYSQL_BIN / "mysqld"), "--no-defaults", f"--basedir={MYSQL_DIR}",
                          f"--datadir={MYSQL_DATA}", "--skip-networking", "--mysqlx=OFF",
                          f"--socket={init_sock}", f"--log-error={LOGS / 'mysql-init.err'}"])
    try:
        for _ in range(60):
            if run([MYSQL_BIN / "mysqladmin", f"--socket={init_sock}", "-uroot", "ping"],
                   check=False, capture_output=True).returncode == 0:
                break
            time.sleep(1)
        sql = (
            f"ALTER USER 'root'@'localhost' IDENTIFIED BY '{db_pw}';"
            "CREATE DATABASE IF NOT EXISTS xianyu_data CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
            f"CREATE USER IF NOT EXISTS 'xianyu'@'127.0.0.1' IDENTIFIED BY '{db_pw}';"
            f"CREATE USER IF NOT EXISTS 'xianyu'@'localhost' IDENTIFIED BY '{db_pw}';"
            "GRANT ALL ON xianyu_data.* TO 'xianyu'@'127.0.0.1';"
            "GRANT ALL ON xianyu_data.* TO 'xianyu'@'localhost';FLUSH PRIVILEGES;"
        )
        run([MYSQL_BIN / "mysql", f"--socket={init_sock}", "-uroot", "-e", sql])
    finally:
        p.terminate()
        p.wait(timeout=60)
    old = os.umask(0o077)
    try:
        ENV_FILE.write_text("\n".join([
            "MYSQL_HOST=127.0.0.1", "MYSQL_PORT=3307", "MYSQL_USER=xianyu",
            f"MYSQL_PASSWORD={db_pw}", "MYSQL_DATABASE=xianyu_data",
            "REDIS_HOST=127.0.0.1", "REDIS_PORT=6380", f"REDIS_PASSWORD={redis_pw}", "REDIS_DB=0",
            f"JWT_SECRET_KEY={jwt}", f"SECRET_KEY={jwt}", f"INTERNAL_API_TOKEN={internal}",
            "HOST=127.0.0.1", "BACKEND_WEB_PORT=8089", "WEBSOCKET_PORT=8090", "SCHEDULER_PORT=8091",
            "WEBSOCKET_SERVICE_URL=http://127.0.0.1:8090",
            "SCHEDULER_SERVICE_URL=http://127.0.0.1:8091",
            "BACKEND_WEB_SERVICE_URL=http://127.0.0.1:8089",
            "CORS_ORIGINS=http://127.0.0.1:9000,http://localhost:9000",
            "ENVIRONMENT=production",
            # 关掉上游作者服务器的广告/公告/卡券对接和自动采集
            "AUTO_START_CRAWL_JOBS=false", "CARD_DOCK_BASE_URL=", "EXTERNAL_API_KEY=",
            "REMOTE_OFFICIAL_BASE_URL=", "ENABLE_REMOTE_ADS=false",
            "ENABLE_REMOTE_ANNOUNCEMENTS=false", "ENABLE_REMOTE_POPUP_ANNOUNCEMENTS=false",
            "BROWSER_HEADLESS=true", "LOG_LEVEL=INFO", "TZ=Asia/Shanghai",
        ]) + "\n")
    finally:
        os.umask(old)


def _node_bin_dir():
    """要 18+ 且和本机同架构的 node；本机默认 node 可能是旧的 x86 版。"""
    def ok(node):
        try:
            v = subprocess.run([node, "-p", "process.versions.node + ' ' + process.arch"],
                               capture_output=True, text=True, timeout=10).stdout.split()
            want = "arm64" if platform.machine() == "arm64" else "x64"
            return int(v[0].split(".")[0]) >= 18 and v[1] == want
        except Exception:
            return False
    found = shutil.which("node")
    if found and ok(found):
        return None
    nvm = Path.home() / ".nvm" / "versions" / "node"
    for d in sorted(nvm.glob("v*"), key=lambda p: [int(x) for x in p.name[1:].split(".")], reverse=True):
        if ok(d / "bin" / "node"):
            return d / "bin"
    raise SystemExit("需要 Node.js 18 以上（和本机同架构），可以用 nvm 或 brew 安装")


def load_env():
    env = dict(os.environ)
    for line in ENV_FILE.read_text().splitlines():
        if line.strip() and not line.startswith("#") and "=" in line:
            k, v = line.split("=", 1)
            env[k.strip()] = v.strip()
    node = _node_bin_dir()
    if node:
        env["PATH"] = f"{node}:{env.get('PATH', '')}"
    env["PYTHONPATH"] = str(ROOT)
    env["PYTHONUNBUFFERED"] = "1"
    return env


def ensure_browsers_and_frontend(env):
    if not (RUN / "browsers-installed").exists():
        log("下载 Playwright / Patchright 浏览器（国内镜像）…")
        e = dict(env, PLAYWRIGHT_DOWNLOAD_HOST=PLAYWRIGHT_MIRROR)
        run([PY, "-m", "playwright", "install", "chromium"], env=e)
        run([PY, "-m", "patchright", "install", "chromium"], env=e)
        (RUN / "browsers-installed").touch()
    fe = ROOT / "frontend"
    if not (fe / "dist" / "index.html").exists():
        log("安装前端依赖并构建 …")
        run(["npm", "install", f"--registry={NPM_REGISTRY}"], cwd=fe, env=env)
        run(["npm", "run", "build"], cwd=fe, env=env)


# ---------------------------------------------------------------- 启动

def http_ok(url):
    try:
        with urllib.request.urlopen(url, timeout=2) as r:
            return r.status < 500
    except Exception:
        return False


def wait_for(check, what, seconds=90):
    for _ in range(seconds):
        if check():
            return
        time.sleep(1)
    raise RuntimeError(f"{what} 没有在 {seconds} 秒内起来，看 .runtime/logs/ 里的日志")


def spawn(name, args, env, cwd=ROOT):
    out = open(LOGS / f"{name}.log", "a")
    p = subprocess.Popen([str(a) for a in args], cwd=cwd, env=env,
                         stdout=out, stderr=subprocess.STDOUT)
    p.name = name
    children.append(p)
    log(f"{name} 已启动（pid {p.pid}），日志 .runtime/logs/{name}.log")
    return p


def mysql_alive(env):
    return run([MYSQL_BIN / "mysqladmin", "-h127.0.0.1", "-P3307", "-uroot",
                f"-p{env['MYSQL_PASSWORD']}", "ping"], check=False, capture_output=True).returncode == 0


def start_mysql(env):
    if mysql_alive(env):
        log("MySQL 已在运行")
        return
    spawn("mysql", [
        MYSQL_BIN / "mysqld", "--no-defaults", f"--basedir={MYSQL_DIR}", f"--datadir={MYSQL_DATA}",
        "--port=3307", "--bind-address=127.0.0.1", "--mysqlx=OFF", f"--socket={MYSQL_SOCK}",
        f"--pid-file={RUN / 'mysql.pid'}", "--character-set-server=utf8mb4",
        "--collation-server=utf8mb4_unicode_ci", "--default-time-zone=+08:00",
        "--max-allowed-packet=256M", "--max-connections=4000",
        f"--log-error={LOGS / 'mysql.err'}",
    ], env)
    wait_for(lambda: mysql_alive(env), "MySQL")


def redis_alive(env):
    r = run([REDIS_SRC / "redis-cli", "-h", "127.0.0.1", "-p", "6380", "--no-auth-warning",
             "-a", env["REDIS_PASSWORD"], "ping"], check=False, capture_output=True, text=True)
    return "PONG" in r.stdout


def start_redis(env):
    if redis_alive(env):
        log("Redis 已在运行")
        return
    (RT / "redis-data").mkdir(exist_ok=True)
    spawn("redis", [
        REDIS_SRC / "redis-server", "--bind", "127.0.0.1", "--port", "6380",
        "--requirepass", env["REDIS_PASSWORD"], "--dir", RT / "redis-data",
        "--appendonly", "yes", "--maxmemory", "256mb", "--maxmemory-policy", "allkeys-lru",
    ], env)
    wait_for(lambda: redis_alive(env), "Redis")


def shutdown(*_):
    log("正在停止所有服务…")
    for p in reversed(children):
        if p.poll() is None:
            p.terminate()
    for p in reversed(children):
        try:
            p.wait(timeout=15)
        except subprocess.TimeoutExpired:
            p.kill()
    sys.exit(0)


def main():
    if sys.platform != "darwin":
        raise SystemExit("目前只支持 macOS")
    for d in (LOGS, RUN):
        d.mkdir(parents=True, exist_ok=True)
    signal.signal(signal.SIGINT, shutdown)
    signal.signal(signal.SIGTERM, shutdown)

    ensure_code()
    ensure_venv()
    ensure_mysql_binary()
    ensure_redis_binary()
    ensure_env_and_database()
    env = load_env()
    ensure_browsers_and_frontend(env)
    if "--setup-only" in sys.argv:
        log("安装完成（--setup-only，不启动服务）")
        return

    start_mysql(env)
    start_redis(env)
    spawn("backend-web", [PY, "backend-web/main.py"], env)
    wait_for(lambda: http_ok("http://127.0.0.1:8089/health"), "backend-web", 180)
    spawn("websocket", [PY, "websocket/main.py"], env)
    spawn("scheduler", [PY, "scheduler/main.py"], env)
    spawn("frontend", ["npx", "vite", "preview", "--host", "127.0.0.1",
                       "--port", "9000", "--strictPort"], env, cwd=ROOT / "frontend")
    wait_for(lambda: http_ok("http://127.0.0.1:9000/"), "前端", 60)

    log("全部就绪：http://127.0.0.1:9000  （首次登录 admin / admin123，登录后马上改密码）")
    if "--no-browser" not in sys.argv:
        webbrowser.open("http://127.0.0.1:9000")
    while True:
        for p in children:
            if p.poll() is not None and p.name not in ("mysql", "redis"):
                log(f"{p.name} 退出了（退出码 {p.returncode}），看 .runtime/logs/{p.name}.log")
                shutdown()
        time.sleep(3)


if __name__ == "__main__":
    main()
