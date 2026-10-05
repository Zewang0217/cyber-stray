import { isIP } from 'node:net';

// 构建期校验与镜像构建共用入口，防止官网 CTA 与所选部署模式不一致。
const mode = process.env.DEPLOY_MODE || 'https_domains';
const url = new URL(process.env.NEXT_PUBLIC_APP_URL);
if (url.username || url.password || url.search || url.hash || url.pathname !== '/') {
  throw new Error('APP_URL 必须是无凭据、路径或查询参数的应用 origin');
}
if (mode === 'https_domains') {
  if (url.origin !== 'https://app.kleinbottle.top') {
    throw new Error('HTTPS 域名模式的 APP_URL 必须为 https://app.kleinbottle.top');
  }
} else if (mode === 'http_ip') {
  const ip = process.env.PUBLIC_IP;
  if (isIP(ip ?? '') !== 4 || url.origin !== `http://${ip}`) {
    throw new Error('HTTP IP 模式的 APP_URL 必须为 http://PUBLIC_IP，且 PUBLIC_IP 为 IPv4');
  }
} else {
  throw new Error('DEPLOY_MODE 必须为 https_domains 或 http_ip');
}
