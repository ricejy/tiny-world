# Tiny World

A little island controlled with language. Pip, Moss, and Dot move, water plants, rest, and change the lights. Three missions teach selection, exclusions, and context.

## Play

Start in **Demo mode** with the example commands. These are deterministic local rules, clearly labeled in the Interpretation panel. They do not call Jev or simulate model probabilities.

For live interpretation, open the mode button and enter your TypeSafe key. It stays only in React memory for this page session. Refreshing forgets it. Commands, island state, and the key pass through this app's backend to TypeSafe; no key is written to browser storage. Alternatively configure the backend secret `TYPESAFE_API_KEY` through the hosting service. Never commit a key.

Try:

- Send someone to water the plants, but leave the charging robot alone.
- Turn on all lights except the cabin.
- Get everyone inside before the storm.
- Send Pip somewhere. (The demo asks you to choose a destination.)

## Architecture

`command + public island state → /api/interpret → Jev → validated answers → review gate → deterministic world update`

- `lib/jev.ts`: Nine independent questions sent together. Choice selects action and destination; six Nouls select robots and lights; Score selects brightness.
- `app/api/interpret/route.ts`: Validates input, calls the fixed TypeSafe endpoint with a 15-second timeout, validates responses, and returns sanitized errors.
- `lib/world.ts`: Pure planning, state transitions, and the explicitly limited demo parser.
- `app/page.tsx`: Island, missions, command desk, probability inspector, and session connection UI.

Jev is pinned to `jev-1.13.0`. No generated prose or code controls the game. Low action/destination confidence or uncertain targets pause for review. These are experimental thresholds, not calibrated correctness guarantees. Give one instruction at a time. If the leading answer is unsupported but a supported alternative has at least 20% probability and selected targets, the app offers that alternative for explicit approval. It never executes the alternative automatically. Artwork is fixed; the app moves sprites and renders weather/light effects.

World progress lasts for the current page session. Missions reset the island. Garden moisture and battery arithmetic run in code. API cost estimates use the documented input rate of $0.042 per million tokens; check TypeSafe pricing before relying on this estimate.

## Development

Requires Node 22.13+ (Node 24 recommended for the tests).

```sh
npm run install:ci
npm run dev
node --test tests/world.test.mjs
npx tsc --noEmit
npm run build
```

The Sites/Vinext starter provides React, TypeScript, Tailwind, shadcn controls, and a Cloudflare-compatible server build. Keep `sites()` in the Vite configuration. `.openai/hosting.json` identifies the private hosted project.

## Validation and limits

Automated tests cover exclusions, all-robot selection, unsupported commands, ambiguous destinations, uncertainty review, and numeric bounds. All three missions and the review flow were exercised in the browser. The user has tested the live TypeSafe integration. Automated tests replay the reported action probabilities with fixture light answers; they do not certify model accuracy. The demo is independently usable.

The game intentionally supports a small action vocabulary. Demo rules understand examples and simple variations; live semantic behavior still needs evaluation with real commands. Model confidence describes the returned distribution, not the probability that an action is correct.

[TypeSafe documentation](https://docs.typesafe.ai/introduction)


## Autonomous survival mode

Open `/autonomous` or choose **Autonomous run** in the sandbox. The objective is 100 fish and 100 crops with all three robots alive. Start with the explicitly labeled demo controller, or connect a session TypeSafe key to let Jev choose every task.

- The simulation advances in 250 ms steps while running. Decisions are requested approximately every five simulated seconds, or after an important event with at least two seconds between requests. Only one request can be in flight; a run stops requesting after 200 attempts.
- Each Jev request carries current progress, weather, crop state, robot health/battery/tasks, travel times to shelter, recent events, and mechanics. Three independent Choice questions choose tasks for Pip, Moss, and Dot. Each question contains only currently useful tasks: completed charging or clear-weather repairs cannot be continued or selected again. Completed maintenance returns a robot to idle and triggers a fresh decision. Shelter remains available through warnings and storms. Autonomous jobs persist through travel and one work cycle; repairs and charging complete before switching. Storm danger, critical health (35% or below), and low battery (below 20%) allow safety interruptions. Manual controls can interrupt any task. No generated explanations are displayed.
- Fishing attempts last 8–16 seconds. Yields: 18% zero fish, 76% uniformly 1–5 fish, 6% uniformly 7–10 fish. Harvests last 6–12 seconds and yield 2–6 crops, bounded by shared ripe stock. Reassigning the same active job preserves its timer.
- Crops regrow in batches of 4–8 every 18–28 seconds while moisture exceeds 20%. The garden holds at most 24 ripe crops.
- Clear weather lasts 70–100 seconds, warnings last 20 seconds, and storms last 20–35 seconds. Storms deal 6 health per second outdoors, including on the way to shelter. The cabin repairs health at 3/s and never charges batteries. The outdoor dock charges batteries at 8/s and never repairs health.
- Work consumes battery. At zero battery, work stops and emergency movement slows. A robot reaching zero health ends the run. There is no automatic rescue overriding Jev.
- Pause, reset, controller changes, and terminal outcomes invalidate pending responses. Weather changes discard stale responses; per-robot job versions prevent overwriting completed or manually interrupted tasks. API errors pause the run.
- The page pauses when hidden. Closing or refreshing loses the run and the session key. This is a browser simulation, not a background server worker.
- Seeds reproduce weather independently of work-related random draws. Identical seeds and identical decisions reproduce the complete run; different decisions consume work randomness differently and affect crop growth through moisture.
- Cost estimates use reported input tokens at the documented rate; cancelled requests or missing usage can make the displayed total incomplete.

`lib/simulation.ts` owns mechanics and the demo controller; `app/api/autonomy/route.ts` owns validated Jev requests; `app/autonomous/page.tsx` owns the run controls and request lifecycle. Test with `node --test tests/*.test.mjs`. The baseline controller is tested across multiple seeds; autonomous live Jev behavior still needs evaluation with a real key.
