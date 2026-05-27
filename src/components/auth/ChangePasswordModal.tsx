import { Modal } from '@/components/ui/Modal'
import { ChangePasswordForm } from './ChangePasswordForm'

interface Props {
  open: boolean
  onClose: () => void
}

/**
 * v1.4: 自助修改密码弹窗，入口：侧边栏 / Header「修改密码」按钮。
 * 改密成功后会自动踢掉其他设备（后端 token_version+1），但当前设备会用新 token 继续登录。
 */
export function ChangePasswordModal({ open, onClose }: Props) {
  return (
    <Modal open={open} onClose={onClose} title="修改密码">
      <div className="w-[420px]">
        <ChangePasswordForm
          mode="voluntary"
          onCancel={onClose}
          onSuccess={onClose}
        />
      </div>
    </Modal>
  )
}
