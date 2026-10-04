# 游戏控制 Agent —— 视觉闭环 PoC（第一阶段）

一句话：**截图 → 检测目标 → 算 error → 判左右 → 敲 A/D → 再截图。**
这一版只验证一件事：视觉反馈能不能把目标稳定拉回屏幕中心。

明确不做的：LLM、OCR、自动任务、自动对话、寻路、地图识别、战斗识别、反作弊绕过。

工具箱左侧「游戏」页就是这个目录的驾驶舱；也可以完全脱离工具箱，直接用命令行跑。

## 跑起来

```bash
# 第一次
uv sync            # 或者 pip install -r requirements.txt

# 方式一：无头闭环仿真（推荐先跑这个，不碰键盘，秒级出结果）
uv run main.py --source sim --no-window --max-frames 120 --dump-dir work/sim

# 方式二：真实屏幕 + 真实测试窗口（会真的发键！）
uv run python test_target_window.py      # 窗口 A：黑底 + 随机漂移的红点
uv run main.py --source screen \
  --window-title AgentToolboxTestTarget \
  --focus-title AgentToolboxTestTarget \
  --backend pyautogui                     # 窗口 B：agent

# 方式三：先空跑（绝不发键），只看检测和判断对不对
uv run main.py --source screen --window-title AgentToolboxTestTarget --backend null
```

## 热键

| 键 | 作用 |
|---|---|
| F8 | 开始 / 暂停自动控制（全局热键，游戏全屏在前台也有效） |
| ESC | 立即退出程序并释放所有按键 |

## 为什么这样能跑通

真实调试时你分不清「检测错了」还是「控制错了」。这个 PoC 用两个手段把变量钉死：

1. **无头仿真给出 ground truth**。`sim_game.py` 里虚拟游戏自己知道目标在哪个像素，
   日志里的 `true_x` 就是它。`target_x`（检测值）和 `true_x` 逐帧对得上，就证明检测环节没问题；
   剩下的收敛问题就只能在控制环节找。
2. **相机语义和真游戏一致**。向右转（D）→ 世界里固定的目标在画面上向左移动。
   仿真里的 `yaw` 就是这么定义的，所以控制回路是真闭环，不是摆样子。

## 闭环结构

```
ScreenCapture (mss)          TargetDetector          decide() / plan_action()
  screen │ sim        →        color │ template       →    LEFT / RIGHT / CENTERED
      ↑                                                              │
      │                        InputController  ←────────────────────┘
      └────────────────────   pulse() A/D 50~150ms
```

## 文件

| 文件 | 干什么 |
|---|---|
| `main.py` | 主循环 + 热键 + 日志 + 四层安全兜底。只有装配和调度，没有算法 |
| `config.py` | 所有可调参数的唯一来源，默认值零配置可跑 |
| `screen_capture.py` | mss 截屏；可按窗口标题截、可按区域截；定义 `Frame` |
| `target_detector.py` | 颜色团块 / 点击锁色 / 模板匹配三种方案；定义 `Target` |
| `controller.py` | 脉冲式按键；pyautogui / SendInput / 空跑三种后端；定义 `Decision` `Action` |
| `visualizer.py` | 中心线、阈值带、目标框、箭头、HUD、误差历史曲线 |
| `sim_game.py` | 无头「虚拟游戏」，闭环可验证、可复现（seed 固定） |
| `test_target_window.py` | 真实测试窗口，上真机前的彩排 |
| `test_real_screen.py` | **真机端到端回归**：起测试窗 → 跑真实 mss 链路 → 校验指标，一条命令跑完 |
| `test_open_world.py` | **开放世界压力测试**：2560x1440 + 8 个同色干扰物 + 周期性遮挡 |
| `bench.py` | 逐阶段微基准（抓屏 / 各颜色变换 / 形态学 / matchTemplate / imencode） |
| `bench_draw.py` | 可视化绘制拆分基准，同进程 legacy/new 交替 A/B |
| `bench_ab.py` | **逐项累积的性能 A/B**（每档只多开一个开关），带预热 + 归一化 |

