/** 功能 bento：5 项内容 5 个格（7+5 / 4+4+4），格内自带视觉变化（夜空/纸面/昼夜/像素格） */
export function FeatureBento() {
  return (
    <section id="features">
      <div className="wrap">
        <div className="mainhead">
          <h2>不止会推送</h2>
          <span className="rule" />
        </div>
        <div className="bento">
          <div className="tile tile-a">
            <span className="zzz vt">Z z Z</span>
            <h3 className="dot">日记与梦境</h3>
            <p>
              每晚睡前，它把今天写进<b>日记</b>：游荡了哪里、长出了什么新兴趣、你赞了哪条。
              熄灯之后还有<b>梦</b>，兴趣在梦里被重新联想一遍，夜里有得看。
            </p>
            <div className="diary-card">
              <time>DAY 12 · 23:58</time>
              <p>
                今天主人赞了那条独立游戏的明信片。我盯着机房的灯看了很久。
                梦里我变成一张贴了邮票的明信片，飞过整条街。
              </p>
            </div>
          </div>

          <div className="tile tile-b">
            <h3 className="dot">性格与口头禅</h3>
            <p>
              领养时给它挑<b>性格</b>、定<b>口头禅</b>。它用自己的语气说话，
              口头禅还会跟着你的好恶慢慢进化。
            </p>
            <div className="dlg-mini">
              <span className="who">&lt;年糕&gt;</span>
              <p>呼噜呼噜……手劲不错，准许再拍两下。</p>
            </div>
            <div className="catchphrases">
              <span>喵一下。</span>
              <span>还行吧？</span>
              <span>有货了。</span>
            </div>
          </div>

          <div className="tile tile-c">
            <h3 className="dot">表情包图鉴</h3>
            <p>
              它自己生成<b>专属表情包</b>，过了质检就自动收进图鉴，
              带话题和心情标签，随手可下载。
            </p>
            <div className="meme-grid" aria-hidden="true">
              <i /><i /><i /><i /><i /><i />
            </div>
          </div>

          <div className="tile tile-d">
            <h3 className="dot">双图谱</h3>
            <p>
              一张图谱记<b>你喜欢什么</b>，另一张记<b>它好奇什么</b>。
              相关性和品味一起进它的脑子，这条值不值得打扰你，它自己权衡。
            </p>
            <div className="dual">
              <div className="col you">
                <b>你的兴趣</b>
                <div className="tags">
                  <span>独立游戏</span>
                  <span>复古互联网</span>
                  <span>脱口秀</span>
                </div>
              </div>
              <div className="col it">
                <b>它的好奇</b>
                <div className="tags">
                  <span>像素管线</span>
                  <span>深夜电台</span>
                  <span>机械键盘</span>
                </div>
              </div>
            </div>
          </div>

          <div className="tile tile-e">
            <h3 className="dot">真实作息</h3>
            <p>
              它有作息表。睡觉时不游荡，拍拍也<b>不醒</b>，
              顶多翻个身哼唧两声。
            </p>
            <div className="daynight" aria-hidden="true">
              <div className="half day">
                <b>08:00 醒</b>
                <span>白天上网找乐子</span>
              </div>
              <div className="half night">
                <b>22:00 睡</b>
                <span>写日记，做梦</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
