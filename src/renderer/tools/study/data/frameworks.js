const code = (...lines) => lines.join('\n');

export const FRAMEWORK_TRACKS = [
  {
    id: 'uv', name: 'uv 环境管理', icon: '🧰', level: '环境基础', runtime: 'uv', framework: true, packageKey: 'uv', packageLabel: 'uv',
    description: '用 uv 查看版本、创建 .venv、安装依赖并运行 Python；命令会在临时练习目录中执行。',
    samples: [
      { title: '查看 uv 版本', level: '入门', code: 'uv --version' },
      { title: '创建虚拟环境', level: '基础', code: 'uv venv .venv\nls -la .venv' },
      { title: '安装并运行 requests', level: '进阶', code: 'uv venv .venv\nuv pip install --python .venv/bin/python requests\n.venv/bin/python -c "import requests; print(requests.__version__)"' },
    ],
  },
  {
    id: 'langchain', name: 'LangChain', icon: '🔗', level: '框架入门 → Agent', runtime: 'python3 + langchain', framework: true, packageKey: 'langchain', packageLabel: 'LangChain',
    description: '从 PromptTemplate、Runnable 到工具调用和 Agent；先掌握链式组合，再接模型和记忆。',
    samples: [
      { title: 'PromptTemplate 与 Runnable', level: '入门', code: code('from langchain_core.prompts import ChatPromptTemplate', 'from langchain_core.runnables import RunnableLambda', '', 'prompt = ChatPromptTemplate.from_template("用一句话解释：{topic}")', 'chain = prompt | RunnableLambda(lambda message: message.messages[0].content.upper())', 'print(chain.invoke({"topic": "Runnable"}))') },
      { title: '结构化工具输入', level: '基础', code: code('from langchain_core.tools import StructuredTool', '', 'def add_numbers(first: int, second: int) -> int:', '    return first + second', '', 'add_tool = StructuredTool.from_function(add_numbers)', 'print(add_tool.name)', 'print(add_tool.invoke({"first": 2, "second": 3}))') },
      { title: 'Runnable 分支', level: '进阶', code: code('from langchain_core.runnables import RunnableBranch, RunnableLambda', '', 'route = RunnableBranch(', '    (lambda value: value > 10, RunnableLambda(lambda value: "large")),', '    RunnableLambda(lambda value: "small"),', ')', 'print(route.invoke(8))', 'print(route.invoke(12))') },
    ],
  },
  {
    id: 'pytorch', name: 'PyTorch', icon: '🔥', level: '张量 → 训练', runtime: 'python3 + torch', framework: true, packageKey: 'torch', packageLabel: 'PyTorch',
    description: '张量、自动求导、模块和训练循环；先让每一步都有输出，再逐步接入数据集与 GPU。',
    samples: [
      { title: '张量与广播', level: '入门', code: code('import torch', '', 'features = torch.tensor([[1.0, 2.0], [3.0, 4.0]])', 'bias = torch.tensor([0.5, 1.0])', 'print(features + bias)', 'print((features ** 2).mean().item())') },
      { title: '自动求导', level: '基础', code: code('import torch', '', 'weight = torch.tensor(2.0, requires_grad=True)', 'loss = (weight * 3 - 10) ** 2', 'loss.backward()', 'print("loss:", loss.item())', 'print("gradient:", weight.grad.item())') },
      { title: '最小训练循环', level: '进阶', code: code('import torch', '', 'model = torch.nn.Linear(1, 1)', 'optimizer = torch.optim.SGD(model.parameters(), lr=0.1)', 'x = torch.tensor([[1.0], [2.0], [3.0]])', 'y = 2 * x + 1', 'for _ in range(80):', '    loss = torch.nn.functional.mse_loss(model(x), y)', '    optimizer.zero_grad()', '    loss.backward()', '    optimizer.step()', 'print(round(model(torch.tensor([[4.0]])).item(), 2))') },
    ],
  },
  {
    id: 'transformers', name: 'Transformers', icon: '🤗', level: '模型调用 → 微调', runtime: 'python3 + transformers', framework: true, packageKey: 'transformers', packageLabel: 'Transformers',
    description: 'Tokenizer、pipeline 和模型输入输出；先用小模型理解接口，再学习微调和推理优化。',
    samples: [
      { title: 'Tokenizer 编解码', level: '入门', code: code('from transformers import AutoTokenizer', '', 'tokenizer = AutoTokenizer.from_pretrained("sshleifer/tiny-gpt2")', 'encoded = tokenizer("learn by running", return_tensors="pt")', 'print(encoded["input_ids"].shape)', 'print(tokenizer.decode(encoded["input_ids"][0]))') },
      { title: 'Pipeline 推理', level: '基础', code: code('from transformers import pipeline', '', 'classifier = pipeline("sentiment-analysis", model="sshleifer/tiny-distilbert-base-uncased-finetuned-sst-2-english")', 'print(classifier("This practice is useful."))') },
    ],
  },
  {
    id: 'fastapi', name: 'FastAPI', icon: '⚡', level: '接口服务', runtime: 'python3 + fastapi', framework: true, packageKey: 'fastapi', packageLabel: 'FastAPI',
    description: '路由、请求模型和响应；先构造可测试的接口，再接数据库、鉴权和异步任务。',
    samples: [
      { title: '声明一个接口', level: '入门', code: code('from fastapi import FastAPI', '', 'app = FastAPI(title="Learning API")', '', '@app.get("/health")', 'def health():', '    return {"status": "ok"}', '', 'print(app.title)', 'print([route.path for route in app.routes])') },
      { title: '请求模型', level: '基础', code: code('from fastapi import FastAPI', 'from pydantic import BaseModel', '', 'class Item(BaseModel):', '    name: str', '    price: float', '', 'app = FastAPI()', '@app.post("/items")', 'def create_item(item: Item):', '    return {"name": item.name, "price_with_tax": item.price * 1.13}', '', 'print(create_item(Item(name="book", price=10)))') },
    ],
  },
  {
    id: 'matplotlib', name: 'Matplotlib', icon: '📈', level: '科研可视化', runtime: 'python3 + matplotlib', framework: true, packageKey: 'matplotlib', packageLabel: 'Matplotlib',
    description: '论文常用折线图、散点图和坐标轴；练习会把图片写入临时目录并输出文件位置。',
    samples: [
      { title: '保存一张折线图', level: '入门', code: code('import matplotlib.pyplot as plt', '', 'x = [1, 2, 3, 4]', 'y = [1, 4, 9, 16]', 'plt.plot(x, y, marker="o", label="square")', 'plt.xlabel("x")', 'plt.ylabel("y")', 'plt.legend()', 'plt.savefig("learning_plot.png", dpi=120)', 'print("saved: learning_plot.png")') },
      { title: '多组实验结果', level: '基础', code: code('import matplotlib.pyplot as plt', '', 'steps = [1, 2, 3, 4]', 'plt.plot(steps, [0.61, 0.72, 0.79, 0.83], label="ours")', 'plt.plot(steps, [0.55, 0.63, 0.69, 0.71], label="baseline")', 'plt.xlabel("step")', 'plt.ylabel("accuracy")', 'plt.legend()', 'plt.savefig("comparison.png", dpi=120)', 'print("saved: comparison.png")') },
    ],
  },
  {
    id: 'pandas', name: 'Pandas', icon: '🐼', level: '数据处理', runtime: 'python3 + pandas', framework: true, packageKey: 'pandas', packageLabel: 'Pandas',
    description: 'DataFrame、筛选、分组和缺失值处理；这是读实验日志、整理指标的常用基础。',
    samples: [
      { title: 'DataFrame 筛选', level: '入门', code: code('import pandas as pd', '', 'data = pd.DataFrame({"model": ["a", "b", "c"], "score": [0.81, 0.74, 0.89]})', 'print(data[data["score"] >= 0.8].sort_values("score", ascending=False).to_string(index=False))') },
      { title: '分组聚合', level: '基础', code: code('import pandas as pd', '', 'logs = pd.DataFrame({"run": [1, 1, 2, 2], "loss": [0.8, 0.6, 0.7, 0.5]})', 'summary = logs.groupby("run", as_index=False)["loss"].mean()', 'print(summary.to_string(index=False))') },
    ],
  },
];
