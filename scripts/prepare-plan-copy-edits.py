"""Prepare reviewable wording edits for the audited New Zealand plan; never writes SQLite."""
import json
import re
from pathlib import Path

root = Path(__file__).resolve().parent.parent
audit = json.loads((root / 'data/plan-copy-audit.json').read_text())
fields = audit['fields']
exact = {}
def edit(path, text):
    exact[fields[path]] = text

edit('/knownInformation/0', 'Your New Zealand trip is ready to review.')
edit('/knownInformation/3', 'Your 16-day itinerary includes 86 places to visit, eat or stay.')
edit('/assumptions/0', 'Some opening hours and travel details still need checking closer to your trip.')
edit('/nextAction', 'Add the remaining traveler details so we can help you finish your travel preparations.')
edit('/presentation/summary', 'Explore both islands with stays in Auckland, Rotorua, Queenstown, Te Anau and Aoraki / Mount Cook. There’s a mix of culture, forests, fjords and mountain walks, with room to rest along the way. Before booking, check flights, rooms for all three travelers, total prices and cancellation terms.')
stage_descriptions = [
    'A few useful things to pack for the places and activities on your trip.',
    'Check what each traveler needs to enter New Zealand before you leave.',
    'Get your flights and journeys between towns ready before setting off.',
    'Choose your rooms, tickets and tour times, then complete the bookings you want.',
    'We’ll check these details again closer to your visit, when current information is more useful.',
    'A few things to sort out before departure, so your trip runs more smoothly.'
]
for i, text in enumerate(stage_descriptions): edit(f'/stages/{i}/description', text)
edit('/stages/0/tasks/1/description', 'Keep your phone charged for maps, tickets, translation and checking your journey along the way.')
edit('/stages/0/tasks/2/description', 'Choose shoes you’re comfortable walking in, and pack spare socks for the outdoor days.')
edit('/stages/0/tasks/4/description', 'Pack a light layer for cooler evenings, lakeside walks and changes in the weather.')
edit('/stages/4/tasks/9/title', 'Check the date of your Tasman Valley visit')
edit('/stages/4/tasks/9/description', 'The earlier notes list different dates for Tasman Valley. Make sure any transport or bookings match the day shown in your current itinerary.')
edit('/stages/4/tasks/2/description', 'Check Te Puia’s official calendar for 5 November 2026 and choose the daytime Te Rā visit or evening Te Pō experience you prefer. Availability for that date still needs checking.')
edit('/stages/2/tasks/0/description', 'Compare flights, checked bags, car hire or arranged transfers, fuel, parking and your final Auckland hotel. Add up the cost for all three travelers before deciding what fits your budget.')
edit('/stages/2/tasks/2/description', 'Compare flights from Auckland or the Rotorua area to Queenstown, including checked bags and getting to and from the airports. Choose a departure that gives you the Rotorua stay you want.')
edit('/stages/2/tasks/3/description', 'If you’re considering the route through Wellington and Christchurch, compare the flights, car hire and transfers for all three travelers before choosing it.')
edit('/stages/2/tasks/5/title', 'Compare the Christchurch route with the Queenstown loop')
edit('/stages/2/tasks/5/description', 'The Christchurch and Lake Takapō option adds roughly 2 hours 40 minutes of driving in the earlier estimates, including a long Aoraki–Te Anau journey. The Queenstown loop may suit you better if you’d prefer less driving.')
edit('/stages/2/tasks/6/description', 'If you choose the Christchurch route, check Auckland–Christchurch and Queenstown–Auckland flights against your international tickets. Include checked bags and leave enough time for connections before paying.')
edit('/stages/5/tasks/3/description', 'Add up flights, car hire or coaches, accommodation and the experiences you want for all three travelers. Compare current prices with your budget before booking.')
edit('/stages/3/tasks/0/description', 'Compare rooms for three in Auckland, Rotorua, Aoraki / Mount Cook and Queenstown. Check availability, total prices and cancellation terms, including your final night in Auckland.')
edit('/stages/4/tasks/5/description', 'If you’d like to eat at Old Mountaineers, check that it will be open on 11 November before setting off. Its hours for that day still need checking.')
edit('/presentation/localFoods/8/description', 'Look out for Mackenzie Basin salmon on local menus. The cold, glacier-fed waters are part of its regional character; dishes will vary by restaurant and season.')

