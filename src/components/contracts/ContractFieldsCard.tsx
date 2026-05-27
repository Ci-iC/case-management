import { useEffect, useState } from 'react'
import { Plus, X, ArrowLeftRight } from 'lucide-react'
import { contractsApi, type ContractFields, type ContractMeta } from '@/api/contracts'
import { usersApi } from '@/api/users'

// ─── 静态枚举（兜底，正常会从 contracts/meta 拉） ────────────────────────────
const CONTRACT_TYPES = [
  '货物销售合同', '货物采购合同', '矿权转让合同', '研发实验类合同',
  '行政采购类合同', '人力资源服务类合同', '合作协议', '代理协议',
  '房屋租赁合同', '股权转让合同', '补充协议',
]
const PAYMENT_TYPES = ['收款', '付款', '借贷', '框架类', '无金额']
const TERM_TYPES = ['固定日期', '固定期限', '无期限']
const REQUIRES_AMOUNT = new Set(['收款', '付款', '借贷'])

export interface ContractFieldsState extends ContractFields {
  handlerId?: string | null
}

interface Props {
  /** 初始值 */
  initial?: ContractFieldsState
  /** 字段变化时回调（受控） */
  onChange?: (state: ContractFieldsState) => void
  /** 是否禁用所有输入（如 AI 提取中、或发起审批后变只读） */
  readOnly?: boolean
  /** 隐藏经办人字段（如审批流末节点不展示） */
  hideHandler?: boolean
}

interface Contact {
  id: string
  username: string
  displayName?: string
  roles: string[]
}

