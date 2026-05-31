# REC Menu Navigation Standard

Every user-facing menu window must include a path back.

Required controls:

```txt
Back
Main Menu
```

Admin windows may also include:

```txt
Admin Panel
```

Implementation:

```txt
apps/bot/src/ui/navigation.ts
```

Rules:

1. No menu branch should be a dead end.
2. Wizards should use Back to return to the previous wizard step.
3. Non-wizard department shells should use Back or Main Menu to return to REC League HQ.
4. Admin feature windows should allow returning to Admin Panel when practical.
5. Future menu builders should use `buildNavigationRow()`.
