import { resolveAssistantPersonality, type PersonalityContext } from '@c-assistant/core';

type Variants = readonly [string, string, string];
const voiceIndex = (profile: PersonalityContext) => ['local_insider', 'travel_buddy', 'miles'].indexOf(resolveAssistantPersonality(profile.assistantPersonality).id);

/** Only rewrite owned, routine copy. Structured plans, facts, links and failures pass through. */
export function personalityMessage(text: string, profile: PersonalityContext): string {
  if (/^(?:# |\[Plan \d+\/\d+\])/.test(text)) return text;
  if (/\b(?:boarding|bag-drop|deadline|leave now|need to leave now|cancelled|could not|couldn't|can't|failed|out of date|no longer|share your location|pickup location|immigration|passport)\b/i.test(text)) return text;
  const index = voiceIndex(profile);
  let changed = false;
  const replace = (pattern: RegExp, make: (...captures: string[]) => Variants) => {
    text = text.replace(pattern, (...args: unknown[]) => {
      changed = true;
      return make(...args.slice(1, -2) as string[])[index]!;
    });
  };
  replace(/^Good morning! Lovely to have another day ahead\.|^Morning! A new day of your trip is here\.|^Good morning! Let’s see what today has in store\.|^Morning! I’m here whenever you’re ready to get going\./,
    () => ['Morning! Here’s what’s worth making time for today.', 'Morning! A new day to explore (˶ᵔᵕᵔ˶)', 'Morning. Alright, let’s see what today’s got for us.']);
  replace(/^Good afternoon! How’s your day going\?|^Hello! Hope your afternoon is going well\.|^Good afternoon! Here’s what’s coming up\./,
    () => ['Afternoon! Here’s the next part of your day.', 'Afternoon! Ready for the next little adventure?', 'Yo, here’s what’s coming up this afternoon.']);
  replace(/^Good evening! How has your day been\?|^Evening! Hope today has treated you well\.|^Good evening! Here’s what’s coming up\./,
    () => ['Evening! Let’s take a look at what’s next.', 'Evening! Here’s what we have coming up (˶ᵔᵕᵔ˶)', 'Alright, here’s the evening lineup.']);
  replace(/Let's make some time for ([^\n]+)\./,
    name => [`${name} is next. Let’s give it some time.`, `${name} time!`, `Next up: ${name}. Let’s check it out.`]);
  replace(/Today we're heading to ([^\n]+)\./,
    name => [`Today we’re heading to ${name}.`, `Off to ${name} today!`, `Alright, ${name} is where we’re headed today.`]);
  replace(/We're planning to visit (at|around) ([^\n]+)\./,
    (qualifier, time) => [`We’re aiming to visit ${qualifier} ${time}.`, `We’re planning to visit ${qualifier} ${time}.`, `We’re aiming for a visit ${qualifier} ${time}.`]);
  replace(/Let's get ready to leave (at|around) ([^\n]+)\./,
    (qualifier, time) => [`We’re aiming to leave ${qualifier} ${time}.`, `Let’s get ready to head out ${qualifier} ${time}.`, `Quick heads-up—we’re aiming to leave ${qualifier} ${time}.`]);
  replace(/Ready for a bite to eat\?/,
    () => ['Time for some food. Let’s look at the nearby options.', 'Food time! Let’s find something tasty (≧▽≦)', 'Alright, sightseeing has officially lost to food. Let’s see what’s nearby.']);
  replace(/Have a look at the menus and choose what you fancy\./,
    () => ['Check the menus and pick what sounds good to you.', 'Have a peek at the menus—what catches your eye?', 'Take a look at the menus. What’s calling your name?']);
  replace(/Enjoy your meal, and let me know when you’re ready to head on\./,
    () => ['Enjoy your meal. We can pick up the next stop when you’re ready.', 'Enjoy your food! Let me know when you’re ready for our next stop.', 'Enjoy the food. Give me a shout when you’re ready to head on.']);
  replace(/That's everything on your itinerary\. Hope you had a lovely time!/, 
    () => ['That’s the end of your itinerary. Hope you found a few places worth remembering.', 'That’s our itinerary wrapped up! Hope you’re taking home some lovely memories (˶ᵔᵕᵔ˶)', 'And that’s a wrap. Hope this trip gave you some good stories.']);
  replace(/^A quick reminder: /,
    () => ['A quick heads-up: ', 'A little reminder: ', 'Yo, quick heads-up: ']);
  replace(/Let me know if you need to change this step\./,
    () => ['If this no longer suits your day, we can rethink it.', 'Want to change this bit? Just tell me.', 'Need to switch this up? I’m listening.']);
  replace(/The updated itinerary is saved as a draft\. Review it before activation\./,
    () => ['The revised itinerary is saved as a draft. Have a look at the changes before activating it.', 'The new version is saved as a draft (˶ᵔᵕᵔ˶) Take a look before activating it.', 'Alright, the revised itinerary is saved as a draft. Give it a look before activating it.']);
  replace(/Got it\. I have enough to start building the plan\./,
    () => ['Got it. There’s enough here to build a worthwhile plan.', 'Ooh, we have enough to start putting your trip together (≧▽≦)', 'Alright, we’ve got enough to build this trip. Let’s put it together.']);
  replace(/I have the essential trip details\. Review them above, correct anything that looks wrong, then select Generate plan\./,
    () => ['We have the essentials. Check the details above, tell me if anything needs changing, then select Generate plan.', 'We have the essentials for your trip (˶ᵔᵕᵔ˶) Check the details above, correct anything that looks wrong, then select Generate plan.', 'Alright, the essentials are in. Give the details above a look, fix anything that’s off, then select Generate plan.']);
  replace(/The plan direction is confirmed\. Before creating the final plan, please confirm: /,
    () => ['The direction is settled. One detail before I build the full plan: ', 'We have our direction! One little detail before I build the full plan: ', 'Alright, direction’s settled. One detail before I build the full plan: ']);
  replace(/^Let's see what's next\.$/,
    () => ['Let’s look at your next stop.', 'Let’s see what’s next!', 'Alright, let’s see what’s next.']);
  if (!changed) return text;
  // Deterministic variation keeps retries identical, and avoids a compulsory salutation.
  let hash = 0;
  for (const character of text) hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  if (index === 2 && hash % 4 === 0) {
    const address = profile.gender === 'man' ? 'bro' : profile.gender === 'woman' ? 'sis' : undefined;
    if (address && !/\b(?:bro|sis|my man)\b/i.test(text)) text = text.replace(/^(?:Alright, |Yo, )?/, `Alright, ${address}, `);
  }
  // Greeting and meal copy can share one card: keep only its first kaomoji.
  let seenKaomoji = false;
  return text.replace(/\s*\((?:≧▽≦|˶ᵔᵕᵔ˶|๑•̀ㅂ•́)\)(?:و✧)?/g, match => {
    if (seenKaomoji) return '';
    seenKaomoji = true;
    return match;
  });
}
