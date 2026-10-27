import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseSpriteContract } from "@cyber-stray/shared/sprite";
import { StreetStage } from "./StreetStage";
import { LoopFlow } from "./LoopFlow";
import { FeatureBento } from "./FeatureBento";
import { PostcardWall } from "./PostcardWall";
import { InviteBenefits } from "./InviteBenefits";
import styles from "./landing.module.css";

const REPO_URL = "https://github.com/Zewang0217/cyber-stray";
const INVITE_URL = "/apply";

export function LandingPage() {
  const contract = parseSpriteContract(
    JSON.parse(readFileSync(join(process.cwd(), "public/pet/strayboy/frames.json"), "utf8")),
  );
  return (
    <div className={styles.page}>
      <header className={styles.topbar}>
        <a className={styles.brandLink} href="#top" aria-label="回到首页顶部">
          <span className={styles.led} aria-hidden="true" />
          <span className={`${styles.brand} ${styles.ps2}`}>STRAY-BOY</span>
        </a>
        <span className={styles.clock} aria-hidden="true">CLOUD PET / 001</span>
        <nav aria-label="页面导航">
          <a className={styles.navi} href="#loop">好奇闭环</a>
          <a className={styles.navi} href="#wall">它的来信</a>
          <a className={styles.navi} href="#invite">内测权益</a>
          <a className={`${styles.pbtn} ${styles.blue}`} href={INVITE_URL}>申请邀请</a>
        </nav>
      </header>

      <div id="top">
        <section className={styles.heroSection} aria-labelledby="hero-title">
          <pre className={styles.heroSignals} aria-hidden="true">{`       +       .         +
  [BOOKS]──┐        ┌──[CAFE]
           └──[ ??? ]┘
  001 / FOLLOW_CURIOSITY
  :::: ::::: :::: :::: ::::`}</pre>
          <div className={styles.wrap}>
            <div className={styles.hero}>
              <div className={styles.heroCopy}>
                <p className={`${styles.eyebrow} ${styles.mono}`}>A LITTLE LIFE, ONLINE.</p>
                <h1 id="hero-title">
                  你的云上有只猫。
                  <span className={styles.hl}>它自己逛互联网。</span>
                </h1>
                <p className={styles.sub}>
                  它有自己的好奇心、作息和脾气。出门探索，记住见闻，慢慢长出新的兴趣；
                  遇到你会喜欢的，就主动寄一张明信片回来。
                </p>
                <div className={styles.ctaRow}>
                  <a className={`${styles.pbtn} ${styles.blue} ${styles.big}`} href={INVITE_URL}>申请邀请内测</a>
                  <a className={styles.textLink} href="/login">已有账号，回到街区 <span aria-hidden="true">→</span></a>
                </div>
                <p className={styles.heroNote}><span aria-hidden="true">■</span> 不用喂养，不用打卡。它自己会安排今天。</p>
              </div>
              <StreetStage contract={contract} />
            </div>
          </div>
        </section>

        <LoopFlow />
        <FeatureBento />
        <PostcardWall />
        <InviteBenefits />

        <section id="adopt" className={styles.adoptSection}>
          <div className={styles.wrap}>
            <div className={styles.adopt}>
              <pre className={styles.adoptCat} aria-hidden="true">{` /\\_/\\  \n( o.o )  \n > ^ <   `}</pre>
              <div>
                <span className={styles.who}>&lt;年糕&gt;</span>
                <h2 className={styles.dot}>下一张明信片，寄给你。</h2>
                <p>内测期间免费，按批次邀请。收到邀请函后，从专属链接登录领养。</p>
                <a className={`${styles.pbtn} ${styles.blue} ${styles.big}`} href={INVITE_URL}>申请邀请内测</a>
              </div>
            </div>
          </div>
        </section>
      </div>

      <div className={styles.wrap}>
        <footer className={styles.footer}>
          <span className={styles.ps2}>STRAY-BOY</span>
          <span>云端活着，像素里见面。</span>
          <nav aria-label="页脚导航">
            <a href={REPO_URL}>GitHub</a>
            <a href="/login">登录</a>
          </nav>
          <span className={styles.right}>RADIUS 0 / STEPS ONLY</span>
        </footer>
      </div>
    </div>
  );
}
