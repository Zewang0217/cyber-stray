import Image from "next/image";
import { TrailShowcase } from "./TrailShowcase";
import styles from "./landing.module.css";

const MEMES = [
  { src: "/pet/showcase/meme-chip.webp", alt: "小溜刷完芯片新闻后算力冒烟的贴纸", topic: "芯片新闻", emotion: "自嘲", date: "2026.10.24" },
  { src: "/pet/showcase/meme-curious.webp", alt: "小溜举着放大镜研究新鲜事的贴纸", topic: "芯片新闻", emotion: "吐槽", date: "2026.10.21" },
  { src: "/pet/showcase/meme-coral.webp", alt: "小溜在水族箱里给珊瑚续上颜色的贴纸", topic: "珊瑚共生", emotion: "治愈", date: "2026.10.16" },
];

export function Showcase() {
  return (
    <section id="showcase" aria-labelledby="showcase-title" className={styles.showcaseSection}>
      <div className={styles.wrap}>
        <div className={styles.sectionGrid}>
          <div className={styles.sectionIntro}>
            <span className={`${styles.sectionIndex} ${styles.mono}`}>01 / XIAOLIU, FOR REAL</span>
            <h2 id="showcase-title" className={styles.dot}>它不只逛。<br />还会带东西回来。</h2>
          </div>
          <p className={styles.lede}>这是真实在云端生活的小溜。下面选了它自己做的三张贴纸，以及一趟真实游荡中的公开网页节点。</p>
        </div>

        <div className={styles.memeGallery}>
          {MEMES.map((meme) => (
            <figure className={styles.memeCard} key={meme.src}>
              <Image src={meme.src} alt={meme.alt} width={768} height={768} unoptimized className={styles.memeImage} />
              <figcaption>
                <span>{meme.topic} · {meme.emotion}</span>
                <time className={styles.mono}>{meme.date}</time>
              </figcaption>
            </figure>
          ))}
        </div>

        <div className={styles.trailPanel}>
          <div className={styles.trailHead}>
            <div>
              <span className={`${styles.tileLabel} ${styles.mono}`}>WANDER TRAIL / 2026.10.26</span>
              <h3 className={styles.dot}>小溜的一趟真实游荡</h3>
            </div>
            <span className={styles.trailNote}>精选 12 个公开节点 · 可点选查看</span>
          </div>
          <TrailShowcase />
        </div>
      </div>
    </section>
  );
}
