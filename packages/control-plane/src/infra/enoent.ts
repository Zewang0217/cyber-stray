/** 文件缺失（ENOENT）= 合法空态的判定；其他读/解析错误必须显式抛（禁兜底） */
export function isEnoent(error: unknown): boolean {
  return (error as NodeJS.ErrnoException).code === 'ENOENT';
}
