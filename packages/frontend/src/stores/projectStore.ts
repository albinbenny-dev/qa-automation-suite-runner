import { create } from 'zustand';
import type { Project, User } from '../types';
import { getCurrentUser } from '../lib/auth';

const THEME_KEY = 'qai-theme';

function applyTheme(theme: 'light' | 'dark'): void {
  const root = document.documentElement;
  root.setAttribute('data-theme', theme);
  if (theme === 'dark') {
    root.classList.add('dark');
  } else {
    root.classList.remove('dark');
  }
}

const savedTheme = (localStorage.getItem(THEME_KEY) as 'light' | 'dark') ?? 'light';
applyTheme(savedTheme);

interface ProjectStore {
  activeProject: Project | null;
  setActiveProject: (p: Project | null) => void;
  projects: Project[];
  setProjects: (ps: Project[]) => void;
  theme: 'light' | 'dark';
  toggleTheme: () => void;
  currentUser: User | null;
  setCurrentUser: (u: User | null) => void;
}

export const useProjectStore = create<ProjectStore>((set, get) => ({
  activeProject: null,
  setActiveProject: (p) => set({ activeProject: p }),
  projects: [],
  setProjects: (ps) => set({ projects: ps }),
  theme: savedTheme,
  toggleTheme: () => {
    const next = get().theme === 'light' ? 'dark' : 'light';
    localStorage.setItem(THEME_KEY, next);
    applyTheme(next);
    set({ theme: next });
  },
  currentUser: getCurrentUser(),
  setCurrentUser: (u) => set({ currentUser: u }),
}));
