import { useEffect } from 'react';
import { Outlet, useParams } from 'react-router-dom';
import BrandBanner from './BrandBanner';
import Sidebar from './Sidebar';
import ChatWidget from '../chat/ChatWidget';
import ScanNotificationManager from '../scan/ScanNotificationManager';
import HealNotificationManager from '../healing/HealNotificationManager';
import { useProjectStore } from '../../stores/projectStore';
import { useProjects } from '../../hooks/useProjects';

export default function AppShell() {
  const { slug } = useParams<{ slug?: string }>();
  const { setActiveProject, setProjects } = useProjectStore();
  const { data: projects, isSuccess } = useProjects();

  useEffect(() => {
    if (isSuccess && projects) {
      setProjects(projects);
      if (slug) {
        const found = projects.find((p) => p.slug === slug) ?? null;
        setActiveProject(found);
      } else {
        setActiveProject(null);
      }
    }
  }, [isSuccess, projects, slug, setProjects, setActiveProject]);

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)' }}>
      {/* Global background listeners — fire notifications regardless of active page */}
      <ScanNotificationManager />
      <HealNotificationManager />

      {/* Fixed top banner */}
      <BrandBanner />

      {/* Layout below banner */}
      <div
        style={{
          marginTop: '64px',
          height: 'calc(100vh - 64px)',
          display: 'flex',
          overflow: 'hidden',
        }}
      >
        <Sidebar slug={slug} />

        <main
          style={{
            flex: 1,
            overflowY: 'auto',
            overflowX: 'hidden',
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          <Outlet />
        </main>
      </div>

      <ChatWidget />
    </div>
  );
}
