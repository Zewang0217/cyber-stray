/**
 * 控制面 Hono 应用组装（依赖注入，可测）
 */

import { Hono } from 'hono';
import type { ControlPlaneConfig } from './config.js';
import type { OidcProvider } from './oidc.js';
import type { EventBus } from './events/bus.js';
import { createAuthRoutes } from './routes/auth.js';
import { StateStore } from './state-store.js';
import { createDataRoutes } from './routes/data.js';
import { createPetsRoutes } from './routes/pets.js';
import { createEventsRoutes } from './routes/events.js';
import { createFeedbackRoutes } from './routes/feedback.js';
import { createPushRoutes } from './routes/push.js';
import { createChannelsRoutes } from './routes/channels.js';
import { createPlanRoutes } from './routes/plan.js';
import { createAdminRoutes } from './routes/admin.js';
import { createEvolutionRoutes } from './routes/evolution.js';
import { createFootprintRoutes } from './routes/footprint.js';
import { createDiaryRoutes } from './routes/diary.js';
import { createDreamRoutes } from './routes/dream.js';
import { createWechatRoutes } from './routes/wechat.js';
import { createPetGenRoutes } from './routes/petgen.js';
import { createMemeRoutes } from './routes/meme.js';
import { createPetAssetRoutes } from './routes/pet-assets.js';
import type { BindingService } from './ilink/binding-service.js';
export interface AppDeps {
  config: ControlPlaneConfig;
  oidc: OidcProvider;
  /** 事件总线（与调度器共享；SSE 路由消费调度器发布的事件） */
  bus: EventBus;
  /** 微信绑定状态机（#97；index.ts 构造注入） */
  wechatBindings?: BindingService;
}

export function createApp({ config, oidc, bus, wechatBindings }: AppDeps): Hono {
  const app = new Hono();

  app.get('/healthz', (c) => c.json({ ok: true }));

  app.route('/api/auth', createAuthRoutes({ config, oidc, states: new StateStore() }));

  // S6：Web 只读数据面（鉴权 + 按会话租户路由）
  app.route('/api', createDataRoutes({ config }));

  // S7：领养旅程（写路径：建宠物行 + 兴趣种子；仍以 session claim 定租户）
  app.route('/api', createPetsRoutes({ config }));

  // S8：应用内实时（SSE，调度器事件 → 租户浏览器连接）
  app.route('/api', createEventsRoutes({ config, bus }));

  // S9：反馈回路（点赞/踩 + 顶话题节流；spawn agent feedback-cli 复用反馈管道）
  app.route('/api', createFeedbackRoutes({ config }));

  // S10：Web Push 订阅管理（公开 vapid-key + 登录态订阅 CRUD）
  app.route('/api/push', createPushRoutes({ config }));

  // S10：每租户通道绑定（飞书可选；webhook 走 S4 加密，worker 注入）
  app.route('/api/channels', createChannelsRoutes({ config }));

  // S11：套餐门控用户面（切换/限额/推送窗口/BYOK key）
  app.route('/api/plan', createPlanRoutes({ config }));

  // S13：运营管理面板（CP_ADMIN_SUBS 白名单）
  app.route('/api/admin', createAdminRoutes({ config }));

  // S13：进化可视化 + 回滚（快照序列/反馈事件/游荡摘要）
  app.route('/api/evolution', createEvolutionRoutes({ config }));

  // S14：游荡足迹（每次 loop 每一步骤）
  app.route('/api/footprint', createFootprintRoutes({ config }));

  // #92：日记（睡前任务生成；列表/单篇，租户隔离）
  app.route('/api/diary', createDiaryRoutes({ config }));

  // #93：梦境（与日记同刻预生成；列表/单篇，租户隔离）
  app.route('/api/dream', createDreamRoutes({ config }));

  // #97：微信通道（扫码即用绑定 + 状态；未挂载 bindings 时跳过——单测 app 组装可省略）
  if (wechatBindings) {
    app.route('/api/wechat', createWechatRoutes({ config, bindings: wechatBindings }));
  }

  // #94：宠物 IP 自定义生成（Pro/BYOK 专属；任务状态机在 petgen/processor.ts）
  app.route('/api/petgen', createPetGenRoutes({ config }));

  // #95：宠物素材消费（manifest 按租户 + 鉴权素材服务；web 只读消费方）
  app.route('/api', createPetAssetRoutes({ config }));

  // #96：表情包图鉴（agent 生成管线落盘 meme-assets/，这里提供列表/图片/删除）
  app.route('/api/meme', createMemeRoutes({ config }));

  return app;
}
