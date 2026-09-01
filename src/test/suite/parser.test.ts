import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { parseTeamFile } from '../../team/parser';

/** Real fixture: the repo's own `.squad/team.md` (multi-section, real-world shape). */
const REAL_TEAM_MD_PATH = path.resolve(__dirname, '..', '..', '..', '.squad', 'team.md');

const MULTI_SECTION_TEAM_MD = `# Test Squad

## Coordinator

| Name | Role | Notes |
|------|------|-------|
| Squad | Coordinator | Routes work, enforces handoffs |

## Members

| Name | Role | Charter | Status | Notes |
|------|------|---------|--------|-------|
| Neo | Lead / Architect | \`.squad/agents/neo/charter.md\` | ✅ Active | |
| Trinity | Frontend Dev | \`.squad/agents/trinity/charter.md\` | ✅ Active | |

## Coding Agent

| Name | Role | Charter | Status |
|------|------|---------|--------|
| @copilot | Coding Agent | — | 🤖 Coding Agent |

## Project Context

- **Owner:** Jane Doe
- **Stack:** TypeScript
- **Description:** Sample squad for tests
`;

const LEGACY_SINGLE_TABLE_TEAM_MD = `# Legacy Team

## Members

| Name | Role | Charter | Status | Notes |
|------|------|---------|--------|-------|
| Squad | Coordinator | — | ✅ Active | |
| Neo | Lead / Architect | \`.squad/agents/neo/charter.md\` | ✅ Active | |
| AutoBot | Coding Agent | — | 🤖 Coding Agent | |
| @copilot | Coding Agent | — | 🤖 Coding Agent | |
`;

