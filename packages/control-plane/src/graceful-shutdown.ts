/**
 * 优雅停机编排（#138 / ADR-0008）——控制面收到停止信号后的收口序列：
 *
 *   1. stopDispatch：停调度器/任务处理器/轮询（不再派发新游荡）
 *   2. drain：等在飞游荡干净收尾（预算 budgetMs，默认 90s；compose
 *      stop_grace_period 需覆盖预算 + 余量）
 *   3. 预算耗尽 → forceKill：强制终止在飞 worker——孤儿由既有 lease /
 *      DB 冷却机制自愈（S5 既有设计，不新增）
 *   4. detach：收口后卸除推送分发与轮询（防孤儿并发写租户 state.json）
 *   5. exit(0)：进程退出（容器编排的 SIGKILL 是最终兜底）
 *
 * 依赖全部注入（停止语义 + worker 终止可注入），不依赖真实定时器等待。
 * 单测见 graceful-shutdown.test.ts；scheduler.stop() 的"不再派发"语义
 * 见 scheduler.test.ts。
 */

export interface GracefulShutdownDeps {
  /** 停止派发：调度器/任务处理器/轮询的 stop（不再拉起新游荡） */
  stopDispatch: () => void;
  /** 等在飞游荡收口（scheduler.drain；拒绝 = 未成功收口，走强杀兜底） */
  drain: () => Promise<void>;
  /** 预算耗尽/未收口时强制终止在飞 worker（stopAllWorkers + stopAllDiaryWorkers） */
  forceKill: () => void;
  /** 收口后卸除推送分发与轮询（push gateway / wechat gateway detach） */
  detach: () => void;
  /** 进程退出（生产 process.exit；测试注入） */
  exit: (code: number) => void;
  /** 收口预算（ms；60–90s 区间，compose stop_grace_period 必须覆盖） */
  budgetMs: number;
}

/**
 * 预算内收口判定：drain 在预算内成功落定 → true；超时或拒绝 → false。
 * 定时器在 drain 先落定时清除（不留悬挂句柄）。
 */
function withinBudget(drain: Promise<void>, budgetMs: number): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<boolean>((resolve) => {
    timer = setTimeout(() => resolve(false), budgetMs);
  });
  return Promise.race([drain.then(() => true, () => false), timeout]).finally(() => {
    if (timer !== undefined) clearTimeout(timer);
  });
}

/** 执行优雅停机序列（fire-and-forget；index.ts 接 SIGTERM/SIGINT 时调用） */
export async function runGracefulShutdown(deps: GracefulShutdownDeps): Promise<void> {
  deps.stopDispatch();
  console.log(`[shutdown] 已停止派发；等在飞游荡收口（预算 ${deps.budgetMs}ms）`);

  const drained = await withinBudget(deps.drain(), deps.budgetMs);
  if (!drained) {
    console.log('[shutdown] 预算耗尽，强制终止在飞 worker（孤儿由既有 lease 自愈）');
    deps.forceKill();
  } else {
    console.log('[shutdown] 在飞游荡已收口');
  }

  deps.detach();
  console.log('[shutdown] 已卸除推送分发，退出');
  deps.exit(0);
}
