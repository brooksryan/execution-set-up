# Prior Art: PRD-010 — Grill family: context-grill, epic-grill, and the optional type pass

Researched 2026-06-14. Covers: (1) decomposing requirements-elicitation / design interviews into staged or scoped passes; (2) type-driven design dialogues and "make illegal states unrepresentable"; (3) LLM-agent interview/elicitation patterns and how they decide depth; (4) living-documentation grills; (5) known gotchas when splitting one prompt/skill into several.

---

## Existing approaches

### 1. EventStorming's three-workshop sequence (Big Picture → Process Modelling → Software Design)

Alberto Brandolini's EventStorming family is the canonical industry example of separating vocabulary/shared-model work from requirements work from design work into distinct, sequenced workshops with distinct artifacts and attendees.

- **Big Picture** (25–30 people, exploratory): produces a visual shared model of the business domain — events, systems, people, hotspots. The shared vocabulary emerges here.
- **Process Modelling** (4–8 people, focused): maps one specific process step-by-step; vocabulary is taken as given from Big Picture.
- **Software Design** (technical, smaller): extends Process Modelling to aggregates, bounded contexts, commands — explicit design artifacts.

Each workshop has a different scope owner, a different attendee set, and different output artifacts. The sequencing is intentional: vocabulary must precede structural modeling, which must precede software design.

