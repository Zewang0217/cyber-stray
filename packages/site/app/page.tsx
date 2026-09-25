import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseSpriteContract } from "@cyber-stray/shared/sprite";
import { StreetStage } from "@/components/StreetStage";
import { LoopFlow } from "@/components/LoopFlow";
import { FeatureBento } from "@/components/FeatureBento";
import { PostcardWall } from "@/components/PostcardWall";
import { PricingCarts } from "@/components/PricingCarts";

/**
 * 官网单页（静态导出）：掌机顶栏 + Hero 街区舞台 + 闭环 + 功能 + 明信片墙 +
 * 定价 + 领养 CTA。帧表契约构建期读盘校验（同 web/app/page.tsx 模式），
 * 交互体全部下沉 StreetStage 一个 client 岛。
 */
// CTA 指向伴侣端应用。静态导出 = 构建期烘焙 NEXT_PUBLIC_APP_URL；
// 发布流水线经 Dockerfile.site 的 ARG 注入对外地址（|| 兜住空串），
// 本地默认 web dev 端口。
const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "http://127.0.0.1:3000";
const REPO_URL = "https://github.com/Zewang0217/cyber-stray";

export default function Home() {
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
          <a className="navi" href="#pricing">
            定价
          </a>
          <a className="pbtn blue" href={APP_URL}>
            领养一只
          </a>
        </nav>
      </header>

      <main id="main-content">
        <div className="wrap">
          <div className="hero">
            <div className="hero-copy">
              <h1>
                一只活在云端的
                <br />
                <span className="hl">街猫</span>，替你游荡互联网。
              </h1>
              <p className="sub">
                它自己探索、学习、进化兴趣。抓到你会感兴趣的东西，就从城里
                <b>寄成明信片</b>给你。你是持机人，只观察、回应、拍拍。
              </p>
              <div className="cta-row">
                <a className="pbtn blue big" href={APP_URL}>
                  领养一只
                </a>
              </div>
            </div>
            <StreetStage contract={contract} />
          </div>
        </div>

        <LoopFlow />
        <FeatureBento />
        <PostcardWall />
        <PricingCarts />

        <section id="adopt">
          <div className="wrap">
            <div className="adopt">
              <span className="who">&lt;年糕&gt;</span>
              <h2 className="dot">墙上给你留了位置。</h2>
              <p>免费档就够它一直游荡下去。领养之后，它今晚就开始值夜班。</p>
              <a className="pbtn blue big" href={APP_URL}>
                领养一只
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
