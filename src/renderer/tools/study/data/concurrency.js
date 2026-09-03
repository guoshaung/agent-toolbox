export default {
  id: 'concurrency',
  name: '并发与异步',
  icon: '🧵',
  blurb: '并发的难点不在语法，在于判断"这个任务该用哪种并发"。选错了写得再对也慢。所以每个模板先讲适用场景，再给代码。',

  templates: [
    {
      id: 'choose-model',
      title: '选型：线程 / 进程 / 协程',
      lang: 'python',
      tags: ['选型', '必背'],
      why: '这是并发第一个决策，也是最容易选错的。选错的代价是"写了并发但一点没快"，而且很难看出原因。',
      code: `# ---- 判断依据只有一条：瓶颈在等待，还是在计算 ----
#
# IO 密集（等网络、等磁盘、等数据库）→ 线程 或 协程
#   等待时 GIL 会被释放，多线程真的能并行等待。
#   任务成百上千用协程（一个线程管全部，没有线程切换开销）。
#
# CPU 密集（算哈希、解压、图像处理、纯计算）→ 多进程
#   GIL 保证同一时刻只有一个线程执行 Python 字节码，
#   多线程跑 CPU 密集任务**一点都不会快**，还多了切换开销。
#
# 混合 → 进程池里跑计算，每个进程内部用线程/协程处理 IO


import time, threading, multiprocessing

def cpu_task(n):
    return sum(i * i for i in range(n))

def io_task(url):
    time.sleep(0.1)          # 模拟网络等待
    return url


# 验证 GIL：CPU 密集任务用多线程不会变快
def benchmark():
    n, count = 2_000_000, 4

    start = time.perf_counter()
    for _ in range(count):
        cpu_task(n)
    serial = time.perf_counter() - start

    start = time.perf_counter()
    threads = [threading.Thread(target=cpu_task, args=(n,)) for _ in range(count)]
    for t in threads: t.start()
    for t in threads: t.join()
    threaded = time.perf_counter() - start

    # threaded 通常和 serial 差不多，甚至更慢 —— 这就是 GIL
    return {'串行': serial, '多线程': threaded}


# 注意：Python 3.13 起有可选的自由线程（no-GIL）构建，
# 但默认解释器仍带 GIL，上面的结论在绝大多数环境里成立。`,
      points: [
        'IO 密集用线程/协程，CPU 密集用进程 —— 唯一的判断依据',
        'GIL 只影响 Python 字节码执行；等 IO 时会释放，所以线程对 IO 有效',
        'numpy / 压缩库等在 C 层释放 GIL，这类"CPU 密集"用线程也可能有效',
        '任务数量大（上千）时协程优于线程：没有线程栈和切换开销',
      ],
      pitfalls: [
        '用多线程加速纯计算 —— 最常见的无效优化',
        '多进程传参会走 pickle，传大对象的开销可能超过计算本身',
      ],
    },

    {
      id: 'thread-lock',
      title: '线程同步：Lock 与竞态',
      lang: 'python',
      tags: ['线程', '必背'],
      why: 'count += 1 不是原子操作。这一条不知道，写出来的并发代码在测试环境永远是对的，上线才偶尔错。',
      code: `import threading

class Counter:
    def __init__(self):
        self._value = 0
        self._lock = threading.Lock()

    def increment(self):
        # count += 1 实际是"读 → 加 → 写"三步，中间可能被切换，
        # 两个线程读到同一个旧值，加完写回，就丢了一次计数
        with self._lock:            # with 保证异常时也会释放
            self._value += 1

    @property
    def value(self):
        with self._lock:
            return self._value


# ---- 可重入锁：同一线程可以多次获取 ----
class Tree:
    def __init__(self):
        self._lock = threading.RLock()   # 普通 Lock 在这里会自己把自己锁死

    def walk(self, node):
        with self._lock:
            for child in node.children:
                self.walk(child)          # 递归再次获取同一把锁


# ---- 避免死锁：永远按同一顺序获取多把锁 ----
def transfer(from_acc, to_acc, amount):
    # 两个线程反向转账，各持一把锁等对方 → 死锁
    # 用固定顺序（比如按 id 排序）打破环形等待
    first, second = sorted([from_acc, to_acc], key=id)
    with first.lock, second.lock:
        from_acc.balance -= amount
        to_acc.balance += amount


# ---- 只读共享不用加锁 ----
# 初始化完成后不再修改的数据，多个线程读是安全的。
# 加锁前先问：这个数据真的会被写吗？`,
      points: [
        'a += 1 不是原子的，读-改-写三步之间可能被切换',
        'RLock 允许同一线程重复获取，递归场景必须用它',
        '多把锁固定顺序获取，破坏环形等待条件',
        '只读共享数据不需要加锁',
      ],
      pitfalls: [
        '锁的粒度太大 → 并发退化成串行；太小 → 保护不住不变量',
        '在持锁期间做 IO 或调用外部代码 → 锁被长期占住',
      ],
    },

    {
      id: 'thread-pool',
      title: '线程池 / 进程池：concurrent.futures',
      lang: 'python',
      tags: ['线程', '必背'],
      why: '手动 Thread + join 的写法几乎总能被这个替代。而且它把异常带回主线程，不会像裸线程那样静默吞掉。',
      code: `from concurrent.futures import ThreadPoolExecutor, ProcessPoolExecutor, as_completed

def fetch(url):
    import time; time.sleep(0.1)
    if 'bad' in url: raise ValueError(f'坏链接: {url}')
    return f'{url} 的内容'


def fetch_all(urls, workers=8):
    results, errors = {}, {}
    with ThreadPoolExecutor(max_workers=workers) as pool:
        # submit 返回 Future；建立 future -> url 的映射，才知道是谁失败了
        futures = {pool.submit(fetch, url): url for url in urls}

        # as_completed 谁先完成先处理，不必等最慢的那个
        for future in as_completed(futures):
            url = futures[future]
            try:
                results[url] = future.result()   # 异常会在这里重新抛出
            except Exception as exc:
                errors[url] = str(exc)           # 一个失败不影响其它任务
    return results, errors


def compute_all(numbers):
    # CPU 密集换成进程池，接口完全一样
    # 注意：函数必须是模块级的（可 pickle），不能是 lambda 或闭包
    with ProcessPoolExecutor() as pool:
        return list(pool.map(heavy, numbers))

def heavy(n):
    return sum(i * i for i in range(n))


# pool.map vs submit：
#   map 保持输入顺序、写法简洁，但一个抛异常整个迭代就中断
#   submit + as_completed 能逐个处理异常，还能先拿到先完成的结果`,
      points: [
        'future.result() 会把子线程的异常重新抛到调用处',
        'as_completed 先完成先处理；map 保序但异常会中断整个迭代',
        '进程池的目标函数必须可 pickle：模块级函数，不能是 lambda/闭包',
        'with 语句退出时自动等待所有任务完成',
      ],
      pitfalls: [
        '裸 threading.Thread 里抛的异常不会传到主线程，静默失败',
        '线程池 max_workers 设得过大，IO 任务反而因上下文切换变慢',
      ],
    },

    {
      id: 'asyncio-basics',
      title: 'asyncio 基础：并发不是并行',
      lang: 'python',
      tags: ['协程', '必背'],
      why: 'await 一个接一个写等于串行。gather 才是并发。这个区别是 asyncio 最常见的误用。',
      code: `import asyncio

async def fetch(url, delay):
    await asyncio.sleep(delay)         # 模拟网络等待，期间让出控制权
    return f'{url} 完成'


async def wrong():
    """串行：总耗时 = 各任务之和。写了 async 但一点没并发"""
    a = await fetch('A', 1)            # 等 A 完全结束
    b = await fetch('B', 1)            # 才开始 B
    return [a, b]                      # 约 2 秒


async def right():
    """并发：总耗时 = 最慢的那个"""
    results = await asyncio.gather(
        fetch('A', 1),
        fetch('B', 1),
    )
    return results                     # 约 1 秒


async def with_errors(urls):
    """一个失败不要拖垮全部：return_exceptions=True 把异常当结果返回"""
    tasks = [fetch(u, 0.1) for u in urls]
    results = await asyncio.gather(*tasks, return_exceptions=True)
    ok = [r for r in results if not isinstance(r, Exception)]
    bad = [r for r in results if isinstance(r, Exception)]
    return ok, bad


async def with_task_group(urls):
    """Python 3.11+ 推荐写法：任何一个失败，其余会被自动取消"""
    async with asyncio.TaskGroup() as tg:
        tasks = [tg.create_task(fetch(u, 0.1)) for u in urls]
    return [t.result() for t in tasks]


# 入口：asyncio.run 创建事件循环、跑完、再关掉
# 一个程序里通常只调用一次，不要在已有循环里再调
if __name__ == '__main__':
    print(asyncio.run(right()))`,
      points: [
        '连续 await = 串行；要并发必须用 gather / TaskGroup',
        'gather(return_exceptions=True) 让部分失败不影响其它任务',
        'TaskGroup（3.11+）在任一失败时自动取消兄弟任务，更安全',
        'asyncio.run 是入口，不要在运行中的循环里再次调用',
      ],
      pitfalls: [
        '在 async 函数里调用阻塞函数（requests.get、time.sleep）→ 整个事件循环卡死',
        '创建了 Task 却不保存引用 → 可能被垃圾回收，任务莫名消失',
      ],
    },

    {
      id: 'asyncio-limit',
      title: '并发限流、超时与取消',
      lang: 'python',
      tags: ['协程', '必背'],
      why: '一次 gather 一千个请求会把对方打挂，也会把自己的连接数耗尽。限流、超时、取消是异步代码上生产的三件必需品。',
      code: `import asyncio

async def fetch(session, url):
    await asyncio.sleep(0.2)
    return url


async def fetch_limited(urls, limit=10):
    """信号量限流：同时最多 limit 个在跑，其余排队"""
    sem = asyncio.Semaphore(limit)

    async def one(url):
        async with sem:                 # 拿不到就在这里等
            return await fetch(None, url)

    return await asyncio.gather(*(one(u) for u in urls))


async def with_timeout(url):
    """超时：3.11+ 用 timeout 上下文，比 wait_for 更清晰"""
    try:
        async with asyncio.timeout(5):
            return await fetch(None, url)
    except TimeoutError:
        return None                     # 超时后协程已被取消，无需手动清理


async def cancellable():
    """取消：CancelledError 必须重新抛出，不能吞掉"""
    try:
        await asyncio.sleep(10)
    except asyncio.CancelledError:
        # 这里只做清理，然后必须让异常继续传播，
        # 吞掉它会让调用方以为任务正常结束，取消机制失效
        print('清理资源')
        raise


async def run_with_cancel():
    task = asyncio.create_task(cancellable())
    await asyncio.sleep(0.1)
    task.cancel()
    try:
        await task
    except asyncio.CancelledError:
        pass


async def call_blocking():
    """阻塞函数必须扔到线程里跑，否则整个事件循环停摆"""
    import time
    return await asyncio.to_thread(time.sleep, 1)`,
      points: [
        'Semaphore 限制同时在跑的数量，是异步版的"线程池大小"',
        'asyncio.timeout（3.11+）超时后会自动取消内部任务',
        'CancelledError 清理后必须 raise，绝不能吞',
        '阻塞函数用 asyncio.to_thread 包一层',
      ],
      pitfalls: [
        '把 CancelledError 当普通异常 except Exception 吞掉 → 任务取消不掉',
        '在异步代码里用 time.sleep 而不是 asyncio.sleep → 全局卡住',
      ],
    },

    {
      id: 'producer-consumer',
      title: '生产者-消费者：队列',
      lang: 'python',
      tags: ['模式', '必背'],
      why: '解耦生产速度和消费速度的标准结构。队列本身线程安全，用它就不用自己加锁。',
      code: `import threading, queue, time

SENTINEL = object()          # 结束信号，用唯一对象避免和真实数据混淆


def producer(q, items):
    for item in items:
        q.put(item)          # 队列满时阻塞，天然形成背压
    q.put(SENTINEL)


def consumer(q, results):
    while True:
        item = q.get()
        try:
            if item is SENTINEL:
                q.put(SENTINEL)      # 放回去，让其它消费者也能收到
                return
            results.append(item * 2)
        finally:
            q.task_done()            # 配合 q.join() 使用，必须放 finally


def run(items, workers=3):
    q = queue.Queue(maxsize=100)     # 有界队列：防止生产太快把内存吃光
    results = []
    threads = [threading.Thread(target=consumer, args=(q, results)) for _ in range(workers)]
    for t in threads: t.start()
    producer(q, items)
    for t in threads: t.join()
    return results


# ---- 异步版 ----
import asyncio

async def async_pipeline(items, workers=5):
    q = asyncio.Queue(maxsize=100)

    async def worker():
        while True:
            item = await q.get()
            try:
                await asyncio.sleep(0)      # 实际处理
            finally:
                q.task_done()

    tasks = [asyncio.create_task(worker()) for _ in range(workers)]
    for item in items:
        await q.put(item)
    await q.join()                          # 等所有任务被 task_done
    for t in tasks:
        t.cancel()                          # 消费者是死循环，用完要取消`,
      points: [
        '有界队列（maxsize）提供背压，防止生产者压垮内存',
        'task_done 要放在 finally，否则异常时 q.join() 永远等不到',
        '结束信号用唯一哨兵对象，别用 None（None 可能是合法数据）',
        '异步版的 worker 是死循环，用完必须 cancel',
      ],
      pitfalls: [
        '无界队列 + 快生产慢消费 = 内存缓慢涨爆',
        '只放一个哨兵却有多个消费者 → 其余消费者永远阻塞（要放回去）',
      ],
    },
  ],
};
