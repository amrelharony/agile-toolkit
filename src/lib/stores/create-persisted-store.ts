import { create, type StateCreator } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

export interface PersistedStoreActions {
  exportJSON: () => string;
  importJSON: (json: string) => void;
  reset: () => void;
}

export function createPersistedStore<T extends object>(
  name: string,
  initialState: T,
  stateCreator?: StateCreator<T & PersistedStoreActions, [], [], T & PersistedStoreActions>
) {
  const storeKey = `agile-toolkit:${name}`;

  return create<T & PersistedStoreActions>()(
    persist(
      stateCreator ??
        ((set, get) => ({
          ...initialState,
          exportJSON: () => {
            const state = get();
            // eslint-disable-next-line @typescript-eslint/no-unused-vars
            const { exportJSON, importJSON, reset, ...data } = state;
            return JSON.stringify(data, null, 2);
          },
          importJSON: (json: string) => {
            try {
              const data = JSON.parse(json);
              set(data);
            } catch {
              console.error("Failed to import JSON");
            }
          },
          reset: () => set({ ...initialState } as Partial<T & PersistedStoreActions>),
        })),
      {
        name: storeKey,
        storage: createJSONStorage(() => {
          if (typeof window !== "undefined") return localStorage;
          return {
            getItem: () => null,
            setItem: () => {},
            removeItem: () => {},
          };
        }),
        skipHydration: true,
      }
    )
  );
}
