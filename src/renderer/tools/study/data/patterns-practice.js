export default {
  id: 'patterns-practice',
  name: '设计模式·会用',
  icon: '🎯',
  blurb: '光记名字没用。面试官不会问"什么是策略模式"，他会丢一段烂代码问你怎么改。这个模块只练一件事：看到坏味道，立刻知道该上哪个模式——或者该不该上模式。',
  scenarios: [
    {
      id: 'strategy-payment',
      title: '支付方式越加越多，一个函数里全是 if/else',
      problem: '我们的下单接口一开始只支持微信支付。后来加了支付宝、银行卡、花呗，每加一种就往 pay() 里塞一段 elif。现在这个函数三百行，改一个分支要把整个函数看一遍，上周还把微信的手续费算到花呗头上了。',
      smell: '一堆按"类型"分支的 if/elif，每加一种类型就要改同一个函数。',
      options: ['策略', '单例', '工厂方法', '观察者'],
      answer: 0,
      why: '每种支付方式就是一个"策略"。把每个分支拆成独立的类或函数，它们长得一样（都有 pay 方法），外面按名字挑一个用。加新支付方式只加新文件，不碰旧代码。',
      whyNot: ['就是它', '单例管的是"只有一个实例"，跟"多种算法切换"没关系', '工厂方法管"怎么创建对象"，这里问题是"怎么执行"。工厂常常和策略搭配用，但主角是策略', '观察者管"一件事发生通知多方"，这里没有通知的需求'],
      lang: 'python',
      before: `def pay(method, amount):
    # 问题：每加一种支付方式就要改这个函数
    if method == "wechat":
        fee = amount * 0.006
        print(f"微信支付 {amount + fee}")
    elif method == "alipay":
        fee = amount * 0.006
        print(f"支付宝支付 {amount + fee}")
    elif method == "card":
        fee = 2
        print(f"银行卡支付 {amount + fee}")
    elif method == "huabei":
        fee = amount * 0.01   # 上次就是这行抄错了
        print(f"花呗支付 {amount + fee}")
    else:
        raise ValueError("不支持")`,
      after: `class WechatPay:
    def pay(self, amount):
        print(f"微信支付 {amount * 1.006}")

class AlipayPay:
    def pay(self, amount):
        print(f"支付宝支付 {amount * 1.006}")

class CardPay:
    def pay(self, amount):
        print(f"银行卡支付 {amount + 2}")

# 每种方式一个类，长得一样，外面按名字挑
STRATEGIES = {
    "wechat": WechatPay(),
    "alipay": AlipayPay(),
    "card": CardPay(),
}

def pay(method, amount):
    strategy = STRATEGIES[method]   # 挑一个策略
    strategy.pay(amount)            # 用它，不关心它是谁

# 加花呗：只加一个类 + 字典加一行，pay() 不动`,
      tip: '一堆 if/else 按类型分支 → 策略（每个分支变成一个可替换的对象）',
    },

    {
      id: 'factory-method-notifier',
      title: '到处都在 new 对象，换个实现要改十几个地方',
      problem: '我们发通知的代码，在订单模块、用户模块、营销模块里都直接写了 SmsSender()。现在要接一家新的短信服务商，参数不一样，我得把这十几处 new 的地方全找出来改。而且测试时想换成假的发送器，也得挨个改。',
      smell: '创建对象的代码散落在各处，"用谁"和"怎么造"混在一起。',
      options: ['单例', '工厂方法', '适配器', '建造者'],
      answer: 1,
      why: '把"造对象"这件事收进一个函数或方法里，大家都从它那儿拿。要换实现只改这一处。测试时让它返回假对象也很容易。',
      whyNot: ['单例是"只造一个"，这里可以造很多个，问题是造的地方太分散', '就是它', '适配器是"接口不合把它包一层"，这里接口本来就统一，是创建太分散', '建造者管"参数太多一步步拼"，这里造对象很简单，只是造的地方多'],
      lang: 'python',
      before: `class SmsSender:
    def send(self, to, text):
        print(f"短信给 {to}: {text}")

# 订单模块
def notify_order(user):
    SmsSender().send(user, "订单已发货")   # 直接 new

# 用户模块
def notify_signup(user):
    SmsSender().send(user, "欢迎注册")     # 又直接 new

# 营销模块……还有十几处
# 问题：换服务商 / 换成假发送器，要改所有地方`,
      after: `class SmsSender:
    def send(self, to, text):
        print(f"短信给 {to}: {text}")

class FakeSender:
    def send(self, to, text):
        print(f"[测试] 假装发给 {to}")

# 造对象只在这一处
def create_sender(env="prod"):
    if env == "test":
        return FakeSender()
    return SmsSender()

# 各模块都从工厂拿，不自己 new
def notify_order(user):
    create_sender().send(user, "订单已发货")

def notify_signup(user):
    create_sender().send(user, "欢迎注册")

# 换服务商：只改 create_sender 一个地方`,
      tip: '到处 new 同一种对象 → 工厂方法（把"造"收到一个口子里）',
    },

    {
      id: 'singleton-config',
      title: '配置文件被读了一百遍，还担心两份配置不一致',
      problem: '每个模块启动时都自己 open("config.yaml") 读一遍。日志里一启动就刷几十行"加载配置"。更麻烦的是，有个模块运行时改了配置里的值，别的模块拿的还是旧的，查了半天才发现大家手里各有一份。',
      smell: '本来全局只该有一份的东西，被创建了很多份，而且互相不同步。',
      options: ['工厂方法', '代理', '单例', '外观'],
      answer: 2,
      why: '配置全局只需要一份，谁来拿都拿同一个对象。这就是单例。注意：Python 里模块本身就是天然单例，模块级变量往往比写 Singleton 类更省事。',
      whyNot: ['工厂方法每次调用可以造新对象，解决不了"多份"的问题', '代理是"在访问前后加一层控制"，不管有几份', '就是它', '外观是"把复杂子系统包成简单接口"，不管实例数量'],
      lang: 'python',
      before: `import yaml

class Config:
    def __init__(self):
        print("加载配置")             # 每 new 一次就读一次文件
        with open("config.yaml") as f:
            self.data = yaml.safe_load(f)

# 模块 A
cfg_a = Config()
cfg_a.data["debug"] = True         # 改了 A 手里那份

# 模块 B
cfg_b = Config()
print(cfg_b.data["debug"])         # 问题：B 拿的还是文件里的旧值`,
      after: `import yaml

class Config:
    _instance = None

    def __new__(cls):
        if cls._instance is None:          # 只在第一次真正创建
            cls._instance = super().__new__(cls)
            print("加载配置")
            with open("config.yaml") as f:
                cls._instance.data = yaml.safe_load(f)
        return cls._instance

cfg_a = Config()
cfg_a.data["debug"] = True
cfg_b = Config()
print(cfg_b.data["debug"])   # True，因为 cfg_a is cfg_b

# 更 Python 的写法：不用类，直接在模块里放一个变量
# config.py:
#   with open("config.yaml") as f:
#       DATA = yaml.safe_load(f)
# 其他地方 from config import DATA，天然只有一份

# 什么时候别用单例：数据库连接、HTTP 客户端这种要按线程/协程管理的，
# 用连接池；单例会让测试互相污染、难以并行`,
      tip: '全局只该有一份还老被重复创建 → 单例（Python 先考虑模块级变量）',
    },

    {
      id: 'observer-order-events',
      title: '下单成功后要做的事越来越多，下单函数越来越胖',
      problem: '订单支付成功后要：扣库存、发短信、加积分、通知仓库、写统计。这些逻辑全塞在 pay_success() 里。营销组又要加一个"发优惠券"，我又得改这个核心函数。改一次上一次线，心惊胆战。',
      smell: '一个核心函数知道太多"后续要做什么"，每加一个下游都要改它。',
      options: ['命令', '责任链', '观察者', '中介者'],
      answer: 2,
      why: '下单函数只管"喊一声：我成功了"。谁关心这件事，谁自己来登记。加"发优惠券"只需要再登记一个函数，下单函数一个字不改。',
      whyNot: ['命令是"把一次操作打包成对象"，用于撤销/排队，这里不需要', '责任链是"一个请求顺着链传，有人处理就停"，这里所有下游都要执行，不是选一个', '就是它', '中介者是"多方互相通信，中间加个协调人"，这里只是单向广播'],
      lang: 'python',
      before: `def pay_success(order):
    # 问题：每加一个下游动作就要改这里
    reduce_stock(order)
    send_sms(order.user, "支付成功")
    add_points(order.user, order.amount)
    notify_warehouse(order)
    record_stats(order)
    # 营销组：能不能加一个 send_coupon(order)？
    # 我：……又要改核心函数`,
      after: `# 一个简单的事件总线
_listeners = {}

def on(event, func):
    _listeners.setdefault(event, []).append(func)

def emit(event, data):
    for func in _listeners.get(event, []):
        func(data)

# 核心函数只管喊一声
def pay_success(order):
    emit("paid", order)

# 谁关心谁登记，互相不认识
on("paid", reduce_stock)
on("paid", lambda o: send_sms(o.user, "支付成功"))
on("paid", lambda o: add_points(o.user, o.amount))
on("paid", notify_warehouse)

# 营销组自己加，不碰 pay_success
on("paid", send_coupon)`,
      tip: '一件事发生要通知一堆人 → 观察者（发布/订阅，发的人不认识收的人）',
    },

    {
      id: 'decorator-logging-cache',
      title: '每个接口函数都要手动加日志、计时、缓存',
      problem: '老板要求所有查询接口都打日志、统计耗时。我在二十个函数开头结尾都复制了同样的几行。后来又要给部分接口加缓存，又复制一遍。函数本身的业务逻辑只有三行，包装代码倒有十行。',
      smell: '同样的"前置/后置"代码在很多函数里重复出现，和业务逻辑混在一起。',
      options: ['代理', '装饰器', '模板方法', '外观'],
      answer: 1,
      why: '把"日志、计时、缓存"各做成一层皮，想要什么就给函数套上什么。Python 的 @语法就是为这个生的。业务函数保持干净，功能可以随意叠加。',
      whyNot: ['代理和装饰器很像，但代理侧重"控制访问"（比如权限、延迟加载），装饰器侧重"叠加功能"。日志、计时这种可以叠好几层的用装饰器更贴切', '就是它', '模板方法是"固定流程骨架，子类填步骤"，要用继承，这里没有类层次', '外观是"包一组复杂调用"，不是给单个函数加皮'],
      lang: 'python',
      before: `import time

def get_user(uid):
    print(f"调用 get_user {uid}")     # 日志，每个函数都抄一遍
    start = time.time()
    result = db.query("user", uid)   # 真正的业务只有这一行
    print(f"耗时 {time.time() - start:.3f}s")
    return result

def get_order(oid):
    print(f"调用 get_order {oid}")    # 又抄一遍
    start = time.time()
    result = db.query("order", oid)
    print(f"耗时 {time.time() - start:.3f}s")
    return result
# 问题：二十个函数，二十份重复；要加缓存再抄二十遍`,
      after: `import time
from functools import wraps, lru_cache

def logged(func):
    @wraps(func)
    def wrapper(*args, **kwargs):
        print(f"调用 {func.__name__} {args}")
        start = time.time()
        result = func(*args, **kwargs)
        print(f"耗时 {time.time() - start:.3f}s")
        return result
    return wrapper

# 业务函数干干净净，功能像贴纸一样往上叠
@logged
def get_user(uid):
    return db.query("user", uid)

@logged
@lru_cache(maxsize=1000)      # 想要缓存就再叠一层
def get_order(oid):
    return db.query("order", oid)`,
      tip: '很多函数要加同样的前后包装 → 装饰器（一层一层往上套）',
    },

    {
      id: 'adapter-third-party-sdk',
      title: '换了家第三方服务，方法名参数全不一样',
      problem: '我们的对象存储原来用的是 A 云，代码里到处调 a_client.upload_file(path, key)。现在公司要迁到 B 云，B 的 SDK 叫 put_object(bucket, key, data)，还得先读文件。业务代码有几十处调用，我不想全改。',
      smell: '我们期望的接口和对方提供的接口对不上，要么改我们几十处，要么改不了对方 SDK。',
      options: ['外观', '桥接', '适配器', '代理'],
      answer: 2,
      why: '写一个"转接头"类，对外长得和旧的 A 云一样（有 upload_file），内部偷偷调 B 云的 put_object。业务代码一行不改，换掉底层客户端就行。',
      whyNot: ['外观是"把很多复杂调用包成一个简单的"，重点是简化，不是接口转换', '桥接是"抽象和实现分两条继承线各自演化"，比这个问题重多了', '就是它', '代理的接口和原对象是一样的，只是加控制；适配器的重点恰恰是接口不一样要转换'],
      lang: 'python',
      before: `# B 云的 SDK，接口和我们用惯的 A 云完全不同
class BCloudClient:
    def put_object(self, bucket, key, data: bytes):
        print(f"B云 上传 {bucket}/{key}, {len(data)} 字节")

# 业务代码几十处都是这种写法
def save_avatar(path):
    client.upload_file(path, "avatar/1.png")    # 问题：B 云没有 upload_file

def save_report(path):
    client.upload_file(path, "report/q3.pdf")   # 全改？改不动`,
      after: `class BCloudClient:
    def put_object(self, bucket, key, data: bytes):
        print(f"B云 上传 {bucket}/{key}, {len(data)} 字节")

# 转接头：对外长得像 A 云，内部调 B 云
class BCloudAdapter:
    def __init__(self, b_client, bucket):
        self._b = b_client
        self._bucket = bucket

    def upload_file(self, path, key):          # 和旧接口一模一样
        with open(path, "rb") as f:
            self._b.put_object(self._bucket, key, f.read())

# 只换这一行，业务代码一个字不改
client = BCloudAdapter(BCloudClient(), "my-bucket")

def save_avatar(path):
    client.upload_file(path, "avatar/1.png")   # 照旧`,
      tip: '接口对不上但两边都不想改 → 适配器（中间加个转接头）',
    },

    {
      id: 'command-editor-undo',
      title: '编辑器要支持撤销/重做，还要能把操作记录下来重放',
      problem: '我们做一个简单的画板。用户画一笔、移动一个图形、删除一个图形，这些都要支持 Ctrl+Z 撤销。产品还想要"操作历史"面板，能看到每一步，还能重放。现在每个操作都是直接改数据，撤销根本无从下手。',
      smell: '操作是"直接执行完就没了"，没法记录、没法撤销、没法排队。',
      options: ['备忘录', '命令', '策略', '观察者'],
      answer: 1,
      why: '把每一次操作打包成一个对象，里面有 execute() 和 undo()。执行时把对象压进历史栈。撤销就是弹出来调 undo。操作历史、重放、排队都是顺手的事。',
      whyNot: ['备忘录是"整个状态快照存起来再恢复"，对画板这种大状态太重，而且没法记录"做了什么"', '就是它', '策略是"同一件事的不同做法"，不解决记录和撤销', '观察者是"通知"，不解决撤销'],
      lang: 'python',
      before: `class Canvas:
    def __init__(self):
        self.shapes = []

    def add(self, shape):
        self.shapes.append(shape)     # 直接改，改完就没痕迹

    def remove(self, shape):
        self.shapes.remove(shape)

canvas = Canvas()
canvas.add("circle")
canvas.remove("circle")
# 用户按 Ctrl+Z：问题：我怎么知道刚才干了啥？`,
      after: `class AddShape:
    def __init__(self, canvas, shape):
        self.canvas, self.shape = canvas, shape
    def execute(self):
        self.canvas.shapes.append(self.shape)
    def undo(self):
        self.canvas.shapes.remove(self.shape)

class RemoveShape:
    def __init__(self, canvas, shape):
        self.canvas, self.shape = canvas, shape
    def execute(self):
        self.canvas.shapes.remove(self.shape)
    def undo(self):
        self.canvas.shapes.append(self.shape)

# 操作变成了对象，可以存、可以撤、可以重放
history = []

def run(cmd):
    cmd.execute()
    history.append(cmd)

def undo():
    history.pop().undo()

run(AddShape(canvas, "circle"))
run(RemoveShape(canvas, "circle"))
undo()      # circle 回来了
print([type(c).__name__ for c in history])   # 操作历史面板`,
      tip: '操作要能撤销/排队/记录 → 命令（把"做一件事"打包成对象）',
    },

    {
      id: 'template-method-report',
      title: '三种报表的生成流程一样，只有中间几步不同',
      problem: '我们有日报、周报、月报。生成流程都是：连数据库 → 查数据 → 算汇总 → 渲染成 HTML → 发邮件。三份代码各写了一遍，90% 相同，只有"查数据"和"算汇总"不同。上次改邮件模板，忘了改月报，被投诉了。',
      smell: '几段代码的流程骨架一模一样，只有个别步骤不同，却整体复制了三份。',
      options: ['策略', '模板方法', '建造者', '责任链'],
      answer: 1,
      why: '把流程骨架写在父类里，固定死。不同的那几步留成空方法，让子类填。改流程只改父类一处，改具体步骤只改对应子类。',
      whyNot: ['策略也能做，但策略是"整个算法可替换"；这里是"流程固定，只换几步"，模板方法更贴。二者常一起出现，区分标准：骨架在不在父类', '就是它', '建造者是"分步拼装一个复杂对象"，不是"固定流程执行"', '责任链是"请求沿着链传"，跟固定流程无关'],
      lang: 'python',
      before: `def daily_report():
    db = connect()
    rows = db.query("select * from sales where day = today")
    total = sum(r.amount for r in rows)
    html = render("<h1>日报</h1>", total)
    send_mail(html)             # 改邮件逻辑要改三处

def weekly_report():
    db = connect()
    rows = db.query("select * from sales where week = this_week")
    total = sum(r.amount for r in rows) / 7
    html = render("<h1>周报</h1>", total)
    send_mail(html)

def monthly_report():
    # 问题：又抄一遍，上次就是这里忘改了
    ...`,
      after: `class Report:
    def run(self):                  # 骨架固定在父类，不许改
        db = connect()
        rows = self.fetch(db)       # 留给子类填
        total = self.summarize(rows)
        html = render(self.title(), total)
        send_mail(html)             # 改邮件逻辑只改这一处

    def fetch(self, db):
        raise NotImplementedError
    def summarize(self, rows):
        return sum(r.amount for r in rows)   # 默认实现，子类可覆盖
    def title(self):
        raise NotImplementedError

class DailyReport(Report):
    def fetch(self, db):
        return db.query("select * from sales where day = today")
    def title(self):
        return "<h1>日报</h1>"

class WeeklyReport(Report):
    def fetch(self, db):
        return db.query("select * from sales where week = this_week")
    def summarize(self, rows):
        return super().summarize(rows) / 7
    def title(self):
        return "<h1>周报</h1>"`,
      tip: '流程骨架相同、个别步骤不同 → 模板方法（父类定骨架，子类填空）',
    },

    {
      id: 'state-order-status',
      title: '订单状态流转全靠 if status == ...，改一处崩一片',
      problem: '订单有：待支付、已支付、已发货、已完成、已取消。每个动作（支付、发货、取消、确认收货）都要先判断当前状态能不能做。现在每个方法里一堆 if status == "paid" and ...。上周产品加了个"已退款"状态，我改了四个方法，漏了一个，用户能对已退款订单发货。',
      smell: '同一个对象的行为随"状态"变化，每个方法里都重复判断状态，加状态要改所有方法。',
      options: ['策略', '状态', '责任链', '命令'],
      answer: 1,
      why: '每个状态变成一个类，里面写清楚"在这个状态下，支付/发货/取消分别怎么办"。订单只需要把动作转发给当前状态对象。加新状态就加一个类，不用翻遍所有方法。',
      whyNot: ['策略和状态代码长得几乎一样。区别：策略是外面选一个用，用完不变；状态是对象自己在动作里切换到下一个状态。这里是自动流转，用状态', '就是它', '责任链是"沿链找处理者"，不是"随状态变行为"', '命令是"操作打包"，不解决状态判断分散的问题'],
      lang: 'python',
      before: `class Order:
    def __init__(self):
        self.status = "pending"

    def pay(self):
        if self.status == "pending":
            self.status = "paid"
        else:
            raise Exception("当前状态不能支付")

    def ship(self):
        # 问题：加"已退款"状态时，这里忘了排除，退款订单也能发货
        if self.status == "paid":
            self.status = "shipped"
        else:
            raise Exception("当前状态不能发货")

    def cancel(self):
        if self.status in ("pending", "paid"):
            self.status = "cancelled"
        else:
            raise Exception("当前状态不能取消")`,
      after: `class State:
    def pay(self, order):    raise Exception("当前状态不能支付")
    def ship(self, order):   raise Exception("当前状态不能发货")
    def cancel(self, order): raise Exception("当前状态不能取消")

class Pending(State):
    def pay(self, order):    order.state = Paid()
    def cancel(self, order): order.state = Cancelled()

class Paid(State):
    def ship(self, order):   order.state = Shipped()
    def cancel(self, order): order.state = Cancelled()

class Shipped(State): pass          # 啥都不能做，全走父类报错
class Cancelled(State): pass
class Refunded(State): pass         # 新状态：加一个类，默认啥都不能做，安全

class Order:
    def __init__(self):
        self.state = Pending()
    # 订单只转发，不判断
    def pay(self):    self.state.pay(self)
    def ship(self):   self.state.ship(self)
    def cancel(self): self.state.cancel(self)`,
      tip: '行为随状态变、方法里到处判断状态 → 状态模式（每个状态一个类，自己决定下一步）',
    },

    {
      id: 'builder-http-request',
      title: '一个构造函数十几个参数，调用时全是 None, None, True, None',
      problem: '我们封装了一个 HttpRequest 类，构造函数有 url、method、headers、params、body、timeout、retries、verify_ssl、proxy、auth……调用的时候写成 HttpRequest(url, "GET", None, None, None, 30, 3, True, None, None)，没人看得懂第六个参数是啥。有人把 timeout 和 retries 写反了，线上重试了 30 次。',
      smell: '构造对象要传一大堆参数，大部分是可选的，位置容易错，可读性极差。',
      options: ['工厂方法', '建造者', '原型', '单例'],
      answer: 1,
      why: '一步一步地设置，每一步都有名字，最后 build() 出对象。读起来像说话：先设 url，再设超时，再设重试。Python 里关键字参数 + 默认值也能解决大半，建造者适合"步骤有顺序/有校验"的复杂情况。',
      whyNot: ['工厂方法是"把创建收到一处"，不解决参数太多的问题', '就是它', '原型是"复制一个已有对象"，和参数多没关系', '单例是"只有一个"，跟参数多完全无关'],
      lang: 'python',
      before: `class HttpRequest:
    def __init__(self, url, method, headers, params, body,
                 timeout, retries, verify_ssl, proxy, auth):
        self.url = url
        self.method = method
        self.timeout = timeout
        self.retries = retries
        # ... 其他字段

# 问题：第六个是 timeout 还是 retries？下面这行写反了
req = HttpRequest("https://api.x.com", "GET", None, None, None,
                  3, 30, True, None, None)`,
      after: `class HttpRequest:
    def __init__(self):
        self.url = None
        self.method = "GET"
        self.timeout = 30
        self.retries = 0
        self.headers = {}

class RequestBuilder:
    def __init__(self, url):
        self._r = HttpRequest()
        self._r.url = url

    def method(self, m):        self._r.method = m;  return self
    def timeout(self, sec):     self._r.timeout = sec; return self
    def retries(self, n):       self._r.retries = n; return self
    def header(self, k, v):     self._r.headers[k] = v; return self

    def build(self):
        if self._r.retries > 10:            # 校验放在最后一步
            raise ValueError("重试太多次")
        return self._r

# 每一步都有名字，读起来像说话
req = (RequestBuilder("https://api.x.com")
       .method("GET")
       .timeout(30)
       .retries(3)
       .header("Token", "abc")
       .build())

# 简单情况下，Python 的关键字参数就够了：
# HttpRequest(url="...", timeout=30, retries=3)`,
      tip: '构造参数一大堆、可选的多、容易传错位 → 建造者（链式一步步设，最后 build）',
    },

    {
      id: 'chain-approval-flow',
      title: '报销审批：金额不同要不同级别的人审，规则老变',
      problem: '公司报销：500 以下组长批，5000 以下部门经理批，50000 以下总监批，再高要 CEO。代码里写了一大串 if amount < 500 ... elif ... 。上个月财务说"经理出差期间跳过经理直接给总监"，我又得改这堆 if。而且以后还要加"合规审查"这一环。',
      smell: '一个请求要经过多个处理者，谁处理取决于条件；处理者的顺序和数量老变。',
      options: ['责任链', '状态', '策略', '装饰器'],
      answer: 0,
      why: '每个审批人是链上一环。请求从头传，每一环自己判断"我能处理吗，能就处理，不能就丢给下一个"。加环、删环、换顺序都只动链的组装，不动每一环的代码。',
      whyNot: ['就是它', '状态是"对象自己随状态变行为"，这里是请求在多人之间传', '策略是"选一个算法用"，这里不是选一个，是顺着传直到有人接', '装饰器是"叠功能"，每层都执行；责任链是"找到能处理的就停"'],
      lang: 'python',
      before: `def approve(amount):
    # 问题：规则一变就改这里；加一环也改这里；跳过某人还是改这里
    if amount < 500:
        print("组长批准")
    elif amount < 5000:
        print("经理批准")
    elif amount < 50000:
        print("总监批准")
    else:
        print("CEO批准")`,
      after: `class Approver:
    def __init__(self, name, limit):
        self.name, self.limit = name, limit
        self.next = None

    def then(self, nxt):          # 把下一环接上
        self.next = nxt
        return nxt

    def handle(self, amount):
        if amount < self.limit:   # 我能处理就处理
            print(f"{self.name}批准")
        elif self.next:           # 不能就丢给下一个
            self.next.handle(amount)
        else:
            print("没人能批")

# 组装链：顺序、跳过谁、加谁，都只动这几行
leader = Approver("组长", 500)
manager = Approver("经理", 5000)
director = Approver("总监", 50000)
ceo = Approver("CEO", float("inf"))

leader.then(manager).then(director).then(ceo)
leader.handle(8000)          # 总监批准

# 经理出差：跳过他，只改一行
leader.then(director).then(ceo)`,
      tip: '请求沿着一串处理者传，谁能接谁接 → 责任链（每环只管自己和下一环）',
    },

    {
      id: 'facade-video-export',
      title: '调用方要导出一个视频，得先调七个底层模块',
      problem: '我们有一套视频处理库：解码器、滤镜、字幕、音频混合、编码器、封装器。外部同事想"把 a.mp4 加个水印导出"，我给他写了个示例，要调七个类、传二十个参数、按特定顺序初始化。他说看不懂，我也觉得每次自己写都容易漏一步。',
      smell: '完成一件常见的事要调用一堆底层模块，调用方被迫了解内部细节。',
      options: ['适配器', '外观', '中介者', '代理'],
      answer: 1,
      why: '写一个简单的入口类，把最常用的几件事包成一个方法：export(src, dst, watermark)。内部帮你按正确顺序调那七个模块。调用方只看到一个门面，需要精细控制时仍然可以绕过门面直接用底层。',
      whyNot: ['适配器是"接口不兼容做转换"，这里接口没问题，是太复杂', '就是它', '中介者是"多个对象互相通信，中间加协调人"，这里底层模块并不互相通信', '代理是"控制对单个对象的访问"，这里是包一组对象'],
      lang: 'python',
      before: `# 调用方要写的代码（问题：太多步骤，顺序还不能错）
decoder = Decoder("a.mp4")
frames = decoder.read_all()
filt = Filter()
filt.add_watermark("logo.png", pos=(10, 10))
frames = filt.apply(frames)
audio = AudioMixer().extract(decoder)
encoder = Encoder(codec="h264", bitrate=4000)
stream = encoder.encode(frames)
Muxer().mux(stream, audio, "b.mp4")`,
      after: `class VideoFacade:
    """把最常用的操作包成一个门面"""

    def export(self, src, dst, watermark=None):
        decoder = Decoder(src)
        frames = decoder.read_all()
        if watermark:
            filt = Filter()
            filt.add_watermark(watermark, pos=(10, 10))
            frames = filt.apply(frames)
        audio = AudioMixer().extract(decoder)
        stream = Encoder(codec="h264", bitrate=4000).encode(frames)
        Muxer().mux(stream, audio, dst)

# 调用方只需要一行
VideoFacade().export("a.mp4", "b.mp4", watermark="logo.png")

# 需要精细控制的人，仍然可以直接用 Decoder / Encoder`,
      tip: '干一件常见的事要调一堆底层模块 → 外观（包一个简单入口）',
    },

    {
      id: 'proxy-lazy-permission',
      title: '大对象加载太慢，还想在访问前检查权限',
      problem: '我们的报表对象一创建就从数据库拉全量数据，要三秒。但很多时候用户只是打开列表看看名字，根本不点进去。另外，有些报表是敏感的，要检查权限才能看数据。现在权限检查散落在每个调用报表的地方。',
      smell: '访问一个对象前需要"拦一下"（延迟加载、权限、缓存、日志），但这些控制散落在调用方。',
      options: ['装饰器', '代理', '外观', '适配器'],
      answer: 1,
      why: '写一个"替身"对象，接口和真对象一模一样。调用方拿到的是替身。替身在真正需要时才创建真对象（延迟加载），访问前顺便检查权限。调用方完全不知道自己拿的是替身。',
      whyNot: ['装饰器和代理代码很像。区别：装饰器是"给它加功能"，可以叠很多层，调用方知道自己在叠；代理是"控制能不能访问它、什么时候访问它"，调用方不知道有替身。延迟加载 + 权限，是代理的典型场景', '就是它', '外观是"包一组复杂对象"，不是替身', '适配器是"接口转换"，这里接口一模一样'],
      lang: 'python',
      before: `class Report:
    def __init__(self, rid):
        print("从数据库拉全量数据……3 秒")   # 问题：一创建就慢
        self.data = db.load_report(rid)

    def show(self):
        print(self.data)

# 列表页：创建 100 个报表对象只为了显示名字，卡 300 秒
reports = [Report(i) for i in range(100)]

# 详情页：权限检查散落在各处
if user.can_view(rid):
    Report(rid).show()`,
      after: `class Report:
    def __init__(self, rid):
        print("从数据库拉全量数据……3 秒")
        self.data = db.load_report(rid)
    def show(self):
        print(self.data)

class ReportProxy:
    """替身：接口和 Report 一样，但真对象用到时才创建"""
    def __init__(self, rid, user):
        self.rid, self.user = rid, user
        self._real = None                 # 先不创建

    def show(self):
        if not self.user.can_view(self.rid):   # 访问前先拦一下
            raise PermissionError("无权查看")
        if self._real is None:                 # 真正要用了才创建
            self._real = Report(self.rid)
        self._real.show()

# 列表页：创建 100 个替身，零成本
reports = [ReportProxy(i, user) for i in range(100)]
# 只有点进去的那个才真正加载 + 检查权限
reports[3].show()`,
      tip: '访问对象前要拦一下（延迟加载/权限/缓存） → 代理（给它找个替身）',
    },

    {
      id: 'composite-ui-tree',
      title: '菜单里有菜单，计算总价时要区分"单品"和"套餐"',
      problem: '我们做点餐系统。菜单项可以是单品（可乐 5 块），也可以是套餐（汉堡 + 薯条 + 可乐），套餐里还能嵌套小套餐。算总价的时候，我得写递归，还要到处判断 isinstance(item, Combo)。前端渲染菜单树也是同样的一堆判断。',
      smell: '数据是树形的（部分-整体），处理时到处判断"这是叶子还是容器"。',
      options: ['装饰器', '组合', '迭代器', '建造者'],
      answer: 1,
      why: '让"单品"和"套餐"长得一样（都有 price() 方法）。套餐的 price() 就是把孩子们的 price() 加起来。调用方对着任何一个节点调 price()，不用关心它是叶子还是容器。',
      whyNot: ['装饰器是"一层套一层"，是线性的；这里是树，一个容器有多个孩子', '就是它', '迭代器只解决"怎么遍历"，不解决"叶子和容器要统一对待"', '建造者是"分步造对象"，跟树形结构无关'],
      lang: 'python',
      before: `class Item:
    def __init__(self, name, price):
        self.name, self.price = name, price

class Combo:
    def __init__(self, name, children):
        self.name, self.children = name, children

def total(thing):
    # 问题：每个用到菜单的地方都要写这种判断
    if isinstance(thing, Combo):
        return sum(total(c) for c in thing.children)
    else:
        return thing.price

def render(thing, depth=0):
    print("  " * depth + thing.name)
    if isinstance(thing, Combo):        # 又判断一遍
        for c in thing.children:
            render(c, depth + 1)`,
      after: `class Item:
    def __init__(self, name, price):
        self.name, self._price = name, price
    def price(self):
        return self._price
    def render(self, depth=0):
        print("  " * depth + self.name)

class Combo:
    def __init__(self, name, children):
        self.name, self.children = name, children
    def price(self):                    # 和 Item 长得一样
        return sum(c.price() for c in self.children)
    def render(self, depth=0):
        print("  " * depth + self.name)
        for c in self.children:
            c.render(depth + 1)         # 不用判断 c 是啥

# 调用方对任何节点都一视同仁
menu = Combo("全家桶", [
    Item("可乐", 5),
    Combo("汉堡套餐", [Item("汉堡", 20), Item("薯条", 8)]),
])
print(menu.price())     # 33
menu.render()`,
      tip: '树形结构、到处判断叶子还是容器 → 组合（让叶子和容器长得一样）',
    },

    {
      id: 'restraint-dict-mapping',
      title: '一个"状态码 → 中文提示"的小需求，同事建议上策略模式',
      problem: '接口返回状态码 0/1/2/3，我要显示对应的中文："成功""参数错误""无权限""服务器错误"。就这四个，以后可能加一两个。同事说"这不就是 if/else 按类型分支吗，上策略模式，每个状态一个类"。我写完发现四个类五个文件，就为了显示四行字。',
      smell: '真正的坏味道不在原代码，而在"过度设计"：为一个查表就能解决的事，引入了类层次。',
      options: ['策略', '不用模式，用字典映射', '工厂方法', '状态'],
      answer: 1,
      why: '策略模式解决的是"每个分支有不同的逻辑"。这里每个分支只是返回一个字符串，没有逻辑，一个字典就是最好的"策略"。模式是为了降低复杂度，如果用了模式反而更复杂，就是用错了。',
      whyNot: ['策略模式适合"分支里有不同算法"。这里分支里只有一个字符串，四个类是杀鸡用牛刀，以后别人读代码要跳五个文件', '就是它', '工厂方法解决"创建分散"，这里根本不需要创建对象', '状态模式解决"对象自己随状态变行为"，这里没有对象，只是查个表'],
      lang: 'python',
      before: `# 同事的"策略模式"版：4 个类 + 1 个工厂，就为了显示四行字
class SuccessMsg:
    def text(self): return "成功"

class ParamErrorMsg:
    def text(self): return "参数错误"

class NoPermMsg:
    def text(self): return "无权限"

class ServerErrorMsg:
    def text(self): return "服务器错误"

def create_msg(code):
    if code == 0: return SuccessMsg()
    if code == 1: return ParamErrorMsg()
    if code == 2: return NoPermMsg()
    if code == 3: return ServerErrorMsg()

print(create_msg(2).text())
# 问题：过度设计。读代码的人要跳五个地方才知道 2 是"无权限"`,
      after: `# 一个字典就够了
MESSAGES = {
    0: "成功",
    1: "参数错误",
    2: "无权限",
    3: "服务器错误",
}

print(MESSAGES.get(2, "未知错误"))

# 什么时候才该升级成策略？
# 当"分支里有逻辑"的时候。比如每种错误要走不同的上报流程，
# 那时候字典的值可以先换成函数：
# HANDLERS = {0: handle_ok, 1: handle_param_error, ...}
# 函数还不够复杂时，仍然不需要类`,
      tip: '分支里只有数据没有逻辑 → 字典查表就够；先用最简单的，复杂了再升级',
    },
  ],
};
