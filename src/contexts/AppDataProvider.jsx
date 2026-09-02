import { useAppData } from '../hooks/useAppData';
import { AppDataContext } from '../hooks/useAppDataContext';

export function AppDataProvider({ children }) {
  const appData = useAppData();
  return (
    <AppDataContext.Provider value={appData}>
      {children}
    </AppDataContext.Provider>
  );
}
