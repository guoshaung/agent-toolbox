# T023 私有离线资源说明

此目录随功能提交，运行时不执行 npm、不下载资源、不调用全局 tesseract 或任意命令。源项目 package.json / package-lock.json 没有改变。npm 包初次获取使用固定顶层版本、registry.npmjs.org 和 --ignore-scripts；实际传递版本与 registry SHA-512 记录在 manifest.json。所有随附文件的原始字节 SHA-256 与大小也在该清单；host 在进程首次使用前逐份核验，失败只提示恢复原版本，不联网补齐。清单是复现/意外损坏检查，不是外部可信签名。

- Tesseract.js 6.0.1 / tesseract.js-core 6.0.0：Apache-2.0，原 LICENSE 保留。私有 runtime/node_modules 保留成熟上游代码与依赖，不改其实现。Node 路径包含全部四种原始 JS + WASM 核心（v6.0.1 Node 的选择器可能选完整核心）；使用 OEM=1 和 tessdata_fast LSTM 模型。未带浏览器嵌入式 *.wasm.js 或无关完整 core 包文件。原项目入口/许可证/README 均在私有目录。此功能自己的识别线程禁用 fetch 并设置绝对本地 langPath、gzip=false、cacheMethod=none。
- pdf-lib 1.17.1：MIT，dist/pdf-lib.min.js 原字节改名 pdf-lib.cjs，使用自包含 UMD，不执行项目安装。原 LICENSE.md、其包内 pako/UPNG/standard-fonts 的许可文本保留。
- @pdf-lib/fontkit 1.1.1：MIT，dist/fontkit.umd.min.js 原字节改名 fontkit.cjs；保留 npm package.json 和 README 声明。上游 npm 分发及源仓库未附 LICENSE 文件，fontkit-LICENSE.txt 是依其 MIT 声明补充的标准许可及作者元数据归属，文件明确说明该情况，不冒称原包已有的许可证文件。
- eng.traineddata / chi_sim.traineddata：tesseract-ocr/tessdata_fast 固定提交 87416418657359cb625c412a48b6e1d6d41c29bd；Apache-2.0，models/LICENSE 原文件。
- NotoSansCJKsc-Regular.otf：notofonts/noto-cjk Sans2.004，固定提交 523d033d6cb47f4a80c58a35753646f5c3608a78；SIL OFL 1.1，font/LICENSE 原文件。字体原文件不改；PDF 仅嵌入使用字符的子集。

完整源 URL、版本、integrity、每文件 SHA 与字节数见 manifest.json。清单里的 packages 是获取锁中所有包（包括未作为运行时独立模块分发的 UMD 内嵌/安装元数据项）；files 才是实际随附文件的完整清单。恢复安装：从同一功能提交还原 vendor 目录（含被顶层 .gitignore 忽略的 models/node_modules），运行专项 tests 或打开功能做 status 检查。不要以其他语言模型或版本静默替换文件。缺资源时功能明确失败，没有要求用户编写适配器。
