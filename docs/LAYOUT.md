# Layout notes

The UI is a local operations desk, not a marketing dashboard. The layout should
make one thing obvious: where to look, where to act, and what is running.

## Peer research (GitHub)

These public projects were reviewed for navigation patterns; no code was copied:

| Project | Pattern worth keeping | What we avoided |
| --- | --- | --- |
| [cft0808/edict](https://github.com/cft0808/edict) | one live operating view, kanban plus audit trail, model configuration in one console | repeating the same actions in both a top toolbar and a side menu |
| [EKKOLearnAI/ekko-studio](https://github.com/EKKOLearnAI/ekko-studio) | workspace-first navigation, local-first setup | a crowded global toolbar for every feature |
| [ringhyacinth/Star-Office-UI](https://github.com/ringhyacinth/Star-Office-UI) | the office/agent stage remains the hero | moving the simulation into a settings-heavy admin shell |
| [abhi1693/openclaw-mission-control](https://github.com/abhi1693/openclaw-mission-control) | task board + task detail + approvals as a coherent flow | navigation duplicated between page tabs and a second toolbar |
| [dagoSte/squadra](https://github.com/dagoSte/squadra) | work queue, evidence and MCP/collaboration in one local console | a separate icon for every low-level utility |
| [mixpeek/amux](https://github.com/mixpeek/amux) | control-plane clarity: runs, agents and usage are top-level concepts | tool buttons competing with run controls |
| [phodal/routa](https://github.com/phodal/routa) | workspace/rail navigation with contextual panels | permanent dense button bars |

## Decision

- **One navigation source of truth**: the left rail owns work, people, task
  creation, settings and communication (groups and DMs).
- **Top bar is for simulation state only**: scenario, play/pause and speed.
  Task, company, tools, theme, language, meeting, incident and reset moved into
  rail flyouts so customers do not see the same action twice.
- **Contextual flyouts** open next to the rail icon; the full drawer is only the
  fallback for discovery.
- **The office stays the hero**: navigation and controls must not crowd the
  stage; the board and feed remain readable at 1440 px and collapse cleanly on
  mobile.
- **Agent identity and connection methods live together**: pairing, model APIs
  and MCP are all reached through People and Tools, not scattered across the
  top bar.

## MCP placement

MCP deployment is a connection/setup concern, so it lives in **Tools → MCP
deployment**, next to AI model settings. It is not a permanent top-level button.
