# Executable requirement traceability

The S015 catalog is `traceability.v1` at `tests/fixtures/traceability/catalog.ts`. It contains one strict record for every `FR-01`–`FR-32`, `SAFE-01`–`SAFE-10`, and `NFR-01`–`NFR-10` requirement.

Each record names its owning implementation-plan tasks, code paths, tests, fixture IDs, evidence paths, and an honest coverage status:

- `covered`: the current code/tests/evidence prove the scoped requirement;
- `partial`: the fixture foundation proves only the stated slice and the note names the remaining risk;
- `planned`: no implementation evidence is claimed; the owning task remains the source of future work.

Run `npm run traceability:check` to parse the catalog, reject duplicate/incomplete IDs, and verify every referenced repository path. Planned entries intentionally have empty code/test/fixture/evidence arrays so the checker cannot convert roadmap intent into false completion.
