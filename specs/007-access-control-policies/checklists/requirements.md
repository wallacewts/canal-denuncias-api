# Specification Quality Checklist: Controle de acesso — políticas reais da matriz de permissões

**Purpose**: Validate specification completeness and quality before proceeding to planning
**Created**: 2026-11-28
**Feature**: [spec.md](../spec.md)

## Content Quality

- [x] No implementation details (languages, frameworks, APIs)
- [x] Focused on user value and business needs
- [x] Written for non-technical stakeholders
- [x] All mandatory sections completed

## Requirement Completeness

- [x] No [NEEDS CLARIFICATION] markers remain
- [x] Requirements are testable and unambiguous
- [x] Success criteria are measurable
- [x] Success criteria are technology-agnostic (no implementation details)
- [x] All acceptance scenarios are defined
- [x] Edge cases are identified
- [x] Scope is clearly bounded
- [x] Dependencies and assumptions identified

## Feature Readiness

- [x] All functional requirements have clear acceptance criteria
- [x] User scenarios cover primary flows
- [x] Feature meets measurable outcomes defined in Success Criteria
- [x] No implementation details leak into specification

## Notes

- Iteração 1: 15/16 itens ok. Pendentes 2 marcadores [NEEDS CLARIFICATION]: FR-012 (410 da denúncia expurgada antes
  ou depois do escopo) e FR-018 (404 de id inexistente também gera `ACCESS_DENIED`?).
- Iteração 2 (2026-11-28, Clarifications): FR-012 (Q1 = B) e FR-018 (Q2 = B) resolvidos. 16/16 itens ok.
- Nomes de tabelas e colunas (`reports.assigned_to_id`, `report_access_blocks`, `shredded_at`), `scopeReportsFor`,
  códigos de habilidade, `ACCESS_DENIED` e status HTTP são o vocabulário fixado pelo backlog (ACL-02/03), pela
  constituição (princípio IV) e pelo ADR 0053, não escolha de implementação desta spec.
- Itens marcados incompletos exigem atualização do spec antes de `/speckit-clarify` ou `/speckit-plan`.
