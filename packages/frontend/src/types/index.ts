export interface User {
  id: string;
  email: string;
  name: string;
  globalRole: 'SUPER_ADMIN' | 'ADMIN' | 'SUPER_USER' | 'STANDARD_USER';
}

/** Project-level role assigned to a ProjectMember */
export type ProjectRole = 'ADMIN' | 'SUPER_USER' | 'STANDARD_USER';

export interface AuthResponse {
  token: string;
  user: User;
}

export interface Project {
  id: string;
  name: string;
  slug: string;
  description?: string;
  baseUrl?: string;
  color?: string;
  reqLibraryPath?: string;
  videoEnabled?: boolean;
  createdAt: string;
  createdBy: string;
  /** The authenticated user's role in this project (injected by GET /projects) */
  myRole?: ProjectRole | null;
  _count?: {
    testCases: number;
    members: number;
    runs?: number;
  };
  members?: ProjectMember[];
  envConfigs?: EnvConfig[];
}

export interface ProjectMember {
  projectId: string;
  userId: string;
  role: 'ADMIN' | 'SUPER_USER' | 'STANDARD_USER';
  user: {
    id: string;
    name: string;
    email: string;
  };
}

export interface EnvConfig {
  id: string;
  projectId: string;
  name: string;
  baseUrl: string;
  username?: string | null;
  password?: string | null;
  isDefault: boolean;
}

export interface TestCase {
  id: string;
  projectId: string;
  tcId: string;
  title: string;
  sortOrder?: number;
  description?: string;
  steps: string[];
  expectedResult?: string;
  type: 'UI' | 'API' | 'SIT';
  tags: string[];
  useCaseTag?: string;
  status: 'DRAFT' | 'APPROVED' | 'DEPRECATED';
  priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  sourceRef?: string;
  generationHints?: string | null;
  /** ID of the TC whose script covers the setup steps (login + navigation) for this TC */
  prerequisiteTcId?: string | null;
  /** Minimal info about the prerequisite TC for display */
  prerequisiteTc?: { id: string; tcId: string; title: string } | null;
  lastRun?: RunResult;
  /** Last ≤5 terminal run results, oldest → newest. Each carries the runId for navigation. */
  recentRunStatuses?: Array<{ status: 'PASSED' | 'FAILED' | 'SKIPPED' | 'CANCELLED'; runId: string }>;
}

export interface Run {
  id: string;
  projectId: string;
  runSeq: number;
  name: string;
  environment: string;
  status: 'PENDING' | 'RUNNING' | 'PASSED' | 'FAILED' | 'CANCELLED';
  startedAt?: string;
  completedAt?: string;
  triggerType: 'MANUAL' | 'SCHEDULED' | 'INDIVIDUAL' | 'GROUP' | 'HEAL_RERUN';
  createdByUserId?: string | null;
  results?: RunResult[];
}

export interface RunResult {
  id: string;
  runId: string;
  testCaseId: string;
  status: 'PENDING' | 'RUNNING' | 'PASSED' | 'FAILED' | 'CANCELLED' | 'SKIPPED';
  duration?: number;
  errorMessage?: string;
  screenshotPath?: string;
  videoPath?: string;
  rfLogPath?: string;
}

export interface Schedule {
  id: string;
  projectId: string;
  name: string;
  cronExpression: string;
  testCaseIds: string;
  environment: string;
  isActive: boolean;
  emailRecipients: string;
  createdAt: string;
  updatedAt: string;
}

export interface SuiteStage {
  useCaseTag: string;
  mode: 'sequential' | 'parallel';
}

export interface Suite {
  id: string;
  projectId: string;
  name: string;
  testCaseIds: string; // JSON string — legacy
  stages: string;     // JSON string — parse to SuiteStage[]
  createdAt: string;
  updatedAt: string;
}

