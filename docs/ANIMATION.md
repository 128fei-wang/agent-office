# Agent animation and task linkage

> Updated: 2026-11-28 · Version 1.28.0

The office is a state-driven animation system, not a video loop. Every character
state comes from the simulation engine; task progress and agent state must stay
consistent.

## The bug

Before 1.14.1, a finished sprint set every agent to `celebrating` and
`celebrateAgentTick` only left that state when `world.done` was false. Since a
finished world stays done, all six characters remained in the same pose forever.
The clock kept ticking, but the office looked frozen for minutes.

A second, quieter problem: if an agent/task stopped making progress, there was no
watchdog. The UI could keep saying "working" without any visible change.

## Patterns adopted from other agent offices

| Pattern | Source example | Our implementation |
| --- | --- | --- |
| Completion / success is a one-shot animation, then returns to idle | Clawd on Desk state machine: ONESHOT_STATES + AUTO_RETURN | `celebrateAgentTick` leaves celebration after 3 ticks and returns to the ambient loop |
| Finished agents walk to a rest/lounge area and keep living | Star Office UI maps `idle` to the sofa; frankshane/pixel-office sends finished workers to a rest area | Post-done `decide()` mixes celebrate / chat / coffee / wander / desk review |
| Idle agents get ambient loops | DenView idle animations; Pixel Agents idle wandering | `.state-idle`, `.state-chatting`, `.state-reviewing` sprite animations |
| A heartbeat or timeout prevents "looks working but frozen" | DSH/DeepSeek animation guide; Clawd on Desk priority state resolution | Task watchdog on 24 ticks without progress; live mission elapsed timer |
| State changes are visible near the actor | Star Office UI zone mapping; Pixel Agents tool activity | Per-character task progress bar + team-card task percentage |

## Implemented behavior

### Simulation

- `celebrating` is a one-shot: 3 ticks after completion, the agent returns to
  `idle`; it can celebrate again later.
- A completed office keeps moving: agents chat, drink coffee, wander, revisit
  the board, and celebrate in short bursts.
- A **New sprint** button appears in the SHIPPED banner and resets the current
  scenario without hunting through the left menu.
- Working and reviewing characters show a small progress bar under the name;
  the team card shows `task · NN%`.
- The sprite has an ambient animation for idle / chatting / reviewing, so even a
  short pause is visibly alive.
- The watchdog re-dispatches a task that has made no progress for 24 ticks, or
  returns it to the backlog if no owner is on it. Recovery is written to the
  feed and audit ledger.

### Real Mission Control auto-run

- The MISSION LIVE HUD and hot-desk card show an elapsed timer (MM:SS), so a
  long model call visibly continues instead of looking dead.
- The HUD has a **Stop** action; it calls `/missions/<id>/autorun/stop` without
  opening Mission Control.
- The bridge stamps `autoRun.currentTaskStartedAt` when a task starts, so the
  timer is tied to the actual task, not just the page load.

## Real business mode (1.23.0)

Demo mode always felt alive; real mode used to switch the office off and leave a
few tiny external agents at hot desks. 1.23.0 makes the real office share the
demo's visual language without inventing business facts.

### Character language

Real external agents are rendered with the same `.agent` children as demo
agents: sprite, shadow, aura, ring, badge, nametag, brand logo, paper bubble and
task progress. "Offline" only means no heartbeat; it no longer grays out or dims
an agent that the local AI can still dispatch.

### State source

| State | Real trigger |
| --- | --- |
| working | `autoRun.currentAgentId` or an `in_progress` task assigned to the agent |
| reviewing | a task in `review` |
| meeting | `discussion.status` or auto-run `discussing/queued`; seats come from `AO.MEETING.seats` |
| blocked / waiting | auto-run `waiting_boss`, agent walks to the boss office |
| celebrating | auto-run `done` while the completed mission is still transient (12s), with recurring confetti |
| coffee / chatting / idle-review / patrol | no active mission; a staggered 11s phase rotates agents through real data-backed ambient activities |

