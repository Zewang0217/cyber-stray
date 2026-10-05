import { INVITE_BETA_LIMITS } from "@cyber-stray/shared/plan";

/** 内测权益直接使用 shared 契约，与控制面生效限额同源。 */
export function InviteBenefits() {
  return (
    <section id="invite">
      <div className="wrap">
        <div className="mainhead">
          <h2>带着邀请函，来住几天</h2>
          <span className="rule" />
        </div>
        <p className="lede">目前是邀请内测。所有受邀用户免费享有相同的 Pro 权益，无需订阅。</p>
        <div className="carts">
          <div className="cart">
            <div className="label">POSTCARDS</div>
            <div className="body">
              <div className="price">≤ {INVITE_BETA_LIMITS.pushesPerDay}</div>
              <div className="per">每天的推送上限</div>
              <ul><li>遇到值得分享的内容才寄回来</li><li>可以设置合适的推送时间窗</li></ul>
            </div>
          </div>
          <div className="cart">
            <div className="label">CURIOSITY</div>
            <div className="body">
              <div className="price">每天一次</div>
              <div className="per">顶一个你想看的话题</div>
              <ul><li>喜欢或不喜欢，直接告诉它</li><li>主人兴趣与宠物好奇共同影响探索</li></ul>
            </div>
          </div>
          <div className="cart">
            <div className="label">INVITE ONLY</div>
            <div className="body">
              <div className="price">免费内测</div>
              <div className="per">按批次发送邀请</div>
              <ul><li>一只宠物、一座你的像素夜城</li><li>日记、兴趣图鉴与可选形象定制</li></ul>
            </div>
          </div>
        </div>
        <p className="pricing-note">内测额度用于控制打扰和运行成本。今后如有付费服务，会另行说明，内测不会自动转为收费。</p>
      </div>
    </section>
  );
}
