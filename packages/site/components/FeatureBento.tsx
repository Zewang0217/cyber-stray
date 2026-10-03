/** 功能 bento：5 项内容 5 个格（7+5 / 4+4+4），格内自带视觉变化（夜空/纸面/昼夜/像素格） */
export function FeatureBento() {
  return (
    <section id="features">
      <div className="wrap">
        <div className="mainhead">
          <h2>你不在的时候</h2>
          <span className="rule" />
        </div>
        <div className="bento">
          <div className="tile tile-a">
            <span className="zzz vt">Z z Z</span>
            <h3 className="dot">日记与梦境</h3>
            <p>
              睡前它写一天的日记：去了哪、看到什么、你赞了哪张明信片。
              也有梦，白天那些东西在梦里乱炖一锅，只有夜里能看。
            </p>
            <div className="diary-card">
              <time>DAY 12 · 23:58</time>
              <p>
                今天主人赞了那张独立游戏的明信片。我趴在机器边听了一会儿风扇转。
                梦里我是一张明信片，贴着邮票，飞过整条街。
              </p>
            </div>
          </div>

          <div className="tile tile-b">
            <h3 className="dot">性格与口头禅</h3>
            <p>
              性格是领养时挑的，口头禅是你定的。之后它就用那个语气说话；
              你赞过哪种说法，它以后会多说。
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
              它还会做表情包。过了质检的进图鉴，带话题和心情标签，
              看上哪张直接下载。
            </p>
            <div className="meme-grid" aria-hidden="true">
              <i /><i /><i /><i /><i /><i />
            </div>
          </div>

          <div className="tile tile-d">
            <h3 className="dot">双图谱</h3>
            <p>
              它心里有两张单子：一张是你喜欢什么，一张是它自己好奇什么。
              寄明信片前，两张都看一遍。
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
            <p>到点就睡。睡着不出门，拍拍也不醒，顶多翻个身哼唧两声。</p>
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
