import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { X } from 'lucide-react'
import { ToastContext } from '@/lib/toast'

interface ToastItem { id: number; message: string }

const DISMISS_MS = 5000
let toastSeq = 0

function Toast({ item, onDismiss }: { item: ToastItem; onDismiss: (id: number) => void }) {
  useEffect(() => {
    const t = setTimeout(() => onDismiss(item.id), DISMISS_MS)
    return () => clearTimeout(t)
  }, [item.id, onDismiss])

  return (
    <div
      role="alert"
      className="flex items-center gap-2 px-3 py-2 bg-[#fcf0f0] border border-[#f1d8d8] rounded-md shadow-sm"
    >
      <p className="text-[11px] text-[#a14040] flex-1">{item.message}</p>
      <button
        onClick={() => onDismiss(item.id)}
        className="text-[#a14040] opacity-60 hover:opacity-100"
        aria-label="Dismiss"
      >
        <X size={12} />
      </button>
    </div>
  )
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([])

  const notify = useCallback((message: string) => {
    const id = ++toastSeq
    // Collapse repeats of the same message (e.g. several writes failing
    // together while offline) into one toast.
    setItems(prev => (prev.some(t => t.message === message) ? prev : [...prev, { id, message }]))
  }, [])

  const dismiss = useCallback((id: number) => {
    setItems(prev => prev.filter(t => t.id !== id))
  }, [])

  return (
    <ToastContext.Provider value={notify}>
      {children}
      <div aria-live="polite" className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 w-[280px]">
        {items.map(item => <Toast key={item.id} item={item} onDismiss={dismiss} />)}
      </div>
    </ToastContext.Provider>
  )
}