Sources:
- [Event storming 101 — RST Software](https://www.rst.software/blog/event-storming-101-flexible-workshop-approach-to-domain-driven-design)
- [Big Picture EventStorming — SoftwareMill](https://softwaremill.com/big-picture-event-storming-simple-workshops-big-benefits-for-your-business/)
- [Collaborative Process Modelling — Alberto Brandolini (Medium)](https://medium.com/@ziobrando/collaborative-process-modelling-with-eventstorming-17ed363650c0)

### 2. Automating DDD: vocabulary-first then design

A 2026 preprint describes an LLM prompting framework for automating DDD that explicitly sequences passes: first it extracts the ubiquitous language (terms, definitions), then uses that vocabulary as input to generate bounded contexts, aggregates, and entities. The separation is intentional — the paper treats vocabulary as the foundation on which all downstream design decisions depend, because AI-generated designs that skip this step produce generic patterns not grounded in domain knowledge.

Source:
- [Automating Domain-Driven Design: Experience with a Prompting Framework (arXiv 2603.26244)](https://arxiv.org/pdf/2603.26244)

### 3. LLMREI: staged LLM requirements interview with short vs long prompt variants

LLMREI (Automating Requirements Elicitation Interviews with LLMs, 2025) tested two prompt variants: a short zero-shot prompt (LLMREI-short) vs a long prompt structured around role definition, five-step interview guidelines, and error-handling protocols (LLMREI-long). The five steps mirror Christel and Kang's classic interview structure: preparation, conducting, documentation, analysis/integration. The long prompt incorporates best practices inline (e.g., "discuss existing systems", "provide summaries"). LLMREI-long outperformed the short variant, suggesting that explicit multi-step structure within a single elicitation context improves output quality.

Sources:
- [LLMREI: Automating Requirements Elicitation Interviews with LLMs (arXiv 2507.02564)](https://arxiv.org/html/2507.02564v1)
- [LLMREI PDF](https://arxiv.org/pdf/2507.02564)

### 4. Elicitron: separate product-experience pass before interview pass

Elicitron (Autodesk Research, 2024) runs four sequential phases: agent generation → product experience simulation → structured interview → latent needs identification. Crucially, the product-experience pass (agents simulate using the product) happens before the interview pass, and interview questions are given context from that earlier simulation. This is analogous to PRD-010's pattern: a context-establishing pass (context-grill) before a requirements-elicitation pass (epic-grill).

Source:
- [Elicitron: An LLM Agent-Based Simulation Framework for Design Requirements Elicitation (arXiv 2404.16045)](https://arxiv.org/abs/2404.16045)

### 5. iReDev: six-agent multi-agent requirements framework

iReDev (2025) uses six specialized knowledge-driven agents to cover the full requirements development lifecycle. Each agent has a defined profile, owned task, and knowledge scope — the framework treats domain vocabulary and pain-point knowledge as injected inputs to agents rather than outputs they discover. This reflects the same single-responsibility principle PRD-010 applies to grills: one agent/grill per concern.

Source:
- [iReDev: A Knowledge-Driven Multi-Agent Framework for Intelligent Requirements Development (arXiv 2507.13081)](https://arxiv.org/abs/2507.13081)

### 6. Scott Wlaschin's "Designing with types" series and DDD with F# type system (2014–present)

The closest prior art to PRD-010's "work-in-types" optional pass. Wlaschin's methodology:
1. Start with loose/primitive types, then wrap primitives in single-case union types for semantic clarity.
2. Enumerate all valid states as discriminated union variants (not optional fields) — making invalid combinations literally unrepresentable.
3. Require exhaustive pattern matching: the compiler forces every union variant to be handled; nothing left unspecified.
4. Extend to state machines: identify states, then define which transitions are valid per state — bridging data-structure analysis with behavioral constraints.
5. Post 4 ("Discovering new concepts") specifically addresses using the type structure to surface hidden domain concepts that weren't visible before the type analysis.

The series does not describe switching axes (e.g. from data model to call graph), but the state-machine post implicitly does so: after completing the data model, Wlaschin shifts to modeling valid transitions, which is a behavioral/call-graph axis.

Sources:
- [The "Designing with types" series — F# for Fun and Profit](https://fsharpforfunandprofit.com/series/designing-with-types/)
- [Making illegal states unrepresentable — F# for Fun and Profit](https://fsharpforfunandprofit.com/posts/designing-with-types-making-illegal-states-unrepresentable/)
- [Domain-Driven Design with the F# Type System — Speaker Deck (F#unctional Londoners 2014)](https://speakerdeck.com/swlaschin/domain-driven-design-with-the-f-number-type-system-f-number-unctional-londoners-2014)

### 7. Grill-with-docs (mattpocock/skills) — the upstream skill PRD-010 forks

The original grill-with-docs separates vocabulary writes (CONTEXT.md) from design writes (ADRs), but collapses all three concerns (vocabulary, requirements, design) into one session with no phase gating. It uses the same ADR offer criteria (hard to reverse + surprising + real trade-off) and the same "ask one question at a time" discipline. It does not offer an optional deep pass or a structured termination condition.

Sources:
- [grill-with-docs SKILL.md — mattpocock/skills on GitHub](https://github.com/mattpocock/skills/blob/main/skills/engineering/grill-with-docs/SKILL.md)
- [Aligning Plans with Docs (Grill-with-Docs) — DeepWiki](https://deepwiki.com/mattpocock/skills/7.1-aligning-plans-with-docs-(grill-with-docs))

### 8. Anthropic's guidance on agent decomposition: context-centric splits only

Anthropic's official guidance (Claude blog + MindStudio documentation) provides direct precedent for PRD-010's "fresh session" rule. Their framing: decompose when context can be truly isolated; never decompose by work type (planning vs implementation vs testing as separate passes) because that creates coordination overhead and each handoff loses context. The criterion for splitting is whether concerns compete for the agent's attention and whether the output of one pass is irrelevant to the next.

Sources:
- [When to use multi-agent systems — Claude blog (Anthropic)](https://claude.com/blog/building-multi-agent-systems-when-and-how-to-use-them)
- [Sub-agents in Claude Code to manage context — MindStudio](https://www.mindstudio.ai/blog/sub-agents-claude-code-context-management)

---

## Gotchas

### G1. LLMs lack principled stopping criteria for interviews — they exhaust turn budgets

ReqElicitGym found that most tested LLMs "overwhelmingly favor probing over clarification" and lack effective termination mechanisms. GPT-5.2 reached 19.98 turns on average — essentially always hitting the hard 20-turn cap rather than deciding to stop. The work-in-types pass in PRD-010 needs an explicit, semantically meaningful termination condition ("every union variant handled, every seam specified on both sides") rather than a turn limit, because without it the agent will keep probing.

Source:
- [ReqElicitGym (arXiv 2602.18306)](https://arxiv.org/html/2602.18306)

### G2. LLMs degrade significantly across long multi-turn conversations

The paper "LLMs Get Lost In Multi-Turn Conversation" documents context drift, premature solution proposals, and difficulty course-correcting as conversations lengthen. Reliability degrades as turns compound. This is the primary empirical motivation for PRD-010's fresh-session rule (context-grill and epic-grill run as separate sessions). If both grills ran in the same thread, early vocabulary decisions would compete with later requirements decisions in the model's attention.

Source:
- [LLMs Get Lost In Multi-Turn Conversation (arXiv 2505.06120)](https://arxiv.org/pdf/2505.06120)

### G3. Premature commitment in underspecified conversations

The same multi-turn research documents that LLMs "make early assumptions to fill in for missing information" and "prematurely attempt to propose finalized solutions." This is directly relevant to the epic-grill's optional deep pass: if the agent launches into type-design work without first completing the requirements pass, it will prematurely constrain the design space. PRD-010's sequencing (requirements pass → optional type pass) is the correct mitigation.

Source:
- [Multi-Turn LLM Evaluation in 2026 — Confident AI](https://www.confident-ai.com/blog/multi-turn-llm-evaluation-in-2026)

### G4. Context bleed between passes is not automatic — it must be explicitly handed off

MindStudio's Claude Code sub-agent documentation makes explicit: "Sub-agents don't have memory between runs. If you spawn a new sub-agent to 'continue where the last one left off,' it starts completely fresh." For PRD-010's grill family, this means the context-grill's CONTEXT.md output must be written to disk (which the skill does) before the epic-grill runs, because the epic-grill reads it by explicit path — not through shared in-memory state. If this write is delayed or partial, the epic-grill operates on a stale or empty glossary.

Source:
- [Sub-agents in Claude Code to manage context — MindStudio](https://www.mindstudio.ai/blog/sub-agents-claude-code-context-management)

### G5. "Role bleed" — an agent doesn't know which part of its prompt is permanent behavior vs current input

The prompt engineering literature names "role bleed" as a failure mode when a single system prompt handles multiple concerns: the model treats all content as context and rebalances with each request, causing it to drift from its defined role. This is why grill-with-docs' current design (vocabulary + requirements + design in one prompt) produces inconsistency: the model's "what am I here to write?" framing shifts mid-session depending on what the latest exchange emphasized. PRD-010's writer-home keying directly addresses this.

Source:
- [How AI Splits Your Content — ZipTie.dev](https://ziptie.dev/blog/how-ai-splits-your-content-across-multiple-answers/)

### G6. Splitting by work type (not context) creates coordination overhead and context loss at handoffs

Anthropic's official guidance specifically warns against splitting "planning, implementation, testing" into separate agents: this creates "constant coordination overhead" and "each handoff loses context." PRD-010's grill family avoids this by splitting on artifact ownership (who writes what) rather than on task type. The risk is that if someone tries to extend the grill family by splitting the epic-grill into a "requirements agent" and a "design agent" (work-type split rather than context-centric split), they will hit this failure mode.

Source:
- [When to use multi-agent systems — Claude blog (Anthropic)](https://claude.com/blog/building-multi-agent-systems-when-and-how-to-use-them)

### G7. LLMREI: hallucination risk when agent goes beyond its chartered role

LLMREI documented that LLMs in elicitation interviews would hallucinate information outside their mandate (providing cost estimates without data, requesting personal information). In PRD-010, the context-grill must not write to ADRs (that's epic-grill's home), and the epic-grill must not write to CONTEXT.md (that's context-grill's home). Without an explicit "you are only allowed to write X" constraint in each skill's prompt, the agent will write outside its home when it encounters a tempting topic — the same hallucination-of-scope failure LLMREI observed.

Source:
- [LLMREI: Automating Requirements Elicitation Interviews with LLMs (arXiv 2507.02564)](https://arxiv.org/html/2507.02564v1)

### G8. Vocabulary-last is a known DDD anti-pattern (SDD critique)

The "Spec-Driven Development is DDD's Impatient Cousin" article identifies the core failure mode of collapsing vocabulary and design into one upfront pass: domain model insights that emerge through implementation cannot be anticipated in a single session. A one-pass grill that tries to build both the glossary and the design simultaneously will produce design decisions grounded in pre-glossary (imprecise) vocabulary that later needs to be reinterpreted. PRD-010's sequencing (context-grill before epic-grill) directly avoids this.

Source:
- [Spec-Driven Development is Domain-Driven Design's Impatient Cousin — INNOQ (2026)](https://www.innoq.com/en/blog/2026/03/sdd-ddd-why-bmad-wont-save-you/)

---

## Nothing found

- **"Work in types" as a named methodology**: no prior art found. Wlaschin's "designing with types" series covers the core techniques (exhaustive union variants, totality, discovering concepts from structure, state machines as behavior axis), but does not use the phrase "work in types" or describe the "switch axes" technique (data model → call graph → liveness) as a named discipline. This appears to be an original synthesis in PRD-010.
- **"Light requirements pass → optional deep design pass" as a named pattern**: no prior art found under any name. The concept exists in practice (EventStorming workshops are optional and sequenced by need) but no literature describes an agent or skill that explicitly offers a deep pass only when warranted, with a decision procedure for when to offer it.
- **Totality-checking as a dialogue termination condition**: found totality checking as a compiler/type-system concept (exhaustive pattern matching, Wlaschin's series), but not as a conversational termination criterion for a design interview. PRD-010's use of "every union variant handled, every seam specified" as the grill's exit condition is novel application of the concept.
