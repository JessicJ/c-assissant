import { type ReactNode, useState } from "react";
import { CalendarDays, CarFront, Utensils } from "lucide-react";
import type { ImmigrationStatus, Profile, WorkspaceSnapshot } from "@c-assistant/core";
import { saveProfile } from "./api-client.js";
import flightDelayPlaneUrl from "./assets/onboarding/flight-delay-plane.png";
import asakusaLunchUrl from "./assets/onboarding/asakusa-lunch.png";
import destinationJapanUrl from "./assets/onboarding/destination-japan-tokyo-tower.png";
import destinationLondonUrl from "./assets/onboarding/destination-london.png";
import fujiUrl from "./assets/onboarding/japan-trip-fuji.png";
import landiIconUrl from "./assets/onboarding/landi-round-otter-earth-icon-final.png";
import phoneUrl from "./assets/onboarding/landi-phone-notifications-v2.png";
import sensoJiUrl from "./assets/onboarding/sensoji-temple.png";
import shibuyaUrl from "./assets/onboarding/shibuya-crossing.png";
import singaporeUrl from "./assets/onboarding/singapore-marina-bay.png";
import teamLabUrl from "./assets/onboarding/teamlab-planets.png";
import teamLabRainUrl from "./assets/onboarding/teamlab-rain-update.png";
import itineraryMapUrl from "./assets/onboarding/tokyo-itinerary-map.png";
import weatherCardUrl from "./assets/onboarding/tokyo-rain-card-final.png";
import skytreeUrl from "./assets/onboarding/tokyo-skytree.png";
import tsukijiUrl from "./assets/onboarding/tsukiji-outer-market.png";
import uenoParkUrl from "./assets/onboarding/ueno-park.png";
import "./first-run-tour.css";

export const FIRST_RUN_TOUR_COMPLETE_KEY = "landi:first-run-tour:v1";
const FIRST_RUN_TOUR_PROGRESS_KEY = "landi:first-run-tour:progress:v1";
const PROFILE_PAGE = 2;
const LAST_PAGE = 4;
const STEP_LABELS = [
  "Tell me where you want to go",
  "Fine-tune it your way",
  "Tell me once, and that’s enough",
  "Stay ahead of every change",
  "A personal assistant for your entire journey"
] as const;

export function shouldShowFirstRunTour(profile: Profile, forcePreview = false): boolean {
  if (forcePreview) return true;
  // The persisted completion flag belongs to the previous profile lifecycle.
  // A reset/incomplete server profile must always restart the real onboarding.
  if (profile.status !== "ready") return true;
  if (typeof localStorage === "undefined") return profile.status !== "ready";
  if (localStorage.getItem(FIRST_RUN_TOUR_COMPLETE_KEY) === "complete") return false;
  return localStorage.getItem(FIRST_RUN_TOUR_PROGRESS_KEY) !== null;
}

function initialPage(): number {
  if (typeof localStorage === "undefined") return 0;
  const saved = Number(localStorage.getItem(FIRST_RUN_TOUR_PROGRESS_KEY));
  return Number.isInteger(saved) && saved >= 0 && saved <= LAST_PAGE ? saved : 0;
}

function editableProfile(profile: Profile): Profile {
  return {
    ...profile,
    displayName: profile.displayName === "New explorer" ? "" : profile.displayName
  };
}