day_summaries = [
    None,
    'You’ll be flying overnight across the Pacific and the international date line. Keep your passport and essentials handy, and rest when you can.',
    'Welcome to Auckland. After immigration and collecting your bags, head to the hotel to leave your luggage and enjoy lunch. If you feel up to it, spend the afternoon at Auckland Museum; you can keep things lighter after the long flight.',
    'Visit Hobbiton on the way to Rotorua, with lunch after the tour and a walk among the Redwoods later. Check your Hobbiton tour time before leaving Auckland.',
    'Spend the morning exploring Te Puia’s geothermal sights and Māori culture. After lunch, enjoy a forest walk at Whakarewarewa. You can adjust the afternoon to suit the weather and how you feel.',
    'Travel from Rotorua to Auckland Airport, fly to Queenstown, then head to your hotel. The flight still needs choosing; check baggage allowances and any car-return arrangements when booking. Keep the rest of the day easy.',
    'Head from Queenstown to Te Anau today. If you’re hiring a car, check the driver documents, insurance, space for your bags and return arrangements before collecting it. Leave time for a comfortable journey.',
    'Enjoy the Te Anau bird sanctuary, stop for lunch, then watch the Fiordland film if the screening times work for you. The Redcliff is an option for dinner. If you’d prefer the glowworm caves, swap them in and book a suitable departure.',
    'Today is for Milford Sound. Choose a Te Anau coach-and-cruise trip and follow the times on your booking for pickup, breaks, boarding and return. The planned meeting point is the RealNZ Te Anau Visitor Centre; check your ticket in case the operator gives different instructions.',
    'Return to Queenstown and leave your bags at the hotel. If the skies are clear, head up Skyline for the lake and mountain views, then find something to eat in town.',
    'Travel from Queenstown to Aoraki / Mount Cook today. It’s a longer drive, so leave room for fuel, lunch and a proper break along the way.',
    'Enjoy the Tasman Valley walks when the weather is clear, then return to the village for lunch and the national park visitor centre. If you’d prefer to stay indoors, the Sir Edmund Hillary Alpine Centre is an alternative to part of the walking day.',
    'Head out for Hooker Valley when the weather and track conditions are suitable. The planned walk is about four hours; leave extra time for parking and any bridge controls. Kea Point or the visitor centre are alternatives if the longer walk doesn’t suit the conditions.',
    'Return to Queenstown ready for the next day’s flight. Take the drive at a comfortable pace, with time for lunch, fuel and a break.',
    'Fly from Queenstown to Auckland and settle into your final Auckland hotel. Choose a flight that leaves some room for delays before tomorrow’s international departure, and check your baggage allowance when booking.',
    'For your flight to Los Angeles at around 15:00, plan to leave the hotel around 10:30 and reach Auckland Airport around noon. Check your ticket, terminal, airline deadlines and traffic closer to departure, and leave earlier if needed.'
]
for i, text in enumerate(day_summaries):
    if text: edit(f'/presentation/days/{i}/summary', text)

block_edits = {
 (2,2): 'Leave your bags at the hotel before exploring Auckland. Ask reception whether your room is ready; if not, check whether they can store your luggage. Check the room and total price for all three travelers before booking.',
 (5,2): 'Check in for your flight to Queenstown here. Once you’ve chosen the flight, check its departure time and bag-drop deadline.',
 (5,3): 'After check-in, have something to eat or take a break before boarding. Use the boarding time on your ticket to decide how much time you have.',
 (5,5): 'Collect your bags, then continue to your Queenstown hotel.',
 (8,4): 'Take the coach included with your excursion. Check your booking for pickup, stops, terminal arrival and cancellation terms.',
 (9,2): 'Leave your bags with reception before exploring. Ask whether your room is ready if you’d like to check in early.',
 (9,6): 'Head into central Queenstown on foot; check the route before you leave.',
 (11,7): 'Drive back to the village, checking the route before you set off.',
 (12,3): 'Check the short drive back to the village before setting off.',
 (14,2): 'Check in at Queenstown Airport. Use your chosen flight’s timetable and airline instructions to plan when to arrive.',
 (14,3): 'Have something to eat or take a break while waiting for your flight. Keep an eye on the boarding time and gate.',
 (14,4): 'Choose a flight to Auckland for all three travelers, including checked bags. Check the flight times and cancellation terms before booking.'
}
for (day, block), text in block_edits.items(): edit(f'/presentation/days/{day}/blocks/{block}/summary', text)

