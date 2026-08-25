/**
 * PaperTexture - 维多利亚图鉴的纸张纹理背景层
 * 替代废弃的 CyberGridBackground(赛博网格雨) + MouseGlow(鼠标光晕)。
 *
 * 做:静态/极慢漂移的纸张 noise 纹理,让 UI 落在「图鉴纸面」上而非赛博空间。
 * 不做:网格雨、跟随鼠标光晕、任何赛博朋克动效。
 */
export function PaperTexture(): React.ReactElement {
  return (
    <div
      aria-hidden
      className="fixed inset-0 z-0 pointer-events-none"
      style={{
        backgroundColor: "var(--c-paper)",
        backgroundImage: "var(--paper-texture)",
        backgroundRepeat: "repeat",
        opacity: 0.6,
      }}
    />
  );
}
