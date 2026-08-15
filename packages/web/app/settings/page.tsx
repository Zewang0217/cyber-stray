"use client";
import { motion } from "framer-motion";
import { useWebPush } from "@/hooks/useWebPush";
import { useChannels } from "@/hooks/useChannels";

/**
 * 设置页面
 * 只读展示当前配置，提示修改需编辑后端 .env
 */
export default function SettingsPage(): React.ReactElement {
  const { state: pushState, error: pushError, enable, disable } = useWebPush();
  const { channels, bindFeishu, unbindFeishu, error: channelError } = useChannels();

  return (
    <div className="spacing-lg max-w-6xl mx-auto">
      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ type: "spring", stiffness: 400, damping: 25 }}
      >
        <h1
          className="font-heading text-hero font-bold text-text"
          style={{ letterSpacing: "-0.04em" }}
        >
          设置
        </h1>
        <p className="text-body text-subtext mt-1">
          查看当前 Agent 配置（修改需编辑后端 .env 文件）
        </p>
      </motion.div>

      <motion.div
        className="grid grid-cols-1 lg:grid-cols-2 gap-6"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ type: "spring", stiffness: 400, damping: 25, delay: 0.1 }}
      >
        {/* 心跳配置 */}
        <div className="p-6 rounded-2xl backdrop-blur-xl bg-mantle/[0.05] border border-white/10">
          <h2 className="font-heading text-heading font-bold text-text mb-4">
            心跳与状态
          </h2>
          <div className="space-y-4 font-mono text-sm">
            <div className="flex justify-between">
              <span className="text-subtext">心跳间隔</span>
              <span className="text-text">5 分钟</span>
            </div>
            <div className="flex justify-between">
              <span className="text-subtext">无聊增长速率</span>
              <span className="text-text">+5 / 心跳</span>
            </div>
            <div className="flex justify-between">
              <span className="text-subtext">精力恢复速率</span>
              <span className="text-text">+2 / 心跳</span>
            </div>
            <div className="flex justify-between">
              <span className="text-subtext">无聊阈值</span>
              <span className="text-text">50</span>
            </div>
            <div className="flex justify-between">
              <span className="text-subtext">精力阈值</span>
              <span className="text-text">20</span>
            </div>
          </div>
        </div>

        {/* LLM 配置 */}
        <div className="p-6 rounded-2xl backdrop-blur-xl bg-mantle/[0.05] border border-white/10">
          <h2 className="font-heading text-heading font-bold text-text mb-4">
            LLM 配置
          </h2>
          <div className="space-y-4 font-mono text-sm">
            <div className="flex justify-between">
              <span className="text-subtext">模型</span>
              <span className="text-text">deepseek-chat</span>
            </div>
            <div className="flex justify-between">
              <span className="text-subtext">Temperature</span>
              <span className="text-text">0.8</span>
            </div>
          </div>
        </div>

        {/* 搜索配置 */}
        <div className="p-6 rounded-2xl backdrop-blur-xl bg-mantle/[0.05] border border-white/10">
          <h2 className="font-heading text-heading font-bold text-text mb-4">
            搜索配置
          </h2>
          <div className="space-y-4 font-mono text-sm">
            <div className="flex justify-between">
              <span className="text-subtext">最大结果数</span>
              <span className="text-text">10</span>
            </div>
            <div className="flex justify-between">
              <span className="text-subtext">搜索 API</span>
              <span className="text-text">Tavily</span>
            </div>
          </div>
        </div>

        {/* 推送配置 */}
        <div className="p-6 rounded-2xl backdrop-blur-xl bg-mantle/[0.05] border border-white/10">
          <h2 className="font-heading text-heading font-bold text-text mb-4">
            推送渠道
          </h2>
          <div className="space-y-4 font-mono text-sm">
            <div className="flex justify-between items-center">
              <span className="text-subtext">飞书 Webhook</span>
              <span className="text-success text-xs">已配置</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-subtext">Telegram Bot</span>
              <span className="text-subtext text-xs">未配置</span>
            </div>
          </div>
        </div>

        {/* 系统推送（S10）：Web Push 订阅开关 */}
        <div className="p-6 rounded-2xl backdrop-blur-xl bg-mantle/[0.05] border border-white/10">
          <h2 className="font-heading text-heading font-bold text-text mb-2">系统推送</h2>
          <p className="text-small text-subtext mb-4">
            关掉 App 也能收到它的推送（浏览器系统级通知）
          </p>
          {pushState === "unsupported" ? (
            <p className="text-small text-subtext">当前浏览器不支持系统推送</p>
          ) : pushState === "denied" ? (
            <p className="text-small text-danger">
              通知权限被拒绝——请在浏览器站点设置中允许通知后重试
            </p>
          ) : (
            <div className="flex items-center gap-3">
              <button
                type="button"
                disabled={pushState === "subscribing"}
                onClick={() => void (pushState === "on" ? disable() : enable())}
                className={`px-4 py-2 rounded-xl text-small font-medium transition-colors ${
                  pushState === "on"
                    ? "bg-success/20 text-success"
                    : "bg-accent text-base font-semibold"
                } disabled:opacity-50`}
              >
                {pushState === "subscribing"
                  ? "订阅中…"
                  : pushState === "on"
                    ? "已开启（点击关闭）"
                    : "开启系统推送"}
              </button>
              {pushError ? <span className="text-small text-danger">{pushError}</span> : null}
            </div>
          )}
        </div>

        {/* 飞书通道（S10）：可选绑定 */}
        <div className="p-6 rounded-2xl backdrop-blur-xl bg-mantle/[0.05] border border-white/10">
          <h2 className="font-heading text-heading font-bold text-text mb-2">飞书通道（可选）</h2>
          <p className="text-small text-subtext mb-4">
            绑定后推送同步发到飞书群机器人（高级用户）
          </p>
          {channels?.feishu ? (
            <div className="flex items-center gap-3">
              <span className="text-small text-success">已绑定</span>
              <button
                type="button"
                onClick={() => void unbindFeishu()}
                className="px-3 py-1.5 rounded-xl text-small bg-danger/10 text-danger"
              >
                解绑
              </button>
            </div>
          ) : (
            <form
              className="flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                const form = e.currentTarget;
                const webhook = new FormData(form).get("webhook");
                if (typeof webhook === "string") void bindFeishu(webhook);
                form.reset();
              }}
            >
              <input
                name="webhook"
                type="url"
                required
                placeholder="https://open.feishu.cn/open-apis/bot/v2/hook/…"
                className="flex-1 px-3 py-2 rounded-xl bg-surface text-small text-text border border-white/10"
              />
              <button
                type="submit"
                className="px-4 py-2 rounded-xl text-small bg-accent text-base font-semibold"
              >
                绑定
              </button>
            </form>
          )}
          {channelError ? <p className="text-small text-danger mt-2">{channelError}</p> : null}
        </div>
      </motion.div>

      {/* 提示 */}
      <motion.div
        className="mt-6 p-4 rounded-xl bg-warning/10 border border-warning/20"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.3 }}
      >
        <p className="text-sm text-warning">
          提示：以上配置仅作展示。如需修改，请编辑项目根目录下的 .env 文件并重启 Agent。
        </p>
      </motion.div>
    </div>
  );
}
