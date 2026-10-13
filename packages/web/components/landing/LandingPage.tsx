import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseSpriteContract } from "@cyber-stray/shared/sprite";
import { StreetStage } from "./StreetStage";
import { LoopFlow } from "./LoopFlow";
import { FeatureBento } from "./FeatureBento";
import { PostcardWall } from "./PostcardWall";
import { InviteBenefits } from "./InviteBenefits";
import styles from "./landing.module.css";

/**
 * 官网落地页（并入 web 后的未登录首页）：掌机顶栏 + Hero 街区舞台 + 闭环 +
 * 功能 + 明信片墙 + 内测权益 + 邀请 CTA。内容/文案/视觉逐字沿用 packages/site
 * 单页；帧表契约构建期读盘校验（同街角页模式），交互体全部下沉 StreetStage
 * 一个 client 岛。
 *
 * CTA 一律同源相对链接（官网包构建期 NEXT_PUBLIC_APP_URL 注入与其 URL 守卫随
 * 官网退役删除，产品入口不再跨源）。
 */
const REPO_URL = "https://github.com/Zewang0217/cyber-stray";
/** 申请入口：站内申请页（不收集邮箱等隐私，凭申请号 + 查询码取邀请函） */
const INVITE_URL = "/apply";

export function LandingPage() {
  const contract = parseSpriteContract(
    JSON.parse(readFileSync(join(process.cwd(), "public/pet/strayboy/frames.json"), "utf8")),
  );
  return (
    <div className={styles.page}>
      <header className={styles.topbar}>
        <span className={styles.led} aria-hidden="true" />
        <span className={`${styles.brand} ${styles.ps2}`}>STRAY-BOY</span>
        <span className={styles.clock} aria-hidden="true">
          DAY 12 · 22:41
        </span>
        <nav aria-label="页面导航">
          <a className={styles.navi} href="#loop">
            它怎么活
          </a>
          <a className={styles.navi} href="#wall">
            明信片墙
          </a>
          <a className={styles.navi} href="#invite">
            内测权益
          </a>
          <a className={`${styles.pbtn} ${styles.blue}`} href={INVITE_URL}>
            申请邀请
          </a>
        </nav>
      </header>

      {/* 布局已提供 <main id="main-content">：此处不再套 main 地标，避免重复 id */}
      <div>
        <div className={styles.wrap}>
          <div className={styles.hero}>
            <div className={styles.heroCopy}>
              <h1>
                在云上养一只猫，
                <br />
                <span className={styles.hl}>它自己</span>逛互联网。
              </h1>
              <p className={styles.sub}>
                它自己选路线，自己记看到的东西，喜好慢慢自己长。遇上它觉得你会喜欢的，就寄成明信片回来。
              </p>
              <div className={styles.ctaRow}>
                <a className={`${styles.pbtn} ${styles.blue} ${styles.big}`} href={INVITE_URL}>
                  申请邀请内测
                </a>
                <a className={styles.navi} href="/login">
                  已有账号，进入街区
                </a>
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
          <div className={styles.wrap}>
            <div className={styles.adopt}>
              <span className={styles.who}>&lt;年糕&gt;</span>
              <h2 className={styles.dot}>墙上给你留了位置。</h2>
              <p>内测期间免费，按批次邀请。收到邀请函后，从专属链接登录领养。</p>
              <a className={`${styles.pbtn} ${styles.blue} ${styles.big}`} href={INVITE_URL}>
                申请邀请内测
              </a>
            </div>
          </div>
        </section>
      </div>

      <div className={styles.wrap}>
        <footer className={styles.footer}>
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
          <span className={styles.right}>RADIUS 0 · 实色偏移阴影 · STEPS ONLY · 14色宇宙</span>
        </footer>
      </div>
    </div>
  );
}
