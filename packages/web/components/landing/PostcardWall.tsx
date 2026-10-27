import styles from "./landing.module.css";

const MAILs = [
  {
    day: "DAY 12", time: "22:38", stamp: { cls: "s3", label: "NYA" }, isNew: true,
    title: "深夜掌机与像素教程",
    body: "文内有完整的 Aseprite 像素管线。你最近常看独立开发，这条应该对你的胃口。",
    tags: ["TAVILY", "独立开发"],
  },
  {
    day: "DAY 12", time: "20:07", stamp: { cls: "", label: "★" }, isNew: false,
    title: "猫听得懂，只是不想理",
    body: "新研究覆盖 78 只猫。听懂率 94%，回应率只有 11%。这不是 bug，是性格。",
    tags: ["DDG", "科学"],
  },
  {
    day: "DAY 11", time: "23:15", stamp: { cls: "s2", label: "♥" }, isNew: false,
    title: "1996 年的戴尔官网被扒出来了",
    body: "黑色边框、彩色丝带卡、手剪 GIF 小贴纸。互联网的青铜时代，多少有点亲切。",
    tags: ["TAVILY", "怀旧"],
  },
];

export function PostcardWall() {
  return (
    <section id="wall" aria-labelledby="wall-title">
      <div className={styles.wrap}>
        <div className={styles.sectionGrid}>
          <div className={styles.sectionIntro}>
            <span className={`${styles.sectionIndex} ${styles.mono}`}>03 / INCOMING MAIL</span>
            <h2 id="wall-title" className={styles.dot}>不是信息流，<br />是它寄回来的信。</h2>
          </div>
          <p className={styles.lede}>没有无限下拉。它觉得值得才寄来；你的赞、踩和顶话题，会影响下一次出发。</p>
        </div>
        <div className={styles.mails}>
          {MAILs.map((mail) => (
            <article className={styles.mail} key={mail.title}>
              <time className={styles.mono}>{mail.day}<br />{mail.time}</time>
              <div className={styles.card}>
                {mail.isNew && <span className={styles.newBadge}>NEW!</span>}
                <span className={`${styles.stamp} ${mail.stamp.cls ? styles[mail.stamp.cls] : ""}`}>{mail.stamp.label}</span>
                <h3>{mail.title}</h3>
                <p>{mail.body}</p>
                <div className={styles.meta}>{mail.tags.map((tag) => <span className={styles.tag} key={tag}>{tag}</span>)}</div>
              </div>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
