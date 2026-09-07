/**
 * 兴趣图谱跨模块共享常量。
 *
 * 独立零依赖叶子模块：config.ts（默认行为配置）与 interest-graph.ts
 * （DEFAULT_INTEREST_CONFIG）都要引用同一衰减值，放任一侧都会造成
 * 分层倒挂或 import 环——此前两处手写 0.0116 靠注释同步即由此起（review #159）。
 */

/**
 * 兴趣权重时间衰减 λ（单位：/天）。
 *
 * λ = ln2 / 60：半衰期 60 天（S2 #151）。旧值 0.1/天 ≈ 6.9 天半衰期，
 * 兴趣快速凉透导致图谱多样性死锁（#147）。
 */
export const INTEREST_DECAY_LAMBDA = Math.LN2 / 60;
