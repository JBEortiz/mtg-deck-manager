# Agent Workflow

This repository uses a lightweight spec-driven multi-agent workflow.

The goal is simple:
- define the work clearly before coding
- implement only against an approved spec
- validate against acceptance criteria before closing the task

There are exactly three agents:
- `Spec Agent`
- `Dev Agent`
- `Test Agent`

Use them in that order unless a bugfix is trivial and the requirement is already unambiguous.

## Principles

- Keep the workflow small and repeatable.
- One agent owns one kind of work.
- Specs drive implementation.
- Testing validates behavior and risk. It does not redefine scope.
- Requirements changes go back to the spec, not directly into code.

## Repo Structure

- `app/`: Next.js App Router pages and route handlers
- `components/`: shared UI components
- `lib/`: client helpers, types, Scryfall helpers, and server-side domain logic
- `workflow/agents/`: agent definitions and operating rules
- `workflow/specs/`: feature specs
- `workflow/tasks/`: implementation handoff documents
- `workflow/reports/`: test and validation reports
- `workflow/templates/`: reusable document templates

## Agent Responsibilities

### Spec Agent

Owns problem definition.

Produces:
- feature spec
- acceptance criteria
- assumptions
- out-of-scope list
- open questions

Must not:
- implement code
- silently resolve ambiguity by making product decisions in code
- mark work complete without acceptance criteria

Reference:
- [workflow/agents/spec-agent.md](/C:/workspace/mtg-deck-manager/workflow/agents/spec-agent.md)

### Dev Agent

Owns implementation.

Produces:
- code changes
- implementation task updates
- notes on deviations or blockers

Must not:
- redefine requirements
- expand scope without returning to spec
- treat tests as optional when verification is possible

Reference:
- [workflow/agents/dev-agent.md](/C:/workspace/mtg-deck-manager/workflow/agents/dev-agent.md)

### Test Agent

Owns validation.

Produces:
- test report
- findings
- regression notes
- pass/fail status against acceptance criteria

Must not:
- implement feature code as part of validation
- approve behavior that contradicts the spec
- replace missing requirements with personal assumptions

Reference:
- [workflow/agents/test-agent.md](/C:/workspace/mtg-deck-manager/workflow/agents/test-agent.md)

## Standard Workflow

1. `Spec Agent` writes or refines a spec in `workflow/specs/`.
2. `Dev Agent` creates or updates a task file in `workflow/tasks/` and implements strictly against the spec.
3. `Test Agent` validates the implementation and writes a report in `workflow/reports/`.
4. If validation fails, work returns to `Dev Agent`.
5. If requirements changed during implementation, work returns to `Spec Agent` first.

## Handoff Protocol

Every handoff should be file-based and explicit.

### Spec -> Dev

Required inputs:
- approved spec file
- acceptance criteria
- known constraints

Required output:
- implementation task file that references the spec

### Dev -> Test

Required inputs:
- implementation task file
- changed files
- claimed completion status
- known risks or shortcuts

Required output:
- test report with pass/fail per acceptance criterion

### Test -> Spec or Dev

- go to `Dev Agent` if behavior is wrong but requirements are clear
- go to `Spec Agent` if requirements are ambiguous, contradictory, or incomplete

## Naming Conventions

Use short, sortable names.

- Specs: `YYYY-MM-DD-short-feature-name.md`
- Tasks: `YYYY-MM-DD-short-feature-name-task.md`
- Reports: `YYYY-MM-DD-short-feature-name-test-report.md`

Examples:
- `workflow/specs/2026-04-04-deck-delete.md`
- `workflow/tasks/2026-04-04-deck-delete-task.md`
- `workflow/reports/2026-04-04-deck-delete-test-report.md`

Use lowercase kebab-case for filenames.

## Recommended Execution Order

Default order:
1. spec
2. implementation
3. validation

Do not start implementation before the spec has:
- problem statement
- scope
- acceptance criteria
- non-goals

Do not close work before the test report exists.

## Minimal Working Files

Start from these templates:
- [workflow/templates/feature-spec.md](/C:/workspace/mtg-deck-manager/workflow/templates/feature-spec.md)
- [workflow/templates/implementation-task.md](/C:/workspace/mtg-deck-manager/workflow/templates/implementation-task.md)
- [workflow/templates/test-report.md](/C:/workspace/mtg-deck-manager/workflow/templates/test-report.md)

## Example Flow

Feature: add deck deletion

1. `Spec Agent`
   writes `workflow/specs/2026-04-04-deck-delete.md`
   defines user goal, constraints, API impact, UI impact, and acceptance criteria

2. `Dev Agent`
   writes `workflow/tasks/2026-04-04-deck-delete-task.md`
   implements route handler, UI action, and persistence changes
   records changed files and any deviations

3. `Test Agent`
   writes `workflow/reports/2026-04-04-deck-delete-test-report.md`
   validates happy path, error path, and regression risk
   either passes the work or sends it back with findings

## Current Project Rules

- Root Next.js app is the only active app
- Do not reintroduce Spring Boot as the active backend
- Do not create a second frontend app
- Prefer minimal, reversible changes
- Avoid unrelated refactors during feature work
