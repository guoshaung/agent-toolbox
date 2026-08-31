export default {
  id: 'middleware',
  name: '中间件',
  icon: '🧩',
  blurb: '系统一做大，中间件就全来了：缓存、消息队列、网关、注册中心、分布式锁。面试考的不是"用过"，是"为什么用它、坏了怎么办"。每个模板都对着"选型理由 + 关键代码 + 翻车点"来背。',

  templates: [
    {
      id: 'cache-patterns',
      title: '缓存三大问题：穿透 / 击穿 / 雪崩',
      lang: 'python',
      tags: ['缓存', '必背'],
      why: '缓存面试必考第一题。三个名字长得像，机制完全不同：穿透是无中生有，击穿是热点失效，雪崩是集体失效。',
      code: `import time
import threading

NULL_MARK = b"__NULL__"      # 空值占位符，短 TTL

def get_data(key):
    # 穿透：查"根本不存在的数据"，缓存永远不命中，请求全砸到数据库
    #       （攻击者拿一堆不存在的 id 狂打就是穿透攻击）
    val = cache.get(key)
    if val is not None:
        return None if val == NULL_MARK else deserialize(val)

    # 击穿：某个热点 key 过期瞬间，海量并发同时打到数据库重建缓存
    lock = cache.lock(f"lock:{key}", timeout=5)     # 分布式锁：只放一个请求去重建
    if lock.acquire(blocking=False):
        try:
            val = db.query(key)
            if val is None:
                # 防穿透：空结果也缓存（短 TTL），下次直接返回"没有"
                cache.setex(key, 60, NULL_MARK)
                return None
            cache.setex(key, 3600, serialize(val))
            return val
        finally:
            lock.release()
    else:
        time.sleep(0.05)          # 没抢到锁的：稍等重试，别去砸数据库
        return get_data(key)

# 雪崩：大量 key 同一时刻过期（比如凌晨批量预热的那批），数据库瞬间被打挂
# 防御：TTL 加随机抖动 —— cache.setex(key, 3600 + random.randint(0, 600), v)
# 再加一层：接口限流兜底，缓存全挂也不至于把库打死`,
      points: [
        '穿透防"查不到"：缓存空值 + 入参合法性校验（id 格式都不对直接拒）',
        '击穿防"热点过期"：互斥锁重建 + 逻辑过期（值里带过期时间，过期后异步刷新）',
        '雪崩防"集体过期"：TTL 加随机抖动 + 多级缓存（本地 + Redis）+ 限流兜底',
      ],
      pitfalls: [
        '分布式锁忘了设超时：持锁进程挂了，所有请求永远等锁，比击穿更惨',
        '缓存空值用 None 判断会出 bug：Redis 里存的序列化空串和"没这个 key"要分清',
      ],
    },

    {
      id: 'cache-consistency',
      title: '缓存与数据库一致性',
      lang: 'python',
      tags: ['缓存', '必背'],
      why: '写操作时先删缓存还是先写库？背结论没用，要能推出为什么。这题答不好，缓存那题基本凉。',
      code: `# 结论先行：Cache Aside（旁路缓存）= 读：先读缓存，miss 读库回填
#                                写：先更新数据库，再删缓存
#
# ---- 为什么是"删缓存"不是"更新缓存"？----
# 1. 更新缓存可能写一个马上就被覆盖的值（写多读少时白写）
# 2. 并发更新时两个写请求的缓存写入顺序无法保证，旧值可能覆盖新值
#
# ---- 为什么"先库后删"？推演另外两种就懂 ----
# 先删缓存后写库：删完还没写完，读请求 miss 回填了旧值 → 脏数据活到 TTL
# 先写库后删缓存：理论上也有窗口（读旧值 + 写缓存发生在写库后），
#                 但写库 + 删缓存的窗口极小，且兜底方案成熟

def update_item(item_id, data):
    db.update(item_id, data)             # 1. 先写数据库
    cache.delete(f"item:{item_id}")      # 2. 再删缓存（下次读时回填新值）
    # 兜底 1：删除失败进 MQ 重试
    # 兜底 2：设置 TTL，脏数据最多活到过期（最终一致性的保险丝）

# 强一致怎么办？答案通常是"别用缓存"：
# 库存扣减这类强一致场景，直接锁数据库/分布式锁，不要中间加缓存层`,
      points: [
        'Cache Aside 是默认答案：读——缓存 miss 才读库；写——先库后删缓存',
        '删缓存而非更新缓存：把"什么时候回填"交给读请求，天然避免并发写乱序',
        '最终一致靠 TTL 兜底：所有一致性方案都可能有小窗口，TTL 是最后保险丝',
      ],
      pitfalls: [
        '延迟双删是补丁不是方案：为了修极端窗口引入延时任务，复杂度上去了，先想清楚是否真需要',
        '删缓存后立刻有读请求回填旧值（读库主从延迟）：主从架构下脏数据能活到 TTL，要感知这个窗口',
      ],
    },

    {
      id: 'mq-basics',
      title: '消息队列：解耦削峰与可靠性',
      lang: 'python',
      tags: ['消息队列', '必背'],
      why: 'MQ 的三大作用（解耦/异步/削峰）谁都会背，面试往下追问的是：消息丢了怎么办？重复了怎么办？堆积了怎么办？',
      code: `# ---- 为什么用 MQ ----
# 解耦：下单后要发短信、加积分、更新推荐……直接调接口，任何一方挂了下单就失败
#       发到 MQ，下游各消费各的，谁挂了不影响主流程
# 削峰：秒杀瞬时 10w QPS，数据库只能扛 2k —— MQ 当蓄水池，下游按自己的节奏消费
#
# ---- 可靠性三问 ----

# Q1: 消息丢了怎么办？（三个环节都可能丢）
def produce_safely():
    # ① 生产端：确认机制（RabbitMQ confirm / Kafka acks=all）
    producer.send(topic, msg, acks="all")
    # ② Broker：持久化 + 副本（至少刷盘 + 多副本）
    # ③ 消费端：先处理业务，再提交 offset（手动 ack）
    ...

def consume_safely(msg):
    result = handle_business(msg)   # 1. 先干活
    if result.ok:
        consumer.commit(msg.offset) # 2. 干完再确认，挂了下次重投

# Q2: 重复消费怎么办？（重投必然存在，所以幂等是消费端的义务）
def consume_idempotent(msg):
    # 幂等键：业务唯一 ID（订单号）+ 去重表/Redis
    if redis.setnx(f"dedup:{msg.order_id}", 1, ex=86400):
        handle_business(msg)
    else:
        return  # 重复消息，直接跳过

# Q3: 堆积了怎么办？
# 先定位：生产暴涨？消费太慢？消费者挂了？
# 应急：扩消费者（注意 Kafka 分区数 >= 消费者数，否则加人白加）
#       紧急时上"临时队列"：把消息搬运到新 topic 用更多分区，再扩消费`,
      points: [
        '消息不丢 = 生产确认 + Broker 持久化副本 + 消费手动 ack，三段都要保',
        'MQ 的消息语义是"至少一次"，所以重复不可避免——幂等是消费端义务，不是 MQ 的功能',
        'Kafka 扩消费者上限是分区数；堆积应急先看分区够不够，再谈加机器',
      ],
      pitfalls: [
        '消费端先 commit 再处理业务：处理到一半挂了，这条消息永远丢了',
        '去重用 Redis 但没设过期：去重键无限膨胀；设太短：迟到重投的消息又会被处理一遍',
      ],
    },

    {
      id: 'rate-limit',
      title: '限流：计数器 / 滑动窗口 / 漏桶 / 令牌桶',
      lang: 'python',
      tags: ['网关', '必背'],
      why: '限流算法是网关和中间件面试的高频题。四个算法的差异不在名字，在"边界行为"：卡瞬间流量还是卡平均速率。',
      code: `import time

# ---- 固定窗口计数器：每分钟最多 N 次 ----
# 简单，但窗口边界有 2N 突刺：59 秒打满 N 次，第 61 秒又放 N 次
counter, window_start = 0, time.time()

def allow_fixed(n=100, per=60):
    global counter, window_start
    now = time.time()
    if now - window_start >= per:
        counter, window_start = 0, now
    if counter >= n:
        return False
    counter += 1
    return True

# ---- 滑动窗口：把窗口切成小格，统计"最近 60 秒" ----
# 平滑了边界突刺，代价是要存细粒度计数
def allow_sliding(n=100, per=60, cells=6):
    now, cell = time.time(), per / cells
    cur = int(now / cell)
    total = sum(counts.get(cur - i, 0) for i in range(cells))
    if total >= n:
        return False
    counts[cur] = counts.get(cur, 0) + 1
    return True

# ---- 令牌桶：恒速发令牌，桶有容量上限 ----
# 允许突发（桶里攒的令牌能瞬间用掉），同时限制平均速率 —— 网关最常用
class TokenBucket:
    def __init__(self, rate=10, capacity=100):   # 每秒 10 个，桶最多 100
        self.rate, self.capacity = rate, capacity
        self.tokens, self.last = capacity, time.time()

    def allow(self):
        now = time.time()
        self.tokens = min(self.capacity,
                          self.tokens + (now - self.last) * self.rate)  # 按时间补令牌
        self.last = now
        if self.tokens >= 1:
            self.tokens -= 1
            return True
        return False

# ---- 漏桶：恒速放行，多余的排队或拒绝 ----
# 把"突发"完全磨平，出口永远匀速 —— 适合保护脆弱的下游（如调第三方接口）
# 单机限流用上面任一；分布式限流把计数/令牌放 Redis（Lua 保证原子）`,
      points: [
        '固定窗口有边界突刺，滑动窗口解决突刺但更费存储',
        '令牌桶允许突发、限平均速率；漏桶完全匀速、绝对平滑——"能不能容忍突发"是选型分水岭',
        '分布式限流的核心是原子性：计数与判断必须在一个 Lua 脚本/一次 Redis 操作里完成',
      ],
      pitfalls: [
        '分布式限流在应用层先 get 再 set：并发下计数全是错的，必须原子操作',
        '限流阈值拍脑袋定：压测出下游真实容量再定，并留熔断兜底，限流是保护别人的',
      ],
    },

    {
      id: 'distributed-lock',
      title: '分布式锁',
      lang: 'python',
      tags: ['分布式', '必背'],
      why: '单机锁（synchronized / threading.Lock）管不了多台机器。Redis 锁的三个坑（过期释放、误删、主从丢锁）每一个都是事故',
      code: `import uuid
import time

def acquire_lock(conn, key, ttl=10):
    token = str(uuid.uuid4())            # 唯一标识：防止删了别人的锁
    # SET NX + 过期 + 值 必须一条命令（原子），分开写就是事故
    ok = conn.set(f"lock:{key}", token, nx=True, ex=ttl)
    return token if ok else None

def release_lock(conn, key, token):
    # 只能删自己持有的锁：用 Lua 保证"判断是自己的 + 删"原子执行
    script = """
    if redis.call('GET', KEYS[1]) == ARGV[1] then
        return redis.call('DEL', KEYS[1])
    else
        return 0
    end
    """
    return conn.eval(script, 1, f"lock:{key}", token)

def do_critical_section(key):
    token = acquire_lock(conn, key, ttl=10)
    if not token:
        raise BusyError
    try:
        start = time.time()
        work()                            # 业务逻辑
        if time.time() - start > 8:       # 快超时了？
            renew_lock(conn, key, token)  # 续期（看门狗）：业务没干完锁先不能死
    finally:
        release_lock(conn, key, token)    # 必须放 finally

# Redis 锁的软肋：主从切换瞬间，锁写在主库还没同步到从库，主库挂了 → 两台机器同时持锁
# 要严格互斥用 Redlock（多节点过半）或改用 zookeeper/etcd（CP 系统）`,
      points: [
        '加锁三要素：原子加锁（SET NX EX）、唯一 token、Lua 原子释放——缺一个都是事故',
        '锁过期但业务没跑完 = 两个进程同时进临界区：看门狗续期是标配（Redisson 就是这么实现的）',
        'Redis 锁是 AP 偏性能，etcd/zk 锁是 CP 偏严格——按"锁失效的代价"选型',
      ],
      pitfalls: [
        '释放锁直接 DEL：锁恰好过期被别人持有，你把人家的锁删了——所以要先比对 token 再删',
        '在锁里调慢接口（外部 HTTP）：TTL 内干不完，续期逻辑又没有，互斥就是摆设',
      ],
    },

    {
      id: 'gateway-registry',
      title: '网关与注册中心',
      lang: 'python',
      tags: ['微服务', '常见'],
      why: '微服务入口两件套。面试常问：网关能干什么不能干什么、注册中心挂了服务还能不能调——考的都是"职责边界"。',
      code: `# ---- API 网关的职责（对外的墙）----
# 路由：/order/** → 订单服务，/user/** → 用户服务（对外一个域名，对内一群服务）
# 认证：JWT 校验在这里做一次，内部服务不再重复验
# 限流/熔断/黑名单：脏流量挡在门外
# 日志/审计：所有请求的统一入口，天然好埋点
#
# 网关"不该干的"：业务逻辑。网关里写 if 订单金额>xxx 就…… 迟早变成泥球
#
# ---- 注册中心（服务发现）----
# 服务启动时注册自己的地址；调用方从注册中心拉取可用实例列表
# 心跳机制：几秒一次，超时没心跳 = 摘除实例
#
# Q: 注册中心挂了，服务还能调吗？
# A: 能。调用方本地缓存着实例列表，短期内照常调用；
#    只是"新服务上线/下线"感知不到。这就是为什么要本地缓存 + 多副本部署注册中心。
#
# ---- 熔断器：防雪崩的保险丝 ----
class CircuitBreaker:
    CLOSED, OPEN, HALF_OPEN = "closed", "open", "half-open"

    def call(self, fn, *args):
        if self.state == "open":
            if time.time() - self.opened_at < self.cooldown:
                raise ServiceUnavailable      # 熔断期直接快速失败
            self.state = "half-open"          # 冷却结束，放行一个试探请求
        try:
            result = fn(*args)
            self.failures = 0
            self.state = "closed"
            return result
        except Timeout:
            self.failures += 1
            if self.failures >= self.threshold:
                self.state, self.opened_at = "open", time.time()
            raise
# 连续失败到阈值 → 打开（快速失败保护下游）→ 冷却后半开试探 → 成功则闭合`,
      points: [
        '网关管"横切面"（路由/认证/限流/审计），业务逻辑一律下沉到服务，否则网关变泥球',
        '注册中心挂了≠服务不可用：本地缓存的实例列表让调用继续，这是客户端发现模式的核心价值',
        '熔断三态转换：closed→open（失败到阈值）→half-open（冷却试探）→closed，是防雪崩的保险丝',
      ],
      pitfalls: [
        '把鉴权逻辑写在每个服务里而不是网关：改一次密钥规则要发全部服务的版',
        '熔断阈值和冷却时间照抄默认值：每个下游的容忍度不同，按依赖的重要性分级配置',
      ],
    },
  ],
};
