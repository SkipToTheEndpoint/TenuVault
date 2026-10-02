## Changes

### Desktop backup and recovery

TenuVault brings Intune backup, restore and drift detection into a desktop application for Windows and macOS. Administrators can keep configuration backups on their own machine, compare snapshots, and review restore operations from one interface. The documentation shipped with this source explains supported policy types, permissions, storage and recovery procedures.

### Release channels

Signed Windows installers and signed, notarized macOS builds are distributed from this repository. Nightly builds provide previews; stable builds are published separately. The update preference selects which channel the application follows. Updates do not downgrade an installed build when switching channels.

Windows MSI installations are managed deployments and do not self-update. Deploy a newer MSI through your normal software distribution process. Automatic updates for the setup installer and macOS application also respect the administrator's update policy.

### Repository migration and upgrade notes

This is the first release from the new TenuVault desktop repository, which starts with a clean source history. Earlier development builds point to the previous repository for updates. Install a build from this repository to move to the new update feed; the application identity and package name are unchanged.

The original PowerShell tool is maintained separately at [TenuVault-PowerShell](https://github.com/ugurkocde/TenuVault-PowerShell). The website and desktop licensing service remain separate from this repository.

### Launch verification

While this repository is private, unauthenticated update checks cannot reach its releases. Public-feed access and a complete installed-app update cycle still need verification after the repository is made public. A successful release build and application smoke test do not establish that end-to-end result.
