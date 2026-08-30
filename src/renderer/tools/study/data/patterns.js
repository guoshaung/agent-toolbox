export default {
  id: 'patterns',
  name: '设计模式',
  icon: '🧩',
  blurb: '别背 UML 图，背"它解决了什么问题"和最小可用代码。Python 里很多模式有更轻的写法（函数、字典、装饰器），也一并列出来——知道什么时候不用模式，比会写模式更值钱。',

  templates: [
    {
      id: 'singleton',
      title: '单例 Singleton',
      lang: 'python',
      tags: ['创建型', '必背'],
      why: '面试最爱问的"线程安全单例"就是双重检查锁。但工程里 90% 的场景用模块级变量就够了——Python 的模块天然是单例。',
      code: `import threading

class Singleton:
    """双重检查锁：第一次检查免锁走快路径，第二次检查防并发重复创建"""
    _instance = None
    _lock = threading.Lock()

    def __new__(cls, *args, **kwargs):
        if cls._instance is None:              # 检查一：绝大多数调用在这里就返回了
            with cls._lock:
                if cls._instance is None:      # 检查二：拿到锁后可能已被别人创建
                    cls._instance = super().__new__(cls)
        return cls._instance

    def __init__(self, value=None):
        # 陷阱：__new__ 返回旧对象后，__init__ 每次都还会执行一遍
        if getattr(self, '_inited', False):
            return
        self.value = value
        self._inited = True


def singleton(cls):
    """装饰器写法：更 Pythonic，且不用碰 __new__/__init__ 的坑"""
    instances = {}
    lock = threading.Lock()

    def get_instance(*args, **kwargs):
        if cls not in instances:
            with lock:
                if cls not in instances:
                    instances[cls] = cls(*args, **kwargs)
        return instances[cls]
    return get_instance


# 最简单的方案：模块本身就是单例
# config.py 里写 settings = Settings()，别处 from config import settings 即可`,
      points: [
        '双重检查锁：无锁快路径 + 有锁慢路径，两次判空缺一不可',
        '__new__ 版的坑：__init__ 会被重复调用，要自己加初始化标记',
        'Python 里模块级实例是最省事的单例',
      ],
      pitfalls: [
        '只在 __new__ 里判空不加锁，多线程下会创建出多个实例',
        '单例经常是"全局变量"的伪装，会让测试难写 —— 用之前先想想能不能靠依赖注入',
      ],
    },

    {
      id: 'factory',
      title: '工厂 Factory',
      lang: 'python',
      tags: ['创建型', '必背'],
      why: '把"创建什么"和"怎么用"解耦。注册表工厂是工程里最实用的变体：加新类型不用改任何已有代码。',
      code: `from abc import ABC, abstractmethod

class Exporter(ABC):
    @abstractmethod
    def export(self, data) -> bytes: ...


class CsvExporter(Exporter):
    def export(self, data): return b'csv...'


class JsonExporter(Exporter):
    def export(self, data): return b'json...'


# ---- 工厂方法：把创建延迟到子类 ----
class Report(ABC):
    @abstractmethod
    def create_exporter(self) -> Exporter: ...

    def save(self, data):            # 稳定的流程
        return self.create_exporter().export(data)   # 可变的创建


class CsvReport(Report):
    def create_exporter(self): return CsvExporter()


# ---- 注册表工厂：工程里最常用 ----
REGISTRY = {}

def register(name):
    """新增类型只要加个装饰器，不用回头改 if-else 链"""
    def deco(cls):
        REGISTRY[name] = cls
        return cls
    return deco


@register('csv')
class _Csv(CsvExporter): pass


@register('json')
class _Json(JsonExporter): pass


def create_exporter(name, *args, **kwargs) -> Exporter:
    if name not in REGISTRY:
        raise ValueError(f'未注册的导出格式: {name}，可选: {list(REGISTRY)}')
    return REGISTRY[name](*args, **kwargs)`,
      points: [
        '工厂方法 = 父类定流程、子类定创建',
        '注册表工厂 = 开闭原则的最轻实现，新增类型零改动',
        '报错时把可选值列出来，能省掉一次翻源码',
      ],
      pitfalls: [
        '为了"以后可能扩展"就上抽象工厂，多数时候是过度设计',
        '注册表靠 import 副作用生效 —— 模块没被 import，注册就不会发生',
      ],
    },

    {
      id: 'strategy',
      title: '策略 Strategy',
      lang: 'python',
      tags: ['行为型', '必背'],
      why: '消灭 if-elif 长链的标准手法。Python 里函数是一等公民，一个 dict 往往就等于一个策略模式。',
      code: `from abc import ABC, abstractmethod

class DiscountStrategy(ABC):
    @abstractmethod
    def apply(self, amount: float) -> float: ...


class NoDiscount(DiscountStrategy):
    def apply(self, amount): return amount


class PercentOff(DiscountStrategy):
    def __init__(self, percent): self.percent = percent
    def apply(self, amount): return amount * (1 - self.percent)


class Order:
    def __init__(self, strategy: DiscountStrategy):
        self._strategy = strategy

    def set_strategy(self, strategy: DiscountStrategy):
        self._strategy = strategy       # 运行时可以换，这是策略模式的意义

    def total(self, amount):
        return self._strategy.apply(amount)


# ---- Python 的轻量写法：策略就是个函数 ----
STRATEGIES = {
    'none': lambda amount: amount,
    'vip': lambda amount: amount * 0.8,
    'newbie': lambda amount: max(0.0, amount - 10),
}

def checkout(amount, kind='none'):
    return STRATEGIES.get(kind, STRATEGIES['none'])(amount)`,
      points: [
        '策略模式的核心是"运行时可替换"，不是"有个抽象类"',
        '策略之间必须可互换：同样的入参、同样的返回类型',
        'Python 里优先考虑 dict + 函数，类只在需要状态时才上',
      ],
      pitfalls: [
        '策略里塞了不同的入参签名，调用方又得 if 判断，等于白抽象',
      ],
    },

    {
      id: 'observer',
      title: '观察者 Observer',
      lang: 'python',
      tags: ['行为型', '必背'],
      why: '事件驱动的底座。notify 时遍历要拷贝一份列表——回调里反注册自己会把迭代搞崩，这是真实踩过的坑。',
      code: `from abc import ABC, abstractmethod

class Observer(ABC):
    @abstractmethod
    def update(self, event): ...


class Subject:
    def __init__(self):
        self._observers = []

    def attach(self, observer: Observer):
        if observer not in self._observers:
            self._observers.append(observer)

    def detach(self, observer: Observer):
        if observer in self._observers:
            self._observers.remove(observer)

    def notify(self, event):
        for observer in list(self._observers):   # 拷贝！回调里可能 detach 自己，
            try:                                 # 直接遍历原列表会漏掉元素
                observer.update(event)
            except Exception as exc:             # 一个观察者炸了不该影响其他人
                print(f'observer {observer} failed: {exc}')


# ---- 轻量写法：回调列表 ----
class EventBus:
    def __init__(self):
        self._handlers = {}

    def on(self, name, fn):
        self._handlers.setdefault(name, []).append(fn)
        return lambda: self._handlers[name].remove(fn)   # 返回反注册函数

    def emit(self, name, *args, **kwargs):
        for fn in list(self._handlers.get(name, [])):
            fn(*args, **kwargs)`,
      points: [
        'notify 遍历前拷贝列表，防止回调里增删导致迭代异常',
        '单个观察者抛异常要隔离，否则后面的都收不到通知',
        'on() 返回反注册函数，比记住对象再 detach 方便得多',
      ],
      pitfalls: [
        '观察者持有 subject 的强引用会导致内存泄漏，长生命周期场景用 weakref',
        '同步通知链太长会变成隐形的调用栈，出问题极难排查',
      ],
    },

    {
      id: 'decorator',
      title: '装饰器 Decorator',
      lang: 'python',
      tags: ['结构型', '必背'],
      why: 'Python 原生支持，日志、重试、缓存、限流全靠它。functools.wraps 那一行不加，被装饰函数的名字和文档就丢了。',
      code: `import functools, time

def timing(func):
    @functools.wraps(func)           # 不加这行：func.__name__ 变成 'wrapper'，
    def wrapper(*args, **kwargs):    # 日志、调试、Sphinx 文档全乱
        start = time.perf_counter()
        try:
            return func(*args, **kwargs)
        finally:                     # finally：即使抛异常也要记录耗时
            cost = time.perf_counter() - start
            print(f'{func.__name__} 耗时 {cost:.3f}s')
    return wrapper


def retry(times=3, base_delay=0.5, exceptions=(Exception,)):
    """带参数的装饰器 = 比普通装饰器多包一层"""
    def deco(func):
        @functools.wraps(func)
        def wrapper(*args, **kwargs):
            for attempt in range(times):
                try:
                    return func(*args, **kwargs)
                except exceptions:
                    if attempt == times - 1:
                        raise                       # 最后一次失败就抛出去
                    time.sleep(base_delay * (2 ** attempt))   # 指数退避
        return wrapper
    return deco


class CountCalls:
    """类装饰器：需要保存状态时更顺手"""
    def __init__(self, func):
        functools.update_wrapper(self, func)
        self.func = func
        self.count = 0

    def __call__(self, *args, **kwargs):
        self.count += 1
        return self.func(*args, **kwargs)


@retry(times=3)
@timing                              # 靠近函数的先生效：timing 包住原函数，
def fetch(url):                      # retry 再包住 timing
    ...`,
      points: [
        '@functools.wraps 保住 __name__ / __doc__ / __wrapped__',
        '带参数的装饰器要三层：deco 工厂 → deco → wrapper',
        '多个装饰器自下而上生效，最靠近函数的最先包',
      ],
      pitfalls: [
        '忘了 wraps，日志里全是 "wrapper"，出错定位不到',
        '在装饰器里做重活（连数据库等）会在 import 时就执行',
      ],
    },

    {
      id: 'adapter',
      title: '适配器 Adapter',
      lang: 'python',
      tags: ['结构型'],
      why: '接第三方 SDK、迁移老接口时天天用。它的价值是"不改两边，只加中间一层"。',
      code: `from abc import ABC, abstractmethod

class LegacyPayment:
    """已有的、不能改的老接口：单位是分，回调式"""
    def pay_in_cents(self, cents: int, on_done):
        on_done({'code': 0, 'cents': cents})


class PaymentGateway(ABC):
    """我们希望的接口：单位是元，直接返回"""
    @abstractmethod
    def pay(self, yuan: float) -> bool: ...


class LegacyPaymentAdapter(PaymentGateway):
    def __init__(self, legacy: LegacyPayment):
        self._legacy = legacy

    def pay(self, yuan: float) -> bool:
        result = {}
        # 单位换算用 round 再取整，直接 int(yuan*100) 会因浮点误差少一分
        cents = int(round(yuan * 100))
        self._legacy.pay_in_cents(cents, lambda r: result.update(r))
        return result.get('code') == 0`,
      points: [
        '适配器只做协议转换，不加业务逻辑',
        '两边接口都不动，只加中间层 —— 老代码不用重测',
      ],
      pitfalls: [
        '适配器里悄悄写业务规则，以后没人找得到那段逻辑在哪',
        '金额换算用 int(x*100) 会因浮点误差丢分，必须 round',
      ],
    },

    {
      id: 'builder',
      title: '建造者 Builder',
      lang: 'python',
      tags: ['创建型'],
      why: '参数超过 4 个、且很多可选时用它。链式调用 + build 时统一校验，比一个 10 参数的构造函数强得多。',
      code: `class Query:
    def __init__(self):
        self.table = None
        self.wheres = []
        self.order = None
        self.limit_n = None

    def sql(self):
        parts = [f'SELECT * FROM {self.table}']
        if self.wheres:
            parts.append('WHERE ' + ' AND '.join(self.wheres))
        if self.order:
            parts.append(f'ORDER BY {self.order}')
        if self.limit_n is not None:
            parts.append(f'LIMIT {self.limit_n}')
        return ' '.join(parts)


class QueryBuilder:
    def __init__(self):
        self._q = Query()

    def table(self, name):
        self._q.table = name
        return self                    # 返回 self 才能链式调用

    def where(self, cond):
        self._q.wheres.append(cond)
        return self

    def order_by(self, col):
        self._q.order = col
        return self

    def limit(self, n):
        if n <= 0:
            raise ValueError('limit 必须为正')
        self._q.limit_n = n
        return self

    def build(self) -> Query:
        if not self._q.table:          # 校验集中在 build，中间步骤怎么调都行
            raise ValueError('必须先指定 table')
        return self._q


sql = QueryBuilder().table('orders').where('status = 1').limit(10).build().sql()


# Python 里的轻量替代：dataclass + 关键字参数
from dataclasses import dataclass, field

@dataclass
class QueryConfig:
    table: str
    wheres: list = field(default_factory=list)   # 可变默认值必须用 default_factory
    limit_n: int | None = None`,
      points: [
        '每个设置方法 return self，才能链式调用',
        '校验放在 build()，中间过程允许任意顺序',
        'Python 有关键字参数和 dataclass，很多时候不需要 Builder',
      ],
      pitfalls: [
        'dataclass 里写 wheres: list = [] 会让所有实例共享同一个列表',
        'Builder 复用同一个实例 build 两次，会返回同一个对象的引用',
      ],
    },

    {
      id: 'template-method',
      title: '模板方法 Template Method',
      lang: 'python',
      tags: ['行为型'],
      why: '流程固定、步骤可变的场景（训练循环、ETL、请求处理）。它和策略的区别：模板方法用继承，策略用组合。',
      code: `from abc import ABC, abstractmethod

class Pipeline(ABC):
    def run(self):                 # 模板方法：骨架固定，不允许子类改
        raw = self.extract()
        cleaned = self.transform(raw)
        self.load(cleaned)
        self.on_finish()           # 钩子：有默认实现，子类想管才管

    @abstractmethod
    def extract(self): ...

    @abstractmethod
    def load(self, data): ...

    def transform(self, data):     # 有默认实现的可选步骤
        return data

    def on_finish(self):           # 空钩子
        pass


class CsvPipeline(Pipeline):
    def extract(self):
        return [{'id': 1}]

    def load(self, data):
        print('写入', data)

    def on_finish(self):
        print('done')`,
      points: [
        '模板方法本身不该被子类覆盖（Java 里会标 final）',
        '抽象方法 = 必须实现；钩子方法 = 可选覆盖',
        '继承带来强耦合，能用策略（组合）就别用它',
      ],
      pitfalls: [
        '钩子太多会变成"到处是空实现"，流程反而看不清',
      ],
    },

    {
      id: 'chain',
      title: '责任链 Chain of Responsibility',
      lang: 'python',
      tags: ['行为型'],
      why: '中间件、审批流、风控规则的骨架。Web 框架的 middleware 就是它。',
      code: `from abc import ABC, abstractmethod

class Handler(ABC):
    def __init__(self):
        self._next = None

    def set_next(self, handler):
        self._next = handler
        return handler            # 返回下一个，便于 a.set_next(b).set_next(c)

    def handle(self, request):
        if self.can_handle(request):
            return self.process(request)
        if self._next:
            return self._next.handle(request)
        return None               # 没人处理，要明确返回而不是静默吞掉

    @abstractmethod
    def can_handle(self, request) -> bool: ...

    @abstractmethod
    def process(self, request): ...


class AmountHandler(Handler):
    def __init__(self, limit):
        super().__init__()
        self.limit = limit

    def can_handle(self, request):
        return request['amount'] <= self.limit

    def process(self, request):
        return f'{self.limit} 以内，自动批准'


# ---- 中间件式写法：洋葱模型，每层可以在前后都做事 ----
def compose(middlewares, handler):
    for mw in reversed(middlewares):
        handler = (lambda mw, nxt: lambda req: mw(req, nxt))(mw, handler)
    return handler`,
      points: [
        'set_next 返回下一个 handler，串链子时最顺手',
        '没人处理时要有明确结果，别静默返回 None 让调用方猜',
        '洋葱模型（中间件）比纯链式更灵活：能在调用前后各做一次',
      ],
      pitfalls: [
        '链太长时排查"为什么没被处理"很痛苦 —— 每层加日志',
        'compose 里直接闭包捕获循环变量会全指向最后一个，要用参数固定',
      ],
    },

    {
      id: 'proxy',
      title: '代理 Proxy',
      lang: 'python',
      tags: ['结构型'],
      why: '缓存、懒加载、权限校验、埋点，都是在"不改原对象"的前提下加行为。ORM 的懒加载就是虚拟代理。',
      code: `import functools

class ExpensiveService:
    def query(self, key):
        print('真的去查了', key)
        return {'key': key}


class CachingProxy:
    """缓存代理：接口和被代理对象完全一致，调用方无感"""
    def __init__(self, real):
        self._real = real
        self._cache = {}

    def query(self, key):
        if key not in self._cache:
            self._cache[key] = self._real.query(key)
        return self._cache[key]


class LazyProxy:
    """虚拟代理：真正用到时才创建，省掉启动开销"""
    def __init__(self, factory):
        self._factory = factory
        self._real = None

    def __getattr__(self, name):        # 只有找不到属性时才会走到这里
        if self._real is None:
            self._real = self._factory()
        return getattr(self._real, name)


# Python 自带的缓存代理
@functools.lru_cache(maxsize=128)
def expensive(key):
    return key * 2`,
      points: [
        '代理和被代理对象接口一致，调用方不用改',
        '__getattr__ 只在常规查找失败时触发，是做透明代理的关键',
        '标准库的 functools.lru_cache / cached_property 已经够用',
      ],
      pitfalls: [
        '__getattr__ 里访问 self._real 时若还没设好会无限递归',
        'lru_cache 参数必须可哈希，list/dict 传不进去',
      ],
    },
  ],
};
