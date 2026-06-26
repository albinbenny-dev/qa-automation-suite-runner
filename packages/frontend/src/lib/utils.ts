import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-');
}

export function formatRelativeTime(date: string | Date): string {
  const now = new Date();
  const then = new Date(date);
  const diff = now.getTime() - then.getTime();

  const mins  = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days  = Math.floor(diff / 86400000);

  if (mins < 1)   return 'just now';
  if (mins < 60)  return `${mins}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 7)   return `${days}d ago`;
  return then.toLocaleDateString();
}

export function passRateBadgeClass(rate: number): string {
  if (rate >= 90) return 'badge-teal';
  if (rate >= 70) return 'badge-skip';
  return 'badge-rose';
}

export function getInitials(name: string): string {
  return name
    .split(' ')
    .map(n => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);
}

export const PROJECT_GRADIENTS = [
  'linear-gradient(135deg, #2563AB, #F47B20)',
  'linear-gradient(135deg, #F47B20, #DC2626)',
  'linear-gradient(135deg, #F47B20, #2A9D8F)',
  'linear-gradient(135deg, #2A9D8F, #2563AB)',
  'linear-gradient(135deg, #DC2626, #F47B20)',
  'linear-gradient(135deg, #0A2A57, #2563AB)',
];
