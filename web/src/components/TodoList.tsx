import { useCallback, useRef, useState } from 'react'
import { format, parseISO, isBefore, startOfDay } from 'date-fns'
import { supabase } from '../lib/supabase'
import { Checkbox } from '@/components/ui/checkbox'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import type { Todo } from '../types'
import type { Session } from '@supabase/supabase-js'

const DISPLAY_NAMES: Record<string, string> = {
  'ncduncan@gmail.com': 'Nate',
  'caitante@gmail.com': 'Caitie',
}
const displayName = (email: string) => DISPLAY_NAMES[email] ?? email.split('@')[0]

// ── Section header ─────────────────────────────────────────────────────────────
function SectionHeader({ label }: { label: string }) {
  return (
    <div className="px-4 pt-3 pb-1 text-xs font-semibold text-gray-400 uppercase tracking-wider">
      {label}
    </div>
  )
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
    const { data } = await supabase.auth.getSession()
    if (!data.session) { setSaving(false); return }
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
  onUpdate,
}: {
  todo: Todo
  currentUserEmail: string
  onToggle: (id: string, completed: boolean) => void
  onDelete: (id: string) => void
  onUpdate: (id: string, patch: Partial<Pick<Todo, 'title' | 'notes' | 'due_date'>>) => Promise<void>
}) {
  const today = startOfDay(new Date())
  const isOverdue = !todo.completed && todo.due_date
    ? isBefore(parseISO(todo.due_date), today)
    : false
  const isOwner = todo.created_by === currentUserEmail

  const [editing, setEditing] = useState(false)
  const [editTitle, setEditTitle] = useState(todo.title)
  const [editNotes, setEditNotes] = useState(todo.notes ?? '')
  const [editDue, setEditDue] = useState(todo.due_date ?? '')
  const savingRef = useRef(false)

  const save = useCallback(async () => {
    if (savingRef.current || !editTitle.trim()) return
    savingRef.current = true
    await onUpdate(todo.id, {
      title: editTitle.trim(),
      notes: editNotes.trim() || null,
      due_date: editDue || null,
    })
    savingRef.current = false
    setEditing(false)
  }, [editTitle, editNotes, editDue, onUpdate, todo.id])

  const cancel = useCallback(() => {
    setEditTitle(todo.title)
    setEditNotes(todo.notes ?? '')
    setEditDue(todo.due_date ?? '')
    setEditing(false)
  }, [todo.title, todo.notes, todo.due_date])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void save() }
    if (e.key === 'Escape') cancel()
  }

  if (editing && isOwner) {
    return (
      <li className="px-4 py-3 flex items-start gap-3 bg-blue-50/30 border-b border-gray-50">
        <Checkbox
          checked={todo.completed}
          onCheckedChange={checked => onToggle(todo.id, checked as boolean)}
          className="mt-1 shrink-0"
        />
        <div className="flex-1 min-w-0 space-y-1.5">
          <Input
            autoFocus
            value={editTitle}
            onChange={e => setEditTitle(e.target.value)}
            onKeyDown={handleKeyDown}
            onBlur={() => void save()}
            className="text-sm h-7"
          />
          <Textarea
            placeholder="Notes"
            value={editNotes}
            onChange={e => setEditNotes(e.target.value)}
            onKeyDown={handleKeyDown}
            onBlur={() => void save()}
            className="text-xs h-12 resize-none"
          />
          <Input
            type="date"
            value={editDue}
            onChange={e => setEditDue(e.target.value)}
            onBlur={() => void save()}
            className="text-xs h-7 w-36"
          />
          <p className="text-xs text-gray-300">Enter to save · Esc to cancel</p>
        </div>
      </li>
    )
  }

  return (
    <li className={`flex items-start gap-3 px-4 py-3 group hover:bg-gray-50/50 ${todo.completed ? 'opacity-50' : ''}`}>
      <Checkbox
        checked={todo.completed}
        onCheckedChange={checked => onToggle(todo.id, checked as boolean)}
        className="mt-0.5 shrink-0"
      />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span
            onClick={() => { if (isOwner && !todo.completed) setEditing(true) }}
            className={`text-sm ${todo.completed ? 'line-through text-gray-400' : 'text-gray-900'} ${isOwner && !todo.completed ? 'cursor-pointer hover:text-blue-600' : ''}`}
          >
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
interface Props {
  session: Session
  todos: Todo[]
  loading: boolean
  onSetTodos: React.Dispatch<React.SetStateAction<Todo[]>>
}

export default function TodoList({ session, todos, loading, onSetTodos }: Props) {
  const currentUserEmail = session.user.email ?? ''

  const addTodo = useCallback((todo: Todo) => {
    onSetTodos(prev => [todo, ...prev])
  }, [onSetTodos])

  const toggleTodo = useCallback(async (id: string, completed: boolean) => {
    onSetTodos(prev => prev.map(t => t.id === id ? { ...t, completed } : t))
    const { error } = await supabase.from('todos').update({ completed }).eq('id', id)
    if (error) onSetTodos(prev => prev.map(t => t.id === id ? { ...t, completed: !completed } : t))
  }, [onSetTodos])

  const deleteTodo = useCallback(async (id: string) => {
    onSetTodos(prev => prev.filter(t => t.id !== id))
    await supabase.from('todos').delete().eq('id', id)
  }, [onSetTodos])

  const updateTodo = useCallback(async (id: string, patch: Partial<Pick<Todo, 'title' | 'notes' | 'due_date'>>) => {
    onSetTodos(prev => prev.map(t => t.id === id ? { ...t, ...patch } : t))
    await supabase.from('todos').update(patch).eq('id', id)
  }, [onSetTodos])

  const rowProps = (todo: Todo) => ({
    todo,
    currentUserEmail,
    onToggle: (id: string, c: boolean) => void toggleTodo(id, c),
    onDelete: (id: string) => void deleteTodo(id),
    onUpdate: (id: string, patch: Partial<Pick<Todo, 'title' | 'notes' | 'due_date'>>) => updateTodo(id, patch),
  })

  if (loading) return <div className="p-4 text-gray-400 text-sm">Loading todos...</div>

  const incomplete = todos.filter(t => !t.completed)
  const complete = todos.filter(t => t.completed)
  const myTodos = incomplete.filter(t => t.created_by === currentUserEmail)
  const otherTodos = incomplete.filter(t => t.created_by !== currentUserEmail)
  const otherOwners = [...new Set(otherTodos.map(t => t.created_by))]

  return (
    <div>
      <AddForm onAdd={addTodo} />

      {/* My tasks */}
      <SectionHeader label="My tasks" />
      <ul className="divide-y divide-gray-50">
        {myTodos.length === 0 && (
          <li className="px-4 py-2 text-sm text-gray-300">Nothing here!</li>
        )}
        {myTodos.map(todo => <TodoRow key={todo.id} {...rowProps(todo)} />)}
      </ul>

      {/* Other users' shared tasks (RLS ensures only shared todos come through) */}
      {otherOwners.map(email => (
        <div key={email}>
          <SectionHeader label={`${displayName(email)}'s tasks`} />
          <ul className="divide-y divide-gray-50">
            {otherTodos
              .filter(t => t.created_by === email)
              .map(todo => <TodoRow key={todo.id} {...rowProps(todo)} />)}
          </ul>
        </div>
      ))}

      {/* Completed */}
      {complete.length > 0 && (
        <details className="border-t border-gray-100">
          <summary className="px-4 py-2 text-xs text-gray-400 cursor-pointer hover:text-gray-600 select-none list-none flex items-center gap-1">
            <span className="text-gray-300">▸</span> {complete.length} completed
          </summary>
          <ul className="divide-y divide-gray-50">
            {complete.map(todo => <TodoRow key={todo.id} {...rowProps(todo)} />)}
          </ul>
        </details>
      )}
    </div>
  )
}
