import { useEffect, useState, useCallback } from 'react'
import { format, parseISO, isBefore, startOfDay } from 'date-fns'
import { supabase } from '../lib/supabase'
import { Checkbox } from '@/components/ui/checkbox'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import type { Todo } from '../types'
import type { Session } from '@supabase/supabase-js'

interface Props {
  session: Session
}

// ── Add form ──────────────────────────────────────────────────────────────────
function AddForm({ onAdd }: { onAdd: (t: Todo) => void }) {
  const [title, setTitle] = useState('')
  const [notes, setNotes] = useState('')
  const [dueDate, setDueDate] = useState('')
  const [visibility, setVisibility] = useState<'shared' | 'private'>('shared')
  const [saving, setSaving] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!title.trim()) return
    setSaving(true)
    const { data, error } = await supabase.auth.getSession()
    if (error || !data.session) { setSaving(false); return }
    const email = data.session.user.email ?? ''
    const { data: todo, error: insertErr } = await supabase
      .from('todos')
      .insert({ title: title.trim(), notes: notes || null, due_date: dueDate || null, visibility, created_by: email })
      .select()
      .single()
    if (!insertErr && todo) {
      onAdd(todo as Todo)
      setTitle('')
      setNotes('')
      setDueDate('')
      setVisibility('shared')
    }
    setSaving(false)
  }

  return (
    <form onSubmit={(e) => void handleSubmit(e)} className="p-4 border-b border-gray-100 space-y-2">
      <Input
        placeholder="Add a task..."
        value={title}
        onChange={e => setTitle(e.target.value)}
        className="text-sm"
      />
      <div className="flex gap-2">
        <Textarea
          placeholder="Notes (optional)"
          value={notes}
          onChange={e => setNotes(e.target.value)}
          className="text-xs h-14 resize-none flex-1"
        />
        <div className="flex flex-col gap-1.5 shrink-0">
          <Input
            type="date"
            value={dueDate}
            onChange={e => setDueDate(e.target.value)}
            className="text-xs w-36 h-8"
          />
          {/* Visibility toggle */}
          <div className="flex rounded-md border border-gray-200 overflow-hidden text-xs h-8">
            <button
              type="button"
              onClick={() => setVisibility('shared')}
              className={`flex-1 px-2 transition-colors ${visibility === 'shared' ? 'bg-gray-900 text-white' : 'bg-white text-gray-500 hover:bg-gray-50'}`}
            >
              Shared
            </button>
            <button
              type="button"
              onClick={() => setVisibility('private')}
              className={`flex-1 px-2 transition-colors border-l border-gray-200 ${visibility === 'private' ? 'bg-gray-900 text-white' : 'bg-white text-gray-500 hover:bg-gray-50'}`}
            >
              Just me
            </button>
          </div>
          <Button type="submit" disabled={saving || !title.trim()} size="sm" className="h-8 text-xs">
            Add
          </Button>
        </div>
      </div>
    </form>
  )
}

// ── Single todo row ────────────────────────────────────────────────────────────
function TodoRow({
  todo,
  currentUserEmail,
  onToggle,
  onDelete,
}: {
  todo: Todo
  currentUserEmail: string
  onToggle: (id: string, completed: boolean) => void
  onDelete: (id: string) => void
}) {
  const today = startOfDay(new Date())
  const isOverdue = !todo.completed && todo.due_date
    ? isBefore(parseISO(todo.due_date), today)
    : false
  const isOwner = todo.created_by === currentUserEmail

  return (
    <li className={`flex items-start gap-3 px-4 py-3 group hover:bg-gray-50/50 ${todo.completed ? 'opacity-50' : ''}`}>
      <Checkbox
        checked={todo.completed}
        onCheckedChange={checked => onToggle(todo.id, checked as boolean)}
        className="mt-0.5 shrink-0"
      />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className={`text-sm ${todo.completed ? 'line-through text-gray-400' : 'text-gray-900'}`}>
            {todo.title}
          </span>
          <span className="text-gray-300 text-xs" title={todo.visibility === 'private' ? 'Private' : 'Shared'}>
            {todo.visibility === 'private' ? '🔒' : '👥'}
          </span>
        </div>
        {todo.notes && (
          <p className="text-xs text-gray-400 mt-0.5 line-clamp-2">{todo.notes}</p>
        )}
        {todo.due_date && (
          <span className={`text-xs font-medium mt-0.5 block ${isOverdue ? 'text-red-500' : 'text-gray-400'}`}>
            {isOverdue ? 'Overdue · ' : ''}{format(parseISO(todo.due_date), 'MMM d')}
          </span>
        )}
      </div>
      {isOwner && (
        <button
          onClick={() => onDelete(todo.id)}
          className="opacity-0 group-hover:opacity-100 text-gray-300 hover:text-red-400 text-xs transition-opacity shrink-0 mt-0.5"
          aria-label="Delete todo"
        >
          ✕
        </button>
      )}
    </li>
  )
}

// ── Main component ─────────────────────────────────────────────────────────────
export default function TodoList({ session }: Props) {
  const [todos, setTodos] = useState<Todo[]>([])
  const [loading, setLoading] = useState(true)
  const currentUserEmail = session.user.email ?? ''

  useEffect(() => {
    supabase
      .from('todos')
      .select('*')
      .order('completed', { ascending: true })
      .order('due_date', { ascending: true, nullsFirst: false })
      .order('created_at', { ascending: false })
      .then(({ data }) => {
        if (data) setTodos(data as Todo[])
        setLoading(false)
      })
  }, [])

  const addTodo = useCallback((todo: Todo) => {
    setTodos(prev => [todo, ...prev])
  }, [])

  const toggleTodo = useCallback(async (id: string, completed: boolean) => {
    setTodos(prev => prev.map(t => t.id === id ? { ...t, completed } : t))
    const { error } = await supabase.from('todos').update({ completed }).eq('id', id)
    if (error) setTodos(prev => prev.map(t => t.id === id ? { ...t, completed: !completed } : t))
  }, [])

  const deleteTodo = useCallback(async (id: string) => {
    setTodos(prev => prev.filter(t => t.id !== id))
    await supabase.from('todos').delete().eq('id', id)
  }, [])

  if (loading) return <div className="p-4 text-gray-400 text-sm">Loading todos...</div>

  const incomplete = todos.filter(t => !t.completed)
  const complete = todos.filter(t => t.completed)

  return (
    <div>
      <AddForm onAdd={addTodo} />
      <ul className="divide-y divide-gray-50">
        {incomplete.map(todo => (
          <TodoRow
            key={todo.id}
            todo={todo}
            currentUserEmail={currentUserEmail}
            onToggle={(id, c) => void toggleTodo(id, c)}
            onDelete={(id) => void deleteTodo(id)}
          />
        ))}
        {incomplete.length === 0 && (
          <li className="px-4 py-3 text-gray-400 text-sm">No tasks — add one above!</li>
        )}
      </ul>
      {complete.length > 0 && (
        <details className="border-t border-gray-100">
          <summary className="px-4 py-2 text-xs text-gray-400 cursor-pointer hover:text-gray-600 select-none list-none flex items-center gap-1">
            <span className="text-gray-300">▸</span> {complete.length} completed
          </summary>
          <ul className="divide-y divide-gray-50">
            {complete.map(todo => (
              <TodoRow
                key={todo.id}
                todo={todo}
                currentUserEmail={currentUserEmail}
                onToggle={(id, c) => void toggleTodo(id, c)}
                onDelete={(id) => void deleteTodo(id)}
              />
            ))}
          </ul>
        </details>
      )}
    </div>
  )
}
