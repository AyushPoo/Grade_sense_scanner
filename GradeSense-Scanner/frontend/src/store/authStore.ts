import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { User } from '../types';

interface AuthState {
  user: User | null;
  sessionToken: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  hasHydrated: boolean;
  setUser: (user: User | null) => void;
  setSessionToken: (token: string | null) => void;
  setIsAuthenticated: (value: boolean) => void;
  setIsLoading: (value: boolean) => void;
  setHasHydrated: (state: boolean) => void;
  logout: () => void;
  updateUserOrgName: (orgName: string) => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      user: null,
      sessionToken: null,
      isAuthenticated: false,
      isLoading: false,
      hasHydrated: false,
      setUser: (user) => set({ user }),
      setSessionToken: (token) => set({ sessionToken: token }),
      setIsAuthenticated: (value) => set({ isAuthenticated: value }),
      setIsLoading: (value) => set({ isLoading: value }),
      setHasHydrated: (state) => set({ hasHydrated: state }),
      logout: () => set({ user: null, sessionToken: null, isAuthenticated: false }),
      updateUserOrgName: (orgName) => set((state) => {
        if (state.user) {
          return {
            user: {
              ...state.user,
              org_name: orgName,
            }
          };
        }
        return {};
      }),
    }),
    {
      name: 'auth-storage',
      storage: createJSONStorage(() => ({
        getItem: (name) => {
          console.log(`[TRACE] auth-storage.getItem: start for ${name} at ${Date.now()}`);
          return AsyncStorage.getItem(name);
        },
        setItem: (name, value) => {
          console.log(`[TRACE] auth-storage.setItem: start for ${name} at ${Date.now()}`);
          return AsyncStorage.setItem(name, value);
        },
        removeItem: (name) => {
          console.log(`[TRACE] auth-storage.removeItem: start for ${name} at ${Date.now()}`);
          return AsyncStorage.removeItem(name);
        },
      })),
      partialize: (state) => {
        // HYDRATION ISOLATION: Do not persist hydration/loading flags
        // This prevents setHasHydrated(true) from triggering a persistence write
        const { hasHydrated, isLoading, ...rest } = state;
        return rest;
      },
      onRehydrateStorage: () => (state) => {
        console.log(`[TRACE] auth-storage.onRehydrateStorage: Hydration complete at ${Date.now()}`);
        state?.setHasHydrated(true);
      },
    }
  )
);

