import { create } from "zustand";
import type { Analysis, Plan } from "../shared/types";
import { defaultPlan } from "../shared/demo";
type State = {
  locale: "en" | "ar";
  plan: Plan;
  analysis: Analysis | null;
  demo: boolean;
  setLocale: (l: "en" | "ar") => void;
  setPlan: (p: Plan) => void;
  setAnalysis: (a: Analysis | null) => void;
  setDemo: (d: boolean) => void;
};
export const useStore = create<State>((set) => ({
  locale: localStorage.getItem("traffic.locale") === "ar" ? "ar" : "en",
  plan: defaultPlan(),
  analysis: null,
  demo: false,
  setLocale: (locale) => {
    localStorage.setItem("traffic.locale", locale);
    set({ locale });
  },
  setPlan: (plan) => set({ plan }),
  setAnalysis: (analysis) => set({ analysis }),
  setDemo: (demo) => set({ demo }),
}));
