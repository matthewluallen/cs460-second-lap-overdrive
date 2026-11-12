# Slipstream: a small track with a complete game around it

The physical cars are the attraction. The browser should make their movement legible,
give the players a reason to care, and help everyone keep watching the track.
A good round has a clear invitation, a brief objective, an unmistakable start,
meaningful decisions, a finish, and a reason to try again. More speed is not the
progression system.

This is an independent design review using occupational roles and public design
references. No Disney Imagineer, Pixar employee, Sony/PlayStation employee, or
Nintendo employee was consulted. The lenses below are hypothetical perspectives,
not endorsements or attempts to reproduce those companies' characters or artwork.

## The design table

| Lens | Question it asks | Decision for Slipstream |
|---|---|---|
| O*NET game designer | What is the repeatable challenge, and how do we balance it? | Short rounds, clear scores, shared ties, a rematch, and rules that work with one car |
| O*NET human-factors engineer | Can someone understand, operate, and stop this while looking at a moving object? | Persistent STOP, large controls, control ownership, simple calibration, redundant feedback |
| Imagineering-inspired experience design | Does setup feel like entering an experience? | A pit-crew welcome, choose a challenge, countdown, a physical-track-first stage, then a celebration |
| Pixar-inspired story design | What does the player want, and why does completion matter? | An original crew repairing a fictional signal network; each mission gives laps a small narrative purpose |
| PlayStation-inspired feedback design | Does every important action have a readable consequence? | Optional brief haptics, strong state transitions, clear damage/recovery, and a recap that explains the score |
| Nintendo-inspired accessible play | Can a newcomer join quickly while an experienced player still finds mastery? | Buttons as a full alternative to tilt, short solo practice, bots, cooperative goals, and optional complexity |