## 开放世界怎么处理（这一版的重点）

真实的开放世界画面里，同色的东西到处都是（血条、粒子、队友标记、UI 红点），
而且目标会被树、石头、别的角色挡住。逐帧独立地在整屏找「最像的那个」必然乱跳 ——
实测在 8 个同色干扰物的场景下，误差均值 212px、跳变 181 次。

现在的做法是**把它当成跟踪问题而不是逐帧检测问题**：

| 机制 | 参数 | 作用 |
|---|---|---|
| 搜索窗 | `--track-pad-px 200` `--track-pad-ratio 0.18` | 锁定后只在目标周围搜，干扰物基本被排除在窗外 |
| 降采样检测 | `--detect-max-side 960` | 检测链开销降 4.7 倍，坐标双向映射回去 |
| 丢帧保持 | `--lost-hold 5` | 目标被挡住的那几帧沿用预测位置，不急着回全屏重找 |
| 重现门 | （内置） | 保持期内离保持位置太远的候选一律不认，防止被别的干扰物抢走 |
| 位置平滑 | `--smooth 0.55` | 位置 EMA，抑制单帧抖动 |
| 跳变保护 | `--max-jump 400` | 单帧位移超过它直接判为丢失。**这一条实测单项就能把 181 次跳变降到 0** |
| 形状过滤 | `--aspect-max 4.0` `--fill-min 0.35` | 长条 / 太稀疏的团块不是目标 |
| NMS 去重 | `--nms-iou 0.35` | 同一个目标被拆成多块时合并 |

效果（`test_open_world.py`）：误差均值 212px → **2px**，跳变 181 次 → **0 次**。

## 性能

`--fast` 是最值钱的一键开关，它在 2560x1440 全屏上打开四个东西：
跟踪窗口截图（只截目标周围一块）+ 检测降采样 960 + jpg 落盘 + 锁定后按 ROI 截图。

逐项累积实测（`bench_ab.py`，归一化整帧 p50，越小越好）：

| 档位 | 整帧 | 相对① |
|---|---|---|
| ① 全旧行为（全分辨率检测 + 不跟踪 + PNG） | 49.0 ms | 1.00x |
| ② +检测降采样 1280 | 32.8 ms | 1.51x |
| ③ +检测侧跟踪窗 | 28.7 ms | 1.71x |
| ④ +JPG 落盘 | 28.5 ms | 1.72x |
| ⑤ **+截图 ROI（= `--fast`）** | **11.4 ms** | **4.30x** |

> ⚠️ 关于基准的可信度：这台机器在持续负载约 2.5 秒后会从 boost 降频，
> 同一段 memcpy 从 0.047ms 掉到 0.080ms。**任何「短跑一次就下结论」的数字都不可信** ——
> 所以 `bench_ab.py` / `bench_draw.py` 每个档位前都会先烧 CPU 越过降频窗口，
> 并用固定参考负载做归一化。上面的表就是这么测的。

另外两个真实的性能坑（都已修）：

* **`settle_ms` 曾经是阻塞 sleep**，叠在脉冲保持时长后面。脉冲帧因此要
  按住 53ms + 干等 60ms + 截屏检测 ≈ 129ms，而 60fps 的帧预算只有 16.7ms —— 等于掉 7 帧。
  现在改成了**非阻塞冷却期**：冷却期间照常截屏、检测、画图，只是不再按键。
  帧率 38.4 → **52.0 fps**，最慢帧 386ms → 73.5ms。
  用 `--debug-blocking-settle` 可以切回旧行为（负对照，验证测试判据还有没有牙）。
* **`--no-window` 时白画 HUD**：画好的图直接被丢掉，白烧约 7ms/帧。
  现在只在「真的要给人看」（开窗 / 到点落盘）时才渲染。

## 自检与基准

```bash
# 真机端到端（一条命令跑完：起窗口 → 跑链路 → 校验指标）
python test_real_screen.py --frames 600 --fps 60
python test_real_screen.py --live --frames 600      # 真实按键闭环，验证收敛

# 开放世界压力测试（合成画面，不需要窗口）
python test_open_world.py

# 性能
python bench_ab.py --frames 300 --rounds 2
python bench_draw.py
```

