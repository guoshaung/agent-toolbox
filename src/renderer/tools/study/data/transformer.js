export default {
  id: 'transformer',
  name: 'Transformer',
  icon: '🤖',
  blurb: '从 Attention 一路到 KV Cache。每个模块单独看都不难，难的是记住那些"为什么"：为什么除 sqrt(d_k)、为什么 Pre-LN 比 Post-LN 好训、为什么 RoPE 能外推。这些才是面试真正问的。',

  templates: [
    {
      id: 'sdpa',
      title: 'Scaled Dot-Product Attention',
      lang: 'python',
      tags: ['注意力', '必背'],
      why: '整个 Transformer 的心脏。三行公式，但"为什么要除以 sqrt(d_k)"几乎每次面试都问。',
      code: `import math
import torch
import torch.nn.functional as F

def scaled_dot_product_attention(q, k, v, mask=None, dropout_p=0.0):
    """q, k, v: (B, H, L, D) -> 输出 (B, H, L, D)

    Attention(Q,K,V) = softmax(Q K^T / sqrt(d_k)) V
    """
    d_k = q.size(-1)

    # 为什么除 sqrt(d_k)：q·k 是 d_k 个乘积之和，若各维独立同分布，
    # 其方差随 d_k 线性增长。不缩放的话 softmax 输入的量级过大，
    # 会饱和成接近 one-hot，梯度趋近于 0，训不动。
    scores = q @ k.transpose(-2, -1) / math.sqrt(d_k)      # (B, H, L, L)

    if mask is not None:
        # 用 -inf 而不是很小的负数：softmax 后严格为 0
        scores = scores.masked_fill(mask == 0, float('-inf'))

    attn = scores.softmax(dim=-1)          # 在 key 的维度上归一化
    if dropout_p > 0:
        attn = F.dropout(attn, p=dropout_p)
    return attn @ v


def causal_mask(L, device=None):
    """下三角为 True：位置 i 只能看到 j <= i，防止训练时偷看未来"""
    return torch.tril(torch.ones(L, L, dtype=torch.bool, device=device))


# 生产环境直接用这个：内部会走 FlashAttention，省显存且更快
# out = F.scaled_dot_product_attention(q, k, v, is_causal=True)`,
      points: [
        '除以 sqrt(d_k) 是为了控制 softmax 输入的方差，避免梯度消失',
        'softmax 在最后一维（key 维）上做，不是在 query 维',
        'mask 填 -inf，softmax 后才严格为 0',
        '复杂度 O(L² · d)，序列长度是平方项 —— 长文本的瓶颈在这',
      ],
      pitfalls: [
        'mask 填 -1e9 在 fp16 下会溢出成 -inf 或 NaN',
        'transpose 后没有 contiguous 就 view，会报错',
      ],
    },

    {
      id: 'mha',
      title: 'Multi-Head Attention',
      lang: 'python',
      tags: ['注意力', '必背'],
      why: 'split / merge 那两行 view + transpose 的维度变换，写错就是一堆 shape 报错。背下来。',
      code: `import torch.nn as nn

class MultiHeadAttention(nn.Module):
    def __init__(self, d_model, n_heads, dropout=0.0):
        super().__init__()
        assert d_model % n_heads == 0, 'd_model 必须能被 n_heads 整除'
        self.n_heads = n_heads
        self.d_head = d_model // n_heads       # 每个头的维度

        self.q_proj = nn.Linear(d_model, d_model)
        self.k_proj = nn.Linear(d_model, d_model)
        self.v_proj = nn.Linear(d_model, d_model)
        self.o_proj = nn.Linear(d_model, d_model)   # 输出投影，别漏
        self.dropout = dropout

    def _split(self, t, B, L):
        # (B, L, d_model) -> (B, L, H, d_head) -> (B, H, L, d_head)
        return t.view(B, L, self.n_heads, self.d_head).transpose(1, 2)

    def forward(self, x, mask=None):
        B, L, _ = x.shape
        q = self._split(self.q_proj(x), B, L)
        k = self._split(self.k_proj(x), B, L)
        v = self._split(self.v_proj(x), B, L)

        out = scaled_dot_product_attention(
            q, k, v, mask, self.dropout if self.training else 0.0)

        # 合回来：(B, H, L, d_head) -> (B, L, H, d_head) -> (B, L, d_model)
        out = out.transpose(1, 2).contiguous().view(B, L, -1)
        return self.o_proj(out)


class GroupedQueryAttention(nn.Module):
    """GQA：多个 query 头共享一组 kv 头。KV Cache 体积除以 n_heads/n_kv_heads，
    是现在大模型推理省显存的标配（LLaMA-2 70B 起全用它）"""
    def __init__(self, d_model, n_heads, n_kv_heads):
        super().__init__()
        assert n_heads % n_kv_heads == 0
        self.n_heads, self.n_kv_heads = n_heads, n_kv_heads
        self.repeat = n_heads // n_kv_heads
        self.d_head = d_model // n_heads
        self.q_proj = nn.Linear(d_model, d_model)
        self.k_proj = nn.Linear(d_model, n_kv_heads * self.d_head)
        self.v_proj = nn.Linear(d_model, n_kv_heads * self.d_head)
        self.o_proj = nn.Linear(d_model, d_model)
    # forward 里把 k、v 用 repeat_interleave(self.repeat, dim=1) 扩到 n_heads 即可`,
      points: [
        'split: view(B, L, H, d_head).transpose(1, 2)',
        'merge: transpose(1, 2).contiguous().view(B, L, -1)',
        '多头的意义：不同头学不同的关注模式（语法、指代、位置…）',
        'GQA 让 KV Cache 缩小 n_heads/n_kv_heads 倍，质量几乎不掉',
      ],
      pitfalls: [
        '忘了 o_proj，多头拼接后没有交互，等于白分头',
        'transpose 后张量不连续，直接 view 会报 "view size is not compatible"',
      ],
    },

    {
      id: 'positional',
      title: '位置编码：正弦 与 RoPE',
      lang: 'python',
      tags: ['位置', '必背'],
      why: 'Attention 本身对顺序无感知，位置信息全靠它注入。RoPE 是现在所有主流大模型的选择，理由要能说清楚。',
      code: `import math
import torch
import torch.nn as nn

class SinusoidalPositionalEncoding(nn.Module):
    """原始论文的绝对位置编码：不同频率的正弦/余弦"""
    def __init__(self, d_model, max_len=5000):
        super().__init__()
        pe = torch.zeros(max_len, d_model)
        pos = torch.arange(0, max_len, dtype=torch.float).unsqueeze(1)     # (L, 1)
        div = torch.exp(torch.arange(0, d_model, 2).float()
                        * (-math.log(10000.0) / d_model))                  # (d_model/2,)
        pe[:, 0::2] = torch.sin(pos * div)      # 偶数维用 sin
        pe[:, 1::2] = torch.cos(pos * div)      # 奇数维用 cos
        # register_buffer：随模型保存和搬设备，但不是可训练参数
        self.register_buffer('pe', pe.unsqueeze(0))

    def forward(self, x):                       # x: (B, L, d_model)
        return x + self.pe[:, :x.size(1)]


def build_rope_cache(seq_len, d_head, base=10000.0, device=None):
    """RoPE 的 cos/sin 表，可以预计算复用"""
    theta = 1.0 / (base ** (torch.arange(0, d_head, 2, device=device).float() / d_head))
    pos = torch.arange(seq_len, device=device).float()
    freqs = torch.outer(pos, theta)             # (L, d_head/2)
    return freqs.cos(), freqs.sin()


def apply_rope(x, cos, sin):
    """x: (B, H, L, d_head)

    把相邻两维看成一个复数，按位置 m 旋转 m*theta 角。
    关键性质：旋转后 q_m 和 k_n 的内积只依赖 (m - n) —— 
    绝对位置编码的形式，拿到的是相对位置的效果，所以外推能力好。
    """
    x1, x2 = x[..., 0::2], x[..., 1::2]         # 各取一半维度
    cos = cos[None, None]                       # 广播到 (1, 1, L, d_head/2)
    sin = sin[None, None]
    out1 = x1 * cos - x2 * sin                  # 二维旋转矩阵
    out2 = x1 * sin + x2 * cos
    return torch.stack((out1, out2), dim=-1).flatten(-2)   # 交错还原`,
      points: [
        '正弦编码：加在 embedding 上，绝对位置，不可训练',
        'RoPE：作用在 q 和 k 上（不是 v），乘性旋转而非加性',
        'RoPE 的内积只依赖相对位置差，所以长度外推明显更好',
        '调大 base（NTK 插值）是最常用的上下文扩展手段',
      ],
      pitfalls: [
        'RoPE 只对 q、k 施加，误加到 v 上会破坏数值',
        '正弦编码的 pe 用普通属性存，模型 .to(device) 时不会跟着搬',
      ],
    },

    {
      id: 'norm-ffn',
      title: 'LayerNorm / RMSNorm / FFN',
      lang: 'python',
      tags: ['归一化', '必背'],
      why: 'RMSNorm 比 LayerNorm 少一次求均值，SwiGLU 比 ReLU 效果好——现代大模型的两个默认选择，要知道为什么。',
      code: `import torch
import torch.nn as nn
import torch.nn.functional as F

class LayerNorm(nn.Module):
    """在最后一维上归一化。注意是 per-token 归一化，和 batch 大小无关，
    所以推理时 batch=1 也没问题（BatchNorm 就不行）"""
    def __init__(self, dim, eps=1e-5):
        super().__init__()
        self.eps = eps
        self.weight = nn.Parameter(torch.ones(dim))
        self.bias = nn.Parameter(torch.zeros(dim))

    def forward(self, x):
        mean = x.mean(-1, keepdim=True)
        var = x.var(-1, keepdim=True, unbiased=False)
        return self.weight * (x - mean) / torch.sqrt(var + self.eps) + self.bias


class RMSNorm(nn.Module):
    """LLaMA 用的归一化：不减均值，只按均方根缩放。
    少一次求均值和减法，速度更快，效果基本持平"""
    def __init__(self, dim, eps=1e-6):
        super().__init__()
        self.eps = eps
        self.weight = nn.Parameter(torch.ones(dim))

    def forward(self, x):
        rms = x.pow(2).mean(-1, keepdim=True).add(self.eps).rsqrt()
        return self.weight * (x * rms)


class FeedForward(nn.Module):
    """原始版：Linear -> 激活 -> Linear，中间维度一般是 4 * d_model"""
    def __init__(self, d_model, d_ff, dropout=0.1):
        super().__init__()
        self.net = nn.Sequential(
            nn.Linear(d_model, d_ff),
            nn.GELU(),
            nn.Linear(d_ff, d_model),
            nn.Dropout(dropout),
        )

    def forward(self, x):
        return self.net(x)


class SwiGLU(nn.Module):
    """LLaMA 的 FFN：用门控代替单纯激活。
    因为多了一个矩阵，中间维度一般取 8/3 * d_model 来保持参数量相当"""
    def __init__(self, d_model, d_ff):
        super().__init__()
        self.w_gate = nn.Linear(d_model, d_ff, bias=False)
        self.w_up = nn.Linear(d_model, d_ff, bias=False)
        self.w_down = nn.Linear(d_ff, d_model, bias=False)

    def forward(self, x):
        return self.w_down(F.silu(self.w_gate(x)) * self.w_up(x))`,
      points: [
        'LayerNorm 是 per-token 的，与 batch 无关，推理友好',
        'RMSNorm 省掉减均值，快且效果相当，现代 LLM 默认',
        'FFN 的中间维度承担了模型大部分参数量（约 2/3）',
        'SwiGLU 有三个矩阵，d_ff 取 8/3·d_model 才和原版参数量持平',
      ],
      pitfalls: [
        'var 要用 unbiased=False（有偏估计），否则和主流实现对不齐',
        'Transformer 里不要用 BatchNorm：序列长度可变、推理 batch 小',
      ],
    },

    {
      id: 'block',
      title: 'Transformer Block（Pre-LN）',
      lang: 'python',
      tags: ['结构', '必背'],
      why: 'Pre-LN 还是 Post-LN 是必问题。Pre-LN 让残差成为一条无归一化的直通路，深层也能稳定训练，不用 warmup。',
      code: `import torch.nn as nn

class TransformerBlock(nn.Module):
    """Pre-LN：norm 在残差分支内部
        x = x + Attn(Norm(x))
        x = x + FFN(Norm(x))

    Post-LN（原论文）是 x = Norm(x + Attn(x))，深层时梯度不稳，
    必须配 learning-rate warmup 才训得动。现在基本都用 Pre-LN。
    """
    def __init__(self, d_model, n_heads, d_ff, dropout=0.1):
        super().__init__()
        self.norm1 = nn.LayerNorm(d_model)
        self.attn = MultiHeadAttention(d_model, n_heads, dropout)
        self.norm2 = nn.LayerNorm(d_model)
        self.ff = FeedForward(d_model, d_ff, dropout)
        self.drop = nn.Dropout(dropout)

    def forward(self, x, mask=None):
        x = x + self.drop(self.attn(self.norm1(x), mask))   # 残差 = 梯度直通路
        x = x + self.drop(self.ff(self.norm2(x)))
        return x


class GPT(nn.Module):
    def __init__(self, vocab_size, d_model=512, n_layers=6, n_heads=8,
                 d_ff=2048, max_len=1024, dropout=0.1):
        super().__init__()
        self.tok_emb = nn.Embedding(vocab_size, d_model)
        self.pos_emb = nn.Embedding(max_len, d_model)
        self.blocks = nn.ModuleList([                        # 必须用 ModuleList，
            TransformerBlock(d_model, n_heads, d_ff, dropout)  # 普通 list 里的
            for _ in range(n_layers)                           # 参数不会被注册
        ])
        self.norm_f = nn.LayerNorm(d_model)                  # 最后再来一次 norm
        self.head = nn.Linear(d_model, vocab_size, bias=False)
        self.head.weight = self.tok_emb.weight               # 权重共享，省一大块参数

    def forward(self, idx, mask=None):
        B, L = idx.shape
        pos = torch.arange(L, device=idx.device)
        x = self.tok_emb(idx) + self.pos_emb(pos)
        for block in self.blocks:
            x = block(x, mask)
        return self.head(self.norm_f(x))`,
      points: [
        'Pre-LN：x + Sublayer(Norm(x))；Post-LN：Norm(x + Sublayer(x))',
        'Pre-LN 深层稳定、可省 warmup，是当前默认',
        'Pre-LN 最后要补一个 final norm，否则输出尺度失控',
        '输入 embedding 与输出 head 共享权重，省参数还常常涨点',
      ],
      pitfalls: [
        '用 python list 存 block，参数不会进 model.parameters()，根本训不到',
        'Pre-LN 忘了 final norm，logits 会随层数漂移',
      ],
    },

    {
      id: 'kv-cache',
      title: 'KV Cache 与自回归生成',
      lang: 'python',
      tags: ['推理', '必背'],
      why: '推理提速的第一原理。没有 Cache 每生成一个 token 都要重算整个前缀，有了之后每步只算一个位置。',
      code: `import torch

class KVCache:
    """按层存 k、v。显存占用 = 2 · layers · heads · seq · d_head · dtype
    这就是长上下文吃显存的根源，也是 GQA / MQA 存在的理由"""
    def __init__(self):
        self.cache = {}                       # layer_idx -> (k, v)

    def update(self, layer_idx, k, v):
        if layer_idx in self.cache:
            prev_k, prev_v = self.cache[layer_idx]
            k = torch.cat([prev_k, k], dim=2)   # 在序列维 (B, H, L, D) 上拼
            v = torch.cat([prev_v, v], dim=2)
        self.cache[layer_idx] = (k, v)
        return k, v


@torch.no_grad()
def generate(model, idx, max_new_tokens, temperature=1.0, top_k=None, eos_id=None):
    """自回归生成。两个阶段：
       prefill —— 一次性把 prompt 全算完，填满 cache（算力密集）
       decode  —— 每步只喂一个 token，读 cache（访存密集）
    """
    model.eval()
    for _ in range(max_new_tokens):
        logits = model(idx)[:, -1, :]          # 只要最后一个位置的分布

        if temperature <= 0:                   # 贪心
            next_id = logits.argmax(dim=-1, keepdim=True)
        else:
            logits = logits / temperature      # 温度越高越随机
            if top_k is not None:
                v, _ = torch.topk(logits, min(top_k, logits.size(-1)))
                logits[logits < v[:, [-1]]] = float('-inf')   # 截断长尾
            probs = logits.softmax(dim=-1)
            next_id = torch.multinomial(probs, num_samples=1)

        idx = torch.cat([idx, next_id], dim=1)
        if eos_id is not None and (next_id == eos_id).all():
            break
    return idx`,
      points: [
        '生成分 prefill 和 decode 两阶段，瓶颈完全不同',
        'KV Cache 把每步复杂度从 O(L²) 降到 O(L)',
        'Cache 显存 = 2·layers·heads·seq·d_head·字节数，长上下文的主要开销',
        'temperature 调随机性、top_k / top_p 截断长尾',
      ],
      pitfalls: [
        '生成时忘了 torch.no_grad()，显存会随步数一路涨到 OOM',
        '用了 KV Cache 后还把整个序列喂进去，等于 cache 白做',
      ],
    },

    {
      id: 'training',
      title: '训练循环骨架',
      lang: 'python',
      tags: ['训练', '必背'],
      why: '标签右移一位、ignore_index、梯度裁剪、混合精度——这四件事漏一个，要么算错要么炸显存。',
      code: `import torch
import torch.nn.functional as F
from torch.amp import autocast, GradScaler

def train_epoch(model, loader, optimizer, scheduler, device,
                clip=1.0, accum_steps=1):
    model.train()
    scaler = GradScaler('cuda')
    optimizer.zero_grad(set_to_none=True)      # set_to_none 比置零省显存

    for step, batch in enumerate(loader):
        input_ids = batch['input_ids'].to(device)     # (B, L)

        with autocast('cuda', dtype=torch.bfloat16):  # bf16 不需要 loss scaling，
            logits = model(input_ids[:, :-1])         # 动态范围比 fp16 大得多
            # 语言模型的标签就是输入右移一位：用第 i 个位置预测第 i+1 个
            loss = F.cross_entropy(
                logits.reshape(-1, logits.size(-1)),
                input_ids[:, 1:].reshape(-1),
                ignore_index=-100,                    # padding 位置不算 loss
            )
            loss = loss / accum_steps                 # 梯度累积要先除

        scaler.scale(loss).backward()

        if (step + 1) % accum_steps == 0:
            scaler.unscale_(optimizer)                # 裁剪前必须先反缩放
            torch.nn.utils.clip_grad_norm_(model.parameters(), clip)
            scaler.step(optimizer)
            scaler.update()
            optimizer.zero_grad(set_to_none=True)
            scheduler.step()                          # 按 optimizer step 走，不是按 batch


def build_optimizer(model, lr=3e-4, weight_decay=0.1):
    """norm 和 bias 不做 weight decay —— 这是标准做法，能明显影响效果"""
    decay, no_decay = [], []
    for name, param in model.named_parameters():
        if not param.requires_grad:
            continue
        if param.dim() < 2 or 'norm' in name or 'bias' in name:
            no_decay.append(param)
        else:
            decay.append(param)
    return torch.optim.AdamW([
        {'params': decay, 'weight_decay': weight_decay},
        {'params': no_decay, 'weight_decay': 0.0},
    ], lr=lr, betas=(0.9, 0.95))`,
      points: [
        '标签 = 输入右移一位；logits 取 [:, :-1]，labels 取 [:, 1:]',
        'padding 位置用 ignore_index=-100 排除，否则 loss 被稀释',
        '梯度裁剪前必须 scaler.unscale_()',
        'norm 和 bias 不做 weight decay',
        'bf16 比 fp16 稳，不需要 loss scaling',
      ],
      pitfalls: [
        '忘了移位，模型看着答案预测答案，loss 会低得离谱',
        '梯度累积时不除以 accum_steps，等效学习率被放大 N 倍',
        'scheduler 按 batch 步进而不是按 optimizer step，学习率衰减快 N 倍',
      ],
    },
  ],
};
