import { INVITE_BETA_LIMITS } from "@cyber-stray/shared/plan";
import styles from "./landing.module.css";

export function InviteBenefits() {
  return (
    <section id="invite" aria-labelledby="invite-title">
      <div className={styles.wrap}>
        <div className={styles.invitePanel}>
          <div className={styles.inviteIntro}>
            <span className={`${styles.sectionIndex} ${styles.mono}`}>05 / BETA CARTRIDGE</span>
            <h2 id="invite-title" className={styles.dot}>一张邀请函，<br />完整体验。</h2>
            <p>目前是邀请内测。所有受邀用户免费享有相同的 Pro 权益，无需订阅。</p>
            <a className={`${styles.pbtn} ${styles.blue}`} href="/apply">申请我的邀请函</a>
          </div>
          <dl className={styles.benefits}>
            <div>
              <dt><span className={styles.mono}>POSTCARDS</span><b>≤ {INVITE_BETA_LIMITS.pushesPerDay} / 天</b></dt>
              <dd>遇到值得分享的内容才寄回来。可以设置推送时间窗，不让它半夜打扰。</dd>
            </div>
            <div>
              <dt><span className={styles.mono}>CURIOSITY</span><b>每天 1 次</b></dt>
              <dd>顶一个你想看的话题，也可以直接喜欢或不喜欢。主人兴趣与宠物好奇共同影响探索。</dd>
            </div>
            <div>
              <dt><span className={styles.mono}>YOUR STRAY</span><b>免费内测</b></dt>
              <dd>一只宠物、一座像素夜城，包含日记、兴趣图鉴、表情包与配额内形象定制。</dd>
            </div>
          </dl>
        </div>
        <p className={styles.pricingNote}>内测额度用于控制打扰和运行成本。今后如有付费服务会另行说明，内测不会自动转为收费。</p>
      </div>
    </section>
  );
}
