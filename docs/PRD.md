# OperAI: Product Redesign and PRD

Amazon Developer Hackathon 2026, Alexa+ track. Deadline: Oct 23, 2026.

## 1. Where the current solution is weak

- **Recovery options are hardcoded.** "Substitute / swap / delay" is an if/else. The LLM only narrates it. A sharp judge sees "LLM wrapper around a script."
- **It's reactive.** The owner has to say "we're out of paneer." That isn't detection.
- **Impact is invisible.** Cost and margin per option are shown, but nothing says "here's what happens if you do nothing." Without that baseline, no option looks valuable.
- **Pricing is commodity.** Every costing tool does it. It should be the foundation, not the star.
- **Voice is a skin.** Nothing in the design needs hands-free.
- **The loop doesn't close.** There's no customer action, no learning, and no end-of-day proof.

## 2. Where AI gives real value (not just an LLM call)

| Job | Right tool | Why not just an LLM |
| --- | --- | --- |
| Scheduling and replanning | Constraint solver (OR-Tools CP-SAT) over tasks, burners, cooks, deadlines | An LLM can't guarantee a feasible schedule. A solver can, and it's provable |
| Generating recovery options | Apply each candidate action to the state, re-solve, compare outcomes | Options come from real simulation, not templates |
| Substitution | LLM proposes candidates, a rule layer validates (allergens, diet tags, owner-approved list) | LLM guesses are unsafe for food |
| Order intake | LLM extraction with schema validation, confidence and clarifying questions | Genuine unstructured-to-structured job |
| Ranking options | Scoring on weights that adapt to the owner's past approvals | Light personalisation, honest and explainable |
| Explanation and voice | LLM grounded only on solver outputs | Never invents numbers |

The LLM is the interface. The solver and rules are the brain. Say that on stage.

## 3. What makes the journey stronger

1. **Evening brief (proactive).** "Tomorrow: 26 orders. Paneer short by 1 kg. 4 orders at risk, ₹1,180 revenue exposed."
2. **Do-nothing baseline vs options.** Every option is compared against "ignore it."
3. **Voice-verified approval.** "Confirm option 2."
4. **Replan with minimal disruption.** Don't reshuffle tasks already in progress.
5. **Customer loop.** Drafted WhatsApp messages for affected customers.
6. **Day-end proof.** "Protected 4 orders, preserved ₹X vs doing nothing."
7. **Undo.**

## 4. What a judge understands in 5 seconds

One impact card, shown before and after approval:

> **Without action:** 4 orders late/cancelled, ₹1,180 at risk **With Option 2:** 0 late, ₹310 extra cost, margin 21% → 18%

Make this the hero of the UI and the demo. (These figures are illustrative, not verified business data.)

## 5. Improved MVP, prioritised (impact > differentiation > feasibility)

| # | Change | Impact | Differentiation | Feasible in 7 days |
| --- | --- | --- | --- | --- |
| 1 | Solver-based scheduler and replan (greedy fallback ready) | High | High | Medium, so model it small |
| 2 | Proactive evening brief with risk and ₹ exposure | High | High | High |
| 3 | Do-nothing vs options impact card | High | High | High |
| 4 | Simulation-generated options (4 types) with transparent score | High | High | Medium |
| 5 | Voice read-back and confirm-by-option-number | Medium | Medium | High |
| 6 | Validated substitution table (LLM proposes, rules decide) | Medium | High | High |
| 7 | WhatsApp paste to order extraction | Medium | Medium | High |
| 8 | Customer message drafts (wa.me) | Medium | Medium | High |
| 9 | Audit log and undo | Medium | Medium | High |
| 10 | Day-end summary | Medium | Medium | High |
| 11 | Pricing analysis (supporting feature, feeds margin math) | Low | Low | High |

**Deferred (be honest):** demand forecasting. With simulated history, any accuracy claim would be fake. Only add a moving-average forecast if you have real order history, and label it.

**Alexa+:** expose the backend as MCP tools if the track allows. Verify the rules early.

---

# PRD: OperAI

## Product name

OperAI

## One-line description

A voice-first kitchen co-pilot that spots tomorrow's problems tonight, simulates recovery options, and replans only after the owner approves.

## Problem statement

Small food businesses price, plan and fix disruptions mentally while cooking. A single missing ingredient cascades across orders, and owners can't calculate cost, timing and customer impact fast enough, so they lose margin, miss deadlines, or cancel orders.

## Target users

- **Primary:** home-based and cloud-kitchen owners, tiffin services (1-3 people, orders via WhatsApp/Instagram/delivery apps)
- **Secondary:** small cafes, cloud kitchen managers

## Goals

1. Turn shortages from surprises into decisions made before orders fail.
2. Show the financial and delivery impact of every decision against doing nothing.
3. Keep the owner in control (approval, audit, undo).
4. Work hands-free.

## User pain points

- True per-dish cost is hidden (packaging, commission, overhead)
- 20-30 orders compete for limited burners, cooks and time
- One shortage cascades into several orders
- No time to type or calculate mid-cooking
- Distrust of tools that act without asking
- Orders arrive as messy chat messages

## Core features