place_edits = {
 (0,'tip'): 'Compare flights, car hire or arranged transfers, and the total cost for all three travelers before booking.',
 (1,'whyWorthIt'): 'Your arrival and return flights use Auckland Airport, with onward journeys to the city and the South Island.',
 (1,'plan'): 'Arrive here on November 4 and return to Auckland by November 16. If you change between domestic and international terminals, leave enough time for the transfer and airport formalities.',
 (13,'plan'): 'Enjoy a daytime walk among the redwoods, or choose Nightlights if you’d like an evening visit. Check that its entry time works with your Te Puia booking.',
 (13,'tip'): 'If you’d like to visit Nightlights after Te Puia, check the finish and entry times so you don’t have to rush.',
 (15,'plan'): 'This is another geothermal option if Te Puia’s times don’t suit you. Choose the experience you prefer rather than trying to fit both full visits into one day.',
 (23,'tip'): 'Check that the café will be open on the day you visit before making a special trip.',
 (28,'whyWorthIt'): 'This is where you’ll catch your planned flight from Queenstown to Auckland.',
 (28,'plan'): 'Head here for your Queenstown–Auckland flight and follow your airline’s check-in and baggage instructions.',
 (33,'plan'): 'Consider staying here if you choose a night in Aoraki / Mount Cook. Check available rooms for three and the total price before booking.',
 (34,'plan'): 'Consider this motel for your Aoraki / Mount Cook stay. Ask about rooms for all three travelers and check availability for your dates.',
 (36,'plan'): 'If you’d like a guided boat trip, choose a departure and adjust the Tasman Valley walks around it. Leave enough time to check in and reach the lake.',
 (36,'tip'): 'Everyone needs to be able to walk the 1.5-kilometre approach in 25 minutes. Keep the self-guided walks as an alternative if the boat trip is cancelled for weather.',
 (37,'plan'): 'A useful lunch or coffee stop if your drive takes you through Glentanner during opening hours.',
 (42,'plan'): 'Stop here for coffee or a meal if it suits your day. Check the closing time if you’re planning an afternoon visit.',
 (47,'plan'): 'Consider this hotel for your first Auckland stay and the final night before flying home. Check room options for three and compare the total price with your budget.',
 (49,'plan'): 'Choose the Wai Whakaora journey, bathing, a private pool or a treatment that appeals to you, then book that experience. Each option has its own inclusions and timings.',
 (53,'plan'): 'Enjoy the views on a clear Queenstown day. You can add luge rides or a meal if you’d like.',
 (53,'tip'): 'Check the operator’s current hours before deciding when to go.',
 (59,'whyWorthIt'): 'Try hāngī and Māori-inspired dishes as part of your time exploring Rotorua’s culture.',
 (70,'whyWorthIt'): 'Auckland Airport is your arrival point in New Zealand and where you’ll fly home from.',
 (72,'plan'): 'Visit on your journey between Auckland and Rotorua. Book a tour time first, then plan when to leave so you can arrive comfortably.',
 (73,'plan'): 'Choose a daytime guided visit or an evening cultural experience, depending on what you’d enjoy. You can keep the rest of the day lighter rather than adding another full geothermal park visit.',
 (82,'whyWorthIt'): 'Starting in Christchurch lets you explore Canterbury and Lake Takapō before continuing through the South Island.',
 (84,'plan'): 'If parking allows, leave the car on the village side of the footbridge and walk over to enjoy the grounds. You can take a look inside if it’s open.',
 (85,'whyWorthIt'): 'This is the meeting point for your Te Anau excursion, so you can find the right place to check in before the journey.'
}
for (i,key), text in place_edits.items(): edit(f'/presentation/places/{i}/{key}', text)

