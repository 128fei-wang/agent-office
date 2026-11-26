# Agent animation and task linkage

> Updated: 2026-11-26 · Version 1.14.2

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

## References

- [Clawd on Desk — state machine and animation](https://deepwiki.com/rullerzhou-afk/clawd-on-desk/2.1-state-machine-and-animation-system)
- [Star Office UI — agent states and rest area](https://cnb.cool/takenotes/github.com/ringhyacinth/Star-Office-UI/-/blob/master/docs/PROJECT_SUMMARY_2026-03-01.md)
- [Pixel Agents — tool activity and idle/waiting states](https://deepwiki.com/pablodelucca/pixel-agents/9.3-tool-activity-and-subagents)
- [frankshane/pixel-office — finished worker walks to rest area](https://github.com/frankshane/pixel-office)
- [Pixel office agent monitoring write-up — state-driven animation and heartbeat](https://blog.csdn.net/weixin_31315567/article/details/167404063)