1. **Evening/morning risk brief:** stock vs next-day orders, at-risk orders, ₹ exposure
2. **Solver-based scheduler:** feasible plan for burners, cooks, deadlines, ingredients
3. **Shortage recovery engine:** up to 4 simulated options (substitute, dish swap, delay and notify, partial/priority reorder; emergency purchase optional)
4. **Impact card:** do-nothing vs each option (late orders, ₹ cost, margin change)
5. **Voice approval:** read-back and "confirm option N"
6. **Replan with minimal disruption**, plus before/after view
7. **Customer message drafts** via WhatsApp link
8. **Order intake from pasted WhatsApp text**
9. **Audit log with undo**
10. **Pricing analysis** with suggested price (supporting)
11. **Day-end summary:** orders protected, ₹ preserved

## User journeys

**J1, proactive (hero):** Evening brief flags paneer shortage → owner asks "what are my options?" → system reads 3 ranked options with impact → owner says "confirm option 2" → plan updates → customer drafts shown → audit entry written.

**J2, reactive:** Owner says "we're out of paneer" mid-cooking → affected orders identified → options and approval as above.

**J3, intake:** Owner pastes a WhatsApp message → extracted order shown with confidence → owner confirms → plan updates.

**J4, pricing:** Owner says "paneer biryani at ₹180" → cost breakdown, loss per order, suggested price.

**J5, undo:** Owner says "undo last change" → proposed reversal → approval → restored plan.

## Functional requirements

- **FR1:** Compute per-dish cost (ingredients, packaging, commission, overhead) and suggest a price from a target margin.
- **FR2:** Generate a feasible schedule respecting deadlines, ingredient stock, burner and cook limits.
- **FR3:** Compare stock against planned orders and list at-risk orders with ₹ exposure.
- **FR4:** Generate recovery options by applying each candidate action to state and re-solving.
- **FR5:** Score options on lateness, margin impact and customer-acceptance risk; show the formula.
- **FR6:** Show do-nothing baseline alongside options.
- **FR7:** Every consequential action is created as `pending`; nothing executes without approval.
- **FR8:** Approval requires explicit option reference; revalidate stock and plan state at execution; duplicate approvals are idempotent.
- **FR9:** Replan changes only affected tasks; tasks in progress are locked.
- **FR10:** Write audit entries with before/after snapshots; undo is an approval-gated action.
- **FR11:** Substitutions only from the validated table (allergen and diet checks); flag "needs customer consent".
- **FR12:** Extract orders from pasted text with schema validation and ask a clarifying question on ambiguity.
- **FR13:** Voice input/output via browser APIs with text fallback.
- **FR14:** Label every data field as simulated or verified.
- **FR15:** Generate customer message drafts after approval.

## Non-functional requirements

- **Correctness:** all financial and schedule numbers come from deterministic code, never LLM output
- **Latency:** solver under about 3 s for \~30 orders; option generation under about 5 s
- **Safety:** zero unintended executions, with approval gate and revalidation tests
- **Reliability:** text fallback when speech fails; greedy scheduler fallback if solver fails
- **Security:** no secrets in the repo; env vars; basic input validation
- **Transparency:** every recommendation explains its numbers and assumptions
- **Usability:** the core flow completable in under 5 interactions
- **Maintainability:** modular services, PR-based workflow

## AI/ML functionality

| Component | Approach | Guardrail |
| --- | --- | --- |
| Scheduling / replanning | CP-SAT constraint optimisation | Greedy fallback |
| Option generation | State simulation and re-solve | Only valid actions generated |
| Option ranking | Weighted scoring; weights adjust from owner approvals | Weights visible; no black box |
| Substitution | LLM proposes, rule table validates | Allergen/diet checks |
| Order extraction | Bedrock structured extraction | Schema validation, confidence, owner confirm |
| Intent parsing | Bedrock tool selection | Tools are fixed backend endpoints |
| Explanation | Bedrock narrates solver output | Only given numbers allowed |

## Success metrics

These are targets to measure in testing. Report only what you actually measure.

- Orders protected vs do-nothing in the demo scenario
- ₹ margin preserved vs do-nothing
- Time to decision: manual attempt vs OperAI (stopwatch test)
- Order extraction accuracy on a small labelled test set (e.g. 20-30 messages)
- Unintended executions: target 0
- Solver response time and plan feasibility rate across test cases
- Feedback from at least one real kitchen owner, if possible

## MVP scope (Oct 16-23)

Features 1-6, 9 and 10 are mandatory. Add 7 and 8 next, then 11 as time allows. Seed data comes from the team's own kitchen where possible, otherwise labelled simulated. One polished scenario (paneer shortage, \~25 orders) plus one edge case (no feasible option, honest escalation). Browser voice simulator.

## Future scope

- Real Alexa+/device integration and MCP ecosystem
- Demand forecasting from real order history
- Live inventory sync and supplier ordering
- Direct WhatsApp Business API and delivery-app integrations
- Learned substitution acceptance per customer
- Multi-kitchen support, staff roles, supplier price tracking

## Out of scope

Auth and accounts, payments, multi-tenant, native mobile apps, real-time delivery tracking, tax/accounting, claims of verified business results without real data.

## Critical caveat

The solver is the highest-risk item. Model it small (tasks, burners, cooks, deadline) and keep the greedy fallback. If it isn't solid by end of Oct 18, ship greedy and move the solver to future scope rather than risk the demo.