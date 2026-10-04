import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseSpriteContract } from "@cyber-stray/shared/sprite";
import { StreetStage } from "@/components/StreetStage";
import { LoopFlow } from "@/components/LoopFlow";
import { FeatureBento } from "@/components/FeatureBento";
import { PostcardWall } from "@/components/PostcardWall";
import { InviteBenefits } from "@/components/InviteBenefits";

/**
 * 官网单页（静态导出）：掌机顶栏 + Hero 街区舞台 + 闭环 + 功能 + 明信片墙 +
 * 内测权益 + 邀请 CTA。帧表契约构建期读盘校验（同 web/app/page.tsx 模式），
 * 交互体全部下沉 StreetStage 一个 client 岛。
 */

// CTA 指向伴侣端应用。静态导出 = 构建期烘焙 NEXT_PUBLIC_APP_URL；
// 发布必须明确提供地址，防止静态产物把用户送到自己的 localhost。
function appUrl(): string {
  const configured = process.env.NEXT_PUBLIC_APP_URL;
  if (!configured && process.env.NODE_ENV === "production") {
    throw new Error("官网构建缺少 NEXT_PUBLIC_APP_URL");
  }
  const url = new URL(configured ?? "http://127.0.0.1:3000");
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) {
    throw new Error("NEXT_PUBLIC_APP_URL 必须为无凭据的 HTTP(S) 地址");
  }
  return url.toString();
}
const REPO_URL = "https://github.com/Zewang0217/cyber-stray";
const INVITE_URL = `${REPO_URL}/issues/new?title=${encodeURIComponent("申请邀请内测")}&body=${encodeURIComponent("想让街溜子探索的兴趣方向：\n\n请勿在公开 Issue 中填写邮箱、邀请码或其他隐私信息。")}`;

export default function Home() {
  const app = appUrl();
  const contract = parseSpriteContract(
    JSON.parse(readFileSync(join(process.cwd(), "public/pet/strayboy/frames.json"), "utf8")),
  );
  return (
    <>
      <header className="topbar">
        <span className="led" aria-hidden="true" />
        <span className="brand ps2">STRAY-BOY</span>
        <span className="clock" aria-hidden="true">
          DAY 12 · 22:41
        </span>
        <nav aria-label="页面导航">
          <a className="navi" href="#loop">
            它怎么活
          </a>
          <a className="navi" href="#wall">
            明信片墙
          </a>
          <a className="navi" href="#invite">
            内测权益
          </a>
          <a className="pbtn blue" href={INVITE_URL}>
            申请邀请
          </a>
        </nav>
      </header>

      <main id="main-content">
        <div className="wrap">
          <div className="hero">
            <div className="hero-copy">
              <h1>
                在云上养一只猫，
                <br />
                <span className="hl">它自己</span>逛互联网。
              </h1>
              <p className="sub">
                它自己选路线，自己记看到的东西，喜好慢慢自己长。遇上它觉得你会喜欢的，就寄成明信片回来。
              </p>
              <div className="cta-row">
                <a className="pbtn blue big" href={INVITE_URL}>
                  申请邀请内测
                </a>
                <a className="navi" href={app}>已有账号，进入街区</a>
              </div>
            </div>
            <StreetStage contract={contract} />
          </div>
        </div>

        <LoopFlow />
        <FeatureBento />
        <PostcardWall />
        <InviteBenefits />

        <section id="adopt">
          <div className="wrap">
            <div className="adopt">
              <span className="who">&lt;年糕&gt;</span>
              <h2 className="dot">墙上给你留了位置。</h2>
              <p>内测期间免费，按批次邀请。收到邀请函后，从专属链接登录领养。</p>
              <a className="pbtn blue big" href={INVITE_URL}>
                申请邀请内测
              </a>
            </div>
          </div>
        </section>
      </main>

      <div className="wrap">
        <footer>
          <span>
            <i style={{ background: "#1A1C2C" }} />
            SKY
          </span>
          <span>
            <i style={{ background: "#F8F5F5" }} />
            PAPER
          </span>
          <span>
            <i style={{ background: "#209CEE" }} />
            ACT
          </span>
          <span>
            <i style={{ background: "#F7D51D" }} />
            HI
          </span>
          <span>
            <i style={{ background: "#FF004D" }} />
            NEON ×1
          </span>
          <a href={REPO_URL}>GitHub</a>
          <span className="right">RADIUS 0 · 实色偏移阴影 · STEPS ONLY · 14色宇宙</span>
        </footer>
      </div>
    </>
  );
}
