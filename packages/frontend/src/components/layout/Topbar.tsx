import React from 'react';
import { Link } from 'react-router-dom';
import { cn } from '../../lib/utils';

export interface BreadcrumbSegment {
  label: string;
  href?: string;
}

interface TopbarProps {
  breadcrumbs: BreadcrumbSegment[];
  actions?: React.ReactNode;
}

export default function Topbar({ breadcrumbs, actions }: TopbarProps) {
  return (
    <div className="topbar">
      <div className="topbar-breadcrumb">
        {breadcrumbs.map((seg, i) => (
          <React.Fragment key={i}>
            {i > 0 && <span className="topbar-sep">/</span>}
            {seg.href ? (
              <Link
                to={seg.href}
                style={{ color: 'var(--text-mid)', textDecoration: 'none', transition: 'color 0.15s' }}
                onMouseEnter={(e) => ((e.target as HTMLElement).style.color = 'var(--cyan)')}
                onMouseLeave={(e) => ((e.target as HTMLElement).style.color = 'var(--text-mid)')}
              >
                {seg.label}
              </Link>
            ) : (
              <span className="current">{seg.label}</span>
            )}
          </React.Fragment>
        ))}
      </div>
      {actions && <div className="topbar-right">{actions}</div>}
    </div>
  );
}

interface TbBtnProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'ghost' | 'danger';
}

export function TbBtn({ variant = 'ghost', className, children, ...props }: TbBtnProps) {
  return (
    <button
      className={cn(
        'tb-btn',
        variant === 'primary' && 'tb-btn-primary',
        variant === 'ghost'   && 'tb-btn-ghost',
        variant === 'danger'  && 'tb-btn-ghost',
        className,
      )}
      style={
        variant === 'danger'
          ? { color: 'var(--rose)', borderColor: 'rgba(220,38,38,0.3)' }
          : undefined
      }
      {...props}
    >
      {children}
    </button>
  );
}
