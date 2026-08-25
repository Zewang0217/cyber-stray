/**
 * Service Worker（S10，#77）——Web Push 系统级通知
 *
 * App 关闭也能收：推送到达时 SW 唤醒展示通知；点击聚焦/打开仪表盘。
 * 载荷结构与控制面 push-gateway 的 PushPayload 对齐：
 * { title, body, url?, timestamp }
 */

self.addEventListener("push", (event) => {
  let payload = null;
  try {
    payload = event.data ? event.data.json() : null;
  } catch {
    payload = null;
  }
  if (!payload || !payload.title) {
    payload = { title: "街溜子有新发现", body: "它逛到了有趣的东西" };
  }

  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      icon: "/window.svg",
      badge: "/window.svg",
      // 同 tag 折叠，防连发刷屏；renotify 让折叠后仍提示
      tag: "cyber-stray-push",
      renotify: true,
      data: { url: payload.url || "/" },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/";
  // client.navigate 只对同源受控窗口有效（跨源静默失效）；推送里的
  // url 多为外链文章——同源聚焦+导航，跨源聚焦已有窗口并新开文章
  const origin = new URL(self.registration.scope).origin;
  const target = new URL(url, self.registration.scope);
  const sameOrigin = target.origin === origin;

  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((clients) => {
        for (const client of clients) {
          if ("focus" in client) {
            return client
              .focus()
              .then(() => (sameOrigin && "navigate" in client ? client.navigate(target.href) : null))
              .then(() => (sameOrigin ? null : self.clients.openWindow(target.href)));
          }
        }
        return self.clients.openWindow(target.href);
      }),
  );
});