export function ContractFieldsCard({ initial, onChange, readOnly, hideHandler }: Props) {
  const [meta, setMeta] = useState<ContractMeta | null>(null)
  const [contacts, setContacts] = useState<Contact[]>([])

  // 本地状态（受控时通过 onChange 同步出去）
  const [name, setName] = useState(initial?.contractName || '')
  const [ourParties, setOurParties] = useState<string[]>(initial?.ourParties || [])
  const [counterParties, setCounterParties] = useState<string[]>(initial?.counterParties || [])
  const [contractType, setContractType] = useState<string>(initial?.contractType || '')
  const [paymentType, setPaymentType] = useState<string>(initial?.paymentType || '')
  const [contractAmount, setContractAmount] = useState<string>(initial?.contractAmount != null ? String(initial.contractAmount) : '')
  const [termType, setTermType] = useState<string>(initial?.termType || '')
  const [termDate, setTermDate] = useState<string>(initial?.termDate || '')
  const [termText, setTermText] = useState<string>(initial?.termText || '')
  const [handlerId, setHandlerId] = useState<string>(initial?.handlerId || '')

  useEffect(() => {
    contractsApi.meta().then(setMeta).catch(() => { /* 用静态兜底 */ })
    usersApi.contacts().then(({ contacts }) => setContacts(contacts)).catch(() => { /* ignore */ })
  }, [])

  // 任一字段变 → onChange
  useEffect(() => {
    onChange?.({
      contractName: name.trim() || null,
      ourParties: ourParties.filter(Boolean),
      counterParties: counterParties.filter(Boolean),
      contractType: contractType || null,
      paymentType: paymentType || null,
      contractAmount: contractAmount ? Number(contractAmount) : null,
      termType: termType || null,
      termDate: termType === '固定日期' ? (termDate || null) : null,
      termText: termType === '固定期限' ? (termText || null) : null,
      handlerId: handlerId || null,
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name, ourParties, counterParties, contractType, paymentType, contractAmount, termType, termDate, termText, handlerId])

  // 当 paymentType 切到"无金额/框架类"时清空金额
  useEffect(() => {
    if (!REQUIRES_AMOUNT.has(paymentType)) setContractAmount('')
  }, [paymentType])

  const contractTypeOptions = meta?.contractTypes || CONTRACT_TYPES
  const paymentTypeOptions = meta?.paymentTypes || PAYMENT_TYPES
  const termTypeOptions = meta?.termTypes || TERM_TYPES

  return (
    <div className="space-y-3">
      {/* 合同名称 */}
      <Field label="合同名称" required>
        <input value={name} onChange={e => setName(e.target.value)}
          className="form-input" disabled={readOnly} maxLength={120} />
      </Field>

      {/* 我方 / 对方签署主体 */}
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-xs font-medium text-slate-600">签署主体</span>
          {!readOnly && (
            <button
              type="button"
              onClick={() => {
                // 交换我方 / 对方（AI 可能分不清哪方是我方，给用户一键互换）
                const prevOur = ourParties
                setOurParties(counterParties)
                setCounterParties(prevOur)
              }}
              className="inline-flex items-center gap-1 text-[11px] text-primary-600 hover:text-primary-800 px-1.5 py-0.5 rounded hover:bg-primary-50"
              title="一键互换我方与对方的签署主体"
            >
              <ArrowLeftRight size={12} /> 交换我方 / 对方
            </button>
          )}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <PartyArrayField label="我方签署主体（最多 3 个）" parties={ourParties} setParties={setOurParties} readOnly={readOnly} accent="our" />
          <PartyArrayField label="对方签署主体（最多 3 个）" parties={counterParties} setParties={setCounterParties} readOnly={readOnly} accent="counter" />
        </div>
      </div>

      {/* 合同类型 / 收付款类型 */}
      <div className="grid grid-cols-2 gap-3">
        <Field label="合同类型" required>
          <select value={contractType} onChange={e => setContractType(e.target.value)}
            className="form-select" disabled={readOnly}>
            <option value="">—请选择—</option>
            {contractTypeOptions.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        </Field>
        <Field label="收付款类型" required>
          <select value={paymentType} onChange={e => setPaymentType(e.target.value)}
            className="form-select" disabled={readOnly}>
            <option value="">—请选择—</option>
            {paymentTypeOptions.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        </Field>
      </div>

      {/* 合同款项 —— 仅 收款/付款/借贷 时显示 */}
      {REQUIRES_AMOUNT.has(paymentType) && (
        <Field label="合同款项（元）" required>
          <input type="number" min="0" step="0.01" value={contractAmount}
            onChange={e => setContractAmount(e.target.value)}
            className="form-input" disabled={readOnly} placeholder="如 12345.67" />
        </Field>
      )}

      {/* 合同期限 */}
      <div className="grid grid-cols-2 gap-3">
        <Field label="合同期限类型" required>
          <select value={termType} onChange={e => setTermType(e.target.value)}
            className="form-select" disabled={readOnly}>
            <option value="">—请选择—</option>
            {termTypeOptions.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        </Field>
        {termType === '固定日期' && (
          <Field label="到期日期" required>
            <input type="date" value={termDate} onChange={e => setTermDate(e.target.value)}
              className="form-input" disabled={readOnly} />
          </Field>
        )}
        {termType === '固定期限' && (
          <Field label="期限描述" required>
            <input value={termText} onChange={e => setTermText(e.target.value)}
              className="form-input" disabled={readOnly} placeholder="如：一年、三个月、自签订日起 6 个月" maxLength={64} />
          </Field>
        )}
      </div>

      {/* 经办人 */}
      {!hideHandler && (
        <Field label="经办人" required>
          <select value={handlerId} onChange={e => setHandlerId(e.target.value)}
            className="form-select" disabled={readOnly}>
            <option value="">—请选择—（默认为当前用户）</option>
            {contacts.map(c => (
              <option key={c.id} value={c.id}>{c.displayName || c.username}（{c.username}）</option>
            ))}
          </select>
        </Field>
      )}
    </div>
  )
}

// ─── 子组件：Field 包装 ────────────────────────────────────────────────────────
function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-slate-600">
        {label}{required && <span className="text-red-400 ml-0.5">*</span>}
      </label>
      {children}
    </div>
  )
}

// ─── 子组件：数组型字段（多个签署主体） ─────────────────────────────────────
//   accent: 'our' = 我方（蓝），'counter' = 对方（琥珀），视觉上明确区分两方
function PartyArrayField({ label, parties, setParties, readOnly, accent }: {
  label: string
  parties: string[]
  setParties: (v: string[]) => void
  readOnly?: boolean
  accent?: 'our' | 'counter'
}) {
  // 至少保留 1 个空输入框，便于用户输入第一个
  const view = parties.length === 0 ? [''] : parties

  const theme = accent === 'counter'
    ? { box: 'border-amber-200 bg-amber-50/40', tag: 'bg-amber-100 text-amber-700', tagText: '对方' }
    : { box: 'border-blue-200 bg-blue-50/40', tag: 'bg-blue-100 text-blue-700', tagText: '我方' }

  function update(i: number, v: string) {
    const arr = [...view]
    arr[i] = v
    setParties(arr.filter((s, idx) => s || idx === arr.length - 1 || arr.slice(idx + 1).some(Boolean)))
  }
  function add() { setParties([...parties, '']) }
  function remove(i: number) { setParties(view.filter((_, idx) => idx !== i)) }

  return (
    <div className={`rounded-lg border ${theme.box} p-2`}>
      <div className="flex items-center gap-1.5 mb-1.5">
        {accent && (
          <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${theme.tag}`}>{theme.tagText}</span>
        )}
        <span className="text-[11px] font-medium text-slate-600">{label}</span>
      </div>
      <div className="space-y-1">
        {view.map((p, i) => (
          <div key={i} className="flex items-center gap-1.5">
            <input value={p} onChange={e => update(i, e.target.value)}
              className="form-input flex-1" disabled={readOnly} placeholder="主体名称"
              maxLength={120} />
            {view.length > 1 && !readOnly && (
              <button type="button" onClick={() => remove(i)}
                className="p-1 rounded text-slate-400 hover:text-red-600 hover:bg-red-50">
                <X size={12} />
              </button>
            )}
          </div>
        ))}
        {view.length < 3 && !readOnly && (
          <button type="button" onClick={add}
            className="inline-flex items-center gap-1 text-[11px] text-primary-600 hover:text-primary-800">
            <Plus size={11} />添加（最多 3 个）
          </button>
        )}
      </div>
    </div>
  )
}
