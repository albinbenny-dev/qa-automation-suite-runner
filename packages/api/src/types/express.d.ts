import type { Project, ProjectMember } from '@prisma/client';

// Augment Express's Request interface so middleware-attached fields are typed.
// This file is auto-included via tsconfig "include": ["src/**/*"]

declare global {
  namespace Express {
    interface Request {
      /** Set by verifyToken middleware — present on every authenticated route */
      user: {
        id: string;
        email: string;
        name: string;
        globalRole: string;
      };

      /** Set by requireProjectAccess middleware — present on /:projectId routes */
      project: Project;

      /** Set by requireProjectAccess for non-SUPER_ADMIN users */
      projectMember?: ProjectMember;
    }
  }
}

export {};
