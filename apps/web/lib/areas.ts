export interface OfficeAreaMeta {
  slug: string;
  name: string;
  purpose: string;
  accent: 'cyan' | 'magenta' | 'amber';
}

/** The nine office areas (FR-050). Navigation/theming only — never permissions. */
export const OFFICE_AREAS_META: OfficeAreaMeta[] = [
  { slug: 'clock-tower', name: 'Clock Tower', purpose: 'Executive command & approval inbox', accent: 'amber' },
  { slug: 'hawkins-lab', name: 'Hawkins Lab', purpose: 'Research & intelligence', accent: 'magenta' },
  { slug: 'arcade', name: 'The Arcade', purpose: 'Designers & creative production', accent: 'cyan' },
  { slug: 'garage', name: 'The Garage', purpose: 'Software development', accent: 'cyan' },
  { slug: 'ghost-lab', name: 'Ghost Lab', purpose: 'QA & verification', accent: 'magenta' },
  { slug: 'front-desk', name: 'The Front Desk', purpose: 'Finance & administration', accent: 'amber' },
  { slug: 'video-store', name: 'The Video Store', purpose: 'Writing, video & social media', accent: 'magenta' },
  { slug: 'mall', name: 'The Mall', purpose: 'Sales & growth', accent: 'amber' },
  { slug: 'memory-vault', name: 'The Memory Vault', purpose: 'Searchable knowledge hub', accent: 'cyan' },
];