export function FirstRunTour({ profile: initial, onProfileSaved, onComplete, onError }: {
  profile: Profile;
  onProfileSaved: (workspace: WorkspaceSnapshot) => void;
  onComplete: () => void;
  onError: (message: string) => void;
}) {
  const [page, setPage] = useState(initialPage);
  const [profile, setProfile] = useState<Profile>(() => editableProfile(initial));
  const [saving, setSaving] = useState(false);
  const profileValid = Boolean(
    profile.displayName.trim()
    && profile.preferredLanguage.trim()
    && profile.immigrationStatus !== "unknown"
  );

  function advance() {
    const nextPage = Math.min(LAST_PAGE, page + 1);
    localStorage.setItem(FIRST_RUN_TOUR_PROGRESS_KEY, String(nextPage));
    setPage(nextPage);
  }

  function goToPage(nextPage: number) {
    const lastUnlockedPage = initial.status === "ready" ? LAST_PAGE : PROFILE_PAGE;
    if (nextPage > lastUnlockedPage || nextPage === page) return;
    localStorage.setItem(FIRST_RUN_TOUR_PROGRESS_KEY, String(nextPage));
    setPage(nextPage);
  }

  async function next() {
    if (page === PROFILE_PAGE) {
      if (!profileValid || saving) return;
      setSaving(true);
      try {
        const workspace = await saveProfile(profile);
        if (workspace.profile.status !== "ready") throw new Error("Complete all required profile details.");
        onProfileSaved(workspace);
        advance();
      } catch (caught) {
        onError(caught instanceof Error ? caught.message : "Unable to save profile details.");
      } finally {
        setSaving(false);
      }
      return;
    }
    if (page < LAST_PAGE) {
      advance();
      return;
    }
    localStorage.setItem(FIRST_RUN_TOUR_COMPLETE_KEY, "complete");
    localStorage.removeItem(FIRST_RUN_TOUR_PROGRESS_KEY);
    onComplete();
  }

  return <div className="first-run-tour-backdrop">
    <section className="first-run-tour" role="dialog" aria-modal="true" aria-labelledby={`first-run-title-${page + 1}`}>
      <div className="first-run-stage">
        {page === 0 ? <IntroPage /> : null}
        {page === 1 ? <PlanPage /> : null}
        {page === PROFILE_PAGE ? <ProfilePage profile={profile} onChange={setProfile} /> : null}
        {page === 3 ? <ChangePage /> : null}
        {page === LAST_PAGE ? <JourneyPage /> : null}
      </div>
      <footer className="first-run-controls">
        <nav className="first-run-dots" aria-label={`Tour steps. Step ${page + 1} of 5`}>
          {STEP_LABELS.map((label, index) => {
            const disabled = initial.status !== "ready" && index > PROFILE_PAGE;
            return <button
              aria-current={index === page ? "step" : undefined}
              aria-label={`Go to step ${index + 1}: ${label}`}
              className={index === page ? "active" : index < page ? "complete" : ""}
              disabled={disabled}
              key={label}
              onClick={() => goToPage(index)}
              type="button"
            />;
          })}
        </nav>
        <button className="first-run-next" type="button" onClick={() => void next()} disabled={saving || (page === PROFILE_PAGE && !profileValid)}>
          {saving ? "Saving…" : page === LAST_PAGE ? "Create My First Plan" : "Next"}
        </button>
      </footer>
    </section>
  </div>;
}

function IntroPage() {
  return <article className="first-run-page intro-page">
    <h1 id="first-run-title-1">Tell me where you want to go.</h1>
    <div className="intro-layout">
      <div className="intro-chat">
        <img src={landiIconUrl} alt="Landi" />
        <p>I'm thinking of a trip to Japan for 10 days. I love food, culture and modern cities.</p>
        <p>Sounds amazing! I'll create a personalized plan for you.</p>
      </div>
      <span className="tour-arrow" aria-hidden="true">➜</span>
      <section className="tour-trip-card">
        <img src={fujiUrl} alt="Mount Fuji" />
        <div><h2>Japan Trip</h2><p>⌖ Tokyo, Osaka</p><p>▣ Apr 5 – Apr 14, 2025</p></div>
      </section>
    </div>
  </article>;
}

function PlanPage() {
  const stops = [
    [sensoJiUrl, "Senso-ji Temple", "9:00 AM – 11:00 AM"],
    [tsukijiUrl, "Tsukiji Outer Market", "11:00 AM – 1:00 PM"],
    [teamLabUrl, "teamLab Planets", "2:00 PM – 4:00 PM"],
    [shibuyaUrl, "Shibuya Crossing", "5:00 PM – 7:00 PM"]
  ];
  return <article className="first-run-page plan-page">
    <h1 id="first-run-title-2">Fine-tune it your way.</h1>
    <div className="plan-page-layout">
      <section className="tour-itinerary">
        <header><strong>Tokyo</strong><small>Apr 5 · Day 1</small></header>
        {stops.map(([image, title, time], index) => <div className={index === 1 ? "selected" : ""} key={title}>
          <span className="tour-grip">⠿</span><img src={image} alt="" /><p><strong>{title}</strong><small>{time}</small></p>
        </div>)}
      </section>
      <div className="tour-map" role="img" aria-label="Tokyo itinerary map"><img src={itineraryMapUrl} alt="" /></div>
    </div>
  </article>;
}

