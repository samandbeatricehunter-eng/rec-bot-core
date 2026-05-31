# Team Ownership + Discord Role Sync

Team ownership is a permanent REC Core subsystem and a primary League Setup step.

## Guild/League Resolution

Admins do not select a league during user/team linking. The bot sends the Discord guild ID to REC Core, and REC Core resolves the current primary league linked to that guild.

## Role Model

REC-managed roles:

```txt
REC League Member             light blue
REC League Comp. Committee    dark blue
REC League Commissioner       gold
```

Authority behavior:

```txt
Member:
- REC League Member

Co-Commissioner:
- REC League Member
- REC League Comp. Committee

Commissioner:
- REC League Member
- REC League Comp. Committee
- REC League Commissioner
```

## Nicknames

```txt
Member:          Team Name
Commissioner:    Team Name (Commissioner)
Co-Commissioner: Team Name (Co-Commissioner)
```

## Team Selection

Team menus are split by AFC/NFC because Discord select menus have a 25-option limit. Each conference dropdown includes its 16 NFL teams plus a Custom Team option. The AFC/NFC team option module should be reused anywhere a team selector is needed later.

## REC Role Cleanup

Admin Panel includes Clear REC Roles. This removes only REC-managed roles from users, not unrelated server roles.