extra_edits = {
 '/presentation/places/0/detailSections/0/title': 'Before you book',
 '/presentation/places/0/detailSections/0/body': 'Tell us about your budget, any accessibility needs and how comfortable you are driving. This route is planned for three travelers using flights and either a hire car or arranged transfers.',
 '/presentation/places/0/detailSections/0/items/1': 'Enjoy geothermal sights and Māori culture in Rotorua.',
 '/presentation/places/0/detailSections/0/items/2': 'Explore Aoraki / Mount Cook and Queenstown on the South Island.',
 '/presentation/places/9/accommodation/rationale': 'A central hotel for Te Puia and Rotorua’s geothermal sights, with convenient onward travel toward Waikato.',
 '/presentation/places/10/accommodation/rationale': 'Stay inside the national park for an easier early start to Hooker Valley and flexibility around the weather.',
 '/presentation/places/11/accommodation/rationale': 'A lakefront hotel close to central Queenstown and convenient for arranged tour pickups.',
 '/presentation/places/10/tip': 'The hotel’s published refurbishment runs from May to October 2026. Check which rooms are available for your November stay before booking.',
 '/presentation/places/13/detailSections/1/items/0': 'Choose an entry time that works with your Te Puia visit.',
 '/presentation/places/14/whyWorthIt': 'Relax in a private cedar tub surrounded by native plants — a peaceful forest setting for the three of you after a day of walking.',
 '/presentation/places/14/plan': 'Book a session if you’d like a relaxing soak after Te Puia, or swap it for a forest walk when the weather doesn’t suit walking.',
 '/presentation/places/27/plan': 'A dinner option if you’d like an evening in Te Anau. Book a table for three once you know your return time from the day’s excursion.',
 '/presentation/places/29/plan': 'Stop here to learn about the park, or spend longer with the exhibits if you’d like. It’s also an indoor alternative when the weather doesn’t suit walking.',
 '/presentation/places/31/plan': 'Stop for lunch or coffee if you’d like. Takeaway is another option if you want to make the most of a clear spell for walking.',
 '/presentation/places/36/detailSections/1/items/0': 'Check availability for the day you’d like to go.',
 '/presentation/places/37/detailSections/1/items/0': 'A convenient stop while driving through Glentanner.',
 '/presentation/places/43/accommodation/rationale': 'A village stay close to the visitor centre and a convenient starting point for Hooker Valley.',
 '/presentation/places/44/accommodation/rationale': 'A village motel with room options for three, close to the visitor centre and local walks.',
 '/presentation/places/52/whyWorthIt': 'Share contemporary dishes in Rotorua’s central dining strip, with options for a range of dietary preferences.',
 '/presentation/places/57/accommodation/rationale': 'Spend two nights in Te Anau for a shorter Milford Sound day trip and more time to rest afterward.',
 '/presentation/places/60/accommodation/rationale': 'A central hotel for exploring Rotorua’s geothermal sights and Māori culture.',
 '/presentation/places/64/detailSections/0/items/3': 'Keep the rest of the day free for the excursion.',
 '/presentation/places/68/whyWorthIt': 'Stay near the town’s stargazing departure point, with a convenient onward journey toward Aoraki / Mount Cook.',
 '/presentation/places/68/accommodation/rationale': 'A convenient stay for an evening of stargazing before continuing to Aoraki the next day.',
 '/presentation/places/71/detailSections/0/body': 'An indoor option for a rainy arrival day, or whenever you’d prefer an easier start to the trip.',
 '/presentation/places/82/detailSections/0/body': 'From Christchurch, you can continue through Lake Takapō, Aoraki and Te Anau to Queenstown. The earlier estimates suggest more driving overall than the Queenstown loop.',
 '/presentation/places/83/plan': 'Ask whether the Superior Twin can accommodate all three travelers. Check availability for your dates and request the total price before booking.',
 '/presentation/localFoods/5/description': 'A café stop can be a welcome break on an alpine day — choose somewhere that suits your route and appetite.',
 '/presentation/travelTips/9/body': 'Bring a payment card for the Hermitage-operated café and Chamois Bar & Grill; both describe their service as cashless.',
 '/presentation/travelTips/12/body': 'Check available seats and times for Auckland–Christchurch and Queenstown–Auckland on your exact dates. Include checked bags and allow enough time before the international flight from Auckland at around 15:00 on November 17.',
 '/stages/1/tasks/1/description': 'Use the passport each traveler will travel with to check whether they need an NZeTA or a visitor visa. Immigration New Zealand’s official checker will help you choose the right entry permission.',
 '/stages/1/tasks/2/description': 'Add each traveler’s passport nationality, then check the entry permission they need for New Zealand using that passport.',
 '/stages/3/tasks/8/description': 'If you’d like the boat trip, choose a departure and check that everyone can manage the required walk to the lake. Arrange the Tasman Valley walks around check-in and the weather.',
 '/presentation/guideRelationshipGraph/relationships/2/rationale': 'A convenient Rotorua hotel for visiting Te Puia and the nearby geothermal sights.',
 '/presentation/guideRelationshipGraph/relationships/47/rationale': 'Enjoy hāngī at Te Puia as part of your cultural visit; book the dining experience you’d like.',
 '/presentation/guideRelationshipGraph/relationships/48/rationale': 'Stay centrally in Rotorua for easy journeys to Te Puia.',
 '/presentation/guideRelationshipGraph/relationships/50/rationale': 'Te Papa is an indoor alternative if the weather doesn’t suit Zealandia’s outdoor tracks.',
 '/presentation/guideRelationshipGraph/relationships/63/rationale': 'A Christchurch hotel option if you arrive through CHC; check room availability before booking.',
}
for path, text in extra_edits.items(): edit(path, text)

