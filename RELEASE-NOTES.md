# 本地改动版

版本：0.44.0-personal.1

包含当前主线基础、本地 Windows 窗口切换/OpenFARS、WorkBuddy 的本地工具改动，以及写轮眼启动动画和Q版字体。游戏控制仍是原始 PoC，不能视为鸣潮验收通过。

Windows包解压后运行 Agent Toolbox personal.exe。配置目录为 %APPDATA%/agent-toolbox-personal，与正式版及其它版本分别保存。

设置 → 启动皮肤与文字风格：可预览或关闭动画，选择Q版标题、全界面Q版、手写风或原样。代码与日志保留等宽字体。字体资源随包提供，来源 https://github.com/googlefonts/zcool-kuaile ，许可见 assets/fonts/OFL-ZCOOLKuaiLe.txt。

测试：534项：524通过，10跳过。

FFmpeg相关功能需要本机FFmpeg6.x。Python游戏实验需要Python3.10+及game-agent/requirements.txt中的依赖；没有将个人虚拟环境或游戏账号打包。
