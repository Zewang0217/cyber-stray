/**
 * 会话级统计收集器
 *
 * 追踪本次进程生命周期内的游荡轮次、步数、推送、反馈、错误等指标。
 * 与 AgentState 的累计统计（totalWanders 等）互补——AgentState 跨会话持久化，
 * SessionStats 只活在内存里，进程退出即清零。
 */

/** 单轮游荡的摘要 */
export interface WanderRoundSummary {
  /** 轮次序号（从 1 开始） */
  round: number;
  /** 本轮步数 */
  steps: number;
  /** 本轮是否触发了推送 */
  pushed: boolean;
  /** 本轮耗时（ms） */
  durationMs: number;
}

/** 会话统计快照（只读，供 TUI / 日志消费） */
export interface SessionStatsSnapshot {
  /** 会话开始时间戳（ms） */
  startedAt: number;
  /** 会话已持续时长（ms） */
  uptimeMs: number;
  /** 完成的游荡轮次数 */
  wanderRounds: number;
  /** 累计步数 */
  totalSteps: number;
  /** 推送次数 */
  pushes: number;
  /** 点赞次数 */
  likes: number;
  /** 踩次数 */
  dislikes: number;
  /** 错误次数 */
  errors: number;
  /** 每轮游荡摘要 */
  rounds: readonly WanderRoundSummary[];
}

/**
 * 会话统计收集器
 *
 * 用法：
 * ```ts
 * const stats = new SessionStats();
 * stats.beginRound();
 * stats.recordStep();
 * stats.recordStep();
 * stats.endRound({ pushed: true });
 * stats.recordFeedback('like');
 * const snap = stats.snapshot();
 * ```
 */
export class SessionStats {
  private readonly startedAt = Date.now();

  private rounds: WanderRoundSummary[] = [];
  private pushes = 0;
  private likes = 0;
  private dislikes = 0;
  private errors = 0;

  /** 当前进行中的轮次（null = 不在游荡中） */
  private current: { round: number; steps: number; startedAt: number } | null = null;

  /** 开始一轮游荡 */
  beginRound(): void {
    if (this.current) {
      // 上一轮未正常结束，按未推送收尾
      this.endRound({ pushed: false });
    }
    this.current = {
      round: this.rounds.length + 1,
      steps: 0,
      startedAt: Date.now(),
    };
  }

  /** 记录一个游荡步骤 */
  recordStep(): void {
    if (!this.current) return;
    this.current.steps++;
  }

  /** 结束当前轮次 */
  endRound({ pushed }: { pushed: boolean }): void {
    if (!this.current) return;
    if (pushed) this.pushes++;
    this.rounds.push({
      round: this.current.round,
      steps: this.current.steps,
      pushed,
      durationMs: Date.now() - this.current.startedAt,
    });
    this.current = null;
  }

  /** 记录用户反馈 */
  recordFeedback(type: 'like' | 'dislike'): void {
    if (type === 'like') this.likes++;
    else this.dislikes++;
  }

  /** 记录一次错误 */
  recordError(): void {
    this.errors++;
  }

  /** 获取只读快照 */
  snapshot(): SessionStatsSnapshot {
    const totalSteps = this.rounds.reduce((sum, r) => sum + r.steps, 0)
      + (this.current?.steps ?? 0);

    return {
      startedAt: this.startedAt,
      uptimeMs: Date.now() - this.startedAt,
      wanderRounds: this.rounds.length,
      totalSteps,
      pushes: this.pushes,
      likes: this.likes,
      dislikes: this.dislikes,
      errors: this.errors,
      rounds: this.rounds,
    };
  }
}