for path, old in fields.items():
    if re.fullmatch(r'/presentation/days/\d+/blocks/\d+/summary', path):
        title = fields[path.removesuffix('/summary') + '/title']
        if re.match(r'(Morning begins at|Depart from) the .*base occupied on', old):
            exact[old] = f'Start from {title}, and check you have your bags and belongings before leaving.'
        elif re.match(r'(Recommended|Second provisional|Final provisional).*?(night|base).*?not booked\.', old):
            rest = old.split('not booked.', 1)[1].strip()
            exact[old] = f'Settle in at {title} for the night. Check your reservation before your stay.' + (f' {rest}' if rest else '')

replacements = [
 ('party-level', 'for all three travelers'), ('party-of-three', 'three-person'),
 ('the party', 'you'), ('the planner', 'you'), ('a provisional, not-booked', 'a possible'),
 ('a provisional', 'a possible'), ('the provisional', 'the suggested'),
 ('provisional candidates', 'hotel options'), ('provisional and not booked', 'a suggestion to check before booking'),
 ('provisional', 'suggested'), ('overnight bases', 'places to stay'), ('overnight base', 'hotel'),
 ('base change', 'journey to your next hotel'), ('base-change', 'journey to your next hotel'),
 ('accommodation continuity', 'a convenient place to stay'), ('planning spine', 'nearby sights and walks'),
 ('cited baseline driving', 'estimated driving time'), ('total baseline road time', 'total driving time'),
 ('baseline driving total', 'estimated total driving time'), ('cited public baselines', 'earlier travel estimates'),
 ('materially change the baseline', 'add significant time to the journey'),
 ('before execution', 'before setting off'), ('before route commitment', 'before booking'),
 ('corridor day', 'travel day'), ('corridor anchor', 'main stop'), ('corridor', 'route'),
 ('target-date', 'your travel date'), ('live inventory', 'current availability'),
 ('exact tour product', 'tour you booked'), ('selected product', 'chosen tour'),
 ('product chosen', 'experience you choose'), ('daytime product', 'daytime experience'),
 ('evening product', 'evening experience'), ('products', 'experiences'),
 ('product', 'experience'), ('resequence', 'adjust'),
 ('self-guided anchors', 'self-guided walks'), ('lake-level anchor', 'lakeside walk'),
 ('daytime obligation', 'daytime activity'), ('automatic block', 'another required stop'),
 ('compact local choice rather than a major day anchor', 'short local visit'),
 ('Party-level cost context', 'Costs for three'), ('Practical scope', 'Good to know'),
 ('geothermal coverage', 'geothermal sightseeing'), ('operational passenger departure point', 'airport'),
 ('map-ready village motel', 'village motel'), ('daily parking dependency', 'need to park each day'),
 ('concrete food stop', 'place to eat'), ('concrete meal stop', 'place for a meal'),
 ('concrete dining choice', 'meal'), ('concrete dinner option', 'dinner option'),
 ('concrete lunch', 'lunch break'), ('concrete central meal', 'meal in town'),
 ('operational location', 'meeting point'), ('Formal domestic departure node.', 'Check in here for your domestic flight.'),
 ('Formal domestic arrival node;', 'After landing,'), ('Formal domestic boarding node.', 'Check in here for your domestic flight.'),
 ('departure node', 'departure airport'), ('flight segment', 'flight'),
 ('positioning sector', 'flight'), ('dated domestic flight sectors', 'domestic flights for your dates'),
 ('positioning flight', 'flight'), ('positioning night', 'overnight stay'),
 ('driver eligibility', 'driver documents'), ('legal occupancy', 'room capacity'),
 ('complete party-level price', 'total price for all three travelers'), ('complete cost', 'total cost'),
 ('complete price', 'total price'), ('returned hotels', 'suggested hotels'),
 ('the returned sources do not publish dependable November 2026 operating hours', 'opening hours for November 2026 still need checking'),
 ('the batch did not verify target-date availability', 'availability for your date still needs checking'),
 ('No unsupported time or duration is assigned.', 'Check your ticket for the flight times.'),
 ('no unsupported journey duration is assigned.', 'Check your booking for the journey times.'),
 ('not booked.', 'Check availability and booking details before travel.'),
 ('not-booked', 'suggested'), ('No service is booked.', 'Choose and book your flight before travel.'),
 ('No departure is booked.', 'Check your booking for the departure time.'),
 ('Do not assign a clock until the domestic flight is selected.', 'Use your flight’s boarding time to plan the break.'),
 ('Do not assign a clock until tickets are selected.', 'Use your flight’s boarding time to plan the break.'),
 ('Morning begins at the', 'Start the day at the'), ('base occupied on', 'hotel where you stayed on'),
 ('Depart from the', 'Leave the'), ('; not booked', '; check availability before booking'),
 ('early room access is not assumed', 'ask reception whether your room is ready'),
 ('Early room access is not assumed.', 'Ask reception whether your room is ready.'),
 ('coherent directional sequence', 'route'), ('continuous sequence', 'continuous journey'),
 ('highest-effort candidate', 'most demanding walk'), ('a practical candidate', 'a practical option'),
 ('returned properties', 'suggested hotels'), ('supports early access', 'makes it easier to start early'),
 ('preserving', 'leaving time for'), ('recovery window', 'break'),
 ('calendar day is consumed by', 'day is spent on'),
 ('researched central pickup', 'planned pickup point'), ('researched operator', 'operator'),
 ('research set', 'travel notes'), ('route commitment', 'booking'),
]

