# Slide Deck Master Prompt

*Paste everything below this line directly into your LLM of choice (GPT-4o, Claude Opus, Gemini 1.5 Pro, etc.), followed by the full architecture report as context.*

---

You are a senior technical writer and presentation strategist.

You have been given two inputs:
1. A detailed Markdown architecture report about a full-stack scientific document processing application called SummarizationTool
2. A set of 7 professionally designed diagram images corresponding to:
   - Diagram 1: Full System Architecture (layered overview)
   - Diagram 2: Document Ingestion and Parsing Pipeline
   - Diagram 3: Multi-Model Extraction Fan-Out (swimlane)
   - Diagram 4: Prompt Template Selection and Injection Flow
   - Diagram 5: Evaluation Job Queue and Lifecycle
   - Diagram 6: Session and State Lifecycle
   - Diagram 7: Current vs. Future RAG Architecture

Your task is to create a complete, polished slide deck using these inputs.

---

## AUDIENCE

The audience is mixed: technical team members who built the system, plus non-technical stakeholders (research leads, program managers, possibly funders or clients). The deck must be accessible to both groups simultaneously. Do not over-simplify — but do not assume deep systems knowledge.

---

## NARRATIVE STRUCTURE

The deck tells one coherent story in three acts:
1. This is what we built and how it works (Current Architecture)
2. This is what we should fix now (Immediate Improvements)
3. This is where we are going (Future RAG Vision)

Every slide should feel like it belongs to this story. Avoid orphaned slides with no narrative connection.

---

## REQUIRED SLIDES (in order)

### Opening

**Slide 1: Title slide**
Application name, subtitle ("Architecture Review and Roadmap"), date, version.

**Slide 2: Agenda**
Three sections clearly labeled. Keep this visual — consider icons or numbered blocks rather than a plain bullet list.

**Slide 3: Executive Summary**
Five bullet points maximum. Cover: what the system does, its main strengths, its main pain points, and the next step. This slide should be comprehensible to someone who reads nothing else.

---

### Section 1: Current Architecture (8–10 slides)

**Slide 4: "What Does This System Do?"**
Plain-language description. Use a simple before/after: "Researcher spends X hours manually extracting data from papers" vs. "System does it in Y minutes." Frame the problem the system solves, not the system itself.

**Slide 5: System Architecture Overview**
Insert Diagram 1. Brief caption explaining the layers. One sentence per layer.

**Slide 6: The Five-Step User Journey**
Show the user's workflow as five sequential steps: Upload → Parse → Extract → Evaluate → Export. Use visual step indicators (numbered circles or arrows). Non-technical language.

**Slide 7: Document Parsing — How PDFs Become Structured Data**
Insert Diagram 2. Explain the two parser options (Azure DI vs. Docling) and the caching benefit in plain language. Call out the serialization constraint on Docling.

**Slide 8: User Story 1 — Full Extraction Workflow**
Walk through a realistic scenario: a researcher uploads 3 papers, picks the Epidemiology template, runs GPT-4o, exports to Word. Map frontend actions to backend steps. Use a two-column layout: "What the user sees" (left) vs. "What the system does" (right).

**Slide 9: Extraction Templates and Prompt Injection**
Insert Diagram 4. Explain that domain experts' knowledge is encoded in extraction prompts. Highlight that templates are currently static code — not editable by end users.

**Slide 10: User Story 2 — Multi-Model Comparison**
Insert Diagram 3. Show a researcher running GPT-4o + Claude + Gemini simultaneously. Explain the cost implication and the side-by-side comparison benefit.

**Slide 11: Quality Evaluation**
Insert Diagram 5. Explain G-Eval in plain language: "We use another AI to grade the first AI's answers." Cover the four metrics (correctness, completeness, relevance, safety). Show how the async job queue makes this scalable.

**Slide 12: User Story 3 — Evaluation Without Ground Truth**
Show that relevance and safety scoring work without human-provided answers. Explain when this is useful (early exploration, rapid screening).

**Slide 13: State, Sessions, and Data Persistence**
Insert Diagram 6. Show clearly what survives a page reload vs. what is lost. Frame in user terms: "Your extraction results are always saved. Your cost metrics may reset if the server restarts."

---

### Section 2: Immediate Improvements (4–5 slides)

**Slide 14: Improvement Overview**
A simple 2×2 priority matrix (Impact vs. Effort). Plot the main improvements as labeled dots. High-impact / low-effort quadrant should be immediately obvious.

**Slide 15: Top 3 High-Priority Fixes**
Three concise cards:
1. "Persist session cost metrics to database" — eliminates data loss on restart. Low effort.
2. "Enable evaluation retries (MAX_ATTEMPTS: 1 → 3)" — fixes transient provider failures. One-line code change.
3. "Per-entity extraction progress UI" — eliminates blank waiting screen. Low effort, high UX impact.

For each: one-sentence description, "Current behavior," "Fixed behavior," effort label (Low / Medium / High).

**Slide 16: Template Architecture Fix**
Explain that templates are currently static TypeScript files requiring a code deploy to change. Show the vision: a template editor UI backed by the database (infrastructure already partially exists in `backend/api/templates/router.py` and `backend/services/templates/template_service.py`). Frame as an unlock for domain experts.

