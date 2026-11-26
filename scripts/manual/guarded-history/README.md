# Historical guarded test source

These `.txt` files preserve the original one-off investigation scripts verbatim.
They are documents, not runnable test entries. They reference private deployment
receipts, former local runtimes, preserved snapshots and historical counts that
are unavailable in a clean checkout. Do not rename or execute them as acceptance
tests, provide real database paths, or count their previous results as a new run.

Run `python3 scripts/test-guarded-contracts.py` from the workspace instead.
Its current-source tests use fresh synthetic files, databases, virtual OS/kernel
replies, and only test-owned pipes/processes. Historical deployed-schema and
native machine acceptance remain unverified. The synthetic readonly/post-stop
suite is explicitly `fixture_mechanism`; its single test-only schema substitution
never changes production source or establishes historical compatibility.
