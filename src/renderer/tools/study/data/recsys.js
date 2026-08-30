export default {
  id: 'recsys',
  name: '搜广推',
  icon: '📊',
  blurb: '搜索、广告、推荐三件事的公共底座：召回 → 粗排 → 精排 → 重排。面试里真正拉开差距的不是会调包，是能手写 AUC/GAUC、说清 FM 的化简公式、讲明白 in-batch 负采样为什么要做 logQ 修正。',

  templates: [
    {
      id: 'auc-gauc',
      title: 'AUC 与 GAUC',
      lang: 'python',
      tags: ['评估', '必背'],
      why: '排序问题的第一指标。手写 AUC 是高频考题；GAUC 才是推荐系统线上真正看的东西——理由要能讲清楚。',
      code: `import numpy as np
from collections import defaultdict

def auc(labels, scores):
    """AUC 的物理含义：随机取一个正样本、一个负样本，
    正样本得分更高的概率。用排名公式算是 O(n log n)。

    AUC = (sum(正样本的排名) - M(M+1)/2) / (M * N)
    """
    labels = np.asarray(labels)
    scores = np.asarray(scores, dtype=float)

    order = np.argsort(scores)                 # 升序
    ranks = np.empty(len(scores), dtype=float)
    ranks[order] = np.arange(1, len(scores) + 1)

    # 同分必须取平均排名，否则结果会依赖排序的稳定性
    for value in np.unique(scores):
        idx = scores == value
        if idx.sum() > 1:
            ranks[idx] = ranks[idx].mean()

    pos = labels == 1
    m, n = int(pos.sum()), int((~pos).sum())
    if m == 0 or n == 0:
        return 0.5                              # 单一类别，AUC 无定义
    return float((ranks[pos].sum() - m * (m + 1) / 2) / (m * n))


def gauc(labels, scores, user_ids, weight_by='count'):
    """GAUC：按用户分组算 AUC，再按曝光量加权平均。

    为什么线上看 GAUC 不看 AUC：
    推荐系统实际要解决的是"给同一个用户把候选排好"。
    全局 AUC 会把不同用户之间的分数差异也算进去 —— 
    模型只要学会"活跃用户整体分高"就能刷高 AUC，但对每个人的排序毫无改善。
    """
    groups = defaultdict(lambda: ([], []))
    for label, score, uid in zip(labels, scores, user_ids):
        groups[uid][0].append(label)
        groups[uid][1].append(score)

    total, total_weight = 0.0, 0.0
    for uid, (ls, ss) in groups.items():
        ls = np.asarray(ls)
        if ls.sum() == 0 or ls.sum() == len(ls):
            continue                            # 全正或全负的用户没有区分度，跳过
        weight = len(ls) if weight_by == 'count' else 1.0
        total += weight * auc(ls, ss)
        total_weight += weight
    return total / total_weight if total_weight else 0.5`,
      points: [
        'AUC = 正样本排在负样本前面的概率，与阈值无关',
        '同分必须取平均排名，否则结果不稳定',
        'GAUC 按用户分组再加权，才反映"给单个用户排序"的能力',
        '全正/全负的用户组要剔除，它们没有区分度',
      ],
      pitfalls: [
        '正负样本极度不均衡时 AUC 看着很高，但业务上没用 —— 该看 PR-AUC',
        '离线 AUC 涨了线上不涨，多半是因为看的是全局 AUC 而非 GAUC',
      ],
    },

    {
      id: 'fm',
      title: 'FM 因子分解机',
      lang: 'python',
      tags: ['排序', '必背'],
      why: '那个把 O(n²k) 降到 O(nk) 的化简公式，是 FM 能上线的唯一原因。这个推导必须背下来，面试常让手推。',
      code: `import torch
import torch.nn as nn

class FM(nn.Module):
    """二阶特征交叉：y = w0 + sum(w_i x_i) + sum_i sum_j <v_i, v_j> x_i x_j

    化简（必背）：
      sum_{i<j} <v_i,v_j> x_i x_j
        = 1/2 * [ (sum_i v_i x_i)^2 - sum_i (v_i x_i)^2 ]
    左边 O(n^2 k)，右边 O(nk)。这一步让 FM 从"理论可行"变成"线上可跑"。

    另一个关键：即使特征 i 和 j 在训练集里从没共现过，
    v_i 和 v_j 也各自被别的组合训练到了，所以照样能算出交叉 —— 
    这是 FM 相对 POLY2 在稀疏数据上的根本优势。
    """
    def __init__(self, n_features, k=16):
        super().__init__()
        self.bias = nn.Parameter(torch.zeros(1))
        self.linear = nn.Embedding(n_features, 1)    # 一阶权重
        self.v = nn.Embedding(n_features, k)         # 二阶隐向量
        nn.init.normal_(self.v.weight, std=0.01)     # 初始化别用默认，方差太大

    def forward(self, feat_idx):
        """feat_idx: (B, F)，每个样本 F 个非零特征的 id（one-hot 的下标）"""
        linear = self.linear(feat_idx).sum(dim=1).squeeze(-1)       # (B,)

        v = self.v(feat_idx)                                        # (B, F, k)
        square_of_sum = v.sum(dim=1).pow(2)                         # (B, k)
        sum_of_square = v.pow(2).sum(dim=1)                         # (B, k)
        cross = 0.5 * (square_of_sum - sum_of_square).sum(dim=1)    # (B,)

        return self.bias + linear + cross


class DeepFM(nn.Module):
    """FM 管低阶交叉，DNN 管高阶交叉，两边共享同一份 embedding。
    相比 Wide&Deep 的好处：wide 侧不需要人工设计交叉特征"""
    def __init__(self, n_features, n_fields, k=16, hidden=(256, 128), dropout=0.2):
        super().__init__()
        self.linear = nn.Embedding(n_features, 1)
        self.emb = nn.Embedding(n_features, k)
        layers, in_dim = [], n_fields * k
        for h in hidden:
            layers += [nn.Linear(in_dim, h), nn.ReLU(), nn.Dropout(dropout)]
            in_dim = h
        layers.append(nn.Linear(in_dim, 1))
        self.mlp = nn.Sequential(*layers)

    def forward(self, feat_idx):
        e = self.emb(feat_idx)                                   # (B, F, k)
        linear = self.linear(feat_idx).sum(1).squeeze(-1)
        fm = 0.5 * (e.sum(1).pow(2) - e.pow(2).sum(1)).sum(1)
        deep = self.mlp(e.flatten(1)).squeeze(-1)                # 拍平喂给 MLP
        return torch.sigmoid(linear + fm + deep)`,
      points: [
        '化简公式：1/2 · [(Σvx)² − Σ(vx)²]，O(n²k) → O(nk)',
        'FM 能处理训练集里没共现过的特征组合，POLY2 不能',
        'DeepFM 的 FM 侧和 Deep 侧共享 embedding，端到端一起训',
      ],
      pitfalls: [
        'embedding 初始化用默认值方差过大，FM 很难收敛',
        'DeepFM 两侧用各自独立的 embedding，参数翻倍且效果更差',
      ],
    },

    {
      id: 'two-tower',
      title: '双塔召回 + in-batch 负采样',
      lang: 'python',
      tags: ['召回', '必背'],
      why: '召回阶段的工业标准。logQ 修正那一行是重点：不做的话热门 item 会被系统性打压。',
      code: `import torch
import torch.nn as nn
import torch.nn.functional as F

class TwoTower(nn.Module):
    """user 塔和 item 塔各出一个向量，内积当分数。

    上线方式：item 向量离线算好灌进 ANN 索引（Faiss/HNSW），
    线上只跑 user 塔 + 向量检索，几毫秒返回上千候选。
    双塔的代价：user 和 item 直到最后一步才交互，
    表达能力弱于精排模型 —— 所以它只做召回，不做精排。
    """
    def __init__(self, user_dim, item_dim, emb=64):
        super().__init__()
        self.user_tower = nn.Sequential(
            nn.Linear(user_dim, 256), nn.ReLU(), nn.Linear(256, emb))
        self.item_tower = nn.Sequential(
            nn.Linear(item_dim, 256), nn.ReLU(), nn.Linear(256, emb))

    def forward(self, user_feat, item_feat):
        u = F.normalize(self.user_tower(user_feat), dim=-1)   # 归一化后内积=余弦
        i = F.normalize(self.item_tower(item_feat), dim=-1)
        return u, i


def in_batch_softmax_loss(u, i, temperature=0.05, log_q=None):
    """batch 内负采样：把同 batch 里其他样本的 item 当负样本，
    省掉显式采样，一个 batch 就是一次 (B) 分类。

    logQ 修正：热门 item 出现在 batch 里的概率高，
    于是被当成负样本的次数也多，模型会系统性压低它们的分数。
    减去 log(采样概率) 正好抵消这个偏差 —— YouTube 的经典做法。
    """
    logits = u @ i.t() / temperature                # (B, B)
    if log_q is not None:
        logits = logits - log_q.unsqueeze(0)        # 按 item 的流行度纠偏
    labels = torch.arange(u.size(0), device=u.device)   # 对角线是正样本
    return F.cross_entropy(logits, labels)


def sample_negatives(n_items, batch_size, n_neg, popularity=None, alpha=0.75):
    """显式负采样：按流行度的 alpha 次方采样。
    alpha=0.75 来自 word2vec —— 完全按流行度会全采到热门，
    完全均匀又采不到有信息量的难负样本，0.75 是折中"""
    if popularity is None:
        probs = torch.ones(n_items)
    else:
        probs = torch.as_tensor(popularity, dtype=torch.float).pow(alpha)
    probs = probs / probs.sum()
    return torch.multinomial(probs, batch_size * n_neg, replacement=True).view(batch_size, n_neg)`,
      points: [
        '双塔只在最后做内积，表达力受限，所以只用于召回',
        'item 向量离线入 ANN 索引，线上只算 user 塔',
        'in-batch 负采样必须做 logQ 修正，否则打压热门 item',
        '温度系数 temperature 越小，对困难负样本越敏感',
      ],
      pitfalls: [
        '不归一化就算内积，向量模长会主导分数',
        '训练时用 in-batch 负样本、线上却是全库检索 —— 分布不一致，要补全局负样本',
      ],
    },

    {
      id: 'din',
      title: 'DIN 用户兴趣注意力',
      lang: 'python',
      tags: ['排序', '必背'],
      why: '把"用户兴趣是多峰的、且随候选而变"这件事建模出来。注意原论文不做 softmax 归一化——这是个常被写错的细节。',
      code: `import torch
import torch.nn as nn

class DINAttention(nn.Module):
    """用户历史行为对当前候选 item 的注意力。

    动机：同一个用户，看"泳衣"时该激活的是历史里的沙滩、防晒；
    看"键盘"时该激活的是电脑、显示器。
    用一个固定的用户向量表达不了这件事 —— 兴趣得随候选变。
    """
    def __init__(self, emb_dim, hidden=(80, 40)):
        super().__init__()
        layers, in_dim = [], emb_dim * 4     # [hist, cand, 差, 积] 四份拼接
        for h in hidden:
            layers += [nn.Linear(in_dim, h), nn.Sigmoid()]
            in_dim = h
        layers.append(nn.Linear(in_dim, 1))
        self.mlp = nn.Sequential(*layers)

    def forward(self, hist, cand, mask):
        """hist: (B, T, E) 历史行为序列
           cand: (B, E)    当前候选
           mask: (B, T)    有效位（历史长度不齐，padding 要屏蔽）
        """
        T = hist.size(1)
        cand_expand = cand.unsqueeze(1).expand(-1, T, -1)        # (B, T, E)

        # 拼 [h, c, h-c, h*c]：差和积是显式的交互信号，比只拼 [h, c] 好学
        x = torch.cat([hist, cand_expand,
                       hist - cand_expand,
                       hist * cand_expand], dim=-1)
        weights = self.mlp(x).squeeze(-1)                        # (B, T)

        weights = weights.masked_fill(~mask.bool(), 0.0)
        # 原论文这里刻意不做 softmax：softmax 会把权重归一到和为 1，
        # 从而丢掉"这个用户历史里到底有多少相关行为"的强度信息。
        # 若要归一化版本，改成：
        #   weights = weights.masked_fill(~mask.bool(), -1e9).softmax(dim=-1)
        return (weights.unsqueeze(-1) * hist).sum(dim=1)         # (B, E)


class DIN(nn.Module):
    def __init__(self, n_items, emb=32, hidden=(200, 80)):
        super().__init__()
        self.item_emb = nn.Embedding(n_items, emb)
        self.attn = DINAttention(emb)
        layers, in_dim = [], emb * 2
        for h in hidden:
            layers += [nn.Linear(in_dim, h), nn.PReLU()]   # DIN 原文用 Dice/PReLU
            in_dim = h
        layers.append(nn.Linear(in_dim, 1))
        self.mlp = nn.Sequential(*layers)

    def forward(self, hist_ids, cand_id, mask):
        hist = self.item_emb(hist_ids)          # (B, T, E)
        cand = self.item_emb(cand_id)           # (B, E)
        interest = self.attn(hist, cand, mask)  # (B, E)
        return torch.sigmoid(self.mlp(torch.cat([interest, cand], dim=-1)).squeeze(-1))`,
      points: [
        '注意力权重由 [hist, cand, 差, 积] 经小 MLP 算出',
        '原论文不做 softmax，保留兴趣强度信息',
        'padding 位置必须屏蔽，否则短历史用户被稀释',
        '后续演进：DIEN 加 GRU 建模兴趣演化，SIM 处理超长行为序列',
      ],
      pitfalls: [
        'mask 忘了做，行为少的用户兴趣向量被 padding 拉平',
        '照搬标准 attention 加 softmax，丢掉强度信息，效果下降',
      ],
    },

    {
      id: 'itemcf',
      title: 'ItemCF 协同过滤',
      lang: 'python',
      tags: ['召回'],
      why: '最老也最耐用的召回通道。至今仍是多路召回里的一路。两个惩罚项（活跃用户、热门物品）是精髓。',
      code: `import math
from collections import defaultdict

def item_similarity(user_items, topk=50):
    """user_items: {user_id: [item_id, ...]}

    两个惩罚是关键：
    1. 活跃用户对相似度的贡献要打折 —— 一个买了 1000 件东西的用户，
       说明不了任何两件商品真的相似（可能是批发商）。
    2. 热门物品要做分母归一化 —— 否则所有东西都和爆款"相似"。
    """
    co_occur = defaultdict(lambda: defaultdict(float))
    item_count = defaultdict(int)

    for user, items in user_items.items():
        weight = 1.0 / math.log(1 + len(items))     # 惩罚一：活跃用户降权
        for i in items:
            item_count[i] += 1
            for j in items:
                if i != j:
                    co_occur[i][j] += weight

    sim = {}
    for i, related in co_occur.items():
        scored = [
            (j, c / math.sqrt(item_count[i] * item_count[j]))   # 惩罚二：热门归一化
            for j, c in related.items()
        ]
        scored.sort(key=lambda x: -x[1])
        sim[i] = scored[:topk]
    return sim


def recommend(sim, user_history, topn=20):
    """基于相似度给用户出候选：历史 item 的相似 item 加权累加"""
    scores = defaultdict(float)
    seen = set(user_history)
    for item in user_history:
        for related, weight in sim.get(item, []):
            if related in seen:                      # 看过的不再推
                continue
            scores[related] += weight
    return sorted(scores.items(), key=lambda x: -x[1])[:topn]`,
      points: [
        'ItemCF 惩罚活跃用户（1/log(1+n)）和热门物品（除以 sqrt(cnt_i·cnt_j)）',
        '相比 UserCF：物品数量通常更稳定，相似度矩阵不用频繁重算',
        '优点是可解释（"因为你看过 X"），召回链路里常年保留一路',
      ],
      pitfalls: [
        '不做热门惩罚，推荐结果全是爆款，多样性崩掉',
        '共现矩阵是 O(n²) 存储，item 量大时必须截断 topk',
      ],
    },

    {
      id: 'ranking-metrics',
      title: '排序指标：NDCG / MRR / Recall@K',
      lang: 'python',
      tags: ['评估'],
      why: '召回看 Recall@K，排序看 NDCG。选错指标会让整条优化路径跑偏。',
      code: `import numpy as np

def ndcg_at_k(rels, k=10):
    """rels: 按模型预测顺序排好的真实相关性分数列表

    DCG 用 log2(位置+1) 折损：排第 1 和第 2 的差距，
    比排第 10 和第 11 的差距大得多 —— 符合用户从上往下看的行为。
    NDCG 再除以理想排序的 DCG，归一到 [0, 1]，不同 query 之间才可比。
    """
    rels = np.asarray(rels, dtype=float)[:k]
    if rels.size == 0:
        return 0.0
    discounts = 1.0 / np.log2(np.arange(2, rels.size + 2))
    dcg = ((2 ** rels - 1) * discounts).sum()
    ideal = np.sort(rels)[::-1]                 # 理想排序 = 相关性降序
    idcg = ((2 ** ideal - 1) * discounts).sum()
    return float(dcg / idcg) if idcg > 0 else 0.0


def mrr(ranked_lists, ground_truth):
    """Mean Reciprocal Rank：只关心第一个正确答案排在第几。
    适合"只有一个正确答案"的场景，比如搜索直达、问答"""
    total = 0.0
    for ranked, truth in zip(ranked_lists, ground_truth):
        for pos, item in enumerate(ranked, start=1):
            if item in truth:
                total += 1.0 / pos
                break
    return total / len(ranked_lists) if ranked_lists else 0.0


def recall_at_k(ranked_lists, ground_truth, k=50):
    """召回阶段的核心指标：真正相关的东西有多少被捞进了候选集。
    召回阶段不关心顺序（后面还有排序），所以看 Recall 不看 NDCG"""
    total = 0.0
    for ranked, truth in zip(ranked_lists, ground_truth):
        if not truth:
            continue
        hit = len(set(ranked[:k]) & set(truth))
        total += hit / len(truth)
    return total / len(ranked_lists) if ranked_lists else 0.0`,
      points: [
        '召回看 Recall@K（能不能捞到），排序看 NDCG（排得对不对）',
        'NDCG 的 log 折损匹配用户"从上往下看"的行为',
        'MRR 适合只有单个正确答案的场景',
      ],
      pitfalls: [
        '用 NDCG 评估召回阶段 —— 召回不负责精排的顺序',
        '离线指标涨、线上不涨：多半是曝光偏差，离线数据本身就是旧模型选出来的',
      ],
    },

    {
      id: 'feature-engineering',
      title: '特征工程：分桶 / 哈希 / 序列',
      lang: 'python',
      tags: ['特征'],
      why: '模型能不能起飞，一半看特征。等频分桶、哈希冲突、特征穿越，这三件事是工程里最容易翻车的地方。',
      code: `import numpy as np

def equal_frequency_bucket(values, n_buckets=10):
    """等频分桶：每个桶里样本数量相同。

    比等宽分桶好在哪：真实特征（价格、时长、点击数）几乎都是长尾分布，
    等宽分桶会让 99% 的样本挤在第一个桶里，等于没分。
    """
    values = np.asarray(values, dtype=float)
    quantiles = np.quantile(values, np.linspace(0, 1, n_buckets + 1)[1:-1])
    boundaries = np.unique(quantiles)          # 去重：长尾数据分位点可能重合
    return np.searchsorted(boundaries, values), boundaries


def hash_bucket(feature_value, n_buckets=1_000_000):
    """哈希分桶：处理超高基数特征（item_id、query 等）。

    冲突是必然的，但影响比想象中小：
    冲突的两个特征共享一个 embedding，相当于加了正则。
    桶数一般取特征基数的 3~5 倍，把冲突率压到可接受。
    """
    import hashlib
    digest = hashlib.md5(str(feature_value).encode()).hexdigest()
    return int(digest, 16) % n_buckets         # 别用内置 hash()：进程间不一致


def build_sequence_feature(behaviors, max_len=50, pad_id=0):
    """行为序列特征：截断 + padding + mask

    注意顺序：保留最近的 max_len 个（尾部），不是最早的。
    """
    seq = list(behaviors)[-max_len:]
    mask = [1] * len(seq) + [0] * (max_len - len(seq))
    seq = seq + [pad_id] * (max_len - len(seq))
    return seq, mask


# ---- 特征穿越（数据泄露）自检清单 ----
# 1. 所有特征的统计口径必须严格早于样本的时间戳
#    （"该商品的总点击数"如果用了全量数据，就泄露了未来）
# 2. 划分训练/验证集要按时间切，不能随机切
# 3. 标签相关的字段（如"是否成交")不能出现在特征里，包括间接形式
# 4. 离线特征和线上特征必须同一套代码算 —— 训练/服务不一致是最难查的 bug`,
      points: [
        '长尾特征用等频分桶，别用等宽',
        '高基数特征用哈希分桶，桶数取基数的 3~5 倍',
        '哈希必须用 hashlib，Python 内置 hash() 每次进程启动都变',
        '行为序列取最近的 N 个，并配套输出 mask',
      ],
      pitfalls: [
        '特征穿越：用了样本时间点之后才有的信息，离线指标高得离谱、线上崩',
        '训练和线上用两套特征代码，是排查成本最高的一类 bug',
        '按随机而非时间划分验证集，等于变相泄露',
      ],
    },
  ],
};