edits = []
for path, old in fields.items():
    # Leave cited source titles, operational evidence and machine identifiers alone.
    if '/sourceCatalog/' in path or '/operationalFacts/' in path: continue
    new = exact.get(old, old)
    if old not in exact:
        for before, after in replacements: new = new.replace(before, after)
        new = re.sub(r'\b(Recheck|recheck)\b', lambda m: 'Check again' if m[0][0].isupper() else 'check again', new)
        new = re.sub(r'\b(?:anchors|anchor)\b', 'main sights', new)
        new = re.sub(r"Stage [\d.]+ targeted completion candidate for [\d-]+; selected because it fits the same day area or direction as (.+)\.", r'A nearby option to consider when visiting \1.', new)
        new = new.replace('budget scope', 'budget').replace('affordability is unresolved', 'the total still needs comparing with your budget')
        new = new.replace('affordability has not been claimed', 'the total still needs comparing with your budget')
        new = new.replace('affordability has not been established', 'the total still needs comparing with your budget')
        new = new.replace('source directs visitors to', 'website points you to')
        for before, after in [('you wants','you want'),('you prefers','you prefer'),('you chooses','you choose'),('you selects','you select'),("you's",'your'),('you of three','the three of you'),('an hotel','a hotel'),('a your travel date slot','a slot for your travel date'),('complete for all three travelers price','total price for all three travelers'),('for all three travelers ground-transfer costs','ground-transfer costs for all three travelers'),('for all three travelers prices','prices for all three travelers'),('for all three travelers total','total for all three travelers'),('researched','planned'),('a concrete stop','a stop'),('overnight main sights','place to stay'),('anchor','base')]:
            new = new.replace(before, after)
    if new != old: edits.append({'path':path,'before':old,'after':new})
(root / 'data/plan-copy-edits.json').write_text(json.dumps({'id':audit['id'],'version':audit['version'],'edits':edits},indent=2,ensure_ascii=False))
print(json.dumps({'reviewedFields':len(fields),'changedFields':len(edits)}))
