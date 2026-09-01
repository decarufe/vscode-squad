import { TeamState, Member } from './teamState';
import { log } from '../utils/logger';

interface ProjectContext {
  description?: string;
  techStack?: string;
  user?: string;
}

function parseProjectContext(section: string): ProjectContext {
  const ctx: ProjectContext = {};
  for (const line of section.split('\n')) {
    const trimmed = line.trim();
    const match = trimmed.match(/^-\s+\*\*(.+?):\*\*\s*(.+)$/);
    if (!match) {
      continue;
    }
    const key = match[1].toLowerCase();
    const value = match[2].trim();
    if (key === 'building' || key === 'description') {
      ctx.description = value;
    } else if (key === 'tech stack' || key === 'stack') {
      ctx.techStack = value;
    } else if (key === 'user' || key === 'owner' || key === 'lead') {
      ctx.user = value;
    }
  }
  return ctx;
}

function classifyMember(member: Member): Member['section'] {
  const role = member.role.toLowerCase();
  const name = member.name.toLowerCase();
  if (role.includes('coordinator')) {
    return 'coordinator';
  }
  if (name.includes('@copilot') || role.includes('coding agent')) {
    return 'codingAgent';
  }
  return 'members';
}

interface ColumnMap {
  name: number;
  role: number;
  charter?: number;
  status?: number;
  notes?: number;
}

/**
 * Parse a table header row into a column-name -> index map so table shape
 * (e.g. the `## Coordinator` table's `Name | Role | Notes` vs the
 * `## Members` table's `Name | Role | Charter | Status | Notes`) doesn't
 * have to match a fixed column order.
 */
function parseHeaderColumns(headerLine: string): ColumnMap | null {
  const cells = headerLine
    .trim()
    .split('|')
    .slice(1, -1)
    .map((c) => c.trim().toLowerCase());
  const nameIdx = cells.indexOf('name');
  const roleIdx = cells.indexOf('role');
  if (nameIdx === -1 || roleIdx === -1) {
    return null;
  }
  const charterIdx = cells.indexOf('charter');
  const statusIdx = cells.indexOf('status');
  const notesIdx = cells.indexOf('notes');
  return {
    name: nameIdx,
    role: roleIdx,
    charter: charterIdx !== -1 ? charterIdx : undefined,
    status: statusIdx !== -1 ? statusIdx : undefined,
    notes: notesIdx !== -1 ? notesIdx : undefined,
  };
}

/**
 * Parse a markdown roster table into Members.
 * @param tableSection - Raw section content containing the table.
 * @param forcedSection - When the table comes from a dedicated
 *   `## Coordinator` / `## Members` / `## Coding Agent` heading, every row
 *   belongs to that section. When `null` (single-table legacy format), each
 *   row is classified individually via `classifyMember`.
 */
function parseMembersTable(tableSection: string, forcedSection: Member['section'] | null): Member[] {
  const lines = tableSection.split('\n').filter((l) => l.trim().length > 0);
  const members: Member[] = [];

  let columns: ColumnMap | null = null;
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('|')) {
      continue;
    }

    // Detect header row by checking for known column names
    if (!columns) {
      columns = parseHeaderColumns(trimmed);
      continue;
    }

    // Skip separator row (e.g. |------|------|)
    if (/^\|[\s\-:|]+\|$/.test(trimmed)) {
      continue;
    }

    // Parse data row
    const cells = trimmed
      .split('|')
      .slice(1, -1) // remove leading/trailing empty strings from split
      .map((c) => c.trim());

    if (cells.length <= columns.role) {
      continue;
    }

    const cell = (idx?: number): string | undefined => (idx !== undefined ? cells[idx] : undefined);
    const charter = cell(columns.charter);

    const member: Member = {
      name: cell(columns.name) ?? '',
      role: cell(columns.role) ?? '',
      charter: charter && charter !== '—' ? charter : undefined,
      status: cell(columns.status) || undefined,
      notes: cell(columns.notes) || undefined,
      section: forcedSection ?? 'members', // placeholder, classified below when not forced
    };

    member.section = forcedSection ?? classifyMember(member);
    members.push(member);
  }

  return members;
}

/**
 * Extracts the content of a markdown section by heading.
 * Returns everything between the heading and the next heading of equal or higher level.
 */
function extractSection(content: string, heading: string): string | null {
  const headingLevel = heading.match(/^(#+)/)?.[1].length ?? 2;
  const escapedHeading = heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(
    `^${escapedHeading}\\s*$`,
    'm',
  );
  const match = pattern.exec(content);
  if (!match) {
    return null;
  }
  const start = match.index + match[0].length;
  // Find the next heading of equal or higher level
  const nextHeadingPattern = new RegExp(
    `^#{1,${headingLevel}}\\s+`,
    'm',
  );
  const rest = content.slice(start);
  const nextMatch = nextHeadingPattern.exec(rest);
  if (nextMatch) {
    return rest.slice(0, nextMatch.index);
  }
  return rest;
}

/**
 * Parse markdown team file content into TeamState.
 * @param content - Raw markdown file content
 * @param filePath - Path to the team file
 * @returns Parsed TeamState
 */
export function parseTeamFile(content: string, filePath: string): TeamState {
  log('Parsing team file: ' + filePath);

  const state: TeamState = {
    coordinator: null,
    members: [],
    codingAgent: null,
    filePath,
    lastModified: Date.now(),
  };

  // Parse project context
  const contextSection = extractSection(content, '## Project Context');
  if (contextSection) {
    state.projectContext = parseProjectContext(contextSection);
  }

  // Parse roster. Squad files may use distinct `## Coordinator` / `## Members` /
  // `## Coding Agent` sections, or a single `## Members` table with mixed roles
  // (legacy format). Prefer the multi-section layout when any dedicated
  // Coordinator/Coding Agent heading is present, falling back to role-based
  // classification of a single table otherwise.
  const coordinatorSection = extractSection(content, '## Coordinator');
  const membersSection = extractSection(content, '## Members');
  const codingAgentSection = extractSection(content, '## Coding Agent');

  if (coordinatorSection || codingAgentSection) {
    if (coordinatorSection) {
      state.coordinator = parseMembersTable(coordinatorSection, 'coordinator')[0] ?? null;
    }
    if (membersSection) {
      state.members.push(...parseMembersTable(membersSection, 'members'));
    }
    if (codingAgentSection) {
      state.codingAgent = parseMembersTable(codingAgentSection, 'codingAgent')[0] ?? null;
    }
  } else if (membersSection) {
    const allMembers = parseMembersTable(membersSection, null);
    for (const member of allMembers) {
      switch (member.section) {
        case 'coordinator':
          state.coordinator = member;
          break;
        case 'codingAgent':
          state.codingAgent = member;
          break;
        default:
          state.members.push(member);
          break;
      }
    }
  }

  return state;
}