Idle bubbles use the latest mission's real task titles and artifact names. If
there is no real basis, the bubble stays generic ("续一杯", "巡一下办公室",
"回群里看一眼") rather than fabricating a task.

### Routing

`src/mission-live.js` reuses `AO.OBSTACLES` and `AO.HUBS` with the same
segment/hub path search as `src/engine.js`. Movement is a Web Animation over the
computed waypoints, with duration based on distance (420–3600ms). This avoids
walking through the meeting-room glass or desks and gives real mode the same
"walk the aisle" feel as the demo.

### Surrounding surfaces

- **LIVE FEED**: real events from tasks, approvals, artifacts, discussions and
  model calls, with filters and times; actions deep-link to Mission Control.
- **REAL BOARD**: active mission task groups and per-task progress; idle mode
  lists recent deliverables.
- **Whiteboard**: focused mission title, done/total, live progress and `LIVE`
  day marker instead of the demo scenario.
- **Topbar**: local `LIVE HH:MM` clock and a "可调度" count instead of `0 在线`.
- **Stage note**: suppressed when real missions exist; topbar Real panel and
  Mission Center remain the entry points.

## Cinematic layer and continuous motion (1.25.0)

The office now has two animation layers: the state machine (working, meeting,
waiting, celebrating) and an always-on ambience layer.

- **Mission transitions**: start/wait/done briefings are stage overlays with crew
  logos, a real progress bar, scanlines and a completion stamp. A new demo load
  plays a Sprint 01 briefing; it is skipped with `?intro=0` and shown once per
  browser session.
- **Collaboration web**: real working/reviewing/meeting/waiting agents draw
  routed SVG links to the relevant room, with animated beads and status colours.
  The current agent gets a floor spotlight that follows the walking animation.
- **Ambience**: dust motes, light shafts, pendant lamps, monitor bloom, steam,
  whiteboard scan, meeting-screen chart animation, room pulses, a small cleaner
  robot and character props (laptop, paper, cup, tablet, warning badge,
  celebration sparks). All are CSS/SVG; no new runtime dependency.
- **Feedback**: task completion produces a +N TASK pulse and a brief lighting
  wash. Motion is disabled under `prefers-reduced-motion` and the FX toggle.

The state and data still come from the real mission store; the visual layer never
invents a completed task.

## Verification

`dev-activity.html` checks:

1. a working agent shows task progress in the team card and a character progress
   bar;
2. the scenario reaches done;
3. after 45 further ticks at least one agent has moved and not all agents are
   still celebrating;
4. ambient office activity resumes;
5. the New sprint button clears the completion state and resumes the simulation.

`dev-mission-live.html` checks the HUD/hot-desk elapsed timer and Stop action.

`dev-demo-mode.html` (80 checks) now also verifies real working bubbles and
progress, the mission-focus board, a single meeting speaker, waiting-boss state,
celebration confetti, celebration status in the roster, real idle choreography,
feed filters and real event rows. Python tests verify the activity feed is built
from real events and excludes archived missions.

## References

- [Clawd on Desk — state machine and animation](https://deepwiki.com/rullerzhou-afk/clawd-on-desk/2.1-state-machine-and-animation-system)
- [Star Office UI — agent states and rest area](https://cnb.cool/takenotes/github.com/ringhyacinth/Star-Office-UI/-/blob/master/docs/PROJECT_SUMMARY_2026-03-01.md)
- [Pixel Agents — tool activity and idle/waiting states](https://deepwiki.com/pablodelucca/pixel-agents/9.3-tool-activity-and-subagents)
- [frankshane/pixel-office — finished worker walks to rest area](https://github.com/frankshane/pixel-office)
- [Pixel office agent monitoring write-up — state-driven animation and heartbeat](https://blog.csdn.net/weixin_31315567/article/details/167404063)
