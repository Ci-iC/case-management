import { Briefcase, CheckCircle, AlertCircle, Clock } from 'lucide-react'
import { useCaseStats } from '@/store/useCaseStore'

interface StatCardProps {
  icon: React.ReactNode
  label: string
  value: number
  color: string
  bgColor: string
}

function StatCard({ icon, label, value, color, bgColor }: StatCardProps) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-slate-100 bg-white px-4 py-3 shadow-card">
      <div className={`flex h-9 w-9 items-center justify-center rounded-lg ${bgColor}`}>
        <span className={color}>{icon}</span>
      </div>
      <div>
        <p className="text-[11px] font-medium text-slate-500 uppercase tracking-wide">{label}</p>
        <p className="text-xl font-bold text-slate-900 leading-tight">{value}</p>
      </div>
    </div>
  )
}

export function CaseStatsBar() {
  const { total, active, closed, soon } = useCaseStats()

  return (
    <div className="grid grid-cols-4 gap-3">
      <StatCard
        icon={<Briefcase size={16} />}
        label="全部案件"
        value={total}
        color="text-primary-600"
        bgColor="bg-primary-50"
      />
      <StatCard
        icon={<Clock size={16} />}
        label="进行中"
        value={active}
        color="text-amber-600"
        bgColor="bg-amber-50"
      />
      <StatCard
        icon={<CheckCircle size={16} />}
        label="已结案"
        value={closed}
        color="text-emerald-600"
        bgColor="bg-emerald-50"
      />
      <StatCard
        icon={<AlertCircle size={16} />}
        label="7天内截止"
        value={soon}
        color={soon > 0 ? 'text-red-600' : 'text-slate-400'}
        bgColor={soon > 0 ? 'bg-red-50' : 'bg-slate-50'}
      />
    </div>
  )
}
