/** 三档边界来自 CONTEXT.md 已锁定决策：卡的是主人手动操控频率，不卡宠物自进化 */
export function PricingCarts() {
  return (
    <section id="pricing">
      <div className="wrap">
        <div className="mainhead">
          <h2>卡带与月费</h2>
          <span className="rule" />
        </div>
        <div className="carts">
          <div className="cart">
            <div className="label">FREE</div>
            <div className="body">
              <div className="price">¥0</div>
              <div className="per">永久免费</div>
              <ul>
                <li>明信片 3-5 张/天</li>
                <li>操控方向 1 次/月</li>
                <li>兴趣进化不设限，所有档位都免费</li>
              </ul>
            </div>
          </div>

          <div className="cart pro">
            <span className="badge dot">推荐</span>
            <div className="label">PRO</div>
            <div className="body">
              <div className="price">$3-5</div>
              <div className="per">每月（以正式发布为准）</div>
              <ul>
                <li>明信片最多 20 张/天</li>
                <li>推送时间窗你定</li>
                <li>操控方向 1 次/天</li>
              </ul>
            </div>
          </div>

          <div className="cart byok">
            <div className="label">BYOK</div>
            <div className="body">
              <div className="price">¥0</div>
              <div className="per">+ 自带 DeepSeek key</div>
              <ul>
                <li>推送与操控不设限</li>
                <li>token 花在你自己的 key 上</li>
                <li>操控频率不低于 Pro</li>
              </ul>
            </div>
          </div>
        </div>
        <p className="pricing-note">
          付费档卖的是你手动操控的频率。猫自己的成长，任何档位都不卖。
        </p>
      </div>
    </section>
  );
}
