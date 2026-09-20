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

Jev is pinned to `jev-1.13.0`. No generated prose or code controls the game. Low action/destination confidence or uncertain targets pause for review. These are experimental thresholds, not calibrated correctness guarantees. Multi-action instructions are rejected; give one instruction at a time. Artwork is fixed; the app moves sprites and renders weather/light effects.

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

Automated tests cover exclusions, all-robot selection, unsupported commands, ambiguous destinations, uncertainty review, and numeric bounds. All three missions and the review flow were exercised in the browser. A live TypeSafe request has not yet been tested because no API key was supplied; the demo is independently usable.

The game intentionally supports a small action vocabulary. Demo rules understand examples and simple variations; live semantic behavior still needs evaluation with real commands. Model confidence describes the returned distribution, not the probability that an action is correct.

[TypeSafe documentation](https://docs.typesafe.ai/introduction)

