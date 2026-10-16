# T034 私有离线 OCR 资源

独立随本功能提供成熟 Tesseract.js 6.0.1 / core6.0.0、实际运行依赖与 eng/chi_sim 模型，不引用其他功能路径，不修改顶层 package/lock。初次获取使用 registry.npmjs.org 固定版本和 --ignore-scripts；源 URL、传递依赖固定版本、SHA-512 integrity、许可证和所有随附文件大小/SHA-256均在manifest.json。代码与许可保留原始字节，.gitattributes禁止换行归一化。

Node运行采用OEM1、PSM6和识别矩形，本地langPath、gzip=false、cacheMethod=none，自己的OCR线程fetch明确禁止网络。原核心四种JS+WASM全部随附以适配6.0.1 Node上游选择器，未改第三方代码；未使用的浏览器 *.wasm.js 核心不分发。普通私有node_modules包及许可证保留；安装脚本不会执行。源截图只在内存中完整核验，识别不写来源或OCR缓存/临时图片。

Tesseract.js / core及模型Apache-2.0；实际依赖各自原LICENSE保留（MIT/Apache-2.0等见manifest及包元数据）。英/简中模型来自tesseract-ocr/tessdata_fast固定提交87416418657359cb625c412a48b6e1d6d41c29bd；models/LICENSE原字节保留。资源缺失/哈希不符时从同一功能提交完整还原vendor即可；功能不会联网下载或要求用户写适配器。manifest用于复现/损坏检查，不是外部可信签名。
