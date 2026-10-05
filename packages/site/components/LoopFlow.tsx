const NODES = [
  { key: "探索", desc: "无聊了就出门" },
  { key: "学习", desc: "有用的记下来" },
  { key: "反思", desc: "积累够了再想一想" },
  { key: "进化兴趣", desc: "下次喜欢什么会变" },
  { key: "更懂你", desc: "你的赞和踩它都记" },
  { key: "更准推送", desc: "试着挑你喜欢的" },
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
          无聊了就出门，看到东西就记下来，积累一些见闻后再反思。
          你的回应和它自己的发现，一起影响下一次去哪里逛。
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
          内测期间，所有受邀用户都能体验这条成长路径。它有自己的探索节奏，
          你可以用赞、踩和顶话题给它一点方向。
        </p>
      </div>
    </section>
  );
}

