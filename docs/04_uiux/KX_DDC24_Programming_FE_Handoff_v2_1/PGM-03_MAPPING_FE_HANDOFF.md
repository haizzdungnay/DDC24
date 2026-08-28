# PGM-03 — Points & Mapping — FE Handoff

**Route:** `/eng/programming/mapping`  
**Reference:** `assets/PGM-03_mapping.png`  
**Primary goal:** Map logical Program variables to canonical controller/network points quickly and safely, with live value and quality visible.

## 1. Layout

Top toolbar:
`Direction | Type | Search | Suggestions toggle | Actions`

Main split:
- left: `Program Variables`
- right: `Available Points`

Bottom:
- `Assigned Mappings`

The page should feel like a mapping workspace, not a generic CRUD table.

## 2. Variable row

Required:
`Variable | Type | Direction | Mapping | Live Value | Quality`

Explicit statuses:
- mapped
- unmapped
- incompatible
- stale/offline source

## 3. Point row

Required:
`Point | Description | Source | Type | Value | Unit | Quality | Writable`

Source may be physical I/O, virtual point, Modbus/BACnet/etc. only when backend supplies it.

Do not invent `%IX/%QX` addresses when backend model does not provide them.

## 4. Mapping actions

Primary flow:
1. select variable
2. compatible points are ranked/highlighted
3. select point
4. review
5. assign

Drag/drop may exist as shortcut but is not the only path.

### Suggestion ranking
If backend/FE provides suggestions, rank using available metadata:
1. direction
2. datatype
3. unit
4. naming similarity
5. same source/device context

Suggestion is advisory only; never auto-commit.

## 5. Validation rules to surface

- datatype mismatch
- direction mismatch
- writable output → read-only point
- missing/deleted point
- exclusive duplicate binding
- unit policy warning
- point offline/stale warning according to policy

FE displays backend validation result; it must not silently override authority.

## 6. Mapping Inspector / Drawer

Selected binding:
- logical variable
- canonical point
- source/device
- datatype
- direction
- unit
- current live value
- quality
- writable
- optional scale/invert/fallback only if contract supports them

## 7. Empty/error states

### No variables
Explain that the Program has no mappable I/O variables.

### Variables but none mapped
Show count + `Start Mapping`.

### Point catalogue unavailable
Persistent error; do not show empty as if there are zero points.

### Live stream lost
Keep mapping identity, mark value `Stale/Offline`.

## 8. Suggested FE view model

```ts
type MappingVM = {
  variables: Array<{
    id:string; name:string; type:string; direction:"IN"|"OUT"|"IN_OUT";
    binding?: { pointId:string; pointName:string };
    value?: unknown; quality?: string;
  }>;
  points: Array<{
    id:string; name:string; description?:string; source?:string;
    type:string; direction?:string; unit?:string;
    writable?:boolean; value?:unknown; quality?:string; updatedAt?:string;
  }>;
};
```

## 9. Permissions

viewer/operator:
- view mapping
- live values/quality
- no assign/remove

admin:
- assign/remove/change
- Check after changes

## 10. Acceptance criteria

- `AC-PGM03-01` unmapped variable is obvious without relying on color alone.
- `AC-PGM03-02` mapping can be completed with mouse **or keyboard/click flow**.
- `AC-PGM03-03` output→read-only mapping is rejected/blocked.
- `AC-PGM03-04` stale point never renders as healthy zero.
- `AC-PGM03-05` assigned mapping list reflects authoritative state after mutation.
- `AC-PGM03-06` quality uses semantic GOOD/WARN/FAULT/UNKNOWN styling.
- `AC-PGM03-07` no invented point/address model.

## 11. FE tasks

- Split workspace + synchronized selection.
- Compatibility/suggestion presentation.
- Mapping mutation state and authoritative re-fetch.
- Assigned mapping summary.
- Live value/quality subscription.
- Deep-link from variable to PGM-02 source.
- E2E: successful map, incompatible map, offline catalogue, permission denied.