function ProfilePage({ profile, onChange }: { profile: Profile; onChange: (profile: Profile) => void }) {
  return <article className="first-run-page profile-page">
    <h1 id="first-run-title-3">Tell me once, and that’s enough.</h1>
    <div className="profile-page-layout">
      <section className="tour-profile-card" aria-label="Your Landi profile">
        <label className="tour-profile-name">
          <img src={landiIconUrl} alt="Landi" />
          <input aria-label="Name" placeholder="New explorer" value={profile.displayName} onChange={(event) => onChange({ ...profile, displayName: event.target.value })} />
        </label>
        <ProfileInput label="Language" placeholder="e.g. English" value={profile.preferredLanguage} onChange={(value) => onChange({ ...profile, preferredLanguage: value })} />
        <ProfileInput label="Travel preferences" placeholder="Food, culture, nature" value={profile.travelPreferences ?? ""} onChange={(value) => onChange({ ...profile, travelPreferences: value })} />
        <label className="tour-profile-field visa"><span>Destination visa or residence status</span><select aria-label="Destination visa or residence status" value={profile.immigrationStatus} onChange={(event) => onChange({ ...profile, immigrationStatus: event.target.value as ImmigrationStatus })}><option value="unknown" disabled>Select</option><option value="no_visa">No visa or residence permit yet</option><option value="short_term_visitor">Short-term visitor</option><option value="tourist_visa">Tourist visa</option><option value="student_visa">Student visa</option><option value="work_visa">Work visa</option><option value="residence_permit">Residence permit</option><option value="other">Other</option></select></label>
      </section>
      <div className="tour-destinations" aria-label="Personalized destinations">
        <DestinationCard className="japan" image={destinationJapanUrl} title="Japan" date="Oct 2025" />
        <DestinationCard className="london" image={destinationLondonUrl} title="London" date="Apr 2026" />
        <DestinationCard className="singapore" image={singaporeUrl} title="Singapore" date="Aug 2026" />
      </div>
    </div>
  </article>;
}

function ProfileInput({ label, placeholder, value, onChange }: { label: string; placeholder: string; value: string; onChange: (value: string) => void }) {
  return <label className="tour-profile-field"><span>{label}</span><input aria-label={label} placeholder={placeholder} value={value} onChange={(event) => onChange(event.target.value)} /></label>;
}

function DestinationCard({ className, image, title, date }: { className: string; image: string; title: string; date: string }) {
  return <article className={`tour-destination ${className}`} style={{ backgroundImage: `url(${image})` }}><div><strong>{title}</strong><small>{date}</small></div></article>;
}

function ChangePage() {
  const rows = [
    ["10:00", skytreeUrl, "Tokyo Skytree"],
    ["12:30", asakusaLunchUrl, "Lunch at Asakusa"],
    ["15:00", teamLabRainUrl, "Free time (indoor)"],
    ["17:00", uenoParkUrl, "Ueno Park (National Museum)"]
  ];
  return <article className="first-run-page change-page">
    <h1 id="first-run-title-4">Stay ahead of every change.</h1>
    <div className="change-page-layout">
      <div className="change-summary">
        <section className="tour-flight"><img src={flightDelayPlaneUrl} alt="Airplane" /><div><strong>JL 708</strong><span>HND → ITM</span><small>Oct 12, 10:20</small></div><p><b>Flight delayed</b><span>Now departs 11:50</span></p></section>
        <img className="tour-weather" src={weatherCardUrl} alt="Tokyo rain forecast" />
        <section className="tour-moved"><img src={uenoParkUrl} alt="Ueno Park" /><p><strong>Ueno Park<br />(National Museum)</strong><del>Originally 3:00 PM</del><b>Move to 5:00 PM</b></p></section>
      </div>
      <section className="tour-updated-plan"><header><strong>Updated Plan</strong><small>Mon, Oct 13</small></header>{rows.map(([time, image, title], index) => <div className={index === 3 ? "active" : ""} key={time}><time>{time}</time><i /><p><img src={image} alt="" /><strong>{title}</strong></p></div>)}</section>
    </div>
  </article>;
}

function JourneyPage() {
  return <article className="first-run-page journey-page">
    <h1 id="first-run-title-5">A personal assistant for your entire journey.</h1>
    <div className="journey-page-layout">
      <div className="tour-services">
        <Service icon={<CalendarDays aria-hidden="true" />} title="Plan the day" copy="Keep your trip organized." />
        <Service icon={<CarFront aria-hidden="true" />} title="Get a ride" copy="Quick help with taxis and routes." />
        <Service icon={<Utensils aria-hidden="true" />} title="Find food" copy="Nearby places to eat, when you need them." />
      </div>
      <img className="tour-phone" src={phoneUrl} alt="Landi notifications on a phone" />
    </div>
  </article>;
}

function Service({ icon, title, copy }: { icon: ReactNode; title: string; copy: string }) {
  return <section><span>{icon}</span><p><strong>{title}</strong><small>{copy}</small></p></section>;
}
