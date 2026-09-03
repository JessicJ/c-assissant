# Allow flexible itinerary blocks in the recommended plan

Dining, shopping, local-experience, rest, and exploratory itinerary content may enter the Recommended Itinerary as Flexible Itinerary Blocks. A Flexible Itinerary Block belongs to the time-ordered plan but may use a rough time window, optional status, or flexible placement rather than a precise start time. It should still appear in the day's rough sequence and render with a localized Rough Time Label, such as around lunch, flexible afternoon, or optional evening.

Flexible blocks must still reference a concrete Schedulable Itinerary Object when they represent a visit, meal, shopping stop, or experience. They should keep their guide detail, source transparency in details, and replacement behavior. They are not the same as unscheduled Guide Options or Candidate Places.

Requiring precise start times for every dining, shopping, and local-experience item was rejected because it would make the generated itinerary feel falsely rigid. Leaving flexible blocks without any time cue was also rejected because it would weaken the day rhythm. The plan should be complete enough to use directly while preserving real travel flexibility.
