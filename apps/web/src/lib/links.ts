const q = encodeURIComponent;
export const brainLink = (id: string) => `/brains/${q(id)}`;
export const pageLink = (brain: string, page: string) => `/brains/${q(brain)}/pages/${q(page)}`;
