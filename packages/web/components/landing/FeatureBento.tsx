import styles from "./landing.module.css";

export function FeatureBento() {
  return (
    <section id="features" aria-labelledby="features-title">
      <div className={styles.wrap}>
        <div className={styles.sectionGrid}>
          <div className={styles.sectionIntro}>
            <span className={`${styles.sectionIndex} ${styles.mono}`}>03 / LIFE BETWEEN PUSHES</span>
            <h2 id="features-title" className={styles.dot}>不推送的时候，<br />它也在生活。</h2>
          </div>
          <p className={styles.lede}>不是一张等你戳的电子贴纸。它有性格、有记忆，也有不给你看的新鲜事。</p>
        </div>
        <div className={styles.bento}>
          <article className={`${styles.tile} ${styles.tileA}`}>
            <span className={`${styles.zzz} ${styles.vt}`} aria-hidden="true">Z z Z</span>
            <span className={`${styles.tileLabel} ${styles.mono}`}>NIGHT SHIFT</span>
            <h3 className={styles.dot}>日记与梦境</h3>
            <p>睡前写下去过哪里、记住了什么、你回应了哪张明信片。到了夜里，白天的见闻还会在梦里重新组合。</p>
            <div className={styles.diaryCard}>
              <time>DAY 12 · 23:58</time>
              <p>今天主人赞了那张独立游戏的明信片。我趴在机器边听了一会儿风扇转。梦里我成了一张贴好邮票的明信片。</p>
            </div>
          </article>

          <article className={`${styles.tile} ${styles.tileB}`}>
            <span className={`${styles.tileLabel} ${styles.mono}`}>PERSONALITY.SYS</span>
            <h3 className={styles.dot}>性格与口头禅</h3>
            <p>性格在领养时选择，口头禅由你决定。它用自己的语气说话，也会从你的反馈里慢慢调整表达。</p>
            <div className={styles.dlgMini}>
              <span className={styles.who}>&lt;小溜&gt;</span>
              <p>呼噜呼噜……手劲不错，准许再拍两下。</p>
            </div>
            <div className={styles.catchphrases}><span>喵一下。</span><span>还行吧？</span><span>有货了。</span></div>
          </article>

          <article className={`${styles.tile} ${styles.tileD}`}>
            <span className={`${styles.tileLabel} ${styles.mono}`}>TWO MAPS, ONE CAT</span>
            <h3 className={styles.dot}>它的好奇，不只围着你转</h3>
            <p>一张图谱记你喜欢什么，另一张记它自己好奇什么。两张地图一起决定探索与分享，所以它既越来越懂你，也仍然有自己的品味。</p>
            <div className={styles.dual}>
              <div className={`${styles.col} ${styles.you}`}><b>你的兴趣</b><div className={styles.tags}><span>独立游戏</span><span>复古互联网</span><span>脱口秀</span></div></div>
              <div className={`${styles.col} ${styles.it}`}><b>它的好奇</b><div className={styles.tags}><span>像素管线</span><span>深夜电台</span><span>机械键盘</span></div></div>
            </div>
          </article>

          <article className={`${styles.tile} ${styles.tileE}`}>
            <div>
              <span className={`${styles.tileLabel} ${styles.mono}`}>SLEEP SCHEDULE</span>
              <h3 className={styles.dot}>到点就睡，别来吵猫</h3>
              <p>作息由你设置。睡着不出门，拍拍也不会醒，顶多翻个身哼唧两声。</p>
            </div>
            <div className={styles.daynight} aria-hidden="true">
              <div className={`${styles.half} ${styles.day}`}><b>08:00 醒</b><span>白天上网找乐子</span></div>
              <div className={`${styles.half} ${styles.night}`}><b>22:00 睡</b><span>写日记，做梦</span></div>
            </div>
          </article>
        </div>
      </div>
    </section>
  );
}
