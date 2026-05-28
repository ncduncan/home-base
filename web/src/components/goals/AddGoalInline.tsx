import { useEffect, useRef, useState } from 'react'
import type { Goal, GoalCategory } from '../../lib/goals'

interface Props {
  category: GoalCategory
  owner: 'nat' | 'caitie'
  createdBy: string
  onCreate: (fields: Omit<Goal, 'id' | 'position'>) => Promise<void>
  onClose: () => void
}

export default function AddGoalInline({ category, owner, createdBy, onCreate, onClose }: Props) {
  const [text, setText] = useState('')
  const [saving, setSaving] = useState(false)
  const taRef = useRef<HTMLTextAreaElement | null>(null)

  useEffect(() => {
    if (taRef.current) {
      taRef.current.style.height = 'auto'
      taRef.current.style.height = `${taRef.current.scrollHeight}px`
    }
  }, [text])

  const submit = async () => {
    const trimmed = text.trim()
    if (!trimmed) { onClose(); return }
    setSaving(true)
    try {
      await onCreate({
        text: trimmed,
        category,
        achieved: false,
        visibility: 'shared',
        owner,
        created_by: createdBy,
        notes: null,
      })
      onClose()
    } catch (e) {
      console.error('AddGoalInline create failed:', e)
      setSaving(false)
    }
  }

  return (
    <li className="flex items-start gap-2 px-2 py-1">
      <span className="mt-[3px] shrink-0 h-3.5 w-3.5 rounded-[3px] border border-hb-border-soft" />
      <textarea
        ref={taRef}
        autoFocus
        rows={1}
        value={text}
        disabled={saving}
        onChange={e => setText(e.target.value)}
        onBlur={() => void submit()}
        onKeyDown={e => {
          if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void submit() }
          if (e.key === 'Escape') { e.preventDefault(); onClose() }
        }}
        placeholder="New goal…"
        className="flex-1 min-w-0 text-[11px] bg-transparent text-hb-fg border-b border-hb-fg-faint outline-none resize-none py-0 leading-tight placeholder:text-hb-fg-faint"
      />
    </li>
  )
}
