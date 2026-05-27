// v2.0：v1.x 用户管理弹窗已被 AccountsAdminPanel 取代（平台控制台里）。
// 保留空导出以避免历史 import 报错；不再使用。

interface Props {
  open: boolean
  onClose: () => void
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function UsersAdminModal(_: Props) {
  return null
}
