## Summary

- What changed?
- Why is it needed?

## Verification

- [ ] `npx tsc --noEmit --pretty false`
- [ ] `npx tsx check-content-and-schedule.ts`
- [ ] `npm run build`
- [ ] Docker build, if Docker files changed

## Safety

- [ ] No secrets, tokens, database files, or personal data are included.
- [ ] No real Threads post was published as part of this change.
- [ ] Documentation and migrations were updated when needed.
