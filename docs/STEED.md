# Steed — The Manifesto

*A research automation philosophy*

```
  ,  ,.~"""""~~..                                          ___
  )\,)\`-,       `~._                                   .'   ``._
  \  \ | )           `~._                 .-"""""-._   /         \
 _/ ('  ( _(\            `~~,__________..-"'          `-<           \
 )   )   `   )/)   )        \                            \           |
') /)`      \` \,-')/\      (                             \          |
(_(\ /7      |.   /'  )'  _(`                              |         |
    \\      (  `.     ')_/`                                |         /
     \       \   \                                         |        (
      \ )  /\/   /                                         |         `~._
       `-._)     |                                        /.            `~,
                 |                          |           .'  `~.          (`
                  \                       _,\          /       \        (``
                   `/      /       __..-i"   \         |        \      (``
                  .'     _/`-..--""      `.   `.        \        ) _.~<``
                .'    _.j     /            `-.  `.       \      '=<``
              .'   _.'   \    |               `.  `.      \
             |   .'       ;   ;               .'  .'`.     \
             \_  `.       |   \             .'  .'   /    .'
               `.  `-, __ \   /           .'  .'     |   (
                 `.  `'` \|  |           /  .-`     /   .'
                   `-._.--t  ;          |_.-)      /  .'
                          ; /           \  /      / .'
                         / /             `'     .' /
                        /,_\                  .',_(
                       /___(                 /___( 

  You set the direction. Steed handles the journey.
```

---

## The Metaphor

In the age of chivalry, a knight's steed was more than transportation. It was:

- **A partner** — responsive to the slightest command
- **A guardian** — carrying the rider through danger unharmed
- **A force multiplier** — extending the knight's reach tenfold
- **Unwavering** — it did not question, only executed

Steed, the research automation system, embodies these same qualities.

---

## What Steed Is

**Steed is the bridge between intention and execution.**

You are the researcher. You hold the vision: the architecture variant, the hyperparameter sweep, the ablation study. But between that vision and the trained model lies a chasm of infrastructure—provisioning, configuration, monitoring, failure recovery, artifact management.

Steed crosses that chasm for you.

It does not conduct research. It does not design experiments. It simply carries your experimental design faithfully to completion and brings back the results. You remain the intellect; Steed is the faithful mount.

---

## What Steed Is Not

- **Steed is not intelligent.** It does not optimize your learning rate or suggest architecture changes. That remains your domain.
- **Steed is not implicitly autonomous.** The runtime executes explicit commands. Autonomous behavior is opt-in and bounded by policy (time/budget), while manual mode remains explicit and step-wise.
- **Steed is not a black box.** Every step produces evidence: logs, JSON artifacts, deterministic checkpoints. The journey is auditable.
- **Steed is not a substitute for understanding.** You should know what it's doing. But you shouldn't have to babysit it.

---

## The Philosophy of Reliable Automation

### 1. Faithful Execution

Given a manifest and configuration, Steed executes exactly what was requested. No more, no less. It does not "helpfully" change your batch size or skip runs it thinks are unimportant.

### 2. Evidence Over Trust

Evidence is canonical and machine-readable. Flow execution writes a single `flow.state.json` artifact with per-phase entries, deterministic verdicts, and final summary. Sweep runs emit `summary.json` and `stdout.log`. Policy denials emit structured payloads (reason code + desired action) for deterministic recovery loops.

### 3. Graceful Degradation

When things go wrong—and they will—Steed fails visibly and informatively. A stalled sweep is detected and reported. A failed run is logged with its exit code. Nothing fails silently.

### 4. Policy as Contract

The contract is enforced at the gate. In manual mode, mutating actions are executed explicitly step-by-step (with optional hardened signed permits). In autonomous mode, execution is bounded by explicit TTL and mutation budgets. Violations are denied with deterministic reason codes, not fuzzy behavior.

### 5. The Single Command Journey

```bash
steed flow --sweep start --fetch all --teardown delete
```

One command can still run the full journey: provision, execute, retrieve, cleanup. In manual workflows, the same journey is executed step-by-step; optionally, hardened permit mode adds cryptographic approval per mutating step. Both paths keep the contract: you define the destination, Steed handles the terrain.

---

## Naming Convention

Steed's components follow the metaphor:

| Concept | Term | Meaning |
|---------|------|---------|
| Main entry point | `steed` | Your mount, ready to depart |
| Configuration | `workflow/<profile>.cfg` | The saddlebags—everything needed for the journey |
| Experiment definition | Sweep manifest | The map—where you're going |
| Execution | `flow` | The journey itself, from start to finish |
| Remote infrastructure | The pod | The steed's stable—you provision it, then ride |
| Monitoring | `sweep-watch` | Checking the steed's gait, ensuring all is well |
| Results | Artifacts | The spoils of the journey, brought home |
| Cleanup | `teardown` | Returning the steed to the stable |

---

## The Researcher's Oath

*I am the rider. Steed is my mount.*

- I will not blame the steed for poor directions
- I will not ignore the evidence it brings back
- I will learn its capabilities, its limits, its care
- I will provision fairly and teardown promptly
- I will remember: the steed serves the research, not the other way around

---

## Why This Matters

Research infrastructure is usually an afterthought. Scripts accumulate. Commands are forgotten. The path from idea to result becomes a maze of incantations.

Steed inverts this. The infrastructure becomes **invisible**—not because it's hidden, but because it's **reliable**. You stop thinking about it. You focus on the research.

That is the steed's gift: **cognitive offload**. You carry the research vision. Steed carries everything else.

---

## The Future

Steed will grow. It will learn new terrain (other GPU providers), new gaits (different training frameworks), new pack animals (larger distributed runs). But the core philosophy remains:

**You define the destination. Steed gets you there.**

Ride well.

---

*"The steed does not choose the destination—it carries you there faithfully, through every terrain, until the journey is complete."*
