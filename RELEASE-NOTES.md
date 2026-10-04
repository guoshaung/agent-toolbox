# 兼容与检测修复版

版本：0.44.0-fixes.1

包含同学200项功能与本地改动，并修复 T020 普通目录的8.3短路径误拒绝、预测帧虚假检出统计、纯色模板虚假高分、中文模板路径和游戏事件计数及 Git Bash 的 /dev/stdin 不兼容。增加特征匹配及真实标注回放评估。真实游戏固定为只读截图观察；红点仿真不证明鸣潮控制有效。

Windows包解压后运行 Agent Toolbox fixes.exe。配置目录为 %APPDATA%/agent-toolbox-fixes，与正式版及其它版本分别保存。

设置 → 启动皮肤与文字风格：可预览或关闭动画，选择Q版标题、全界面Q版、手写风或原样。代码与日志保留等宽字体。字体资源随包提供，来源 https://github.com/googlefonts/zcool-kuaile ，许可见 assets/fonts/OFL-ZCOOLKuaiLe.txt。

测试：4110项：4100通过，10跳过；检测回归10项通过；真实子进程120帧计数与汇总验证通过。鸣潮实机仍未验收。

FFmpeg相关功能需要本机FFmpeg6.x。Python游戏实验需要Python3.10+及game-agent/requirements.txt中的依赖；没有将个人虚拟环境或游戏账号打包。
