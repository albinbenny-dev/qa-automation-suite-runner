import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { useProjectStore } from '../../stores/projectStore';
import { clearAuth } from '../../lib/auth';
import { getInitials, PROJECT_GRADIENTS } from '../../lib/utils';
import { useSchedules } from '../../hooks/useRuns';
import { useRBAC } from '../../hooks/useRBAC';
import type { NavSection } from '../../types';

interface SidebarProps {
  slug?: string;
}

export default function Sidebar({ slug }: SidebarProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { activeProject, projects, currentUser, setCurrentUser } = useProjectStore();
  const [logoutHover, setLogoutHover] = useState(false);

  function handleLogout() {
    clearAuth();
    setCurrentUser(null);
    qc.clear();
    navigate('/login', { replace: true });
  }
  const projectId = activeProject?.id ?? '';
  useRBAC();
  const { data: schedules = [] } = useSchedules(projectId || undefined);
  const activeScheduleCount = schedules.filter((s) => s.isActive).length;

  const navSections: NavSection[] = slug
    ? [
        {
          label: 'Overview',
          items: [
            { label: 'Dashboard', path: `/projects/${slug}/dashboard`, icon: '▦' },
            { label: 'TC Library', path: `/projects/${slug}/tc-library`, icon: '📋', badge: activeProject?._count?.testCases ?? undefined, badgeVariant: 'green' },
          ],
        },
        {
          label: 'Automation',
          items: [
            { label: 'Scripts', path: `/projects/${slug}/scripts`, icon: '⌨' },
            { label: 'Execution', path: `/projects/${slug}/execution`, icon: '▶' },
            { label: 'Scheduler', path: `/projects/${slug}/scheduler`, icon: '⏰', badge: activeScheduleCount || undefined, badgeVariant: 'blue' },
          ],
        },
        {
          label: 'Analytics',
          items: [
            { label: 'Reports', path: `/projects/${slug}/reports`, icon: '📊' },
          ],
        },
        {
          label: 'Project Tools',
          items: [
            { label: 'Settings', path: `/projects/${slug}/settings`, icon: '⚙' },
          ],
        },
      ]
    : [];

  const isActive = (path: string) => location.pathname === path;

  const gradientIndex = activeProject
    ? activeProject.id.charCodeAt(0) % PROJECT_GRADIENTS.length
    : 0;
  const projectColor = activeProject?.color ?? PROJECT_GRADIENTS[gradientIndex];

  return (
    <aside
      style={{
        width: '220px',
        flexShrink: 0,
        background: 'var(--surface)',
        borderRight: '1px solid var(--border)',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        height: '100%',
      }}
    >
      {/* Project context widget */}
      <div
        style={{
          padding: '14px 12px',
          borderBottom: '1px solid var(--border)',
          cursor: slug ? 'pointer' : 'default',
        }}
        onClick={() => slug && navigate(`/projects/${slug}/settings`)}
      >
        {activeProject ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div
              style={{
                width: '32px',
                height: '32px',
                borderRadius: '8px',
                background: projectColor,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '14px',
                flexShrink: 0,
                color: '#fff',
                fontWeight: 700,
              }}
            >
              {getInitials(activeProject.name)}
            </div>
            <div style={{ flex: 1, overflow: 'hidden' }}>
              <div
                style={{
                  fontSize: '13px',
                  fontWeight: 700,
                  color: 'var(--text)',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  lineHeight: 1.2,
                }}
              >
                {activeProject.name}
              </div>
              <div
                style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: '9px',
                  color: 'var(--text-dim)',
                  marginTop: '2px',
                  letterSpacing: '0.5px',
                }}
              >
                {activeProject._count?.testCases ?? 0} tests
              </div>
            </div>
            <span style={{ color: 'var(--text-dim)', fontSize: '11px' }}>⌄</span>
          </div>
        ) : (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              color: 'var(--text-dim)',
              fontSize: '12px',
            }}
          >
            <span style={{ fontSize: '16px' }}>∞</span>
            <span>No project selected</span>
          </div>
        )}
      </div>

      {/* All Projects link */}
      <div style={{ padding: '8px 12px', borderBottom: '1px solid var(--border)' }}>
        <Link
          to="/projects"
          className={`nav-item${location.pathname === '/projects' ? ' active' : ''}`}
        >
          <span className="nav-icon">🌐</span>
          All Projects
          {projects.length > 0 && (
            <span className="nav-badge blue" style={{ marginLeft: 'auto' }}>
              {projects.length}
            </span>
          )}
        </Link>
        {currentUser?.globalRole === 'SUPER_ADMIN' && (
          <Link
            to="/admin/users"
            className={`nav-item${location.pathname === '/admin/users' ? ' active' : ''}`}
          >
            <span className="nav-icon">👤</span>
            User Management
            <span className="nav-badge" style={{ marginLeft: 'auto', background: 'rgba(244,123,32,0.2)', color: 'var(--6d-orange)', fontSize: '8px', padding: '1px 5px' }}>
              ADMIN
            </span>
          </Link>
        )}
      </div>

      {/* Nav sections */}
      <nav
        style={{
          flex: 1,
          padding: '8px 10px',
          overflowY: 'auto',
        }}
      >
        {navSections.map((section) => (
          <div key={section.label}>
            <div className="nav-section-label">{section.label}</div>
            {section.items.map((item) => (
              <Link
                key={item.path}
                to={item.path}
                className={`nav-item${isActive(item.path) ? ' active' : ''}`}
              >
                <span className="nav-icon">{item.icon}</span>
                <span style={{ flex: 1 }}>{item.label}</span>
                {item.badge !== undefined && (
                  <span
                    className={`nav-badge${item.badgeVariant === 'green' ? ' green' : item.badgeVariant === 'blue' ? ' blue' : ''}`}
                  >
                    {item.badge}
                  </span>
                )}
              </Link>
            ))}
          </div>
        ))}

        {!slug && (
          <div
            style={{
              padding: '20px 10px',
              textAlign: 'center',
              color: 'var(--text-dim)',
              fontSize: '11px',
              fontFamily: 'var(--font-mono)',
            }}
          >
            Select a project to see<br />its navigation
          </div>
        )}
      </nav>

      {/* User widget + logout */}
      <div
        style={{
          padding: '10px 10px',
          borderTop: '1px solid var(--border)',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            padding: '7px 8px',
            borderRadius: 'var(--radius)',
            background: 'transparent',
          }}
        >
          {/* Avatar */}
          <div
            style={{
              width: '28px',
              height: '28px',
              borderRadius: '50%',
              background: 'linear-gradient(135deg, var(--violet), var(--cyan))',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '11px',
              fontWeight: 700,
              color: '#fff',
              flexShrink: 0,
            }}
          >
            {currentUser ? getInitials(currentUser.name) : 'U'}
          </div>

          {/* Name + role */}
          <div style={{ flex: 1, overflow: 'hidden' }}>
            <div
              style={{
                fontSize: '12px',
                fontWeight: 600,
                color: 'var(--text)',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              {currentUser?.name ?? 'Guest'}
            </div>
            <div
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: '9px',
                color: 'var(--text-dim)',
                letterSpacing: '1px',
                textTransform: 'uppercase',
              }}
            >
              {currentUser?.globalRole?.replace('_', ' ') ?? 'User'}
            </div>
          </div>

          {/* Logout button */}
          <button
            onClick={handleLogout}
            onMouseEnter={() => setLogoutHover(true)}
            onMouseLeave={() => setLogoutHover(false)}
            title="Sign out"
            style={{
              flexShrink: 0,
              width: '28px',
              height: '28px',
              borderRadius: '7px',
              border: `1px solid ${logoutHover ? 'rgba(220,38,38,0.4)' : 'var(--border)'}`,
              background: logoutHover ? 'rgba(220,38,38,0.10)' : 'transparent',
              color: logoutHover ? 'var(--fail)' : 'var(--text-dim)',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '13px',
              transition: 'all 0.15s',
            }}
          >
            ⏻
          </button>
        </div>
      </div>
    </aside>
  );
}