export interface Script {
  id: string;
  projectId: string;
  testCaseId?: string | null;
  filename: string;
  scriptType?: 'ROBOT';
  isCustomUpload: boolean;
  createdAt: string;
  updatedAt: string;
  testCase?: Pick<TestCase, 'id' | 'tcId' | 'title'> & { useCaseTag?: string | null };
  lastRunStatus?: 'PASSED' | 'FAILED' | 'RUNNING' | 'PENDING' | 'CANCELLED' | null;
  size?: number | null;
  modifiedAt?: string | null;
}

export interface ProjectResource {
  id: string;
  projectId: string;
  filename: string;
  originalName: string;
  size: number;
  uploadedAt: string;
  /** Full container path: /scripts/{slug}/resources/{filename} */
  containerPath?: string;
  /** True for .xlsx, .xls, .pdf and other non-text files */
  isBinary?: boolean;
}

export interface DiffLine {
  type: 'add' | 'remove' | 'unchanged';
  line: string;
  lineNum: number;
}

// ── Reports / Dashboard types ──────────────────────────────────────────────

export interface FlakyTest {
  id: string;
  tcId: string;
  title: string;
  passCount: number;
  failCount: number;
  recentResults: Array<'PASSED' | 'FAILED' | 'SKIPPED'>;
}

export interface ProjectStats {
  totalTests: number;
  scriptsGenerated: number;
  totalRuns: number;
  lastRunPassCount: number;
  lastRunFailCount: number;
  avgPassRate: number;
  activeSchedules: number;
  pendingHeals: number;
  flakyTests: FlakyTest[];
}

export interface RunTrendPoint {
  date: string;
  passed: number;
  failed: number;
  skipped: number;
}

export interface AgentStatus {
  name: string;
  label: string;
  status: 'ok' | 'busy' | 'idle';
  detail: string;
}

export interface TopSuiteEntry {
  name: string;
  runCount: number;
  lastRunStatuses: string[];
  successRate: number;
}

export interface DashboardData {
  stats: ProjectStats;
  trend: RunTrendPoint[];
  recentRuns: Array<{
    id: string;
    name: string;
    environment: string;
    status: string;
    triggerType: string;
    createdAt: string;
    startedAt?: string;
    completedAt?: string;
    results: Array<{ status: string }>;
    _count: { results: number };
  }>;
  agentStatuses: AgentStatus[];
  topSuites: TopSuiteEntry[];
  projectTokens: number;
}

export interface AIAnalysis {
  summary: string;
  rootCauses: string[];
  recommendations: string[];
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
}

export interface ReportRecord {
  id: string;
  projectId: string;
  runId: string;
  summary: string;
  aiAnalysis: string; // JSON string of AIAnalysis
  emailSentAt?: string | null;
  createdAt: string;
}

export interface ReportRun {
  id: string;
  projectId: string;
  runSeq: number;
  name: string;
  environment: string;
  status: string;
  triggerType: string;
  startedAt?: string | null;
  completedAt?: string | null;
  createdAt: string;
  results: Array<{
    id: string;
    status: 'PENDING' | 'RUNNING' | 'PASSED' | 'FAILED' | 'CANCELLED' | 'SKIPPED';
    duration?: number | null;
    errorMessage?: string | null;
    screenshotPath?: string | null;
    videoPath?: string | null;
    rfLogPath?: string | null;
    testCase: { id: string; tcId: string; title: string; type: string; useCaseTag?: string | null };
  }>;
  _count: { results: number };
  report?: ReportRecord | null;
}

export interface EmailConfig {
  recipients: string[];
  triggerEvents: string[];
}

export type NavItem = {
  label: string;
  path: string;
  icon: string;
  badge?: string | number;
  badgeVariant?: 'red' | 'green' | 'blue';
};

export type NavSection = {
  label: string;
  items: NavItem[];
};

export interface FolderImportResult {
  imported: Array<{ filename: string; testCasesCreated: number }>;
  resources: string[];
  warnings: string[];
}
