import * as path from 'path';
import * as fs from 'fs';
import { log } from '../utils/logger';
import { parseTeamFile } from './parser';
import { serializeTeamFile } from './serializer';
import { markInternalChange } from './watcher';

export interface Member {
  name: string;
  role: string;
  charter?: string;
  status?: string;
  notes?: string;
  section: 'coordinator' | 'members' | 'codingAgent';
}

export interface TeamState {
  coordinator: Member | null;
  members: Member[];
  codingAgent: Member | null;
  filePath: string;
  lastModified: number;
  projectContext?: {
    description?: string;
    techStack?: string;
    user?: string;
  };
}

/**
 * Resolve the `team.md` path for a squad directory (flat or nested layout).
 */
export function teamFilePathFor(squadDir: string): string {
  return path.join(squadDir, 'team.md');
}

/**
 * Read and parse `team.md` from disk.
 *
 * This module holds no state: `core/squadRegistry` (`SquadContext`) is the
 * single in-memory source of truth for team state.
 */
export function readTeamState(squadDir: string): TeamState | null {
  const teamFilePath = teamFilePathFor(squadDir);

  if (!fs.existsSync(teamFilePath)) {
    log('Team file not found at', teamFilePath);
    return null;
  }

  try {
    const content = fs.readFileSync(teamFilePath, 'utf-8');
    return parseTeamFile(content, teamFilePath);
  } catch (err) {
    log('Error loading team state:', err);
    return null;
  }
}

/**
 * Serialize `state` and write it to disk, preserving unmanaged content.
 *
 * The write is flagged as internal so the registry's file watcher does not
 * reload state the caller already applied. Callers should go through
 * `squadRegistry.applyTeamState` so the in-memory context stays in sync.
 */
export async function writeTeamState(newState: TeamState): Promise<void> {
  const oldContent = fs.existsSync(newState.filePath)
    ? fs.readFileSync(newState.filePath, 'utf-8')
    : undefined;
  const markdown = serializeTeamFile(newState, oldContent);
  const dir = path.dirname(newState.filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  markInternalChange(newState.filePath);
  fs.writeFileSync(newState.filePath, markdown, 'utf-8');
  newState.lastModified = Date.now();
  log('Team state written to disk:', newState.filePath);
}

export function scaffoldAgentDir(squadDir: string, agentName: string, role: string): void {
  const slug = agentName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
  const agentDir = path.join(squadDir, 'agents', slug);
  if (fs.existsSync(agentDir)) {
    return;
  }
  fs.mkdirSync(agentDir, { recursive: true });

  // Use rich charter generation from templates
  const { generateCharter, generateHistory } = require('../templates/squadTemplates');
  const projectName = path.basename(squadDir);
  const charter = generateCharter(agentName, role, projectName);
  const history = generateHistory(agentName, role, projectName);

  fs.writeFileSync(path.join(agentDir, 'charter.md'), charter, 'utf-8');
  fs.writeFileSync(path.join(agentDir, 'history.md'), history, 'utf-8');
  log(`Scaffolded agent directory for ${agentName} at ${agentDir}`);
}
