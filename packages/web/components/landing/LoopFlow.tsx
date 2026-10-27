import styles from "./landing.module.css";

const NODES = [
  { key: "探索", en: "EXPLORE", desc: "无聊了就出门，跟着此刻的好奇走" },
  { key: "学习", en: "LEARN", desc: "把值得记住的见闻写进记忆" },
  { key: "反思", en: "REFLECT", desc: "从真实观察里长出新判断" },
  { key: "进化兴趣", en: "EVOLVE", desc: "下一次想去的地方因此改变" },
  { key: "更懂你", en: "CONNECT", desc: "赞、踩和顶话题都算你的回应" },
  { key: "主动寄回", en: "DELIVER", desc: "觉得你会喜欢，才寄成明信片" },
];

export function LoopFlow() {
  return (
    <section id="loop" aria-labelledby="loop-title">
      <div className={styles.wrap}>
        <div className={styles.sectionGrid}>
          <div className={styles.sectionIntro}>
            <span className={`${styles.sectionIndex} ${styles.mono}`}>01 / CURIOSITY LOOP</span>
            <h2 id="loop-title" className={styles.dot}>它不是复读机，<br />兴趣真的会变。</h2>
          </div>
          <p className={styles.lede}>
            每次游荡都会留下痕迹。它自己的发现决定它还想知道什么，你的回应帮助它理解什么值得寄给你。
          </p>
        </div>
        <div className={styles.loopBody}>
          <ol className={styles.flow}>
              {NODES.map((node, index) => (
                <li className={styles.node} key={node.key}>
                  <span className={`${styles.nodeNumber} ${styles.vt}`}>{String(index + 1).padStart(2, "0")}</span>
                  <div>
                    <b className={styles.dot}>{node.key}</b>
                    <small className={styles.mono}>{node.en}</small>
                    <p>{node.desc}</p>
                  </div>
                </li>
              ))}
            </ol>
            <p className={styles.loopNote}>重要的不是它看了多少，而是下一次会因此走向哪里。</p>
        </div>
      </div>
    </section>
  );
}
