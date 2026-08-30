export default {
  id: 'algorithms',
  name: '算法',
  icon: '🧮',
  blurb: '这些模板的价值不在"会写"，在于"边界不用现想"。二分的开闭区间、背包的循环方向、回溯的撤销选择——写错一个字就全错，所以要背到肌肉记忆。',

  templates: [
    {
      id: 'binary-search',
      title: '二分查找（三种边界）',
      lang: 'python',
      tags: ['二分', '必背'],
      why: '90% 的二分 bug 都出在边界。把这三个版本的区间定义背死，就再也不用在纸上试 [0,n] 还是 [0,n-1]。',
      code: `# 1) 找精确值：闭区间 [left, right]
def binary_search(nums, target):
    left, right = 0, len(nums) - 1
    while left <= right:                  # 闭区间，left == right 时区间里还有一个数
        mid = left + (right - left) // 2  # 而不是 (left+right)//2，养成防溢出的习惯
        if nums[mid] == target:
            return mid
        if nums[mid] < target:
            left = mid + 1                # mid 已排除，所以是 +1
        else:
            right = mid - 1               # mid 已排除，所以是 -1
    return -1


# 2) 左边界：第一个 >= target 的下标（等价于 bisect_left）
def lower_bound(nums, target):
    left, right = 0, len(nums)            # 半开区间 [left, right)，注意 right 取 len
    while left < right:                   # 半开区间，left == right 时区间为空
        mid = left + (right - left) // 2
        if nums[mid] < target:
            left = mid + 1
        else:
            right = mid                   # 不排除 mid：它自己可能就是答案
    return left                           # 返回值范围 [0, len(nums)]


# 3) 右边界：第一个 > target 的下标（等价于 bisect_right）
def upper_bound(nums, target):
    left, right = 0, len(nums)
    while left < right:
        mid = left + (right - left) // 2
        if nums[mid] <= target:           # 和 lower_bound 只差这个 =
            left = mid + 1
        else:
            right = mid
    return left


# target 出现的次数 = upper_bound - lower_bound`,
      points: [
        '闭区间 [l, r]：while l <= r，两边都用 mid±1',
        '半开区间 [l, r)：while l < r，right = mid（不减一）',
        'lower_bound 和 upper_bound 的唯一区别是 < 还是 <=',
        '出现次数 = upper_bound(x) - lower_bound(x)',
      ],
      pitfalls: [
        '半开区间里写 right = mid - 1 会漏掉答案',
        '闭区间里写 while l < r 会漏掉最后一个元素',
        'lower_bound 返回 len(nums) 表示"所有元素都比 target 小"，用之前必须判越界',
      ],
    },

    {
      id: 'sliding-window',
      title: '滑动窗口',
      lang: 'python',
      tags: ['双指针', '必背'],
      why: '一套骨架能套一大类题：最小覆盖子串、无重复最长子串、字母异位词。变的只有"何时收缩"和"在哪更新答案"。',
      code: `from collections import Counter

def min_window(s: str, t: str) -> str:
    """最小覆盖子串：s 中包含 t 所有字符的最短子串"""
    need = Counter(t)
    window = Counter()
    left = 0
    valid = 0                       # 已经"数量达标"的字符种类数
    start, length = 0, float('inf')

    for right, ch in enumerate(s):          # 右指针只往右走，负责扩大窗口
        if ch in need:
            window[ch] += 1
            if window[ch] == need[ch]:      # 注意是 ==，不是 >=，否则会重复计数
                valid += 1

        while valid == len(need):           # 窗口已合法，左指针收缩找更优解
            if right - left + 1 < length:   # 更新答案的位置：收缩前
                start, length = left, right - left + 1
            c = s[left]
            left += 1
            if c in need:                   # 移出窗口，对称地撤销上面的更新
                if window[c] == need[c]:
                    valid -= 1
                window[c] -= 1

    return '' if length == float('inf') else s[start:start + length]


def longest_no_repeat(s: str) -> int:
    """无重复字符的最长子串：收缩条件变成"有重复"，答案在扩大后更新"""
    last = {}                       # 字符 -> 最后一次出现的下标
    left = ans = 0
    for right, ch in enumerate(s):
        if ch in last and last[ch] >= left:
            left = last[ch] + 1     # 直接跳，不用一格格挪
        last[ch] = right
        ans = max(ans, right - left + 1)
    return ans`,
      points: [
        '右指针负责扩大、左指针负责收缩，两个指针都只往一个方向走 → O(n)',
        '模板的三个空：何时收缩、在哪更新答案、进出窗口时对称地维护状态',
        '求最小值在收缩前更新答案；求最大值在扩大后更新答案',
      ],
      pitfalls: [
        'window[ch] == need[ch] 写成 >= 会让 valid 反复加，永远收缩不完',
        '进窗口和出窗口的状态维护必须严格对称，漏一个 -1 就全乱',
      ],
    },

    {
      id: 'sort',
      title: '快排与归并',
      lang: 'python',
      tags: ['排序', '必背'],
      why: '快排的 partition 和归并的 merge 是无数题的零件：第 K 大用 partition，逆序对用 merge。',
      code: `import random

def quick_sort(nums, lo=0, hi=None):
    if hi is None:
        hi = len(nums) - 1
    if lo >= hi:
        return
    p = partition(nums, lo, hi)
    quick_sort(nums, lo, p - 1)
    quick_sort(nums, p + 1, hi)      # p 已归位，不参与后续


def partition(nums, lo, hi):
    """把 <pivot 的甩到左边，返回 pivot 最终下标"""
    k = random.randint(lo, hi)                  # 随机化：不加这行，
    nums[k], nums[hi] = nums[hi], nums[k]       # 有序数组会退化成 O(n^2)
    pivot = nums[hi]
    i = lo                                      # 不变量：[lo, i) 全都 < pivot
    for j in range(lo, hi):
        if nums[j] < pivot:
            nums[i], nums[j] = nums[j], nums[i]
            i += 1
    nums[i], nums[hi] = nums[hi], nums[i]       # pivot 归位
    return i


def merge_sort(nums):
    if len(nums) <= 1:
        return nums
    mid = len(nums) // 2
    return merge(merge_sort(nums[:mid]), merge_sort(nums[mid:]))


def merge(a, b):
    out, i, j = [], 0, 0
    while i < len(a) and j < len(b):
        if a[i] <= b[j]:            # <= 而不是 <：保证稳定排序
            out.append(a[i]); i += 1
        else:
            out.append(b[j]); j += 1
    out.extend(a[i:])               # 剩下的直接接上，不用再比
    out.extend(b[j:])
    return out


def find_kth_largest(nums, k):
    """快速选择：只递归 pivot 所在的那一半，平均 O(n)"""
    target = len(nums) - k          # 第 k 大 = 升序第 len-k 个下标
    lo, hi = 0, len(nums) - 1
    while True:
        p = partition(nums, lo, hi)
        if p == target:
            return nums[p]
        if p < target:
            lo = p + 1
        else:
            hi = p - 1`,
      points: [
        '快排：原地、不稳定、平均 O(n log n)、最坏 O(n²)（靠随机化规避）',
        '归并：需要 O(n) 额外空间、稳定、稳定 O(n log n)',
        '快速选择只递归一边，平均降到 O(n) —— Top K 的标准解',
      ],
      pitfalls: [
        '不随机化 pivot，遇到已排序数组直接退化',
        'merge 里写 a[i] < b[j] 会丢掉稳定性',
      ],
    },

    {
      id: 'tree-traversal',
      title: '二叉树遍历（递归 / 迭代 / 层序）',
      lang: 'python',
      tags: ['树', '必背'],
      why: '递归三行换位置就是前中后序；迭代中序和层序是面试高频。层序里那个 for _ in range(len(q)) 是分层的关键。',
      code: `from collections import deque

class TreeNode:
    def __init__(self, val=0, left=None, right=None):
        self.val, self.left, self.right = val, left, right


def traverse(root):
    """递归：append 那一行放在哪，就是哪种序"""
    res = []
    def dfs(node):
        if not node:
            return
        # res.append(node.val)    <- 放这里是前序
        dfs(node.left)
        res.append(node.val)      # 放这里是中序
        dfs(node.right)
        # res.append(node.val)    <- 放这里是后序
    dfs(root)
    return res


def inorder_iter(root):
    """迭代中序：一路向左压栈，弹出即访问，再转向右子树"""
    res, stack, cur = [], [], root
    while cur or stack:
        while cur:
            stack.append(cur)
            cur = cur.left
        cur = stack.pop()
        res.append(cur.val)
        cur = cur.right
    return res


def level_order(root):
    """BFS 层序，按层分组"""
    if not root:
        return []
    res, q = [], deque([root])
    while q:
        level = []
        for _ in range(len(q)):     # 关键：先把这一层的长度固定住，
            node = q.popleft()      # 否则边遍历边入队会把下一层混进来
            level.append(node.val)
            if node.left:
                q.append(node.left)
            if node.right:
                q.append(node.right)
        res.append(level)
    return res`,
      points: [
        '二叉搜索树的中序遍历是升序序列 —— 很多 BST 题的突破口',
        '层序里 for _ in range(len(q)) 决定了能不能分层',
        '迭代中序的循环条件是 cur or stack，缺一不可',
      ],
      pitfalls: [
        '层序里直接 while q 逐个弹出，会把所有层混成一个列表',
        '递归深度受限：链状树 10^5 个节点会爆栈，要改迭代',
      ],
    },

    {
      id: 'backtracking',
      title: '回溯模板（排列 / 子集 / 组合）',
      lang: 'python',
      tags: ['回溯', '必背'],
      why: '做选择 → 递归 → 撤销选择，三步一个不能少。res.append(path[:]) 里那个切片拷贝，忘了就全是空列表。',
      code: `def permute(nums):
    """全排列：用 used 数组标记，每层可以从头选"""
    res, path = [], []
    used = [False] * len(nums)

    def backtrack():
        if len(path) == len(nums):
            res.append(path[:])          # 必须拷贝！path 全程是同一个列表对象
            return
        for i in range(len(nums)):
            if used[i]:
                continue
            used[i] = True               # 做选择
            path.append(nums[i])
            backtrack()
            path.pop()                   # 撤销选择，和上面严格对称
            used[i] = False

    backtrack()
    return res


def subsets(nums):
    """子集：用 start 控制起点，保证组合不重复"""
    res, path = [], []

    def backtrack(start):
        res.append(path[:])              # 每个节点都是一个答案，不用等到叶子
        for i in range(start, len(nums)):
            path.append(nums[i])
            backtrack(i + 1)             # i+1：每个元素只能用一次
            path.pop()

    backtrack(0)
    return res


def combination_sum(candidates, target):
    """可重复选取 + 剪枝：排序后一旦超了，后面更大的都不用试"""
    candidates.sort()
    res, path = [], []

    def backtrack(start, remain):
        if remain == 0:
            res.append(path[:])
            return
        for i in range(start, len(candidates)):
            if candidates[i] > remain:
                break                    # 排序后可以直接 break 而不是 continue
            path.append(candidates[i])
            backtrack(i, remain - candidates[i])   # 传 i 不是 i+1：允许重复选自己
            path.pop()

    backtrack(0, target)
    return res`,
      points: [
        '排列用 used 数组；组合/子集用 start 下标',
        'backtrack(i + 1) 每个元素用一次；backtrack(i) 可重复用',
        '排序 + break 剪枝，比 continue 快一个量级',
      ],
      pitfalls: [
        'res.append(path) 不加 [:]，最后全是空列表（存的是同一个引用）',
        '撤销选择漏掉任何一步（pop / used=False），结果就会串味',
      ],
    },

    {
      id: 'knapsack',
      title: '背包 DP（0-1 / 完全）',
      lang: 'python',
      tags: ['动态规划', '必背'],
      why: '一维滚动数组下，0-1 背包倒序、完全背包正序——这一个字的差别就是全部。背下来，别每次现推。',
      code: `def knapsack_01(weights, values, cap):
    """0-1 背包：每件物品最多选一次"""
    dp = [0] * (cap + 1)                 # dp[j] = 容量恰好为 j 时的最大价值
    for i in range(len(weights)):
        for j in range(cap, weights[i] - 1, -1):     # 倒序！
            # 倒序保证 dp[j - w] 还是"上一轮"的值，即还没放过第 i 件
            dp[j] = max(dp[j], dp[j - weights[i]] + values[i])
    return dp[cap]


def knapsack_complete(weights, values, cap):
    """完全背包：每件物品可以选无限次"""
    dp = [0] * (cap + 1)
    for i in range(len(weights)):
        for j in range(weights[i], cap + 1):         # 正序！
            # 正序时 dp[j - w] 可能已经放过第 i 件了，正好允许重复选
            dp[j] = max(dp[j], dp[j - weights[i]] + values[i])
    return dp[cap]


def coin_change(coins, amount):
    """凑硬币最少枚数：完全背包求最小值，初值设成"不可达" """
    dp = [float('inf')] * (amount + 1)
    dp[0] = 0
    for coin in coins:
        for j in range(coin, amount + 1):
            dp[j] = min(dp[j], dp[j - coin] + 1)
    return -1 if dp[amount] == float('inf') else dp[amount]


def combination_count(nums, target):
    """凑法数量：外层循环谁，决定算的是组合还是排列"""
    dp = [0] * (target + 1)
    dp[0] = 1
    for num in nums:            # 物品在外、容量在内 -> 组合数（不计顺序）
        for j in range(num, target + 1):
            dp[j] += dp[j - num]
    return dp[target]
    # 若要排列数（计顺序），把两层循环对调：容量在外、物品在内`,
      points: [
        '0-1 背包一维数组必须倒序遍历容量',
        '完全背包一维数组必须正序遍历容量',
        '求方案数时：物品外层=组合数，容量外层=排列数',
        '求最小值时 dp 初值设 inf，dp[0] = 0',
      ],
      pitfalls: [
        '0-1 背包写成正序 = 悄悄变成完全背包，样例还可能过',
        '内层循环下界写成 0 会索引成负数（Python 不报错，直接取到尾部，更难查）',
      ],
    },

    {
      id: 'union-find',
      title: '并查集',
      lang: 'python',
      tags: ['图', '必背'],
      why: '连通性问题的万能钥匙。路径压缩 + 按秩合并两行代码，把复杂度压到近似 O(1)。',
      code: `class UnionFind:
    def __init__(self, n):
        self.parent = list(range(n))
        self.size = [1] * n
        self.count = n                       # 当前连通分量个数

    def find(self, x):
        while self.parent[x] != x:
            self.parent[x] = self.parent[self.parent[x]]   # 路径压缩（隔代压缩）
            x = self.parent[x]
        return x

    def union(self, a, b):
        ra, rb = self.find(a), self.find(b)
        if ra == rb:
            return False                     # 本来就连通，返回 False 可用来判环
        if self.size[ra] < self.size[rb]:    # 按秩合并：小树挂到大树下
            ra, rb = rb, ra
        self.parent[rb] = ra
        self.size[ra] += self.size[rb]
        self.count -= 1
        return True

    def connected(self, a, b):
        return self.find(a) == self.find(b)


def kruskal(n, edges):
    """最小生成树：边按权排序，能合并就合并"""
    uf = UnionFind(n)
    total = 0
    for w, u, v in sorted(edges):
        if uf.union(u, v):
            total += w
    return total if uf.count == 1 else -1     # 不连通则无生成树`,
      points: [
        'find 里的隔代压缩只多一行，效果接近完全压缩',
        'union 返回 False 表示已连通 —— 判环、算连通块数都靠它',
        '维护 count 就能 O(1) 拿到连通分量数量',
      ],
      pitfalls: [
        '只做路径压缩不做按秩合并，最坏情况仍可能退化',
        '比较两个点是否连通必须用 find，直接比 parent 是错的',
      ],
    },

    {
      id: 'monotonic-stack',
      title: '单调栈',
      lang: 'python',
      tags: ['栈', '必背'],
      why: '"下一个更大元素"这类题的唯一正解。栈里存下标不存值——这样才能算距离。',
      code: `def daily_temperatures(temps):
    """每天要等多少天才会更暖：栈内下标对应的温度单调递减"""
    res = [0] * len(temps)
    stack = []                              # 存下标，不是存值
    for i, t in enumerate(temps):
        while stack and temps[stack[-1]] < t:
            j = stack.pop()                 # 当前元素就是 j 的"下一个更大"
            res[j] = i - j
        stack.append(i)
    return res                              # 没被弹出的保持 0


def largest_rectangle(heights):
    """柱状图最大矩形：对每根柱子找左右第一个比它矮的
    首尾补 0 是技巧：保证所有柱子最终都会被弹出结算"""
    heights = [0] + heights + [0]
    stack, ans = [], 0
    for i, h in enumerate(heights):
        while stack and heights[stack[-1]] > h:
            top = stack.pop()
            width = i - stack[-1] - 1       # 左边界是新栈顶，右边界是 i
            ans = max(ans, heights[top] * width)
        stack.append(i)
    return ans`,
      points: [
        '求下一个更大 → 单调递减栈；求下一个更小 → 单调递增栈',
        '栈里存下标，需要值时用 arr[stack[-1]] 取',
        '每个元素最多进栈出栈各一次 → O(n)',
      ],
      pitfalls: [
        '存值不存下标，就算不出距离和宽度',
        '柱状图题不补哨兵 0，最后残留在栈里的柱子不会被结算',
      ],
    },

    {
      id: 'graph-shortest',
      title: 'Dijkstra 与拓扑排序',
      lang: 'python',
      tags: ['图', '必背'],
      why: 'Dijkstra 那个"过期记录直接跳过"的判断，是堆优化版能跑对的关键；拓扑排序是判环的标准手段。',
      code: `import heapq
from collections import defaultdict, deque

def dijkstra(graph, start, n):
    """graph: {u: [(v, w), ...]}，非负权最短路"""
    dist = [float('inf')] * n
    dist[start] = 0
    pq = [(0, start)]                      # (当前距离, 节点)
    while pq:
        d, u = heapq.heappop(pq)
        if d > dist[u]:                    # 关键：这条是过期的旧记录，
            continue                       # 因为堆里不删只加，同一点可能进多次
        for v, w in graph[u]:
            nd = d + w
            if nd < dist[v]:
                dist[v] = nd
                heapq.heappush(pq, (nd, v))
    return dist


def topo_sort(n, edges):
    """Kahn 算法。返回的序列长度 < n 就说明图里有环"""
    graph = defaultdict(list)
    indeg = [0] * n
    for u, v in edges:                     # 边的方向：u -> v
        graph[u].append(v)
        indeg[v] += 1

    q = deque(i for i in range(n) if indeg[i] == 0)
    order = []
    while q:
        u = q.popleft()
        order.append(u)
        for v in graph[u]:
            indeg[v] -= 1
            if indeg[v] == 0:              # 入度归零才入队
                q.append(v)
    return order if len(order) == n else []`,
      points: [
        'Dijkstra 只适用于非负权；有负权要用 Bellman-Ford / SPFA',
        '堆里存的是快照，弹出时必须用 d > dist[u] 过滤过期项',
        '拓扑序长度不等于节点数 = 有环',
      ],
      pitfalls: [
        '漏掉 d > dist[u] 的判断，复杂度会退化且可能出错',
        '把入度减到 0 之前就入队，会重复访问',
      ],
    },

    {
      id: 'prefix-diff',
      title: '前缀和与差分',
      lang: 'python',
      tags: ['技巧', '必背'],
      why: '区间求和 O(1)、区间修改 O(1)，是一对互逆操作。pre 数组多开一位、diff 在 r+1 处减回去，这两个细节最容易忘。',
      code: `def build_prefix(nums):
    """pre[i] = nums[0..i-1] 的和，多开一位省掉所有边界判断"""
    pre = [0] * (len(nums) + 1)
    for i, x in enumerate(nums):
        pre[i + 1] = pre[i] + x
    return pre
    # 区间 [l, r] 的和 = pre[r + 1] - pre[l]


def subarray_sum_equals_k(nums, k):
    """和为 k 的子数组个数：前缀和 + 哈希表，O(n)"""
    from collections import defaultdict
    count = defaultdict(int)
    count[0] = 1                       # 空前缀，别忘了
    cur = ans = 0
    for x in nums:
        cur += x
        ans += count[cur - k]          # 找有多少个左端点满足 pre[j] = cur - k
        count[cur] += 1
    return ans


def apply_ranges(nums, ops):
    """差分：把若干个"区间整体加 val"批量作用到数组上
    ops: [(l, r, val)]"""
    diff = [0] * (len(nums) + 1)
    for l, r, val in ops:
        diff[l] += val
        diff[r + 1] -= val             # 关键：在 r+1 处减回去，所以要多开一位
    out, cur = [], 0
    for i, x in enumerate(nums):
        cur += diff[i]                 # 差分数组的前缀和 = 每个位置的增量
        out.append(x + cur)
    return out`,
      points: [
        '前缀和数组多开一位，pre[0] = 0，区间和公式就没有边界特判',
        '和为 k 的子数组：count[0] = 1 这一行忘了，答案会少',
        '差分是前缀和的逆运算：差分数组求前缀和 = 原数组',
      ],
      pitfalls: [
        'diff 数组只开 len(nums) 长度，r = len-1 时 diff[r+1] 越界',
        '前缀和用于"区间修改"是错的，那是差分/树状数组的活',
      ],
    },

    {
      id: 'linked-list',
      title: '链表三件套',
      lang: 'python',
      tags: ['链表', '必背'],
      why: '反转链表的 nxt = cur.next 那行，忘了就断链找不回来。快慢指针是判环和找中点的标准答案。',
      code: `class ListNode:
    def __init__(self, val=0, next=None):
        self.val, self.next = val, next


def reverse_list(head):
    prev, cur = None, head
    while cur:
        nxt = cur.next        # 必须先存住，下一行就要把 cur.next 改掉了
        cur.next = prev
        prev = cur
        cur = nxt
    return prev               # 循环结束时 cur 是 None，prev 才是新头


def find_middle(head):
    """快慢指针找中点。偶数个节点时返回后半段的第一个"""
    slow = fast = head
    while fast and fast.next:
        slow = slow.next
        fast = fast.next.next
    return slow


def detect_cycle(head):
    """判环并返回环的入口（Floyd 判圈）"""
    slow = fast = head
    while fast and fast.next:
        slow, fast = slow.next, fast.next.next
        if slow is fast:                   # 相遇了，说明有环
            p = head
            while p is not slow:           # 从头和从相遇点同速走，必在入口相遇
                p, slow = p.next, slow.next
            return p
    return None


def merge_two(a, b):
    """合并两个有序链表：哨兵节点省掉"头节点特判" """
    dummy = ListNode()
    tail = dummy
    while a and b:
        if a.val <= b.val:
            tail.next, a = a, a.next
        else:
            tail.next, b = b, b.next
        tail = tail.next
    tail.next = a or b        # 剩下的整段接上
    return dummy.next`,
      points: [
        '凡是"头节点可能变"的题，先加 dummy 哨兵节点',
        '反转链表：先存 next，再改指针，最后返回 prev',
        '快慢指针相遇后，从头和相遇点同速走会在环入口相遇',
      ],
      pitfalls: [
        '不存 nxt 直接 cur.next = prev，后面的链就丢了',
        '返回 cur 而不是 prev —— cur 循环结束时是 None',
      ],
    },

    {
      id: 'lru',
      title: 'LRU 缓存',
      lang: 'python',
      tags: ['设计', '必背'],
      why: '面试高频，且工程里天天用。OrderedDict 版三行搞定，手写双向链表版才是考点。',
      code: `from collections import OrderedDict

class LRUCache:
    """面试速答版：OrderedDict 本身就是哈希表 + 双向链表"""
    def __init__(self, capacity: int):
        self.cap = capacity
        self.data = OrderedDict()

    def get(self, key: int) -> int:
        if key not in self.data:
            return -1
        self.data.move_to_end(key)          # 命中就挪到末尾（表示最近使用）
        return self.data[key]

    def put(self, key: int, value: int) -> None:
        if key in self.data:
            self.data.move_to_end(key)
        self.data[key] = value
        if len(self.data) > self.cap:
            self.data.popitem(last=False)   # 淘汰最左边 = 最久未使用


class Node:
    def __init__(self, key=0, val=0):
        self.key, self.val = key, val
        self.prev = self.next = None


class LRUCacheManual:
    """手写版：哈希表定位 O(1)，双向链表调整顺序 O(1)
    头尾各放一个哨兵，删除/插入就不用判空"""
    def __init__(self, capacity: int):
        self.cap = capacity
        self.map = {}
        self.head, self.tail = Node(), Node()
        self.head.next, self.tail.prev = self.tail, self.head

    def _remove(self, node):
        node.prev.next, node.next.prev = node.next, node.prev

    def _add_to_tail(self, node):
        node.prev, node.next = self.tail.prev, self.tail
        self.tail.prev.next = node
        self.tail.prev = node

    def get(self, key):
        if key not in self.map:
            return -1
        node = self.map[key]
        self._remove(node)
        self._add_to_tail(node)
        return node.val

    def put(self, key, value):
        if key in self.map:
            self._remove(self.map[key])
        node = Node(key, value)
        self.map[key] = node
        self._add_to_tail(node)
        if len(self.map) > self.cap:
            lru = self.head.next            # 头哨兵的下一个就是最久未用
            self._remove(lru)
            del self.map[lru.key]           # 别忘了同步删哈希表`,
      points: [
        'get 命中也要更新顺序 —— 这是 LRU 和普通缓存的区别',
        '手写版必须在 Node 里存 key，否则淘汰时不知道删哈希表的哪个键',
        '头尾哨兵让所有插入删除都不用判空',
      ],
      pitfalls: [
        '淘汰时只删链表不删哈希表 → 内存泄漏且逻辑错乱',
        'put 已存在的 key 时忘记更新顺序',
      ],
    },
  ],
};