`test_real_screen.py` 把「开测试窗 → 等窗口就绪 → 跑 agent → 收尾」放在**同一个进程**里。
手工开两个终端在自动化环境里是不可靠的 —— 两条命令之间窗口可能被回收或最小化，
agent 就报「找不到窗口」退出。它还会全程盯着窗口矩形，一旦发现被最小化立刻报出来。

## 参数速查（最常用的几个）

```bash
--threshold 50           # 中心判定阈值 px
--preset red             # 目标颜色：red/yellow/green/blue/magenta/white
--backend sendinput      # pyautogui 收不到时换这个（走扫描码）
--window-title 鸣潮       # 只截这个窗口
--focus-title 鸣潮        # 只有它在前台才发键（保险丝，强烈建议加）
--fast                   # 性能预设：跟踪 + 检测 960 + 截图 ROI + jpg（推荐）
--capture-roi            # 只开「截图也只截目标周围」这一项
--no-track               # 关掉跟踪，退回逐帧全画面找（对比 / 排错用）
--pulse-mode proportional # 误差越大按越久；fixed 则固定时长
--fps 8                  # 目标帧率
--log-format line        # 每帧一行（默认 block 多行块）
--events json            # 每帧输出一行 JSON 给父进程（工具箱就是这么读的）
--no-window              # 不弹预览窗（配游戏用时开这个，免得挡画面）
```

合并命令行参数时，**后面的覆盖前面的**；`--fast` 只填那些你没显式指定的项，
所以 `--fast --detect-max-side 0` 是可以的（只关掉降采样，其它照开）。

## 四层安全兜底

任何一层生效都不会让 A/D 卡在按下状态：

1. `controller.pulse()` 用 try/finally 包住，异常也松键
2. 主循环 try/finally 里 `release_all()`
3. `atexit` + `signal` 处理器里再 `release_all()`（幂等）
4. 进程启动时先 `release_all()` 一次，清掉上一次崩溃残留的按下状态

另外还有两道主动保险：

* **焦点守卫**：`--focus-title` 设了之后，前台窗口标题对不上就**不发键**（默认 block）。
  宁可不动，也不要把 A/D 打进浏览器或聊天框。
* **stdin 哨兵**：作为子进程运行时，父进程退出会立刻触发收尾，不会变成
  「还在往游戏里敲键」的孤儿进程。

## 三个踩过的坑（写下来免得再踩）

1. **一次脉冲的位移必须小于阈值**，否则控制回路会在阈值带两侧来回跳、永远停不下来。
   `turn_speed × min_pulse_ms / 1000` 换算成像素要小于 `threshold_px`。
   默认 60 deg/s × 50ms ≈ 42px < 50px，刚好收得住。
2. **真值必须在截图那一刻取**。放到按键之后取，你比对的就是两个不同时刻的画面，
   会误判成「检测不准」。
3. **随机游走的目标必须加边界反弹**，不然跑久了必然漂出画面，测试就失去意义。

## 常见问题

**游戏收不到 pyautogui 的键？** 换 `--backend sendinput`。部分游戏走 DirectInput /
Raw Input，只认扫描码。这不是驱动级注入，是 Windows 自带的标准输入 API。

**目标颜色会随光照变？** 方案 A：在预览窗口上点一下目标，程序重新锁定那块颜色
（`lock_color`）。或者干脆用模板匹配 `--mode template --template 目标图标.png`。

**HUD 上的中文变成问号？** 刻意的。不同版本 OpenCV 对 `cv2.putText` 的 CJK 支持不一致，
屏幕上的文字一律用 ASCII，中文只出现在日志和这份文档里。

## 下一阶段（还没做）

* 目标点自动识别（现在靠颜色 / 模板，靠人告诉它该追什么）
* 上下方向（W/S）闭环
* 平滑转向（连续按住而不是脉冲）
* 多目标选择与丢失重捕获策略
