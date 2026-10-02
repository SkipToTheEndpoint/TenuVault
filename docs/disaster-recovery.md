# Disaster recovery readiness

Open a backup in the restore wizard and expand **Recovery readiness**. Each object
reports whether its configuration can be restored automatically, external artifacts,
unmapped dependency paths and manual actions. Missing readiness is not a successful
assessment. The report is conservative for cross-tenant recovery.

For installer-backed apps, obtain the original trusted installer, verify its publisher
and upload it through Intune's supported application workflow. Apple enrollment and
content tokens must be renewed or uploaded through their respective Apple/Intune
administration workflows. Backup metadata cannot recreate private keys, installer
payloads or Apple credentials that the API does not export.

For a copy to one other tenant, the reviewed dependency editor accepts an array:

```json
[{"folder":"Apps","sourceId":"11111111-1111-1111-1111-111111111111","targetId":"22222222-2222-2222-2222-222222222222"}]
```

`Apps` and `AppCategories` are the initial supported families. Review each target's
identity in Intune and confirm the mapping. TenuVault checks every target exists
and is readable before restore writes. A mapping does not upload an installer.
Unsupported dependencies remain blocked; reconstruct those objects manually and
reconcile their references in Intune. Never copy source tenant IDs blindly.

Copies are unassigned with default scope tags. Recreate groups, exclusions and filters
in the target tenant and validate targeting separately. Review Intune roles and
memberships carefully so disaster recovery does not reinstate revoked access.

Tests cover reference-only installer readiness, missing target objects, rejected
mapping families and category remapping without source IDs. Read-only Lokka beta
checks verified app and category response shapes and Intune error behavior. Live
installer uploads, Apple token renewal and tenant modifications were not performed.
