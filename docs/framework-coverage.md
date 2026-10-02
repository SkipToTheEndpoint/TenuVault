# Framework mapping coverage

Framework packs are administrator-supplied Settings Catalog exports. OpenIntuneBaseline
content is handled by its own section (see [frameworks](frameworks.md#openintunebaseline)),
which reads the upstream repository at the resolved `main` commit and attributes it to
SkipToTheEndpoint and contributors, with the upstream
[GPL-3.0 license](https://github.com/SkipToTheEndpoint/OpenIntuneBaseline/blob/main/LICENSE).
Retain that attribution and license when sharing upstream policy content.

Each loaded policy retains its source declaration
in the saved workspace. Export coverage and source mappings produces a versioned
inventory of policy/root-setting mappings, supported families, unsupported areas
and manual evidence requirements. These are configuration mappings, not a claimed
CIS/NIST/STIG control crosswalk. Imported source declarations are not signatures.

CIS, NIST, STIG, BSI, Essential Eight and Microsoft catalog entries do not ship
complete automated control mappings. Administrators supply their reviewed,
appropriately licensed content and identify its version and profile. No restricted
benchmark text or build kit is distributed. Additional mappings need their own
source and content-rights review before inclusion.

Compliance policies, update rings, legacy baseline templates, application deployment,
device enforcement/applicability and organizational controls are outside automated
coverage. Profile selection, policy approval, organizational safeguards and device-side
validation remain manual. A configuration match does not establish certification,
control effectiveness or a complete assessment.
