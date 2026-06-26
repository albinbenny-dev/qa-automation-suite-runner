import type { Namespace } from 'socket.io';

let _runsNsp: Namespace | null = null;
let _projectsNsp: Namespace | null = null;

export function setRunsNamespace(nsp: Namespace): void {
  _runsNsp = nsp;
}

export function getRunsNamespace(): Namespace | null {
  return _runsNsp;
}

export function emitToRun(runId: string, event: string, data: unknown): void {
  _runsNsp?.to(`run:${runId}`).emit(event, data);
}

export function setProjectsNamespace(nsp: Namespace): void {
  _projectsNsp = nsp;
}

export function emitToProject(projectId: string, event: string, data: unknown): void {
  _projectsNsp?.to(`project:${projectId}`).emit(event, data);
}
