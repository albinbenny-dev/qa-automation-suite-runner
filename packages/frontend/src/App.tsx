import React from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import AppShell from './components/layout/AppShell';
import Login from './pages/Login';
import Register from './pages/Register';
import GlobalProjects from './pages/GlobalProjects';
import ProjectSettings from './pages/ProjectSettings';
import TCLibrary from './pages/TCLibrary';
import Scripts from './pages/Scripts';
import Execution from './pages/Execution';
import Dashboard from './pages/Dashboard';
import Reports from './pages/Reports';
import Scheduler from './pages/Scheduler';
import UserManagement from './pages/UserManagement';
import { isAuthenticated } from './lib/auth';
import { ErrorBoundary } from './components/ui/ErrorBoundary';

// ── Protected route ────────────────────────────────────────────────────────
function ProtectedRoute({ children }: { children: React.ReactNode }) {
  if (!isAuthenticated()) {
    return <Navigate to="/login" replace />;
  }
  return <>{children}</>;
}

// ── App ────────────────────────────────────────────────────────────────────
export default function App() {
  return (
    <Routes>
      {/* Auth pages — no shell */}
      <Route path="/login"    element={<Login />} />
      <Route path="/register" element={<Register />} />

      {/* All protected pages — wrapped in AppShell + ErrorBoundary */}
      <Route
        element={
          <ProtectedRoute>
            <ErrorBoundary>
              <AppShell />
            </ErrorBoundary>
          </ProtectedRoute>
        }
      >
        {/* Global projects list */}
        <Route path="/projects" element={<GlobalProjects />} />

        {/* Per-project screens */}
        <Route path="/projects/:slug/dashboard"    element={<Dashboard />} />
        <Route path="/projects/:slug/tc-library"   element={<TCLibrary />} />
        <Route path="/projects/:slug/scripts"      element={<Scripts />} />
        <Route path="/projects/:slug/execution"    element={<Execution />} />
        <Route path="/projects/:slug/scheduler"    element={<Scheduler />} />
        <Route path="/projects/:slug/reports"      element={<Reports />} />
        <Route path="/projects/:slug/settings"     element={<ProjectSettings />} />
        <Route path="/admin/users"                 element={<UserManagement />} />
      </Route>

      {/* Root redirect */}
      <Route path="/" element={<Navigate to="/projects" replace />} />
      <Route path="*" element={<Navigate to="/projects" replace />} />
    </Routes>
  );
}
