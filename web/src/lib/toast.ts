import { createContext, useContext } from 'react'

// One shared failure toast for optimistic writes. Forms close before their
// write returns, so a failure needs somewhere to surface that isn't the form.
// Messages name the action ("Couldn't add the event"), never its content.

export type Notify = (message: string) => void

export const ToastContext = createContext<Notify>(message => {
  console.error(message)
})

export function useToast(): Notify {
  return useContext(ToastContext)
}
