import { ASSISTANT_PERSONALITIES, resolveAssistantPersonality, type AssistantPersonalityId } from '@c-assistant/core/assistant-personality';
import './personality-picker.css';
import './onboarding-personality.css';
import lucaAvatar from './assets/personas/luca.svg';
import cocoAvatar from './assets/personas/coco.svg';
import milesAvatar from './assets/personas/miles.svg';

const avatars = { local_insider: lucaAvatar, travel_buddy: cocoAvatar, miles: milesAvatar };

export function PersonalityPicker({ value, onChange, variant = 'settings' }: { variant?: 'settings' | 'onboarding'; value?: AssistantPersonalityId | undefined; onChange: (value: AssistantPersonalityId) => void }) {
  const selected = resolveAssistantPersonality(value);
  if (variant === 'onboarding') return <div className="onboarding-people" role="group" aria-label="Assistant personality">
    {ASSISTANT_PERSONALITIES.map(personality => <button type="button" key={personality.id}
      className="onboarding-person" aria-label={`Choose ${personality.name}. ${personality.tagline}`}
      aria-pressed={selected.id === personality.id} onClick={() => onChange(personality.id)}>
      <span className="onboarding-avatar-ring">
        <img className={`onboarding-avatar ${personality.id}`} src={avatars[personality.id]} alt="" />
        <span className="onboarding-selected-check" aria-hidden="true"><svg width="13" height="13" viewBox="0 0 20 20" fill="none"><path d="M4 10l4 4 8-8" stroke="currentColor" strokeWidth="2.7" strokeLinecap="round" strokeLinejoin="round" /></svg></span>
      </span>
      <span className="onboarding-person-name">{personality.name}</span>
      <span className="onboarding-person-description">{personality.tagline}</span>
    </button>)}
  </div>;
  return <div className="personality-picker">
    <div className="personality-options" role="group" aria-label="Assistant personality">
      {ASSISTANT_PERSONALITIES.map(personality => <button type="button" key={personality.id}
        className={`personality-option ${selected.id === personality.id ? 'selected' : ''}`}
        aria-pressed={selected.id === personality.id} onClick={() => onChange(personality.id)}>
        <img className="personality-avatar" src={avatars[personality.id]} alt="" /><div className="personality-option-copy"><strong>{personality.name}</strong><span>{personality.tagline}</span></div>
      </button>)}
    </div>
  </div>;
}
