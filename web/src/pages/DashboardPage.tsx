import Header from '../components/Header'
import CalendarView from '../components/CalendarView'
import TodoList from '../components/TodoList'
import type { Session } from '@supabase/supabase-js'

interface Props {
  session: Session
}

export default function DashboardPage({ session }: Props) {
  return (
    <div className="min-h-screen bg-gray-50">
      <Header session={session} />
      <main className="max-w-5xl mx-auto px-4 py-6">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

          {/* Calendar panel */}
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-100">
              <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-widest">This Week</h2>
            </div>
            <CalendarView />
          </div>

          {/* Todos panel */}
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-100">
              <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-widest">To Do</h2>
            </div>
            <TodoList session={session} />
          </div>

        </div>
      </main>
    </div>
  )
}