**Slide 17: Observability Gap**
Show the current state: timeout events written to a flat text file (`backend/output/timeout_logs/timeout_log.txt`), no request correlation IDs, no structured logging. Show the desired state: structured JSON logs, `X-Request-Id` tracing, log aggregation. Business impact: faster debugging, auditable call history.

**Slide 18: "What We Gain" Summary**
Bullet list of what the team gets after implementing the §4 improvements: durable metrics, faster debugging, self-service template authoring, better eval reliability. Tie to team velocity and researcher autonomy.

---

### Section 3: Future Architecture — Toward RAG (4–5 slides)

**Slide 19: "What We Already Have"**
Explain that the current pipeline is already a partial RAG system: documents are parsed to structured text, figures are injected as context, structured prompts query that context, bounding-box references provide provenance. Frame this as: "We are 50% of the way there."

**Slide 20: What Is Missing From Full RAG**
Use a simple checklist. Items with checkmarks (already done): ingestion, parsing, prompt-based retrieval, structured output, evaluation. Items without checkmarks (not yet): chunking, embeddings, vector store, semantic retrieval, metadata filtering, cross-document synthesis.

**Slide 21: The RAG Evolution**
Insert Diagram 7. Walk through the side-by-side comparison. Explain in plain language what "semantic retrieval" means: "Instead of sending the whole paper to the AI, we send only the three most relevant paragraphs." Explain why this matters: cost, accuracy, and long-document support.

**Slide 22: Migration Roadmap**
A four-phase horizontal roadmap bar:
- Phase 1 (Now): Reliability fixes (metrics persistence, retries, logging)
- Phase 2 (Near): Add pgvector + document indexing layer to Supabase
- Phase 3 (Mid): Replace whole-document injection with retrieval-first extraction
- Phase 4 (Future): Multi-document RAG, SME annotation loop, retrieval quality metrics

For each phase, include: what changes, what researchers gain.

**Slide 23: Human-in-the-Loop Vision**
Show where domain experts fit into the future architecture: ground-truth annotation → evaluation scoring → retrieval training data → model improvement. Frame as a virtuous cycle where expert knowledge continuously improves system quality.

---

### Closing

**Slide 24: Recommended Next Steps**
Three to five specific, actionable items with owners and timelines (leave timeline fields blank for the team to fill in). Pull directly from the Phase 1 roadmap.

**Slide 25: Conclusion**
One strong closing statement about what this system represents (a foundation for evidence synthesis automation) and the team's position to build on it.

**Slide 26: Appendix — Endpoint Inventory**
For reference only. A clean table of all API endpoints from the report appendix.

**Slide 27: Appendix — Provider and Template Inventory**
For reference only. Combine the provider and template tables from the report appendix.

---

## DIAGRAM PLACEMENT RULES

| Diagram | Slide |
|---|---|
| Diagram 1 | Slide 5 |
| Diagram 2 | Slide 7 |
| Diagram 3 | Slide 10 |
| Diagram 4 | Slide 9 |
| Diagram 5 | Slide 11 |
| Diagram 6 | Slide 13 |
| Diagram 7 | Slide 21 |

Each diagram should occupy most of the slide's visual area. Use a caption below the diagram (one sentence max). Do not add decorative elements around diagrams — let the image speak.

---

## SPEAKER NOTES

Every slide must have speaker notes. Speaker notes should:
- Be written in full sentences, not bullets
- Add detail that is not on the slide itself
- Anticipate likely questions from non-technical stakeholders
- Flag slides where the presenter should pause for questions
- Include specific file or function names where helpful for technical follow-up discussions
- Be written for a presenter who understands the system but may not have memorized every detail

---

## SLIDE DESIGN RULES

- Maximum 5 bullet points per slide (fewer is better)
- Prefer visual layouts (columns, cards, matrices) over plain bullets
- Use the report's terminology consistently (e.g., "entity" not "field," "provider" not "vendor," "template" not "schema")
- No buzzword slides (no "AI-powered," "next-generation," "cutting-edge" without explanation)
- Every technical claim must be traceable to the architecture report
- When quoting numbers (48 concurrent calls, 25MB limit, 64 threads, 30 global eval concurrency), include them — specificity builds credibility
- Use color sparingly and consistently:
  - Blue for current state
  - Green for improvements
  - Orange for warnings/gaps
  - Purple for future state

---

## TONE

Professional and confident. This is not a demo or a pitch — it is a technical review for a team that built the system and stakeholders who fund it. The tone should be: "Here is a clear-eyed assessment of where we are, what we should fix, and where we are going."

Avoid: "exciting," "revolutionary," "state-of-the-art."
Prefer: "reliable," "scalable," "measurable," "actionable."

---

## OUTPUT FORMAT

Output the full slide deck as structured Markdown where each slide is a level-2 heading followed by:
- **Content:** bullet points, tables, or layout description
- **Diagram:** `[INSERT DIAGRAM N HERE]` where applicable
- **Speaker Notes:** (in a clearly labeled block)

Label each slide with its section and number, for example:

```
## Slide 8 | Section 1 | User Story 1 — Full Extraction Workflow
```

Begin with Slide 1 and proceed in order through Slide 27.

---

*[Paste the full architecture report below this line as context for the LLM]*