O*NET's [Video Game Designers](https://www.onetonline.org/link/details/15-1255.01)
profile emphasizes core mechanics, missions, balancing, and feedback. Its
[Human Factors Engineers and Ergonomists](https://www.onetonline.org/link/summary/17-2112.01)
profile emphasizes observing users, evaluating interfaces, and integrating human
needs into hardware. Those are useful roles for a classroom playtest, not just
labels for fictional experts.

Disney describes Imagineering as a collaboration between creative and technical
disciplines in its [official fact sheet](https://disneyexperiences.com/app/uploads/2025/07/Walt-Disney-Imagineering-Fact-Sheet_2025.pdf).
[Pixar in a Box](https://www.pixar.com/pixar-in-a-box) provides a public reference for
learning creative production. Our proposed mission framing is our own design
inference from these broad lenses.

Nintendo documents optional steering assistance, tilt controls, and time trials in
its [Mario Kart World overview](https://www.nintendo.com/au/news-and-articles/mario-kart-world-direct-revs-up-new-details-on-the-biggest-mario-kart-ever/).
That supports offering multiple ways to play; it does not establish that automatic
acceleration is safe for physical cars. Sony's
[accessibility settings](https://www.playstation.com/en-in/support/hardware/ps5-accessibility-settings/)
likewise make haptic feedback configurable. Slipstream should keep feedback optional.

## Three selectable feels

These are presentation and objective choices over the same supervised control
system. None grants a higher motor limit, disables safety behavior, or starts a car
merely because a player chose a theme.

| Feel | One car | Two to four cars | Mood |
|---|---|---|---|
| Arcade | Beat your best, then try another round | Battle rush: virtual knockouts plus complete laps | Bright, immediate, playful |
| Competition | Time trial: fastest complete lap | Lap sprint: most complete laps, shared ties | Calm timing, clear standings, minimal decoration |
| Story missions | Complete the crew's delivery alone or with a supervised bot | Cooperate toward a shared lap goal | Brief narrative, shared progress, everyone contributes |

A style selector should not silently start movement. Explain the next objective
before the countdown, show the active mode throughout play, and preserve the choice
for a rematch. Difficulty and style are separate settings.

## Car count and driver mix

| Cars | Strongest first experience | Other combinations |
|---|---|---|
| 1 | Human time trial, learning braking and lane changes | One supervised bot demonstrates; one human completes story deliveries; future driver/navigator shared-control role |
| 2 | Human versus bot lap sprint | Two-human duel; two-human cooperative mission; two bots for observation |
| 3 | Two humans and one bot, or a three-person crew | One human with two bots; three-human competition; supervised bot exhibition |
| 4 | Four-car sprint or a mixed human/bot crew mission | Four-person battle; future explicit 2v2 rules; supervised four-bot exhibition |

Bots must be visibly labeled and follow the same speed envelope and scoring rules.
A human should never have to infer whether a car is computer-driven. Adding another
car should not require another physical car: simulated practice is useful, but the
UI must keep simulated and real cars visibly distinct. Four is the hard maximum.

A solo round should feel complete, not like a multiplayer lobby with missing
players. Cooperative play is also valuable when differences in age, motor skill,
or familiarity would make a duel frustrating. A shared goal needs to celebrate
contribution without calling the least experienced participant a burden.

## Implemented round engine

`session.mjs` is a DOM-free scoring module. The host owns start/countdown/stop
integration; the module never writes to a Bluetooth transport.

- **Beat your best:** 90 seconds; rank fastest complete lap, then completed laps.
- **Lap sprint:** 120 seconds; most complete laps wins; equal results share the finish.
- **Crew mission:** a shared configurable lap target; completion ends the round.
- **Battle rush:** 120 seconds; 100 points per virtual knockout and 25 per full lap.
- A roster freezes at start and contains one to four connected, active cars. Race
  and battle need at least two. Late joiners can prepare for the next round.
- Lap scoring uses mapped circuit progress and direction, not the old start-line
  crossing counter. Reversals, localization gaps, and large position jumps discard
  the incomplete lap. Paused movement does not earn points.
- Completed results freeze. Full-lap and crew-completion badges reflect measured
  achievements; they are not rewards for risky movement.

The three original story briefs are exported as `STORY_MISSIONS`:

1. **The Signal Run:** restore contact; one lap per active car, 90 seconds.
2. **Beacon Network:** power a shared beacon; two laps per active car, 120 seconds.
3. **Dawn Patrol:** complete the final delivery; three laps per active car, 150 seconds.

These first missions use the same cooperative lap mechanic with different goals
and framing. They do not yet include branching stories, virtual checkpoints, a
campaign save, or different mechanical objectives. Do not market them as such.

## Phone controls and haptics

Yes, provide haptics as an optional layer. A phone can acknowledge a lap, warn that
the car is disabled, or celebrate a result without requiring the driver to read a
small screen. It should not buzz continuously, obscure a warning with celebration,
or encourage players to stare at their phones. Keep patterns brief and distinct,
and rate-limit repeated cues. Every cue also needs a visible label or state.

A sensible first vocabulary is a light tap for a completed lap, a double pulse for
a disabled car, and a short completion pattern for the round result. Add a single
setting to turn all vibration off, respect reduced-motion presentation preferences,
and cancel vibration when the page is hidden. Haptics are never the only emergency
notification and are not proof that a motor stopped.

Browser support is uneven: the
[Vibration API](https://developer.mozilla.org/en-US/docs/Web/API/Vibration_API)
is not universally available, and Safari/iPhone does not provide this API. Feature
detection and a visual fallback are mandatory. Do not promise DualSense-like
feedback from a browser or pretend an unsupported device vibrated. Audio, if added
later, should be opt-in and independent of vibration.

Tilt should be explicitly enabled and calibrated in the player's comfortable
holding position. Provide a neutral reset, a dead zone, sensitivity adjustment,
left/right reversal, and large steering buttons that remain a complete alternative.
Never require shaking or sudden gestures near the track. Reconnection should
require neutral input before motion can resume.

## Visual and interaction direction

- Make the track canvas the visual center. Put the round name, remaining time,
  objective, and result in one consistent location above it.
- Reserve red for STOP and fault states. Give each car a number and name as well
  as a color; color alone is insufficient to identify a car.
- Separate setup controls from driving controls. Put traces and diagnostics in a
  collapsible area rather than competing with the round objective.
- Use strong contrast, generous touch targets, visible focus, short labels, and
  reduced-motion alternatives. Never pulse the entire screen while driving.
- Use original symbols, track motifs, and typography rather than third-party game
  characters, emblems, or copied interface art.
- Present a concise finish card: mode result, best lap, personal contribution, and
  an explicit rematch button. Celebrations should not automatically restart motors.

## How far to gamify next

The most valuable progression is skill, variety, teamwork, and creative ownership.
Do not increase the physical speed ceiling as a prize or reward real collisions.
Do not use daily streak penalties, purchases, random loot, or compulsory accounts.

Prioritized next work after hardware validation:

1. A virtual ghost built on the local personal records now saved for completed
   solo rounds. Records are separated by track, speed cap, model, controller and
   simulated/live transport; changing the speed setting mid-round invalidates
   record saving. Add richer comparisons only after timing is hardware-validated.
2. Cooperative checkpoint missions and original car personalities. A calm scout,
   a patient courier, or a bold virtual rival can differ through presentation and
   software strategy without encouraging physical impacts.
3. Explicit 2v2 rules and an optional driver/navigator team sharing one car. Shared
   control needs separate approved roles and a clear conflict policy first.
4. Safe classroom cybersecurity missions: identify an invalid command in a
   simulator, spot a stale telemetry packet, or earn a badge for a sound test.
   Never reward exploiting live classmates' control channels or weakening STOP.
5. A short campaign that unlocks stories, cosmetic badges, and new objectives,
   with no new motor privileges.

## Playtest before calling it fun

Use real observations, not just automated tests. Start with one car at a modest
fixed cap, then two, then four. Record device/browser, controller type, active car
count, supervision, and whether the session was simulated or physical.

Measure time to first successful control, missed STOP attempts, accidental starts,
control handoff errors, glance time away from the track, round completion, and
whether players voluntarily request a rematch. Ask each player what they believed
the objective and result were. A confusing celebration is not a successful result.

For the course's flipped schedule, students can explore one simulated mode at home
before Thursday, bring one design hypothesis, and use the one-hour in-person class
for a supervised playtest and comparison. Home tasks should not depend on owning
cars. Hardware claims, Bluetooth behavior, four-car reliability, sensor direction,
and phone vibration still require device-specific validation.
