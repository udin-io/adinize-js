import { createContext, useContext, useEffect, type ReactNode } from 'react'
import { AppState } from 'react-native'
import type { Adinize } from './adinize.js'

const AdinizeContext = createContext<Adinize | null>(null)

type AdinizeProviderProps = {
  client: Adinize
  children: ReactNode
}

export function AdinizeProvider({ client, children }: AdinizeProviderProps) {
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active') void client.flush()
    })
    return () => subscription.remove()
  }, [client])

  return <AdinizeContext.Provider value={client}>{children}</AdinizeContext.Provider>
}

export function useAdinize(): Adinize {
  const client = useContext(AdinizeContext)
  if (client === null) throw new Error('useAdinize must be used inside AdinizeProvider')
  return client
}
