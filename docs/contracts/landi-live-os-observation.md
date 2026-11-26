# Independent real OS metadata observation

`scripts/guarded-os-readonly-observe.py` is an explicitly invoked live read-only
observer, separate from the fixture parser and all admission/authentication paths.
It requires explicit work-database path, Node path, port, manager label and old PID.
No defaults select a business database. It never opens database contents, loads
configuration, obtains locks, creates business children, mutates services, invokes
MAH or enables local compatibility. The only writes are private observation files
in a new `/private/tmp/landi-live-os-observation-*` directory and temporary command
output spools. Fixed `ps` comm inventory avoids full argument/environment capture.

The native backend is limited to Darwin LP64 and the existing 136-byte BSD layout
with explicit start-time offsets. It saves returned byte count, errno and raw bytes
for each identity/path reply before validating. There is no kinfo fallback. Commands
use absolute paths, fixed parameters, C locale, five-second timeout, bounded in-memory
reads and explicit truncated-output rejection. Timeout handling concerns only its
own query subprocess. Metadata uses lstat/resolve only, not SQLite or database hashes.
Original stdout/stderr bytes are retained as hex alongside argv, return code and
query timestamps. The observer records its source digest and PID as provenance
metadata, not authenticated launcher or permission evidence.

Two scans record current manager absence/disabled observations, port and file-user
replies, work/sidecar metadata, inventory and before/after kernel identity/path
agreement. Existing sidecars are included in lsof; work replacement and old PID
presence reject. Same-Node matches are observations only, never exclusions. The first
failure, warning, inaccessible identity, malformed reply or freshness failure stops
further collection and preserves accumulated receipts. No query is automatically
retried; missing second scans remain missing. Collection and parsed states do not
prove complete OS visibility. Even clean lsof exit 1 is only empty within current
visibility. All reports retain unverified visibility, launcher and lease status,
false real authentication and closed execution/production/compatibility gates.

The reporting exit code is 2 if collection stopped, otherwise 0 for completion;
neither means admission passed. Evidence expires 15 seconds after observation start.
Saved timestamps cannot establish current freshness later. A live run is permitted
only after separately requested targeted checks pass. Its raw observations are not
converted into trusted stage receipts, ownership attestations or lock capability.

Example explicit invocation (use approved actual paths):

```
python3 guarded-os-readonly-observe.py --database /approved/work.sqlite \
  --node /approved/node --port 8787 --manager io.landi.local --old-pid 2913
```

The executable/runtime must be pinned by the caller. This entry currently provides
auditable local observations and gaps, not the complete authenticated two-stage
source adapter. Controller and Storage remain disconnected.
