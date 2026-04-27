import { useState } from 'react'
import { Sidebar } from './Sidebar'

interface AppLayoutProps {
  children: React.ReactNode
}

export default function AppLayout({ children }: AppLayoutProps) {
  const [activeNav, setActiveNav] = useState('cases')

  return (
    <div className="flex h-screen w-full overflow-hidden bg-slate-50">
      <Sidebar activeNav={activeNav} onNavChange={setActiveNav} />

      {/* Main content */}
      <main className="flex flex-1 flex-col overflow-hidden">
        {children}
      </main>
    </div>
  )
}