suite('parser: parseTeamFile', () => {
  suite('multi-section roster (## Coordinator / ## Members / ## Coding Agent)', () => {
    const state = parseTeamFile(MULTI_SECTION_TEAM_MD, 'test.md');

    test('parses the coordinator from its own section', () => {
      assert.ok(state.coordinator);
      assert.strictEqual(state.coordinator?.name, 'Squad');
      assert.strictEqual(state.coordinator?.section, 'coordinator');
      assert.strictEqual(state.coordinator?.notes, 'Routes work, enforces handoffs');
    });

    test('parses members in file order', () => {
      assert.strictEqual(state.members.length, 2);
      assert.strictEqual(state.members[0].name, 'Neo');
      assert.strictEqual(state.members[1].name, 'Trinity');
      assert.ok(state.members.every((m) => m.section === 'members'));
    });

    test('parses the coding agent from its own section', () => {
      assert.ok(state.codingAgent);
      assert.strictEqual(state.codingAgent?.name, '@copilot');
      assert.strictEqual(state.codingAgent?.section, 'codingAgent');
    });
  });

  suite('single-table fallback (legacy `## Members`-only roster)', () => {
    const state = parseTeamFile(LEGACY_SINGLE_TABLE_TEAM_MD, 'test.md');

    test('classifies the coordinator row by role', () => {
      assert.ok(state.coordinator);
      assert.strictEqual(state.coordinator?.name, 'Squad');
    });

    test('classifies coding-agent rows by name (@copilot) or role (Coding Agent)', () => {
      assert.strictEqual(state.codingAgent?.name, '@copilot');
      // Only the last coding-agent-shaped row wins the singular `codingAgent`
      // slot; AutoBot is still classifiable (not left in `members`).
      assert.ok(!state.members.some((m) => m.name === 'AutoBot' || m.name === '@copilot'));
    });

    test('leaves everything else in members', () => {
      assert.strictEqual(state.members.length, 1);
      assert.strictEqual(state.members[0].name, 'Neo');
    });
  });

  suite('@copilot / coordinator classification heuristics', () => {
    test('role containing "coordinator" (any case) classifies as coordinator', () => {
      const md = `# T\n\n## Members\n\n| Name | Role |\n|------|------|\n| Alice | Lead Coordinator |\n`;
      const state = parseTeamFile(md, 'test.md');
      assert.strictEqual(state.coordinator?.name, 'Alice');
    });

    test('name containing "@copilot" classifies as coding agent regardless of role', () => {
      const md = `# T\n\n## Members\n\n| Name | Role |\n|------|------|\n| @copilot | Anything |\n`;
      const state = parseTeamFile(md, 'test.md');
      assert.strictEqual(state.codingAgent?.name, '@copilot');
    });

    test('role containing "coding agent" classifies as coding agent even without @ prefix', () => {
      const md = `# T\n\n## Members\n\n| Name | Role |\n|------|------|\n| RoboDev | Coding Agent |\n`;
      const state = parseTeamFile(md, 'test.md');
      assert.strictEqual(state.codingAgent?.name, 'RoboDev');
    });

    test('everything else falls back to members', () => {
      const md = `# T\n\n## Members\n\n| Name | Role |\n|------|------|\n| Bob | Backend Dev |\n`;
      const state = parseTeamFile(md, 'test.md');
      assert.strictEqual(state.members.length, 1);
      assert.strictEqual(state.members[0].name, 'Bob');
    });
  });

  suite('Project Context key variants', () => {
    function contextOnly(block: string): string {
      return `# T\n\n## Members\n\n| Name | Role |\n|------|------|\n| Bob | Dev |\n\n## Project Context\n\n${block}\n`;
    }

    test('Owner maps to projectContext.user', () => {
      const state = parseTeamFile(contextOnly('- **Owner:** Ami Hollander'), 'test.md');
      assert.strictEqual(state.projectContext?.user, 'Ami Hollander');
    });

    test('Lead maps to projectContext.user', () => {
      const state = parseTeamFile(contextOnly('- **Lead:** Grace Hopper'), 'test.md');
      assert.strictEqual(state.projectContext?.user, 'Grace Hopper');
    });

    test('User maps to projectContext.user', () => {
      const state = parseTeamFile(contextOnly('- **User:** Ada Lovelace'), 'test.md');
      assert.strictEqual(state.projectContext?.user, 'Ada Lovelace');
    });

    test('Stack maps to projectContext.techStack', () => {
      const state = parseTeamFile(contextOnly('- **Stack:** TypeScript, Node.js'), 'test.md');
      assert.strictEqual(state.projectContext?.techStack, 'TypeScript, Node.js');
    });

    test('Tech Stack maps to projectContext.techStack', () => {
      const state = parseTeamFile(contextOnly('- **Tech Stack:** Python, Django'), 'test.md');
      assert.strictEqual(state.projectContext?.techStack, 'Python, Django');
    });

    test('Description maps to projectContext.description', () => {
      const state = parseTeamFile(contextOnly('- **Description:** Build the thing'), 'test.md');
      assert.strictEqual(state.projectContext?.description, 'Build the thing');
    });

    test('Building maps to projectContext.description', () => {
      const state = parseTeamFile(contextOnly('- **Building:** Build the other thing'), 'test.md');
      assert.strictEqual(state.projectContext?.description, 'Build the other thing');
    });

    test('all keys combine into one projectContext', () => {
      const state = parseTeamFile(
        contextOnly('- **Owner:** Ami Hollander\n- **Stack:** TS\n- **Description:** Desc\n- **Created:** 2026-01-01'),
        'test.md',
      );
      assert.strictEqual(state.projectContext?.user, 'Ami Hollander');
      assert.strictEqual(state.projectContext?.techStack, 'TS');
      assert.strictEqual(state.projectContext?.description, 'Desc');
    });
  });

  suite('column-count variants', () => {
    test('3-column table (Name | Role | Notes) with no Charter/Status', () => {
      const md = `# T\n\n## Coordinator\n\n| Name | Role | Notes |\n|------|------|-------|\n| Squad | Coordinator | Notes here |\n`;
      const state = parseTeamFile(md, 'test.md');
      assert.strictEqual(state.coordinator?.name, 'Squad');
      assert.strictEqual(state.coordinator?.notes, 'Notes here');
      assert.strictEqual(state.coordinator?.charter, undefined);
      assert.strictEqual(state.coordinator?.status, undefined);
    });

    test('2-column table (Name | Role) only', () => {
      const md = `# T\n\n## Members\n\n| Name | Role |\n|------|------|\n| Bob | Dev |\n`;
      const state = parseTeamFile(md, 'test.md');
      assert.strictEqual(state.members[0].name, 'Bob');
      assert.strictEqual(state.members[0].role, 'Dev');
      assert.strictEqual(state.members[0].charter, undefined);
      assert.strictEqual(state.members[0].status, undefined);
      assert.strictEqual(state.members[0].notes, undefined);
    });

    test('columns out of the canonical order are located by header name', () => {
      const md = `# T\n\n## Members\n\n| Status | Name | Role |\n|--------|------|------|\n| ✅ Active | Bob | Dev |\n`;
      const state = parseTeamFile(md, 'test.md');
      assert.strictEqual(state.members[0].name, 'Bob');
      assert.strictEqual(state.members[0].role, 'Dev');
      assert.strictEqual(state.members[0].status, '✅ Active');
    });

    test('a charter cell of "—" is treated as unset', () => {
      const md = `# T\n\n## Members\n\n| Name | Role | Charter | Status |\n|------|------|---------|--------|\n| Bob | Dev | — | ✅ Active |\n`;
      const state = parseTeamFile(md, 'test.md');
      assert.strictEqual(state.members[0].charter, undefined);
    });
  });

  suite('separator rows', () => {
    test('standard dashed separator row is skipped', () => {
      const md = `# T\n\n## Members\n\n| Name | Role |\n|------|------|\n| Bob | Dev |\n`;
      const state = parseTeamFile(md, 'test.md');
      assert.strictEqual(state.members.length, 1);
    });

    test('colon-aligned separator row (left/center/right) is skipped', () => {
      const md = `# T\n\n## Members\n\n| Name | Role |\n|:-----|:----:|\n| Bob | Dev |\n`;
      const state = parseTeamFile(md, 'test.md');
      assert.strictEqual(state.members.length, 1);
      assert.strictEqual(state.members[0].name, 'Bob');
    });

    test('extra-padded separator row is skipped', () => {
      const md = `# T\n\n## Members\n\n| Name | Role |\n|  ----  |  ----  |\n| Bob | Dev |\n`;
      const state = parseTeamFile(md, 'test.md');
      assert.strictEqual(state.members.length, 1);
    });
  });

  suite('real .squad/team.md fixture', () => {
    const content = fs.readFileSync(REAL_TEAM_MD_PATH, 'utf-8');
    const state = parseTeamFile(content, REAL_TEAM_MD_PATH);

    test('parses exactly one coordinator (Squad)', () => {
      assert.strictEqual(state.coordinator?.name, 'Squad');
    });

    test('parses all 7 members in order', () => {
      assert.deepStrictEqual(
        state.members.map((m) => m.name),
        ['Neo', 'Trinity', 'Morpheus', 'Switch', 'Tank', 'Scribe', 'Ralph'],
      );
    });

    test('parses the coding agent (@copilot)', () => {
      assert.strictEqual(state.codingAgent?.name, '@copilot');
    });

    test('parses Project Context (Owner/Stack/Description)', () => {
      assert.strictEqual(state.projectContext?.user, 'Ami Hollander');
      assert.strictEqual(
        state.projectContext?.techStack,
        'TypeScript/JavaScript, VS Code Extension API, Node.js, HTML/CSS UI',
      );
      assert.ok(state.projectContext?.description?.startsWith('Build a VS Code extension'));
    });
  });
});
