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
                <li>
                  明信片 <b>3-5 张/天</b>
                </li>
                <li>兴趣方向操控 1 次/月</li>
                <li>
                  <b>自进化不受限</b>，它自己长兴趣永远免费
                </li>
              </ul>
            </div>
          </div>

          <div className="cart pro">
            <span className="badge dot">推荐</span>
            <div className="label">PRO</div>
            <div className="body">
              <div className="price">$3-5</div>
              <div className="per">每月 · 以正式发布为准</div>
              <ul>
                <li>
                  明信片 <b>最多 20 张/天</b>
                </li>
                <li>自定义推送时间窗</li>
                <li>兴趣方向操控 1 次/天</li>
              </ul>
            </div>
          </div>

          <div className="cart byok">
            <div className="label">BYOK</div>
            <div className="body">
              <div className="price">¥0</div>
              <div className="per">+ 自带 DeepSeek key</div>
              <ul>
                <li>
                  推送与操控<b>不设限</b>
                </li>
                <li>token 花在你自己的 key 上</li>
                <li>重用户的正经选择</li>
              </ul>
            </div>
          </div>
        </div>
        <p className="pricing-note">
          档位卡的是<b>你的手动操控频率</b>，从不卡它的成长。宠物自己进化兴趣，任何档位都一样自由。
        </p>
      </div>
    </section>
  );
}
