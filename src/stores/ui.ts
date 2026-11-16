import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

export type SpaceFilter = 'all' | 'study' | 'work';
export type FilterScreen = 'today' | 'tasks' | 'notes' | 'calendar';

interface UiState {
  /** Last space filter per screen (spec §F: remembered per screen). */
  spaceFilter: Record<FilterScreen, SpaceFilter>;
  setSpaceFilter: (screen: FilterScreen, value: SpaceFilter) => void;
  demoBannerDismissed: boolean;
  briefDismissedDate: string | null;
  dismissBrief: (date: string) => void;
  notifPromptDismissed: boolean;
  dismissNotifPrompt: () => void;
  dismissDemoBanner: () => void;
  quickAddOpen: boolean;
  setQuickAddOpen: (open: boolean) => void;
}

export const useUiStore = create<UiState>()(
  persist(
    (set) => ({
      spaceFilter: { today: 'all', tasks: 'all', notes: 'all', calendar: 'all' },
      setSpaceFilter: (screen, value) => set((s) => ({ spaceFilter: { ...s.spaceFilter, [screen]: value } })),
      demoBannerDismissed: false,
      briefDismissedDate: null,
      dismissBrief: (date) => set({ briefDismissedDate: date }),
      notifPromptDismissed: false,
      dismissNotifPrompt: () => set({ notifPromptDismissed: true }),
      dismissDemoBanner: () => set({ demoBannerDismissed: true }),
      quickAddOpen: false,
      setQuickAddOpen: (open) => set({ quickAddOpen: open }),
    }),
    {
      name: 'nhip-ui-v1',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (s) => ({
        spaceFilter: s.spaceFilter,
        demoBannerDismissed: s.demoBannerDismissed,
        briefDismissedDate: s.briefDismissedDate,
        notifPromptDismissed: s.notifPromptDismissed,
      }),
    },
  ),
);
