import { createContext, useContext } from 'react';

export const AppDataContext = createContext(null);

export function useAppDataContext() {
  const context = useContext(AppDataContext);
  if (!context) {
    throw new Error('useAppDataContext deve ser usado dentro de AppDataProvider');
  }
  return context;
}
