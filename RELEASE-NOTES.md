# 同学新增功能版

版本：0.44.0-classmate.1

包含同学的 L001–L060、T001–T100、E001–E040，共200项功能。保留同学原始逻辑；其 Windows 短路径问题在修复版处理。

Windows包解压后运行 Agent Toolbox classmate.exe。配置目录为 %APPDATA%/agent-toolbox-classmate，与正式版及其它版本分别保存。


测试：4103项：4088通过，15跳过（规范化TEMP环境）。

FFmpeg相关功能需要本机FFmpeg6.x。Python游戏实验需要Python3.10+及game-agent/requirements.txt中的依赖；没有将个人虚拟环境或游戏账号打包。
