const NODES = [
  { key: "探索", desc: "无聊了就出门逛互联网" },
  { key: "学习", desc: "抓到新鲜货，记进记忆" },
  { key: "反思", desc: "睡前想想今天学到了啥" },
  { key: "进化兴趣", desc: "图鉴自己长出新分枝" },
  { key: "更懂你", desc: "你的赞和踩都喂给它" },
  { key: "更准推送", desc: "把你想看的钉上墙" },
];

/** 核心闭环（产品主轴）：探索 → 学习 → 反思 → 进化兴趣 → 更懂主人 → 更准推送 */
export function LoopFlow() {
  return (
    <section id="loop">
      <div className="wrap">
        <div className="mainhead">
          <h2>它怎么活</h2>
          <span className="rule" />
        </div>
        <p className="lede">
          它不是按时推送的订阅机器人。它被<b>自己不断进化的好奇心</b>驱动：探索什么、学到什么、
          喜欢上什么，都是它自己的事。
        </p>
        <div className="flow">
          {NODES.map((n) => (
            <div className="node" key={n.key}>
              <i />
              <b className="dot">{n.key}</b>
              <span>{n.desc}</span>
            </div>
          ))}
        </div>
        <p className="loopnote">
          这条环跑完一圈，会从头上再来一遍。<b>兴趣进化永远免费</b>
          ，你只负责看墙上的明信片，偶尔点个赞或者踩。
        </p>
      </div>
    </section>
  );
}
