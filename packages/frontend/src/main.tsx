import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from 'react-hot-toast';
import App from './App';
import './styles/globals.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60,
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <App />
        <Toaster
          position="top-right"
          toastOptions={{
            style: {
              background: '#0d1b2e',
              color: '#e2e8f0',
              border: '1px solid #1e3a5f',
            },
            success: {
              style: { background: '#0d1b2e', color: '#e2e8f0', border: '1px solid rgba(52,211,153,0.4)' },
              iconTheme: { primary: '#34d399', secondary: '#0d1b2e' },
            },
            error: {
              style: { background: '#0d1b2e', color: '#e2e8f0', border: '1px solid rgba(248,113,113,0.4)' },
              iconTheme: { primary: '#f87171', secondary: '#0d1b2e' },
            },
          }}
        />
      </BrowserRouter>
    </QueryClientProvider>
  </React.StrictMode>,
);
