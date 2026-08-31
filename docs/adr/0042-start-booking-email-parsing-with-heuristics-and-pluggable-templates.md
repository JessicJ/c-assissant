# Start Booking Email Parsing With Heuristics and Pluggable Templates

MVP booking email parsing uses English-focused general heuristics with a small pluggable provider-template extension point, rather than a large provider-specific template library. This gives Landi enough extraction to seed Booking Evidence and Booking Constraints while keeping parser maintenance bounded and preserving manual fallback for unsupported formats.
