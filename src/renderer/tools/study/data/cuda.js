export default {
  id: 'cuda',
  name: 'CUDA 并行编程',
  icon: '⚡',
  blurb: 'CPU 像一个博士，什么都会但一次只干一件事；GPU 像一千个小学生，每个人只会做加减法，但一起动手快得吓人。CUDA 就是教你怎么给这一千个小学生分活的语言。按下面的顺序学：先让 GPU 跑起来，再学分活（线程索引）、搬东西（内存），最后再谈怎么跑得快。',

  templates: [
    {
      id: 'hello-kernel',
      title: '第一个 kernel：让 GPU 干活',
      lang: 'cpp',
      tags: ['入门', '必背'],
      why: '把 GPU 想成一个工地，你是包工头。"kernel" 就是一张工作说明书。你喊一声 <<<几个班组, 每组几个人>>>，所有工人就照着说明书各干一份。这一课只做一件事：把说明书发下去，让每个工人报个到。',
      code: `#include <cstdio>
#include <cuda_runtime.h>

// __global__ 表示：这个函数是"说明书"，在 GPU 上跑，由 CPU 来喊人启动
// 返回值必须是 void，GPU 函数不能直接 return 东西给 CPU
__global__ void hello() {
    // 每个工人跑到这里，都会打印自己在哪个班组、是第几号
    printf("你好，我是第 %d 个班组的第 %d 号工人\\n", blockIdx.x, threadIdx.x);
}

int main() {
    // 三个尖括号是 CUDA 特有的写法：<<<班组数, 每组人数>>>
    // 2 个班组，每组 4 人，一共 8 个工人同时跑 hello()
    hello<<<2, 4>>>();

    // 关键：CPU 喊完人就往下走了，不会等 GPU 干完
    // 必须等一下，不然程序退出时 GPU 可能还没来得及打印
    cudaDeviceSynchronize();

    printf("CPU：所有人都干完了\\n");
    return 0;
}

// 编译：nvcc hello.cu -o hello
// 运行：./hello
// 你会看到 8 行"你好"，顺序是乱的——这是正常的，工人不排队`,
      points: [
        '__global__ 标记的函数叫 kernel，是给 GPU 跑的，CPU 只负责启动它',
        '<<<A, B>>> 表示 A 个 block（班组），每个 block 有 B 个线程（工人），总共 A×B 个线程',
        '启动 kernel 是"发完命令就走"，CPU 不会等；想等就写 cudaDeviceSynchronize()',
        'GPU 线程的执行顺序不保证，打印出来是乱的很正常',
        '文件后缀是 .cu，用 nvcc 编译，不是 g++',
      ],
      pitfalls: [
        '忘记 cudaDeviceSynchronize()，程序直接退出，GPU 里的 printf 一行都看不到',
        '把文件存成 .cpp 用 g++ 编译，报一堆看不懂的错——必须用 nvcc 编 .cu',
        '想在 kernel 里 return 一个数给 CPU——不行，kernel 只能是 void，结果要写进显存',
        '一个 block 里的线程数超过 1024（比如 <<<1, 2000>>>），kernel 会静默不跑',
      ],
    },

    {
      id: 'thread-index',
      title: '线程索引：每个工人算出自己该搬第几块砖',
      lang: 'cpp',
      tags: ['入门', '必背'],
      why: '一千个工人搬一千块砖，最省事的分法是"你是几号就搬几号砖"。但工人是分班组的，每人只知道"我在第几组、组里第几号"，所以要自己算一下全局编号：组号 × 每组人数 + 组内号。算出来的编号如果超过砖的总数，就别动，站着就行——这就是越界保护。',
      code: `#include <cstdio>
#include <cuda_runtime.h>

// 向量加法：c[i] = a[i] + b[i]，n 是元素个数
__global__ void vecAdd(const float* a, const float* b, float* c, int n) {
    // 三个内置变量，每个线程看到的值不一样：
    //   blockIdx.x  ：我在第几个班组（从 0 开始）
    //   blockDim.x  ：每个班组有几个人
    //   threadIdx.x ：我在组里是第几号（从 0 开始）
    // 全局编号 = 组号 * 每组人数 + 组内号
    int i = blockIdx.x * blockDim.x + threadIdx.x;

    // 越界保护：总人数通常比 n 多（因为要凑整），多出来的人什么都不干
    if (i < n) {
        c[i] = a[i] + b[i];
    }
}

int main() {
    const int n = 1000;
    size_t bytes = n * sizeof(float);

    // 1. CPU 这边准备数据
    float* h_a = new float[n];
    float* h_b = new float[n];
    float* h_c = new float[n];
    for (int i = 0; i < n; ++i) { h_a[i] = i; h_b[i] = 2 * i; }

    // 2. GPU 那边申请三块显存（h_ 表示 host/CPU，d_ 表示 device/GPU）
    float *d_a, *d_b, *d_c;
    cudaMalloc(&d_a, bytes);
    cudaMalloc(&d_b, bytes);
    cudaMalloc(&d_c, bytes);

    // 3. 把 a、b 搬到 GPU
    cudaMemcpy(d_a, h_a, bytes, cudaMemcpyHostToDevice);
    cudaMemcpy(d_b, h_b, bytes, cudaMemcpyHostToDevice);

    // 4. 算需要几个班组：每组 256 人，1000 个元素要 4 个组（4*256 = 1024 >= 1000）
    //    (n + 255) / 256 是"向上取整"的常用写法
    int threadsPerBlock = 256;
    int blocks = (n + threadsPerBlock - 1) / threadsPerBlock;
    vecAdd<<<blocks, threadsPerBlock>>>(d_a, d_b, d_c, n);

    // 5. 把结果搬回来。cudaMemcpy 自带等待，所以这里不用再 Synchronize
    cudaMemcpy(h_c, d_c, bytes, cudaMemcpyDeviceToHost);

    printf("c[0] = %.0f, c[999] = %.0f（应该是 0 和 2997）\\n", h_c[0], h_c[999]);

    // 6. 收拾干净
    cudaFree(d_a); cudaFree(d_b); cudaFree(d_c);
    delete[] h_a; delete[] h_b; delete[] h_c;
    return 0;
}`,
      points: [
        '全局下标公式背下来：i = blockIdx.x * blockDim.x + threadIdx.x',
        'block 数要向上取整：(n + 每组人数 - 1) / 每组人数',
        '总线程数常常比 n 多，所以 kernel 里一定要 if (i < n)',
        'h_ 开头是 CPU 内存，d_ 开头是 GPU 显存，两边指针不能混用',
        '每组 256 或 128 个线程是常见的顺手值，不用纠结',
      ],
      pitfalls: [
        '没写 if (i < n)：多出来的线程会写到数组外面，轻则结果错，重则整个程序崩',
        'block 数用 n / 256 直接整除：1000 / 256 = 3，最后 232 个元素没人算',
        '在 CPU 上直接读 d_c[0]：那是显存地址，CPU 读会段错误',
        '把 h_a 直接传给 kernel：kernel 拿到 CPU 指针，读出来全是垃圾',
      ],
    },

    {
      id: 'memory-copy',
      title: '主机与设备内存：搬货和查错',
      lang: 'cpp',
      tags: ['入门', '内存', '必背'],
      why: 'CPU 和 GPU 各有各的仓库，中间隔着一条马路。数据得先搬过去，算完再搬回来。搬货这件事又慢又容易出错，所以每一步都要检查有没有翻车。CUDA 的函数不会抛异常，它只是默默返回一个错误码——你不看，它就烂在那。',
      code: `#include <cstdio>
#include <cstdlib>
#include <cuda_runtime.h>

// 错误检查宏：把每个 CUDA 调用包起来，出错就打印是哪一行、什么错，然后退出
// 这个宏几乎每个 CUDA 项目都有，建议直接抄走
#define CUDA_CHECK(call)                                                     \\
    do {                                                                     \\
        cudaError_t err = (call);                                            \\
        if (err != cudaSuccess) {                                            \\
            fprintf(stderr, "CUDA 错误 %s:%d: %s\\n", __FILE__, __LINE__,      \\
                    cudaGetErrorString(err));                                \\
            exit(EXIT_FAILURE);                                              \\
        }                                                                    \\
    } while (0)

__global__ void scale(float* data, float k, int n) {
    int i = blockIdx.x * blockDim.x + threadIdx.x;
    if (i < n) data[i] *= k;
}

int main() {
    const int n = 8;
    size_t bytes = n * sizeof(float);

    float h_data[n] = {1, 2, 3, 4, 5, 6, 7, 8};

    // 第一步：在 GPU 上开一块地。&d_data 是"指针的地址"，cudaMalloc 要往里填显存地址
    float* d_data = nullptr;
    CUDA_CHECK(cudaMalloc(&d_data, bytes));

    // 第二步：CPU -> GPU。参数顺序：目的地, 来源, 字节数, 方向
    CUDA_CHECK(cudaMemcpy(d_data, h_data, bytes, cudaMemcpyHostToDevice));

    // 第三步：算。kernel 启动没有返回值，用 cudaGetLastError 捞启动错误
    scale<<<1, n>>>(d_data, 10.0f, n);
    CUDA_CHECK(cudaGetLastError());        // 参数写错、线程数超限之类
    CUDA_CHECK(cudaDeviceSynchronize());   // kernel 跑的过程中出的错（比如越界）

    // 第四步：GPU -> CPU。目的地和来源换了位置，方向也换了
    CUDA_CHECK(cudaMemcpy(h_data, d_data, bytes, cudaMemcpyDeviceToHost));

    for (int i = 0; i < n; ++i) printf("%.0f ", h_data[i]);   // 10 20 30 ... 80
    printf("\\n");

    // 第五步：还地
    CUDA_CHECK(cudaFree(d_data));
    return 0;
}`,
      points: [
        'cudaMalloc 在显存开地，cudaFree 还地，一一配对',
        'cudaMemcpy 四个参数：目的地、来源、字节数、方向，方向有 HostToDevice 和 DeviceToHost',
        '每个 CUDA 调用都用 CUDA_CHECK 包一层，出错立刻知道在哪行',
        'kernel 启动本身不返回错误码，要用 cudaGetLastError() 捞',
        '字节数是"元素个数 × sizeof(类型)"，别只传个 n',
      ],
      pitfalls: [
        '方向写反了：cudaMemcpy(d, h, ..., DeviceToHost) 不报错但数据全是 0',
        '字节数传成 n 而不是 n * sizeof(float)：只拷了四分之一',
        '不检查错误：kernel 里越界了，你看到的只是结果全错，完全不知道为什么',
        'cudaMalloc(d_data, ...) 少了取地址符 &：编译能过，运行崩',
      ],
    },

    {
      id: 'grid-stride',
      title: 'Grid-stride 循环：一个 kernel 吃下任意长度',
      lang: 'cpp',
      tags: ['入门', '必背'],
      why: '前面"一人一块砖"的分法有个问题：砖有一百万块，你就得雇一百万个工人吗？其实不用。雇一万个，每人搬完一块就往前跳一万块再搬。这样工人数固定、砖多少都能搬完，代码也不用改。这就是 grid-stride loop，CUDA 官方推荐的默认写法。',
      code: `#include <cstdio>
#include <cuda_runtime.h>

__global__ void vecAddStride(const float* a, const float* b, float* c, int n) {
    // 我的起始位置：和之前一样的全局编号
    int i = blockIdx.x * blockDim.x + threadIdx.x;

    // 步长 = 总线程数 = 班组数 × 每组人数
    // 每搬完一块，就跳过"所有人"再搬下一块
    int stride = gridDim.x * blockDim.x;

    // 用 for 代替 if：i < n 的判断自然就在循环条件里，越界保护免费送了
    for (; i < n; i += stride) {
        c[i] = a[i] + b[i];
    }
}

int main() {
    const int n = 1 << 20;   // 大约一百万个元素
    size_t bytes = n * sizeof(float);

    float* h_a = new float[n];
    float* h_b = new float[n];
    float* h_c = new float[n];
    for (int i = 0; i < n; ++i) { h_a[i] = 1.0f; h_b[i] = 2.0f; }

    float *d_a, *d_b, *d_c;
    cudaMalloc(&d_a, bytes); cudaMalloc(&d_b, bytes); cudaMalloc(&d_c, bytes);
    cudaMemcpy(d_a, h_a, bytes, cudaMemcpyHostToDevice);
    cudaMemcpy(d_b, h_b, bytes, cudaMemcpyHostToDevice);

    // 重点：这里的 block 数不用按 n 来算了
    // 固定用几十到几百个 block 就行，一百万个元素照样算完
    // 常见做法：block 数 = SM 数量的几倍（SM 是 GPU 里的"车间"）
    int threads = 256;
    int blocks = 64;      // 64 × 256 = 16384 个线程，每人循环大约 64 次
    vecAddStride<<<blocks, threads>>>(d_a, d_b, d_c, n);

    cudaMemcpy(h_c, d_c, bytes, cudaMemcpyDeviceToHost);
    printf("c[0] = %.0f, c[n-1] = %.0f（都应该是 3）\\n", h_c[0], h_c[n - 1]);

    cudaFree(d_a); cudaFree(d_b); cudaFree(d_c);
    delete[] h_a; delete[] h_b; delete[] h_c;
    return 0;
}`,
      points: [
        '步长 stride = gridDim.x * blockDim.x，就是"总线程数"',
        '用 for (i = 起点; i < n; i += stride) 代替 if (i < n)，一个循环搞定',
        '线程数固定，数据多少都能处理，不用每次重算 block 数',
        'block 数太少（比如 1）也能算对，只是慢；正确性和速度分开考虑',
        'gridDim.x 是 block 的总数，blockDim.x 是每个 block 的线程数，别搞混',
      ],
      pitfalls: [
        '步长写成 blockDim.x（少乘了 gridDim.x）：不同 block 会算同一批元素，结果被重复写',
        '只写 i += stride 忘了 i < n 的循环条件：直接越界',
        '以为 block 数越多越好，开了几十万个 block：不会错，但调度开销白白浪费',
        'n 特别大时 int 溢出：超过 21 亿个元素要用 size_t 或 long long 做下标',
      ],
    },

    {
      id: 'shared-memory',
      title: '共享内存：一个班组共用的小黑板',
      lang: 'cpp',
      tags: ['内存', '性能', '必背'],
      why: '显存（全局内存）像仓库，大但是远，每次去拿东西都要走很久。每个班组有一块小黑板（shared memory），小但就在手边，快几十倍。套路是：先大家一起把要用的数据从仓库抄到黑板上，然后从黑板上读着算。抄的时候人有快有慢，所以要喊一声"都抄完了吗"——这就是 __syncthreads()。',
      code: `#include <cstdio>
#include <cuda_runtime.h>

#define BLOCK 256
#define RADIUS 1     // 每个元素要看左右各 1 个邻居

// 一维模板计算：out[i] = in[i-1] + in[i] + in[i+1]
// 每个元素要读 3 次输入，相邻线程读的数据大量重叠——正好用共享内存
__global__ void stencil1D(const float* in, float* out, int n) {
    // 黑板：比 block 多两头各 RADIUS 个格子，放"光环"（halo）数据
    __shared__ float tile[BLOCK + 2 * RADIUS];

    int gi = blockIdx.x * blockDim.x + threadIdx.x;   // 全局下标
    int li = threadIdx.x + RADIUS;                     // 在黑板上的位置（偏移 RADIUS）

    // 第一步：每个人把自己那格抄到黑板上（越界的抄 0）
    tile[li] = (gi < n) ? in[gi] : 0.0f;

    // 前 RADIUS 个人额外负责抄左右两头的光环
    if (threadIdx.x < RADIUS) {
        int left  = gi - RADIUS;
        int right = gi + BLOCK;
        tile[li - RADIUS]  = (left  >= 0) ? in[left]  : 0.0f;
        tile[li + BLOCK]   = (right < n)  ? in[right] : 0.0f;
    }

    // 第二步：等所有人抄完。没这一行，有人可能读到还没抄上去的空格
    __syncthreads();

    // 第三步：从黑板上读邻居，算出结果
    if (gi < n) {
        float sum = 0.0f;
        for (int k = -RADIUS; k <= RADIUS; ++k) {
            sum += tile[li + k];
        }
        out[gi] = sum;
    }
}

int main() {
    const int n = 1024;
    size_t bytes = n * sizeof(float);
    float* h_in  = new float[n];
    float* h_out = new float[n];
    for (int i = 0; i < n; ++i) h_in[i] = 1.0f;

    float *d_in, *d_out;
    cudaMalloc(&d_in, bytes); cudaMalloc(&d_out, bytes);
    cudaMemcpy(d_in, h_in, bytes, cudaMemcpyHostToDevice);

    stencil1D<<<(n + BLOCK - 1) / BLOCK, BLOCK>>>(d_in, d_out, n);

    cudaMemcpy(h_out, d_out, bytes, cudaMemcpyDeviceToHost);
    // 中间的元素是 3，最两头是 2（少一个邻居）
    printf("out[0]=%.0f out[1]=%.0f out[n-1]=%.0f\\n", h_out[0], h_out[1], h_out[n - 1]);

    cudaFree(d_in); cudaFree(d_out);
    delete[] h_in; delete[] h_out;
    return 0;
}`,
      points: [
        '__shared__ 声明的数组是整个 block 共用的，别的 block 看不到',
        '共享内存很小（一般每个 block 最多 48KB），只放当前块要用的那点数据',
        '套路三步：抄到黑板 → __syncthreads() → 从黑板读着算',
        '__syncthreads() 是 block 内所有线程的集合点，所有人到齐才继续',
        '"光环"（halo）就是边界上多抄的几个邻居，模板类计算都需要',
      ],
      pitfalls: [
        '抄完不写 __syncthreads() 就开始读：偶尔结果对偶尔不对，极难调试',
        '把 __syncthreads() 写在 if (gi < n) 里面：越界的线程不进 if，其他人永远等不到它，程序卡死',
        '共享内存数组开得太大（比如 float tile[100000]）：编译过了但 kernel 启动失败',
        '以为 __syncthreads() 能同步不同 block 的线程：不能，它只管本 block',
      ],
    },

    {
      id: 'reduction',
      title: '并行归约：一群人怎么快速算总和',
      lang: 'cpp',
      tags: ['性能', '必背', '进阶'],
      why: '256 个人手里各有一个数，要算总和。傻办法是一个人挨个加，256 步。聪明办法是"两两配对"：第一轮 128 对同时加，第二轮 64 对……8 轮就完了。配对方式有讲究：让"第 i 个人和第 i+128 个人"配（折半），比"第 i 个人和第 i+1 个人"配（相邻）快得多。原因下面代码里说。',
      code: `#include <cstdio>
#include <cuda_runtime.h>

#define BLOCK 256

// ---------- 朴素版：相邻配对 ----------
// 第 1 轮：0+1, 2+3, 4+5 ...（偶数号线程干活）
// 第 2 轮：0+2, 4+6 ...    （4 的倍数干活）
// 问题一：干活的线程编号是 0,2,4,6...，同一个 warp（32 人小队）里一半人闲着，
//         但闲着的人也得陪跑——这叫"分支发散"
// 问题二：访问 sdata[0], sdata[2], sdata[4]... 隔一个跳一个，共享内存的
//         "bank"（可以理解为 32 个柜台）会撞车——这叫 bank conflict
__global__ void reduceNaive(const float* in, float* out, int n) {
    __shared__ float sdata[BLOCK];
    int tid = threadIdx.x;
    int gi  = blockIdx.x * blockDim.x + threadIdx.x;
    sdata[tid] = (gi < n) ? in[gi] : 0.0f;
    __syncthreads();

    for (int s = 1; s < blockDim.x; s *= 2) {
        if (tid % (2 * s) == 0) {          // 取模运算本身也慢
            sdata[tid] += sdata[tid + s];
        }
        __syncthreads();                    // 注意：写在 if 外面
    }
    if (tid == 0) out[blockIdx.x] = sdata[0];
}

// ---------- 改进版：折半配对 ----------
// 第 1 轮：0+128, 1+129, 2+130 ...（前 128 个线程干活，连续的）
// 第 2 轮：0+64, 1+65 ...        （前 64 个干活）
// 好处一：干活的线程是连续的一段，warp 要么全干要么全歇，不发散
// 好处二：访问 sdata[tid] 和 sdata[tid + s]，相邻线程读相邻地址，不撞柜台
__global__ void reduceBetter(const float* in, float* out, int n) {
    __shared__ float sdata[BLOCK];
    int tid = threadIdx.x;
    int gi  = blockIdx.x * blockDim.x + threadIdx.x;
    sdata[tid] = (gi < n) ? in[gi] : 0.0f;
    __syncthreads();

    // s 从一半开始，每轮减半：128, 64, 32, ..., 1
    for (int s = blockDim.x / 2; s > 0; s >>= 1) {
        if (tid < s) {
            sdata[tid] += sdata[tid + s];
        }
        __syncthreads();
    }
    if (tid == 0) out[blockIdx.x] = sdata[0];
}

int main() {
    const int n = 1 << 20;   // 一百万个 1，总和应该是 1048576
    size_t bytes = n * sizeof(float);
    float* h_in = new float[n];
    for (int i = 0; i < n; ++i) h_in[i] = 1.0f;

    int blocks = (n + BLOCK - 1) / BLOCK;
    float *d_in, *d_partial;
    cudaMalloc(&d_in, bytes);
    cudaMalloc(&d_partial, blocks * sizeof(float));
    cudaMemcpy(d_in, h_in, bytes, cudaMemcpyHostToDevice);

    // 每个 block 算出一个小计，放进 d_partial
    reduceBetter<<<blocks, BLOCK>>>(d_in, d_partial, n);

    // 小计的数量不多（4096 个），搬回 CPU 收尾即可
    // 讲究的写法是再启动一次 kernel 归约小计，这里先简单点
    float* h_partial = new float[blocks];
    cudaMemcpy(h_partial, d_partial, blocks * sizeof(float), cudaMemcpyDeviceToHost);
    double total = 0;
    for (int i = 0; i < blocks; ++i) total += h_partial[i];
    printf("总和 = %.0f（应该是 %d）\\n", total, n);

    cudaFree(d_in); cudaFree(d_partial);
    delete[] h_in; delete[] h_partial;
    return 0;
}`,
      points: [
        '树形归约：每轮把人数减半，256 个数只要 8 轮',
        '折半配对 for (s = blockDim.x/2; s > 0; s >>= 1) 是标准写法，背下来',
        '折半比相邻好的原因：干活的线程连成一片（不发散），访问地址也连成一片（不撞 bank）',
        '一个 block 只能算出一个小计，多个 block 的小计要再加一次',
        '__syncthreads() 必须放在 if 外面，每轮所有人都要碰头',
      ],
      pitfalls: [
        '__syncthreads() 写进 if (tid < s) 里：后半线程不进 if，前半永远等不到，直接卡死',
        'block 大小不是 2 的幂（比如 200）：折半算法会漏掉一部分数据',
        '直接让所有 block 往同一个 out[0] 上 += ：没有原子操作，结果乱七八糟',
        '在 CPU 上用 float 累加一百万个小数：精度会丢，收尾建议用 double',
      ],
    },

    {
      id: 'matmul-tiled',
      title: '分块矩阵乘：用黑板一块一块地算',
      lang: 'cpp',
      tags: ['内存', '性能', '进阶'],
      why: '矩阵乘 C = A × B，算 C 的每个格子要读 A 的一整行和 B 的一整列。相邻格子读的东西大量重复，全都去仓库（显存）拿太慢。办法是：把 A 和 B 切成 16×16 的小方块（tile），一次抄一对方块到黑板上，算完这一对再抄下一对。这样每个数据从仓库只拿一次，被黑板上的 16 个人反复用。',
      code: `#include <cstdio>
#include <cuda_runtime.h>

#define TILE 16   // 方块边长，16×16 = 256 个线程，正好一个 block

// 计算 C[M×N] = A[M×K] × B[K×N]，全部按行优先存储（row-major）
// 为简单起见，要求 M、N、K 都是 TILE 的倍数
__global__ void matmulTiled(const float* A, const float* B, float* C,
                            int M, int N, int K) {
    // 两块黑板，各放一个方块
    __shared__ float sA[TILE][TILE];
    __shared__ float sB[TILE][TILE];

    // 我负责 C 里哪一个格子
    int row = blockIdx.y * TILE + threadIdx.y;
    int col = blockIdx.x * TILE + threadIdx.x;

    float acc = 0.0f;   // 我这个格子的累加值

    // 沿着 K 方向，一次滑一个方块，一共滑 K/TILE 次
    for (int t = 0; t < K / TILE; ++t) {
        // 每人抄一个数：A 的方块在第 row 行、第 (t*TILE + threadIdx.x) 列
        sA[threadIdx.y][threadIdx.x] = A[row * K + t * TILE + threadIdx.x];
        // B 的方块在第 (t*TILE + threadIdx.y) 行、第 col 列
        sB[threadIdx.y][threadIdx.x] = B[(t * TILE + threadIdx.y) * N + col];

        __syncthreads();   // 等两块黑板都抄满

        // 在黑板上做 16 次乘加：我这一行 × 我这一列
        for (int k = 0; k < TILE; ++k) {
            acc += sA[threadIdx.y][k] * sB[k][threadIdx.x];
        }

        __syncthreads();   // 等大家都算完，才能擦黑板抄下一块
    }

    C[row * N + col] = acc;
}

int main() {
    const int M = 256, N = 256, K = 256;
    size_t bytesA = M * K * sizeof(float);
    size_t bytesB = K * N * sizeof(float);
    size_t bytesC = M * N * sizeof(float);

    float* h_A = new float[M * K];
    float* h_B = new float[K * N];
    float* h_C = new float[M * N];
    for (int i = 0; i < M * K; ++i) h_A[i] = 1.0f;
    for (int i = 0; i < K * N; ++i) h_B[i] = 2.0f;

    float *d_A, *d_B, *d_C;
    cudaMalloc(&d_A, bytesA); cudaMalloc(&d_B, bytesB); cudaMalloc(&d_C, bytesC);
    cudaMemcpy(d_A, h_A, bytesA, cudaMemcpyHostToDevice);
    cudaMemcpy(d_B, h_B, bytesB, cudaMemcpyHostToDevice);

    // 二维的 block 和 grid：dim3 是 CUDA 的三维整数类型
    dim3 block(TILE, TILE);            // 16×16 个线程
    dim3 grid(N / TILE, M / TILE);     // x 方向管列，y 方向管行
    matmulTiled<<<grid, block>>>(d_A, d_B, d_C, M, N, K);

    cudaMemcpy(h_C, d_C, bytesC, cudaMemcpyDeviceToHost);
    // 每个格子 = 256 个 (1×2) 相加 = 512
    printf("C[0][0] = %.0f, C[255][255] = %.0f（应该都是 512）\\n",
           h_C[0], h_C[M * N - 1]);

    cudaFree(d_A); cudaFree(d_B); cudaFree(d_C);
    delete[] h_A; delete[] h_B; delete[] h_C;
    return 0;
}`,
      points: [
        '一个 block 负责 C 里一个 TILE×TILE 的方块，一个线程负责其中一个格子',
        '外层循环沿 K 方向滑动方块，每滑一步：抄 A 块、抄 B 块、同步、算 16 次、再同步',
        '两个 __syncthreads() 都不能少：第一个等抄完，第二个等算完再覆盖黑板',
        'dim3 用来表示二维/三维的 grid 和 block，x 对应列、y 对应行',
        'TILE=16 或 32 是常见值，太大黑板放不下，太小省不了多少访存',
      ],
      pitfalls: [
        '漏掉第二个 __syncthreads()：快的线程已经在抄下一块，慢的还在读上一块，结果错',
        '行列搞反：A[row * K + k] 里乘的是 K（A 的列数），B[k * N + col] 乘的是 N',
        '矩阵尺寸不是 TILE 的倍数又不做边界处理：越界读写',
        'grid 的 x、y 写反：grid(M/TILE, N/TILE) 在方阵上看不出来，非方阵就崩',
      ],
    },

    {
      id: 'coalescing',
      title: '内存合并访问：相邻工人拿相邻货',
      lang: 'cpp',
      tags: ['内存', '性能', '进阶'],
      why: '显存发货是按"整箱"发的，一箱 32 或 128 字节。32 个相邻工人如果拿的是相邻的 32 个数，一箱就够了。如果每个人拿的东西隔得很远，就得开 32 箱，慢 30 倍。这就是"合并访问"（coalescing）：让相邻线程访问相邻地址。矩阵转置是最经典的翻车现场——读是连续的，写就一定是跳着的。',
      code: `#include <cstdio>
#include <cuda_runtime.h>

#define TILE 32

// ---------- 朴素转置：读是合并的，写是跳着的 ----------
// 相邻线程 x 相邻，读 in[y*N + x] 是连续地址，好
// 但写 out[x*N + y]：x 每加 1，地址跳 N 个元素，每个线程各开一箱，慢
__global__ void transposeNaive(const float* in, float* out, int N) {
    int x = blockIdx.x * TILE + threadIdx.x;
    int y = blockIdx.y * TILE + threadIdx.y;
    if (x < N && y < N) {
        out[x * N + y] = in[y * N + x];
    }
}

// ---------- 分块转置：读写都合并 ----------
// 思路：先把一个 32×32 的方块"横着读"进黑板，再"竖着"从黑板拿出来"横着写"
// 跳着访问的那一步发生在黑板（共享内存）上，那里跳着访问不吃亏
__global__ void transposeTiled(const float* in, float* out, int N) {
    // +1 是为了错开 bank：32×32 正好每列撞同一个柜台，多一列就错开了
    __shared__ float tile[TILE][TILE + 1];

    int x = blockIdx.x * TILE + threadIdx.x;
    int y = blockIdx.y * TILE + threadIdx.y;

    // 读：相邻线程读相邻地址（合并）
    if (x < N && y < N) {
        tile[threadIdx.y][threadIdx.x] = in[y * N + x];
    }
    __syncthreads();

    // 写：目标方块的坐标是转置后的，block 的 x、y 互换
    int tx = blockIdx.y * TILE + threadIdx.x;
    int ty = blockIdx.x * TILE + threadIdx.y;

    // 从黑板上"竖着"取（tile[x][y]），写到全局内存是相邻地址（合并）
    if (tx < N && ty < N) {
        out[ty * N + tx] = tile[threadIdx.x][threadIdx.y];
    }
}

int main() {
    const int N = 1024;
    size_t bytes = N * N * sizeof(float);
    float* h_in  = new float[N * N];
    float* h_out = new float[N * N];
    for (int i = 0; i < N * N; ++i) h_in[i] = (float)i;

    float *d_in, *d_out;
    cudaMalloc(&d_in, bytes); cudaMalloc(&d_out, bytes);
    cudaMemcpy(d_in, h_in, bytes, cudaMemcpyHostToDevice);

    dim3 block(TILE, TILE);
    dim3 grid(N / TILE, N / TILE);

    // 用 CUDA 事件计时，比较两个版本
    cudaEvent_t start, stop;
    cudaEventCreate(&start); cudaEventCreate(&stop);
    float ms;

    cudaEventRecord(start);
    transposeNaive<<<grid, block>>>(d_in, d_out, N);
    cudaEventRecord(stop); cudaEventSynchronize(stop);
    cudaEventElapsedTime(&ms, start, stop);
    printf("朴素转置：%.3f ms\\n", ms);

    cudaEventRecord(start);
    transposeTiled<<<grid, block>>>(d_in, d_out, N);
    cudaEventRecord(stop); cudaEventSynchronize(stop);
    cudaEventElapsedTime(&ms, start, stop);
    printf("分块转置：%.3f ms（通常快 2~4 倍）\\n", ms);

    cudaMemcpy(h_out, d_out, bytes, cudaMemcpyDeviceToHost);
    // 验证：out[1][0] 应该等于 in[0][1] = 1
    printf("out[1*N+0] = %.0f（应该是 1）\\n", h_out[1 * N + 0]);

    cudaEventDestroy(start); cudaEventDestroy(stop);
    cudaFree(d_in); cudaFree(d_out);
    delete[] h_in; delete[] h_out;
    return 0;
}`,
      points: [
        '合并访问 = 一个 warp 里 32 个相邻线程访问连续的一段地址，一次搬完',
        '行优先存储下，让 threadIdx.x 对应列（最内层下标），读写才是连续的',
        '必须跳着访问的那一步，放到共享内存里做，全局内存只做连续读写',
        '共享内存数组加一列 [TILE][TILE+1]，是为了避开 bank conflict',
        '用 cudaEvent 计时是 GPU 上的标准做法，比 CPU 时钟准',
      ],
      pitfalls: [
        '让 threadIdx.x 对应行、threadIdx.y 对应列：看起来一样，实际每次访存都散开，慢好几倍',
        '用结构体数组（AoS）存数据，每个线程只读其中一个字段：一箱里大部分是没用的',
        '在 CPU 上用 clock() 给 kernel 计时：kernel 是异步的，测出来接近 0',
        '忘了共享内存加 padding（+1）：分块转置比朴素版快得没那么多',
      ],
    },

    {
      id: 'streams-async',
      title: 'Stream 与异步：一边搬货一边干活',
      lang: 'cpp',
      tags: ['性能', '进阶'],
      why: '默认情况下所有事在一条流水线上排队：搬货 → 算 → 搬回来，搬的时候 GPU 闲着，算的时候马路闲着。Stream 就是多开几条流水线：第一批货在算的时候，第二批已经在马路上了。前提是 CPU 内存得"钉住"（pinned），不然搬货只能同步进行。',
      code: `#include <cstdio>
#include <cuda_runtime.h>

__global__ void work(float* data, int n) {
    int i = blockIdx.x * blockDim.x + threadIdx.x;
    if (i < n) {
        // 故意多算几步，让计算时间明显一点
        float v = data[i];
        for (int k = 0; k < 100; ++k) v = v * 1.0001f + 0.5f;
        data[i] = v;
    }
}

int main() {
    const int N = 1 << 22;          // 四百万个元素
    const int NSTREAM = 4;          // 开 4 条流水线
    const int CHUNK = N / NSTREAM;  // 每条流水线处理四分之一
    size_t bytes = N * sizeof(float);
    size_t chunkBytes = CHUNK * sizeof(float);

    // 关键一：pinned memory（钉住的内存）
    // 普通 new/malloc 的内存操作系统可能随时挪动，GPU 没法直接搬，只能同步拷
    // cudaMallocHost 申请的内存不会被挪，GPU 可以在后台直接搬，才能真正异步
    float* h_data;
    cudaMallocHost(&h_data, bytes);
    for (int i = 0; i < N; ++i) h_data[i] = 1.0f;

    float* d_data;
    cudaMalloc(&d_data, bytes);

    // 关键二：创建几条 stream
    cudaStream_t streams[NSTREAM];
    for (int s = 0; s < NSTREAM; ++s) cudaStreamCreate(&streams[s]);

    // 关键三：把"搬过去 → 算 → 搬回来"三件事都塞进同一条 stream
    // 同一条 stream 内按顺序执行，不同 stream 之间可以重叠
    int threads = 256;
    int blocks = (CHUNK + threads - 1) / threads;
    for (int s = 0; s < NSTREAM; ++s) {
        int offset = s * CHUNK;
        cudaMemcpyAsync(d_data + offset, h_data + offset, chunkBytes,
                        cudaMemcpyHostToDevice, streams[s]);
        // kernel 启动的第四个参数就是 stream（第三个是动态共享内存大小，这里 0）
        work<<<blocks, threads, 0, streams[s]>>>(d_data + offset, CHUNK);
        cudaMemcpyAsync(h_data + offset, d_data + offset, chunkBytes,
                        cudaMemcpyDeviceToHost, streams[s]);
    }

    // 上面的循环几乎瞬间跑完（都是异步的），这里等所有 stream 干完
    cudaDeviceSynchronize();

    printf("h_data[0] = %.3f, h_data[N-1] = %.3f\\n", h_data[0], h_data[N - 1]);

    for (int s = 0; s < NSTREAM; ++s) cudaStreamDestroy(streams[s]);
    cudaFree(d_data);
    cudaFreeHost(h_data);   // pinned 内存要用 cudaFreeHost 释放，不是 free
    return 0;
}`,
      points: [
        'stream 是一条队列，队列里的事按顺序做；不同 stream 可以同时做',
        'cudaMemcpyAsync 多一个 stream 参数，发完就返回，不等搬完',
        '异步拷贝必须配 cudaMallocHost 申请的 pinned 内存，普通内存会退化成同步',
        'kernel 启动的第四个参数是 stream：<<<grid, block, 0, stream>>>',
        '把大数据切成几块，每块走一条 stream，就能让搬货和计算重叠',
      ],
      pitfalls: [
        '用 new 出来的内存调 cudaMemcpyAsync：不报错，但实际是同步的，白忙一场',
        '循环刚结束就读 h_data：拷贝还没回来，读到的是旧值；要先 cudaDeviceSynchronize',
        'pinned 内存用 free/delete 释放：要用 cudaFreeHost',
        '所有 kernel 都不写 stream 参数：全在默认 stream 上排队，多开的 stream 等于没开',
      ],
    },

    {
      id: 'warp-basics',
      title: 'Warp 与分支发散：32 人小队要步调一致',
      lang: 'cpp',
      tags: ['性能', '进阶'],
      why: 'GPU 里的线程不是一个个单独跑的，而是 32 个一组（叫 warp），像一个方阵，同一时刻做同一条指令。如果方阵里有人走 if、有人走 else，方阵只能先陪 if 的人走一遍，再陪 else 的人走一遍，两边都白等。另外，既然 32 人本来就步调一致，他们之间传数据可以不用黑板，直接"递纸条"——这就是 __shfl_down_sync。',
      code: `#include <cstdio>
#include <cuda_runtime.h>

#define WARP 32
#define BLOCK 256

// ---------- 分支发散示例 ----------
// 坏写法：按 threadIdx.x 的奇偶分支，每个 warp 里一半人走 if 一半走 else
__global__ void divergeBad(float* data) {
    int i = threadIdx.x;
    if (i % 2 == 0) data[i] = data[i] * 2.0f;   // 偶数号
    else            data[i] = data[i] + 1.0f;   // 奇数号
    // 方阵得走两遍：先偶数那遍（奇数陪跑），再奇数那遍（偶数陪跑）
}

// 好写法：按 warp 整体分支，前 4 个 warp 走 if，后 4 个走 else
// 每个 warp 内部所有人走同一条路，不发散
__global__ void divergeGood(float* data) {
    int i = threadIdx.x;
    int warpId = i / WARP;
    if (warpId % 2 == 0) data[i] = data[i] * 2.0f;
    else                 data[i] = data[i] + 1.0f;
}

// ---------- 用 shuffle 做 warp 内归约 ----------
// __shfl_down_sync(掩码, 我的值, 偏移)：
//   拿到"同 warp 里编号比我大 offset 的那个人"手里的值
//   0xffffffff 是掩码，表示 32 个人全参加
// 不用共享内存、不用 __syncthreads，5 步就把 32 个数加成 1 个
__device__ float warpReduceSum(float val) {
    for (int offset = WARP / 2; offset > 0; offset >>= 1) {
        val += __shfl_down_sync(0xffffffff, val, offset);
    }
    return val;   // 只有 lane 0（warp 里的 0 号）拿到的是完整的和
}

// 整个 block 的归约：先每个 warp 内归约，再把 8 个 warp 的结果加起来
__global__ void blockReduceSum(const float* in, float* out, int n) {
    __shared__ float warpSums[BLOCK / WARP];   // 8 个 warp 各一个小计

    int tid  = threadIdx.x;
    int gi   = blockIdx.x * blockDim.x + threadIdx.x;
    int lane = tid % WARP;    // 我在 warp 里是第几号
    int wid  = tid / WARP;    // 我在第几个 warp

    float val = (gi < n) ? in[gi] : 0.0f;

    // 第一步：warp 内递纸条求和
    val = warpReduceSum(val);

    // 第二步：每个 warp 的 0 号把小计写到黑板上
    if (lane == 0) warpSums[wid] = val;
    __syncthreads();

    // 第三步：让第 0 个 warp 把 8 个小计再加一次
    if (wid == 0) {
        val = (lane < BLOCK / WARP) ? warpSums[lane] : 0.0f;
        val = warpReduceSum(val);
        if (lane == 0) out[blockIdx.x] = val;
    }
}

int main() {
    const int n = 1 << 20;
    size_t bytes = n * sizeof(float);
    float* h_in = new float[n];
    for (int i = 0; i < n; ++i) h_in[i] = 1.0f;

    int blocks = (n + BLOCK - 1) / BLOCK;
    float *d_in, *d_partial;
    cudaMalloc(&d_in, bytes);
    cudaMalloc(&d_partial, blocks * sizeof(float));
    cudaMemcpy(d_in, h_in, bytes, cudaMemcpyHostToDevice);

    blockReduceSum<<<blocks, BLOCK>>>(d_in, d_partial, n);

    float* h_partial = new float[blocks];
    cudaMemcpy(h_partial, d_partial, blocks * sizeof(float), cudaMemcpyDeviceToHost);
    double total = 0;
    for (int i = 0; i < blocks; ++i) total += h_partial[i];
    printf("总和 = %.0f（应该是 %d）\\n", total, n);

    cudaFree(d_in); cudaFree(d_partial);
    delete[] h_in; delete[] h_partial;
    return 0;
}`,
      points: [
        'warp = 32 个连续线程，同一时刻执行同一条指令，是 GPU 调度的最小单位',
        '分支发散：warp 内有人走 if 有人走 else，两条路都要跑，时间翻倍',
        '避免发散的办法：让分支条件按 warp 对齐（比如按 tid / 32 判断，而不是 tid % 2）',
        '__shfl_down_sync 让 warp 内线程直接交换寄存器里的值，不经过共享内存',
        'warp 内归约 5 步（16, 8, 4, 2, 1）就完成，是现代归约的标准写法',
      ],
      pitfalls: [
        '__shfl_down_sync 掩码写成 0 或漏写：编译警告不管，结果是错的',
        '以为 warp 内不用同步就到处不同步：跨 warp 传数据（比如 warpSums）还是要 __syncthreads',
        'block 大小不是 32 的倍数：最后一个 warp 不满员，shuffle 会读到未定义的值',
        '看到 if 就害怕：只有 warp 内部分裂才发散，整个 warp 走同一条路不吃亏',
      ],
    },
  ],
};
