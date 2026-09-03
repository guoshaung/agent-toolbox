export default {
  id: 'oop',
  name: '面向对象',
  icon: '🧱',
  blurb: '面向对象最容易学成"背名词"。这里每个模板都对着一个具体问题：什么时候该继承、什么时候该组合、property 到底解决了什么。记住写法之后，更要记住"不该用"的场合。',

  templates: [
    {
      id: 'class-basics',
      title: '类的骨架：__init__ / __new__ / __repr__',
      lang: 'python',
      tags: ['基础', '必背'],
      why: '__init__ 不是构造函数，__new__ 才是。搞混这两个，单例、不可变类、继承内置类型全会出问题。',
      code: `class Point:
    """二维点。这个类的骨架适用于几乎所有值对象"""

    __slots__ = ('x', 'y')          # 固定属性，省内存且防止手滑写错属性名

    def __new__(cls, x, y):
        # __new__ 才是真正"造对象"的：先有对象，才轮到 __init__ 初始化它
        # 只有在需要控制创建过程时才重写（单例、不可变类、继承 int/str/tuple）
        return super().__new__(cls)

    def __init__(self, x, y):
        self.x = x
        self.y = y

    def __repr__(self):
        # 给人看的调试输出。原则：尽量做到 eval(repr(obj)) == obj
        return f'Point(x={self.x!r}, y={self.y!r})'

    def __str__(self):
        # print() 用这个；没定义时自动退回 __repr__
        return f'({self.x}, {self.y})'

    def __eq__(self, other):
        if not isinstance(other, Point):
            return NotImplemented      # 返回 NotImplemented，让 Python 去问对方
        return (self.x, self.y) == (other.x, other.y)

    def __hash__(self):
        # 只要定义了 __eq__，__hash__ 就会被置为 None，对象无法进 set / 做 dict 键
        # 想保留可哈希性就必须显式定义，且必须和 __eq__ 用同一组字段
        return hash((self.x, self.y))`,
      points: [
        '__new__ 造对象、__init__ 初始化对象，前者返回实例后者返回 None',
        '__repr__ 给开发者、__str__ 给用户；只写一个就写 __repr__',
        '定义了 __eq__ 就必须定义 __hash__，且两者用同一组字段',
        '__eq__ 遇到不认识的类型返回 NotImplemented，不要返回 False',
      ],
      pitfalls: [
        '在 __init__ 里 return 一个值 → TypeError',
        '只写 __eq__ 不写 __hash__ → 对象进不了 set，报 unhashable',
        '__slots__ 和多继承、类属性默认值一起用容易踩坑，先确认再上',
      ],
    },

    {
      id: 'encapsulation',
      title: '封装：property 与"私有"',
      lang: 'python',
      tags: ['封装', '必背'],
      why: 'Python 没有真正的 private。property 的价值不是"藏起来"，是让你**以后**能在不改调用方的前提下加校验和计算。',
      code: `class Account:
    def __init__(self, balance=0):
        self._balance = 0          # 单下划线 = 约定"这是内部的"，不是强制
        self.balance = balance     # 走 setter，初始化时就享受校验

    @property
    def balance(self):
        """读起来还是 account.balance，调用方完全无感"""
        return self._balance

    @balance.setter
    def balance(self, value):
        # property 的真正价值：加校验不需要改任何调用方代码
        if not isinstance(value, (int, float)):
            raise TypeError('金额必须是数字')
        if value < 0:
            raise ValueError('余额不能为负')
        self._balance = value

    @property
    def is_overdrawn(self):
        """计算属性：像字段一样读，实际每次都算"""
        return self._balance < 0


class Config:
    # 双下划线触发名称改写（name mangling）：__secret 变成 _Config__secret
    # 这是为了避免子类无意覆盖父类属性，**不是**安全机制
    def __init__(self):
        self.__secret = 'x'        # 外部仍可用 obj._Config__secret 访问

    def reveal(self):
        return self.__secret


# 什么时候不该用 property：
# 如果 getter 里有 IO、网络请求或耗时计算，就老实写成 fetch_xxx() 方法。
# 属性访问看起来是零成本的，藏一个数据库查询进去会让调用方完全无法预期。`,
      points: [
        '单下划线是约定，双下划线是名称改写，两者都不是访问控制',
        'property 让你在不改调用方的前提下补上校验或改成计算值',
        '计算属性要廉价；有 IO 或耗时的写成方法，别伪装成属性',
      ],
      pitfalls: [
        '在 setter 里写 self.balance = value → 无限递归（必须写 self._balance）',
        '把耗时操作藏进 property，调用方在循环里读一次就慢十倍',
      ],
    },

    {
      id: 'inheritance-mro',
      title: '继承、super() 与 MRO',
      lang: 'python',
      tags: ['继承', '必背'],
      why: 'super() 不是"调用父类"，是"调用 MRO 里的下一个"。多继承时这两种理解会给出完全不同的结果。',
      code: `class Base:
    def __init__(self, **kwargs):
        # 协作式继承：每层都把不认识的参数往上传，最后由 object 收尾
        super().__init__(**kwargs)
        self.base = True

    def greet(self):
        return 'Base'


class Loggable:
    def __init__(self, log_level='INFO', **kwargs):
        super().__init__(**kwargs)      # 关键：混入类也必须调用 super()
        self.log_level = log_level

    def greet(self):
        return f'Loggable -> {super().greet()}'


class Service(Loggable, Base):
    def greet(self):
        return f'Service -> {super().greet()}'


# MRO（方法解析顺序）由 C3 线性化算出，可以直接查看：
# Service.__mro__ -> (Service, Loggable, Base, object)
# 所以 Service().greet() == 'Service -> Loggable -> Base'
#
# super() 走的是**MRO 的下一个**，不是"我的父类"。
# 在 Loggable 里 super().greet() 调到的是 Base —— 而 Loggable 根本不继承 Base。
# 这就是混入（Mixin）能工作的原理，也是漏写 super() 会断链的原因。


class Animal:
    def speak(self):
        raise NotImplementedError('子类必须实现 speak')


class Dog(Animal):
    def speak(self):
        return '汪'


def make_speak(animals):
    # 多态：调用方不关心具体是什么动物，只要求它会 speak
    return [a.speak() for a in animals]`,
      points: [
        'super() 找的是 MRO 里的下一个类，不是父类',
        '多继承时每一层都要调 super().__init__(**kwargs)，漏一个链就断',
        '用 Cls.__mro__ 直接查看解析顺序，别猜',
        '菱形继承下协作式 super 能保证每个基类只初始化一次',
      ],
      pitfalls: [
        '混入类不写 super().__init__() → 后面的基类永远不会被初始化',
        '直接写 Base.__init__(self) 而不是 super() → 多继承时会重复或漏掉初始化',
      ],
    },

    {
      id: 'abc-protocol',
      title: '抽象基类 ABC 与 Protocol',
      lang: 'python',
      tags: ['抽象', '必背'],
      why: 'ABC 是"名义子类型"（必须显式继承），Protocol 是"结构子类型"（长得像就行）。选错会让第三方类型接不进来。',
      code: `from abc import ABC, abstractmethod
from typing import Protocol, runtime_checkable


class Storage(ABC):
    """ABC：必须显式继承才算数。适合你自己掌控的类型体系"""

    @abstractmethod
    def save(self, key: str, data: bytes) -> None: ...

    @abstractmethod
    def load(self, key: str) -> bytes: ...

    def save_text(self, key: str, text: str) -> None:
        # 抽象基类可以带实现，把公共逻辑收进来，子类只填必要的部分
        self.save(key, text.encode('utf-8'))


class DiskStorage(Storage):
    def save(self, key, data): ...
    def load(self, key): return b''
# 漏实现任何一个 abstractmethod，实例化时就报错 —— 错误提前到创建对象那一刻


@runtime_checkable
class Closeable(Protocol):
    """Protocol：只要有这个方法就算，**不需要继承**。
    适合给第三方类型做约束 —— 你改不了别人的类，让它去继承你的 ABC 不现实"""
    def close(self) -> None: ...


def cleanup(resource: Closeable) -> None:
    resource.close()


class ThirdPartyConn:          # 完全不知道 Closeable 的存在
    def close(self): ...

cleanup(ThirdPartyConn())      # 类型检查通过：结构对上了就行`,
      points: [
        'ABC 要显式继承，能强制子类实现，还能带公共实现',
        'Protocol 只看结构，适合约束你无法修改的第三方类型',
        '缺少 abstractmethod 的报错发生在实例化时，不是定义时',
      ],
      pitfalls: [
        '给第三方类型定 ABC → 对方不可能来继承你，约束落空',
        'Protocol 不加 @runtime_checkable 就不能用 isinstance 检查',
      ],
    },

    {
      id: 'composition',
      title: '组合优于继承',
      lang: 'python',
      tags: ['设计', '必背'],
      why: '继承会把父类的全部实现细节焊死在子类上。90% 的"我需要复用这段逻辑"用组合更合适——这条判断力比会写继承更值钱。',
      code: `# ---- 反面：用继承复用，把自己焊死 ----
class BadCache(dict):
    """继承 dict 来做缓存，看着省事"""
    def __setitem__(self, key, value):
        if len(self) >= 100:
            self.pop(next(iter(self)))
        super().__setitem__(key, value)
# 问题：dict.update() / setdefault() 不走 __setitem__，容量限制被绕过。
# 你继承来的每一个方法都是你没审查过的行为。


# ---- 正面：用组合，只暴露你真正想提供的接口 ----
class Cache:
    def __init__(self, capacity=100):
        self._data = {}                 # 持有，而不是继承
        self._capacity = capacity

    def set(self, key, value):
        if key not in self._data and len(self._data) >= self._capacity:
            self._data.pop(next(iter(self._data)))
        self._data[key] = value

    def get(self, key, default=None):
        return self._data.get(key, default)

    def __len__(self):
        return len(self._data)
# 接口是你自己定的，容量限制无法被绕过。


# ---- 判断标准 ----
# 继承表达的是"是一个"（is-a）：Dog 是 Animal，替换后行为仍然正确（里氏替换）。
# 组合表达的是"有一个"（has-a）：Car 有 Engine。
#
# 拿不准时问自己：**父类以后加一个方法，我的子类会不会突然出错？**
# 会的话就该用组合。


class Engine:
    def start(self): return '轰'


class Car:
    def __init__(self, engine: Engine):
        self._engine = engine           # 依赖注入：测试时能换成假引擎
    def start(self):
        return self._engine.start()`,
      points: [
        '继承 = is-a 且满足里氏替换；组合 = has-a',
        '继承内置类型（dict/list）尤其危险：很多方法不走你重写的那个',
        '判断标准：父类以后加方法会不会让子类出错',
        '组合天然支持依赖注入，测试好写',
      ],
      pitfalls: [
        '为了复用一段代码就去继承 → 把不需要的接口也一起继承了',
        '继承层级超过三层，基本可以确定设计出了问题',
      ],
    },

    {
      id: 'dunder',
      title: '常用魔术方法',
      lang: 'python',
      tags: ['协议', '必背'],
      why: 'Python 的"接口"是靠魔术方法约定的。实现对了，你的对象就能用 len()、for、with、+ 这些语言级语法。',
      code: `class Playlist:
    def __init__(self, songs=None):
        self._songs = list(songs or [])

    # ---- 容器协议：让 len() / in / [] / for 都能用 ----
    def __len__(self):
        return len(self._songs)

    def __getitem__(self, index):
        # 只要有 __getitem__，for 循环和 in 就自动能用（旧式迭代协议）
        return self._songs[index]

    def __contains__(self, song):
        return song in self._songs      # 显式定义比退回遍历快

    def __iter__(self):
        return iter(self._songs)        # 有它就优先用它

    # ---- 运算符 ----
    def __add__(self, other):
        return Playlist(self._songs + list(other))

    def __bool__(self):
        # 不定义时，Python 退回用 __len__；两个都没有则对象恒为真
        return bool(self._songs)

    # ---- 上下文管理器：with 语句 ----
    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        # 返回 True 会吞掉异常 —— 除非真的想吞，否则不要返回 True
        return False


from contextlib import contextmanager

@contextmanager
def timed(label):
    """写上下文管理器的轻量方式，比实现 __enter__/__exit__ 省事"""
    import time
    start = time.perf_counter()
    try:
        yield                            # yield 之前是 __enter__，之后是 __exit__
    finally:
        print(f'{label} 耗时 {time.perf_counter() - start:.3f}s')`,
      points: [
        '__len__ + __getitem__ 就能让对象支持 for / in / 切片',
        '__exit__ 返回 True 会吞异常，默认要返回 False',
        '@contextmanager 是写上下文管理器最省事的方式',
        '__bool__ 缺失时退回 __len__，都缺失则恒为 True',
      ],
      pitfalls: [
        '__exit__ 里不小心 return 了真值 → 异常被静默吞掉，最难查的一类 bug',
        '实现了 __getitem__ 但索引越界不抛 IndexError → for 循环永不结束',
      ],
    },

    {
      id: 'dataclass',
      title: 'dataclass 与值对象',
      lang: 'python',
      tags: ['实用', '必背'],
      why: '写值对象不该手敲 __init__/__repr__/__eq__。dataclass 三行解决，但可变默认值和 frozen 这两个坑必须知道。',
      code: `from dataclasses import dataclass, field, asdict, replace
from typing import Optional


@dataclass(frozen=True, slots=True)
class Money:
    """frozen=True 让实例不可变，同时自动获得 __hash__，能进 set 和 dict"""
    amount: int              # 用整数分存金额，浮点数存钱迟早出问题
    currency: str = 'CNY'

    def __post_init__(self):
        # frozen 之后不能直接赋值，校验要用 object.__setattr__ 或只做检查
        if self.amount < 0:
            raise ValueError('金额不能为负')

    def add(self, other: 'Money') -> 'Money':
        if other.currency != self.currency:
            raise ValueError('币种不一致')
        return Money(self.amount + other.amount, self.currency)   # 返回新对象


@dataclass
class Order:
    id: str
    items: list = field(default_factory=list)   # 可变默认值必须用 default_factory
    note: Optional[str] = None
    # items: list = []  ← 这样写所有实例会共享同一个列表，dataclass 会直接报错拦下
    #                     （普通函数参数的同类写法不会报错，更隐蔽）


order = Order('A1')
data = asdict(order)                 # 转 dict，写日志/序列化用
copy = replace(order, note='加急')    # 基于已有对象改几个字段生成新对象`,
      points: [
        'frozen=True → 不可变 + 自动可哈希，值对象的默认选择',
        '可变默认值必须用 field(default_factory=list)',
        'asdict / replace 是配套的两个实用函数',
        '金额用整数（分）存，不要用 float',
      ],
      pitfalls: [
        'frozen 之后在 __post_init__ 里赋值会抛 FrozenInstanceError',
        'dataclass 的字段顺序：有默认值的必须排在没默认值的后面',
      ],
    },

    {
      id: 'classmethod',
      title: '类方法、静态方法与工厂',
      lang: 'python',
      tags: ['基础'],
      why: 'classmethod 的第一个参数是 cls 而不是类名——这一点决定了子类调用时能不能拿到正确的类型。',
      code: `class User:
    def __init__(self, name, age):
        self.name = name
        self.age = age

    @classmethod
    def from_dict(cls, data):
        """备用构造器。用 cls 而不是 User —— 子类调用时才会返回子类实例"""
        return cls(data['name'], data['age'])

    @classmethod
    def from_json(cls, text):
        import json
        return cls.from_dict(json.loads(text))

    @staticmethod
    def is_adult(age):
        """和类相关、但既不用实例也不用类的工具函数。
        放进类里只是为了组织代码，写成模块级函数也完全可以"""
        return age >= 18

    def __repr__(self):
        return f'{type(self).__name__}(name={self.name!r})'   # 用 type(self) 而非硬编码


class VipUser(User):
    pass


VipUser.from_dict({'name': 'a', 'age': 20})   # -> VipUser(...)，不是 User
# 如果 from_dict 里写死 return User(...)，这里就会拿到基类实例，多态断掉`,
      points: [
        'classmethod 用 cls，子类调用时自动返回子类实例',
        '备用构造器（from_xxx）是 classmethod 最主要的用途',
        'staticmethod 只是命名空间归类，没有绑定行为',
        '__repr__ 里用 type(self).__name__，别硬编码类名',
      ],
      pitfalls: [
        '在 classmethod 里写死类名 → 子类继承后行为错误',
      ],
    },

    {
      id: 'solid',
      title: 'SOLID：用代码说清楚',
      lang: 'python',
      tags: ['设计', '必背'],
      why: '这五个字母背下来没用，要能指着一段代码说"它违反了哪一条、怎么改"。这里每条都配一个最小的反例和改法。',
      code: `# S —— 单一职责：一个类只因一个原因而改变
class BadReport:
    def generate(self): ...
    def save_to_db(self): ...      # 数据库变了要改这个类
    def send_email(self): ...      # 邮件服务变了也要改这个类
# 改法：拆成 Report / ReportRepository / ReportMailer 三个类


# O —— 开闭原则：对扩展开放，对修改关闭
def bad_area(shape):
    if shape.kind == 'circle': ...
    elif shape.kind == 'square': ...
    # 每加一种形状都要回来改这个函数
class Shape:
    def area(self): raise NotImplementedError
# 改法：新形状只要新增一个子类，这段调用代码一个字都不用动


# L —— 里氏替换：子类必须能替换父类而不破坏正确性
class Rectangle:
    def __init__(self, w, h): self.w, self.h = w, h
class Square(Rectangle):
    def __init__(self, size): super().__init__(size, size)
    # 若再提供 set_width()，调用方"改宽度不影响高度"的假设就被破坏了
    # 这就是经典的正方形/长方形问题：数学上是 is-a，行为上不是


# I —— 接口隔离：别逼实现者去实现用不到的方法
class BadWorker:                    # 机器人被迫实现 eat()
    def work(self): ...
    def eat(self): ...
# 改法：拆成 Workable 和 Eatable 两个小接口


# D —— 依赖倒置：依赖抽象，不依赖具体
class BadService:
    def __init__(self):
        self.db = MySQLClient()     # 焊死在具体实现上，测试时没法替换
class GoodService:
    def __init__(self, storage):    # 依赖注入：传进来的是抽象
        self.storage = storage
# 测试时传一个假的 storage 就行，不用真连数据库`,
      points: [
        'S：判断标准是"有几种原因会让我改这个类"',
        'O：加功能靠新增代码，而不是修改已有分支',
        'L：看行为契约，不是看数学定义',
        'I：接口要小，宁可多几个',
        'D：构造函数里 new 具体类，通常就是违反 D 的信号',
      ],
      pitfalls: [
        '为了"符合 SOLID"给只有一个实现的东西加抽象层 —— 过度设计比违反原则更常见',
      ],
    },
  ],
};
