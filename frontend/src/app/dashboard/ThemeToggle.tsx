'use client';

import { Monitor, Moon, Sun } from 'lucide-react';
import { ThemePreference, useTheme } from '@/lib/theme';

const options: Array<{ value: ThemePreference; label: string; icon: typeof Moon }> = [
  { value: 'dark', label: 'Dark', icon: Moon },
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'system', label: 'System', icon: Monitor },
];

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();

  return (
    <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-bg)] p-1 shadow-inner shadow-black/5" aria-label="Theme preference">
      <div className="grid grid-cols-3 gap-1">
        {options.map((option) => {
          const Icon = option.icon;
          const active = theme === option.value;
          return (
            <button
              key={option.value}
              type="button"
              onClick={() => setTheme(option.value)}
              className={`flex min-w-0 items-center justify-center gap-1.5 rounded-lg px-2 py-2 text-xs font-medium transition-colors ${
                active
                  ? 'bg-amber-600 text-white shadow-sm shadow-amber-900/10'
                  : 'text-[var(--color-muted)] hover:bg-[var(--color-hover)] hover:text-[var(--color-text)]'
              }`}
              aria-pressed={active}
              title={`${option.label} theme`}
            >
              <Icon className="h-3.5 w-3.5 shrink-0" />
              <span>{option.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
