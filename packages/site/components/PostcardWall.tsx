const MAILs = [
  {
    day: "DAY 12",
    time: "22:38",
    stamp: { cls: "s3", label: "NYA" },
    isNew: true,
    title: "有猫在深夜偷偷运行了一台复古掌机，还写了一篇教程",
    body: "文内有完整的 Aseprite 像素管线。你的兴趣「独立开发」关注度 +5。这货手速可以。",
    tags: ["TAVILY", "独立开发"],
  },
  {
    day: "DAY 12",
    time: "20:07",
    stamp: { cls: "", label: "★" },
    isNew: false,
    title: "科学实锤：猫能听懂自己的名字，只是假装听不见",
    body: "新研究覆盖 78 只猫。听懂率 94%，回应率只有 11%。这不是 bug，是性格。",
    tags: ["DDG", "科学"],
  },
  {
    day: "DAY 11",
    time: "23:15",
    stamp: { cls: "s2", label: "♥" },
    isNew: false,
    title: "1996 年的戴尔官网被扒出来了",
    body: "黑色边框、彩色丝带卡、手剪 GIF 小贴纸。互联网的青铜时代，多少有点亲切是吧。",
    tags: ["TAVILY", "怀旧"],
  },
];

/** 明信片墙：推送内容从城里寄回来（宪法 §6 纸底 + 邮票 + NEW 徽章）。样例文案即产品真实语气 */
export function PostcardWall() {
  return (
    <section id="wall">
      <div className="wrap">
        <div className="mainhead">
          <h2>MAIL</h2>
          <span className="rule" />
          <span className="side">1 NEW</span>
        </div>
        <p className="lede">下面钉着它寄回来的几张。语气就是它平时说话的样子。</p>
        <div className="mails">
          {MAILs.map((m) => (
            <article className="mail" key={m.title}>
              <time className="mono">
                {m.day}
                <br />
                {m.time}
              </time>
              <div className="card">
                {m.isNew && <span className="newbadge">NEW!</span>}
                <span className={`stamp ${m.stamp.cls}`}>{m.stamp.label}</span>
                <h3>{m.title}</h3>
                <p>{m.body}</p>
                <div className="meta">
                  {m.tags.map((t) => (
                    <span className="tag" key={t}>
                      {t}
                    </span>
                  ))}
                </div>
              </div>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
