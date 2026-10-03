const NODES = [
  { key: "探索", desc: "无聊了就出门" },
  { key: "学习", desc: "有用的记下来" },
  { key: "反思", desc: "睡前把一天过一遍" },
  { key: "进化兴趣", desc: "下次喜欢什么会变" },
  { key: "更懂你", desc: "你的赞和踩它都记" },
  { key: "更准推送", desc: "只寄你想看的" },
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
          它不按时推送。无聊了就出门，看到东西就记下来，每晚睡前再把一天过一遍。
          下次喜欢什么，由这些事决定，我们插不上手。
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
          这条环一天跑一遍，不需要谁推它。兴趣进化对所有档位免费，
          花钱的只有你手动操控的那部分。
        </p>
      </div>
    </section>
  );
}

