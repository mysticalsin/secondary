import { request } from "../../api";
import type { BrainPulse, PulseAll } from "./types";

const q = encodeURIComponent;

export const pulseApi = {
  brain: (id: string, days = 60) =>
    request<BrainPulse>("GET", `/v1/brains/${q(id)}/pulse?days=${days}`),
  all: (days = 30) => request<PulseAll>("GET", `/v1/pulse?days=${days}`),
};
