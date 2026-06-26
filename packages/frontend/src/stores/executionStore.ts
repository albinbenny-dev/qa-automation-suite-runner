import { create } from 'zustand';

interface ExecutionStore {
  selectedTestCaseIds: string[];
  setSelected: (ids: string[]) => void;
  addSelected: (ids: string[]) => void;
  clearSelected: () => void;
}

export const useExecutionStore = create<ExecutionStore>((set) => ({
  selectedTestCaseIds: [],
  setSelected: (ids) => set({ selectedTestCaseIds: ids }),
  addSelected: (ids) =>
    set((state) => ({
      selectedTestCaseIds: [...new Set([...state.selectedTestCaseIds, ...ids])],
    })),
  clearSelected: () => set({ selectedTestCaseIds: [] }),
}));
